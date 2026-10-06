import type { AppData, LedgerEntry, Money } from './types'
import { newId } from './types'
import { dogsOfBatch } from './costing'

/**
 * 补账表：从卖家那儿把狗拉回来之后，把这一批该记的成本一次补进账。
 *
 * 这里是「**先做后补账**」（设计 D14）的后半截：收货那一刻只记收购款（`planning.ts` 的
 * `addBatchWithDogs`），运输 / 疫苗 / 检疫 / 处理费都还没有付、也还不知道各是多少，
 * 等真正付了钱再回来填这张表。
 *
 * 本文件**只负责「按只数生成几笔流水」**，不做任何成本汇总：
 * 「一批花了多少钱、每只摊多少」仍然只有 `costing.ts` 一处实现。
 *
 * 三条纪律：
 * - 纯函数，不修改传入的 `data`；找不到批次就原样返回同一引用。
 * - 不调用无参 `new Date()`：`date` 一律由调用方作为 `'YYYY-MM-DD'` 传进来。
 * - 只新增，绝不删除或改写既有流水 —— 用户自己手记的支出必须原样留着。
 */
export interface BatchCostsInput {
  batchId: string
  /** 补账的日期 YYYY-MM-DD */
  date: string
  /** 这一趟的油费 + 笼具（分，整批一笔） */
  transportFen: Money
  /** 每只疫苗医疗（分） */
  medicalPerDogFen: Money
  /** 每只狗的检疫费（分）：狂犬病免疫抗体检测 + 检疫申报跑腿 */
  quarantinePerDogFen: Money
  /** 每只病死犬的无害化处理费（分）。只按**点击那一刻**已标死亡的只数记 */
  disposalPerDogFen: Money
}

/**
 * 金额一律取整并挡掉负数，而且必须显式挡住院的 `NaN` / `Infinity`：
 * `Math.round(NaN)` 是 `NaN`，`Math.max(0, NaN)` **还是** `NaN` ——
 * 光靠 `Math.max(0, ...)` 会让 `NaN` 一路溜进金额里，把批次总成本污染成 `NaN`。
 */
function safeMoney(value: Money): Money {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.round(value))
}

/**
 * 这一次补账要新增哪几笔流水。**笔数口径只有这一处实现**：
 * `addBatchCosts` 与 `previewBatchCosts` 都必须走这里，
 * 否则「预览说 19 笔、点下去加了 17 笔」这种事迟早会发生。
 *
 * 填 0 的那一行一笔都不生成（与 `planning.ts` 的既有约定一致）。
 */
function plannedCostEntries(data: AppData, input: BatchCostsInput): LedgerEntry[] {
  const entries: LedgerEntry[] = []
  const base = {
    date: input.date, type: 'expense' as const, paidBy: 'pool' as const,
    payee: null, batchId: input.batchId, note: '',
  }

  const transportFen = safeMoney(input.transportFen)
  if (transportFen > 0) {
    // 运输是整批一笔，不挂到某只狗头上
    entries.push({ id: newId(), ...base, category: 'transport', amount: transportFen, dogId: null })
  }

  const dogs = dogsOfBatch(data, input.batchId)

  // 疫苗与检疫按**这一批的全部狗**算，不过滤状态：卖掉的、退回的、死了的当初都打过疫苗、
  // 都办过检疫 —— 这是用户口径（设计 §3.10）。
  const medicalPerDogFen = safeMoney(input.medicalPerDogFen)
  if (medicalPerDogFen > 0) {
    for (const dog of dogs) {
      entries.push({ id: newId(), ...base, category: 'medical', amount: medicalPerDogFen, dogId: dog.id })
    }
  }

  const quarantinePerDogFen = safeMoney(input.quarantinePerDogFen)
  if (quarantinePerDogFen > 0) {
    for (const dog of dogs) {
      entries.push({ id: newId(), ...base, category: 'quarantine', amount: quarantinePerDogFen, dogId: dog.id })
    }
  }

  // 无害化处理只对**点击这一刻已经标死亡**的狗发生。刻意不追溯：
  // 后来死的狗要再填一次这张表，补一笔 —— 自动追溯会悄悄改掉已经算过的账。
  const disposalPerDogFen = safeMoney(input.disposalPerDogFen)
  if (disposalPerDogFen > 0) {
    for (const dog of dogs) {
      if (dog.status === 'dead') {
        entries.push({ id: newId(), ...base, category: 'disposal', amount: disposalPerDogFen, dogId: dog.id })
      }
    }
  }

  return entries
}

/**
 * 这一批的成本是不是还没补过。
 *
 * 判据是「有没有一笔非收购款的支出」，**不能**用 `batchTotalCost(data, batchId) === 0` 代替：
 * 那个数含收购款，刚收完货就已经大于 0 了，永远判不出「还没补成本」。
 *
 * 用户自己手记任何一笔该批的非收购支出，也算补过了 —— 他记了账，界面就不该再提醒他。
 */
export function batchCostsIncomplete(data: AppData, batchId: string): boolean {
  return !data.entries.some(
    e => e.type === 'expense' && e.batchId === batchId && e.category !== 'purchase',
  )
}

export function addBatchCosts(data: AppData, input: BatchCostsInput): AppData {
  // 批次不存在就什么都不做，绝不凭空造出一批挂不上批次的流水
  if (!data.batches.some(b => b.id === input.batchId)) return data

  const entries = plannedCostEntries(data, input)
  if (entries.length === 0) return data

  return { ...data, entries: [...data.entries, ...entries] }
}

/** 补账前先让用户看一眼这次会加几笔、一共多少钱。只算这一次要新增的四行。 */
export function previewBatchCosts(data: AppData, input: BatchCostsInput): { count: number; totalFen: Money } {
  if (!data.batches.some(b => b.id === input.batchId)) return { count: 0, totalFen: 0 }

  const entries = plannedCostEntries(data, input)
  return {
    count: entries.length,
    totalFen: entries.reduce((sum, e) => sum + e.amount, 0),
  }
}
