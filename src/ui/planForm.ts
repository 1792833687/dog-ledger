import type { Money, Settings } from '../domain/types'
import type { PlanInput } from '../domain/planning'
import { parseMoney } from '../domain/money'

/**
 * 决策台的表单在界面上是「9 个字符串」。这一层把字符串翻译成 domain 的 `PlanInput`，
 * 并把「解析不了」与「数值不可能」都变成给用户看的中文错误，而不是悄悄当成 0。
 *
 * 为什么不能悄悄当成 0：这是这个软件里最值钱的那个数字（保本价）的输入。
 * 用户把「每只收购价」打成 `６00`（全角）或 `600元`，如果按 0 算，界面会给出一个
 * 看起来正常、实际极低的保本价 —— 他会照着这个价出门亏钱。错的数字比没有数字危险得多。
 *
 * 纯函数，不碰 DOM、不碰 storage，所以可以脱离浏览器测试。
 */

/** 决策台里每一个可输入字段的名字。 */
export type PlanFieldKey =
  | 'n'
  | 'purchasePrice'
  | 'freight'
  | 'medicalPerDog'
  | 'quarantinePerDog'
  | 'disposalPerDog'
  | 'mortalityPercent'
  | 'targetPrice'

/** 字段名 -> 用户看得懂的中文错误。空对象表示全部合法。 */
export type PlanFieldErrors = Partial<Record<PlanFieldKey, string>>

export interface PlanTextForm {
  n: string
  purchasePrice: string
  freight: string
  medicalPerDog: string
  quarantinePerDog: string
  disposalPerDog: string
  /** 界面单位是「%」，例如 "25" 表示 25% */
  mortalityPercent: string
  targetPrice: string
}

/**
 * 今天的日期，YYYY-MM-DD，**按本机时区**。
 * 不用 `new Date().toISOString().slice(0, 10)`：那个是 UTC，在东八区的晚上 8 点之后
 * 会返回昨天，于是晚上出门收的狗记成了前一天的账。
 */
export function todayLocalIso(now: Date): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * 本机时区的「时:分」，24 小时制、两位补零，例如 "14:07"。
 * 和 `todayLocalIso` 一样不能用 toISOString()——那是 UTC，东八区会差 8 小时。
 *
 * 用途：一键建批次时把时间写进默认批次名（`收狗 2 只 14:07`）。同一天建两个**只数相同**
 * 的批次是很常见的事（上午收 2 只、下午又收 2 只），没有这个时间戳，批次选择器里就会出现
 * 两条读起来完全一样的选项，用户没法在界面上分辨它们。
 */
export function localTimeHm(now: Date): string {
  const h = String(now.getHours()).padStart(2, '0')
  const min = String(now.getMinutes()).padStart(2, '0')
  return `${h}:${min}`
}

/** 金额输入框的初始文本：分 -> 元的字符串（整数不拖小数点尾巴）。 */
export function fenToTextInput(fen: Money): string {
  return String(fen / 100)
}

/**
 * 由当前设置算出表单的初始文本。
 * 检疫费与病死犬处理费默认是 0 —— 那是「还不知道」，不是「不要钱」。
 * 界面会拿这个 0 去算，并在脚注里说明为什么这样会低估保本价。
 */
export function defaultPlanText(settings: Settings): PlanTextForm {
  return {
    n: '8',
    purchasePrice: '600',
    freight: '400',
    medicalPerDog: '80',
    quarantinePerDog: fenToTextInput(settings.quarantinePerDog),
    disposalPerDog: fenToTextInput(settings.disposalPerDog),
    mortalityPercent: String(Math.round(settings.expectedMortalityRate * 100)),
    targetPrice: '1200',
  }
}

/** 解析一个金额字段。空字符串按 0 处理；非空但解析不了则记错误。 */
function money(
  raw: string,
  fallback: Money,
  label: string,
  key: PlanFieldKey,
  errors: PlanFieldErrors,
): Money {
  const trimmed = raw.trim()
  if (trimmed === '') return fallback
  const parsed = parseMoney(trimmed)
  if (parsed === null) {
    errors[key] = `${label}填的不是一个数字`
    return fallback
  }
  if (parsed < 0) {
    errors[key] = `${label}不能是负数`
    return fallback
  }
  return parsed
}

/** 解析死亡率输入（界面单位是 %）。 */
export function parseMortalityPercent(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null
  const percent = Number(trimmed)
  if (!Number.isFinite(percent)) return null
  // 上界 99%：`plan` 内部对「全部死光」有兜底，但 100% 之上没有任何意义，
  // 与其把它 clamp 成一个用户没输入的数，不如让用户看见自己填错了。
  if (percent < 0 || percent > 99) return null
  return percent / 100
}

/** 解析「预计收几只」。空字符串按 0 处理（等于「还没填」）。 */
export function parseCount(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed === '') return 0
  if (!/^\d+$/.test(trimmed)) return null
  return Number(trimmed)
}

export interface ParsedPlanText {
  /** 可以直接喂给 `plan()` / `createBatchFromPlan()` 的入参 */
  input: PlanInput
  /** 空对象 = 全部合法。非空时界面不应展示保本价 */
  errors: PlanFieldErrors
}

/**
 * 把表单文本翻译成 `PlanInput`。
 *
 * `errors` 非空时 `input` 里的对应字段是兜底值，**不可用于展示结论**；
 * 调用方必须先把错误显示给用户。
 */
export function parsePlanText(form: PlanTextForm, settings: Settings): ParsedPlanText {
  const errors: PlanFieldErrors = {}

  const rawCount = parseCount(form.n)
  if (rawCount === null) errors.n = '只数要填一个整数'
  const n = rawCount ?? 0

  const mortalityRate = parseMortalityPercent(form.mortalityPercent)
  if (mortalityRate === null) {
    errors.mortalityPercent = '死亡率要填 0 到 99 之间的数字'
  }

  return {
    input: {
      n,
      purchasePrice: money(form.purchasePrice, 0, '每只收购价', 'purchasePrice', errors),
      freight: money(form.freight, 0, '油费 + 笼具', 'freight', errors),
      medicalPerDog: money(form.medicalPerDog, 0, '每只疫苗医疗', 'medicalPerDog', errors),
      quarantinePerDog: money(form.quarantinePerDog, 0, '每只检疫费', 'quarantinePerDog', errors),
      disposalPerDog: money(form.disposalPerDog, 0, '每只病死犬处理费', 'disposalPerDog', errors),
      targetPrice: money(form.targetPrice, 0, '打算卖的价', 'targetPrice', errors),
      mortalityRate: mortalityRate ?? settings.expectedMortalityRate,
    },
    errors,
  }
}
