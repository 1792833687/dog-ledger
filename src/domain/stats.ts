import type { AppData, Money } from './types'
import { dogsOfBatch } from './costing'

/**
 * 「报」页的两个纯函数：钱花在哪了（成本结构）、我这批狗是不是死太多了（死亡率趋势）。
 *
 * 抽到 `domain/` 而不是写在页面里，是为了能单测：页面上那两个数字要跟别的页面对得上，
 * 靠肉眼看是看不出来的（这一节的 `total` 必须与 Task 12 的排行块用同一个分母）。
 */

/** 成本结构里的一行：某个分类花了多少、占全部支出的多少。 */
export interface CostShare {
  /** `LedgerEntry.category`，也就是 `CostItemDef.id`（未知分类原样保留，方便排查） */
  category: string
  /** 分类的中文名 */
  name: string
  totalFen: Money
  /** 0~1；全部支出为 0 时是 0（不是 NaN） */
  share: number
}

/**
 * 钱花在哪了：按 `category` 汇总**支出**流水，金额降序。
 *
 * 只统计 `type === 'expense'`：收入不是成本，注资/报销/分红是钱在账本内搬家，
 * 把它们算进「成本结构」会让占比彻底失真。
 *
 * 返回顺序按 `totalFen` 降序（`Array.prototype.sort` 是稳定的，金额相同的两项
 * 保持「先出现的分类在前」）。
 */
export function costBreakdown(data: AppData): CostShare[] {
  const totals = new Map<string, Money>()
  for (const e of data.entries) {
    if (e.type !== 'expense') continue
    totals.set(e.category, (totals.get(e.category) ?? 0) + e.amount)
  }

  // 分母 = 全部支出之和，与「报」页顶部那个「总支出」（`ledger.ts` 的 totalExpense）
  // 是同一个数：两处都是「所有 expense 流水求和」。
  const sum = [...totals.values()].reduce((s, v) => s + v, 0)

  return [...totals.entries()]
    .map(([category, totalFen]) => ({
      category,
      name: costItemName(data, category),
      totalFen,
      // sum === 0 时才可能除零（真记过一笔 0 元支出）：返回 0 而不是 NaN，
      // 否则界面上会显示「NaN%」，比不显示更糟。
      share: sum === 0 ? 0 : totalFen / sum,
    }))
    .sort((a, b) => b.totalFen - a.totalFen)
}

/**
 * 分类 id → 中文名，查不到回落 `'其他'`。
 *
 * 这段与 `src/ui/moneyBook.ts:51-53` 的 `catLabel` **逻辑重复是有意的**：
 * `src/domain/` 按本仓的 Global Constraints 不许 import `src/ui/*`（domain 是纯的、
 * 能被单测、不依赖 React），所以这里自己解析一份。**别为了 DRY 把 ui 依赖引进 domain。**
 *
 * 与 `catLabel` 的唯一差别：`catLabel` 先查一张「非成本项」表（`sale` / `transfer` 之类），
 * 那些值只会出现在 `income` / `injection` / `reimbursement` / `distribution` 流水上，
 * 而本函数只看 `expense`（其 category 恒为某个 `CostItemDef.id`，见 `types.ts:131`），
 * 所以那张表在这里用不上。
 *
 * ⚠️ 这个回落在本仓**真的会走到**：设置页的成本项只加不删（`SettingsPanel.tsx:205-231`），
 * 但备份 JSON 是可以被外部编辑或从别处导入的（`storage/backup.ts`），
 * 那时 `entries` 里就可能带着 `costItems` 里没有的 category。
 * 换句话说：不要把它当防御性代码删掉。
 */
function costItemName(data: AppData, category: string): string {
  return data.settings.costItems.find(c => c.id === category)?.name ?? '其他'
}

/** 死亡率趋势上的一点：某个批次死了多少、比上一批好还是坏。 */
export interface MortalityPoint {
  batchId: string
  name: string
  date: string
  /** 0~1，dead / total */
  rate: number
  dead: number
  /** 该批次的**全部**狗（含在库/已售/死亡/退回） */
  total: number
  /**
   * 本批 `rate` 减去**按日期排序后**前一批的 `rate`。
   * 第一批是 `null`（「首批」和「与上一批持平」是两件事），持平是 `0`。
   */
  deltaFromPrevious: number | null
}

/**
 * 死亡率趋势：每个批次一条，按日期升序（老的在前）。
 *
 * 分母 `total` 用「该批次的全部狗」而不是「存活数」：死亡率 = 死了几只 / 这批本来有几只，
 * 退回的狗也算在分母里（它还得再卖一次，见 `costing.ts:27-30` 的 `inStockCount`）。
 * **这个数与「报」页排行块用的 `sold + dead + inStock` 恒等** —— 两页给出不同的死亡率，
 * 用户就不知道该信哪个了。
 *
 * 同一天多个批次时保持 `data.batches` 里的原顺序：`sort` 是稳定的，不要为此另加排序键。
 */
export function mortalityTrend(data: AppData): MortalityPoint[] {
  // 先复制再排序：`sort` 是原地排序，直接对 `data.batches` 排会改掉入参。
  const sorted = [...data.batches].sort((a, b) => {
    if (a.date < b.date) return -1
    if (a.date > b.date) return 1
    return 0
  })

  const rows = sorted.map(batch => {
    const dogs = dogsOfBatch(data, batch.id)
    const total = dogs.length
    const dead = dogs.filter(d => d.status === 'dead').length
    return {
      batchId: batch.id,
      name: batch.name,
      date: batch.date,
      dead,
      total,
      // 空批次不除零。
      rate: total === 0 ? 0 : dead / total,
    }
  })

  return rows.map((row, i) => {
    const previousRate = i === 0 ? null : rows[i - 1].rate
    return {
      ...row,
      deltaFromPrevious: previousRate === null ? null : row.rate - previousRate,
    }
  })
}
