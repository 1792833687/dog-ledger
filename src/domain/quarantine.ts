import type { AppData, Dog, Settings } from './types'
import { dogsOfBatch } from './costing'

/**
 * 检疫阶段推导（设计文档 §3.7）。
 *
 * 这一组函数回答一个业务问题：**这只狗现在能不能卖。**
 * 《动物防疫法》第二十九条、第九十七条：没有《动物检疫合格证明》就出售，没收 + 货值
 * 15~30 倍罚款（货值不足一万的处 5 万~15 万），负责人 5 年禁业。所以「能不能卖」
 * 不是界面上一个好看的状态色，它是一道法定闸门。
 *
 * 三条纪律：
 * 1. 全是纯函数，不改入参、不碰存储、不 import React。
 * 2. **本文件不出现无参 `new Date()`** ——「今天」一律由调用方以 `today: string`
 *    （`'YYYY-MM-DD'`）传入。日期算术全部走 `Date.UTC`，不用本地时区方法：
 *    `new Date('2026-10-02')` 按 UTC 解析却拿本地时区方法读，晚上会差一天。
 * 3. `'YYYY-MM-DD'` 字符串直接比大小即可（字典序 = 时间序），不必转成 Date。
 */

export type QuarantineStage =
  | 'unvaccinated'
  | 'waiting_antibody'
  | 'ready_to_test'
  | 'waiting_cert'
  | 'certified'
  | 'cert_expired'

export interface QuarantineStatus {
  stage: QuarantineStage
  /** 中文标签，直接给界面用 */
  label: string
  /** 中文：下一步该做什么 */
  nextAction: string
  /** 仅 waiting_antibody 时有值；其余 null */
  daysUntilTestable: number | null
  isSellable: boolean
}

/** 阶段的中文标签。`Record<QuarantineStage, string>` 是穷尽的：加一个阶段而忘了写标签，tsc 会报错。 */
const LABEL: Record<QuarantineStage, string> = {
  unvaccinated: '未接种狂犬疫苗',
  waiting_antibody: '等待抗体检测期',
  ready_to_test: '可以送检',
  waiting_cert: '待申报检疫',
  certified: '可出售',
  cert_expired: '检疫证明已过期',
}

const DAY_MS = 86400000

/**
 * 把一个 `'YYYY-MM-DD'` 往后推 `days` 天（可为负）。
 *
 * 全程 UTC：`Date.UTC(y, m - 1, d)` 定基点、`setUTCDate` 加减、`toISOString` 取回来。
 * 用本地时区方法（`setDate` / `getDate`）会在 UTC+8 的晚上把日期算错一天。
 */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const base = new Date(Date.UTC(y, m - 1, d))
  base.setUTCDate(base.getUTCDate() + days)
  return base.toISOString().slice(0, 10)
}

/** `toIso - fromIso` 的天数（可为负）。两侧都按 UTC 解析，差值除以一天的毫秒数。 */
export function daysBetween(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split('-').map(Number)
  const [ty, tm, td] = toIso.split('-').map(Number)
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / DAY_MS)
}

/** 下一步做什么。`waiting_cert` 的申报提前天数跟着设置走（默认 3 天，`Settings.quarantineLeadDays`）。 */
function nextActionOf(stage: QuarantineStage, daysUntilTestable: number | null, leadDays: number): string {
  switch (stage) {
    case 'unvaccinated':
      return '先带去接种狂犬疫苗'
    case 'waiting_antibody':
      // daysUntilTestable 在 waiting_antibody 时必定有值（同一条分支里算出来的）
      return `再等 ${daysUntilTestable ?? 0} 天才能采血送检`
    case 'ready_to_test':
      return '去采血做免疫抗体检测'
    case 'waiting_cert':
      return `提前 ${leadDays} 天向当地动物卫生监督机构申报`
    case 'certified':
      return '已具备检疫证明，可以出售'
    case 'cert_expired':
      return '必须重新申报检疫，不能用旧证出售'
  }
}

/**
 * 推导这只狗当前的检疫阶段。
 *
 * 判定顺序就是下面这个顺序，第一个匹配的即为结果（顺序本身是业务规则，不是实现细节）：
 * 没接种 → 证明过期 → 有有效证明 → 已检测等证明 → 等够天数可送检 → 还在抗体等待期。
 *
 * 「先判过期再判有效」很容易写反：写反了过期证会被当成有效的可出售证明。
 *
 * 触发一次复核点：**`rabiesVaccinatedOn === null` 时一律判 `unvaccinated`**，即使手里有一张
 * 看起来有效的证明（任务书第 1 条把 `unvaccinated` 排在第一位，设计 §3.7 的表也是这个次序）。
 * 代价是真实的：从繁育基地接手一只「证随狗走、接种日期不详」的狗时，界面会说「先带去接种
 * 狂犬疫苗」并挡住出售 —— 而它其实是能卖的。收益是台账缺一环就不算可售，不会放走一只
 * 检疫链断掉的狗（货值 15~30 倍罚款）。这是一个口径选择，不是笔误；若裁定反过来（有证明
 * 即可售），把 `certNo`/`validUntil` 那个分支挪到最前面即可，`quarantine.test.ts` 里钉住
 * 当前行为的用例会立刻变红，不会静默改变。
 */
