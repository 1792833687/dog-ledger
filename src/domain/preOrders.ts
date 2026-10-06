import type { AppData, PreOrder } from './types'
import { addDays } from './quarantine'

/**
 * 预定单的阶段推导与排序（设计文档 §3.9）。
 *
 * 「预定单」是先去村里看狗、谈好、约好日子再回来收的那张单子：它**不是**没有狗的批次，
 * 不进任何批次统计，没有成本、没有盈亏。这一组函数只回答两个界面问题：
 * **哪几张该去收了**、**清单按什么顺序摆**。
 *
 * 三条纪律（与 `quarantine.ts` 同一套）：
 * 1. 纯函数，不改入参、不碰存储、不 import React。
 * 2. **本文件不出现无参 `new Date()`** ——「今天」一律由调用方以 `today: string`
 *    （`'YYYY-MM-DD'`）传入。
 * 3. `'YYYY-MM-DD'` 字符串直接比大小即可（字典序 = 时间序），不塞进 `new Date()`。
 *    往前推天数复用 `quarantine.ts:57` 的 `addDays`，不另写一份日期算术。
 */

export type PreOrderStage = 'upcoming' | 'due_soon' | 'overdue' | 'received' | 'cancelled'

/** `'YYYY-MM-DD'` 的形状。`addDays` 对不合形状的串会抛 RangeError，所以先在这里挡住。 */
const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/

/**
 * 这张预定单现在处于哪一步。**判定顺序固定，先命中先返回**：
 * `cancelled` → `received` → `overdue` → `due_soon` → `upcoming`。
 *
 * 三个容易做错的地方：
 * - **到日子那天算 `due_soon`**（「今天去收」），过了那天才算 `overdue`。
 * - **`collectDate` 不合法时返回 `'upcoming'`，绝不抛错**：`addDays` 对空串或
 *   `'不是日期'` 这类串会抛 `RangeError: Invalid time value`（`Date.UTC` 得出 NaN，
 *   `toISOString()` 直接炸），而这张单子可能是手改过的坏数据，界面不能因此白屏。
 * - 已取消 / 已收货**优先于任何日期判定**：一张 2020 年就取消掉的单子不该永远挂在
 *   「该去收了」里。
 */
export function preOrderStage(order: PreOrder, today: string, leadDays: number): PreOrderStage {
  if (order.status === 'cancelled') return 'cancelled'
  if (order.status === 'received') return 'received'
  // 坏数据的兜底必须在 addDays 之前：形状不对就当「还没到日子」。
  if (!DATE_SHAPE.test(order.collectDate)) return 'upcoming'
  if (today > order.collectDate) return 'overdue'
  if (today >= addDays(order.collectDate, -leadDays)) return 'due_soon'
  return 'upcoming'
}

/** 该去收了的张数 = `due_soon` 与 `overdue` 合起来（界面上两者本来就是同一句话「该去收了」）。 */
export function duePreOrderCount(data: AppData, today: string): number {
  let count = 0
  for (const order of data.preOrders) {
    const stage = preOrderStage(order, today, data.settings.preOrderLeadDays)
    if (stage === 'due_soon' || stage === 'overdue') count += 1
  }
  return count
}

/**
 * 分组的排序值：小的排前面。
 *
 * - `0`：该去收了的（`overdue` 与 `due_soon` 合成一组，界面上一句「有 N 张该去收了」）
 * - `1`：还没到日子的
 * - `2`：已经收完或黄掉的
 */
function groupOf(stage: PreOrderStage): number {
  if (stage === 'overdue' || stage === 'due_soon') return 0
  if (stage === 'upcoming') return 1
  return 2
}

/**
 * 清单的排序：先该去收的（按去收的日子升序），再还没到日子的（同样升序），
 * 最后已收货 / 已取消（按**建单时间降序**，最近处理的在最上面）。
 *
 * 同一天（或同一时刻）的用 `id` 兜底比较：不同设备上 `Array.prototype.sort` 的稳定性
 * 虽然已经写进规范，但让顺序**取决于输入数组的顺序**仍然不是好事 —— 同一份数据两次
 * 调用应当给出完全一样的结果，`id` 兜底能钉住这一点。
 */
export function preOrderList(data: AppData, today: string): { order: PreOrder; stage: PreOrderStage }[] {
  const leadDays = data.settings.preOrderLeadDays
  const items = data.preOrders.map(order => ({ order, stage: preOrderStage(order, today, leadDays) }))
  items.sort((a, b) => {
    const groupDiff = groupOf(a.stage) - groupOf(b.stage)
    if (groupDiff !== 0) return groupDiff
    if (groupOf(a.stage) === 2) {
      // 已收货 / 已取消：最近建单的排前面
      if (a.order.createdAt !== b.order.createdAt) return a.order.createdAt < b.order.createdAt ? 1 : -1
      return a.order.id < b.order.id ? -1 : 1
    }
    if (a.order.collectDate !== b.order.collectDate) return a.order.collectDate < b.order.collectDate ? -1 : 1
    return a.order.id < b.order.id ? -1 : 1
  })
  return items
}