export function quarantineStatus(dog: Dog, settings: Settings, today: string): QuarantineStatus {
  const vaccinatedOn = dog.rabiesVaccinatedOn
  const certNo = dog.quarantineCertNo.trim()
  const validUntil = dog.quarantineCertValidUntil

  let stage: QuarantineStage
  let daysUntilTestable: number | null = null

  if (vaccinatedOn === null) {
    stage = 'unvaccinated'
  } else if (certNo !== '' && validUntil !== null) {
    // 证明编号与有效期齐了才算「有证明」；过期判定必须排在 certified 前面
    stage = validUntil < today ? 'cert_expired' : 'certified'
  } else if (dog.antibodyTestedOn !== null) {
    stage = 'waiting_cert'
  } else if (daysBetween(vaccinatedOn, today) >= settings.rabiesWaitDays) {
    // 满当天即可送检：差一天都不行，正好等于就放行
    stage = 'ready_to_test'
  } else {
    stage = 'waiting_antibody'
    daysUntilTestable = settings.rabiesWaitDays - daysBetween(vaccinatedOn, today)
  }

  return {
    stage,
    label: LABEL[stage],
    nextAction: nextActionOf(stage, daysUntilTestable, settings.quarantineLeadDays),
    daysUntilTestable,
    isSellable: stage === 'certified',
  }
}

/**
 * 能不能出售。**直接复用 `quarantineStatus` 的结果**，不另写一套判定：
 * 两套判定意味着将来改口径时总有一套会漏掉，而漏掉的那一套会放走一只不该卖的狗。
 */
export function isSellable(dog: Dog, settings: Settings, today: string): boolean {
  return quarantineStatus(dog, settings, today).isSellable
}

/**
 * 距离证明到期还有几天（负数表示已过期）。
 * 没有填有效期就返回 `null` —— 「不知道」和「还剩 0 天」是两件事，界面要分开显示。
 */
export function certExpiresIn(dog: Dog, today: string): number | null {
  const validUntil = dog.quarantineCertValidUntil
  if (validUntil === null) return null
  return daysBetween(today, validUntil)
}

/** 还在我们账上的狗：在库 + 退回来的（它又站在笼子里，还得再卖一次）。 */
function isOnHand(dog: Dog): boolean {
  return dog.status === 'in_stock' || dog.status === 'returned'
}

export interface SaleCheckEntry {
  dog: Dog
  status: QuarantineStatus
}

export interface PreSaleChecklist {
  /** 现在就能卖的狗 */
  sellable: Dog[]
  /** 在库但不能卖的狗，带上完整的检疫状态供界面说明原因 */
  blocked: SaleCheckEntry[]
}

/**
 * 出栏前检查清单：这批狗里哪些现在能卖、哪些不能、为什么不能。
 *
 * **只统计「还在我们账上」的狗**（`in_stock` / `returned`）。死狗与已售狗不在笼子里，
 * 把它们算成「不能卖」会让「在库 N 只里有 M 只不能卖」这句话失去意义。
 */
export function preSaleChecklist(data: AppData, batchId: string, today: string): PreSaleChecklist {
  const sellable: Dog[] = []
  const blocked: SaleCheckEntry[] = []
  for (const dog of dogsOfBatch(data, batchId)) {
    if (!isOnHand(dog)) continue
    const status = quarantineStatus(dog, data.settings, today)
    if (status.isSellable) sellable.push(dog)
    else blocked.push({ dog, status })
  }
  return { sellable, blocked }
}

/**
 * 在库狗的阶段分布。**6 个 key 全部存在**（没有的填 0），界面可以直接遍历渲染，
 * 不必自己补零。与 `preSaleChecklist` 同口径：只统计在库的狗。
 */
export function quarantineSummary(data: AppData, batchId: string, today: string): Record<QuarantineStage, number> {
  const counts: Record<QuarantineStage, number> = {
    unvaccinated: 0,
    waiting_antibody: 0,
    ready_to_test: 0,
    waiting_cert: 0,
    certified: 0,
    cert_expired: 0,
  }
  for (const dog of dogsOfBatch(data, batchId)) {
    if (!isOnHand(dog)) continue
    counts[quarantineStatus(dog, data.settings, today).stage] += 1
  }
  return counts
}
