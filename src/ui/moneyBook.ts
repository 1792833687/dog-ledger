import type { CostItemDef, EntryType, Partner } from '../domain/types'
import { parseMoney } from '../domain/money'

/**
 * 「钱」页面的显示与提交判定。抽出来是为了能单测：这里的每一处判错都会直接
 * 影响用户看到什么、以及能不能把钱记进账。
 *
 * 全部是纯函数，不 import React。
 */

/** 记一笔的弹窗有哪几种。`expense` 之外都是池子与合伙人之间的钱。 */
export type BookDialog = 'expense' | 'income' | 'injection' | 'reimbursement' | 'distribution'

/**
 * 流水类型的名字。
 *
 * 标注成 `Record<EntryType, string>` 而不是 `Record<string, string>` 是故意的：
 * 前者是**穷尽检查**，将来 `EntryType` 多一个成员（比如「借款」），`tsc -b` 会当场报错
 * 提示这里漏了中文名；后者会静默漏过去，让英文 id 显示给用户。
 */
export const TYPE_LABEL: Record<EntryType, string> = {
  injection: '注资',
  expense: '支出',
  income: '收入',
  reimbursement: '报销',
  distribution: '分红',
}

/**
 * 不走设置里成本项表的分类名。`types.ts:129` 的约定是：
 * `income` 用 `'sale'`，`injection` / `reimbursement` / `distribution` 用 `'transfer'`。
 *
 * 值类型写成 `string | undefined` 而不是 `string`：查表查不到是**真的会发生**的
 * （用户可以在设置页自建成本项、备份文件可以被外部编辑），
 * 写成 `string` 会让下面那个 `??` 在类型上变成死代码，兜底就成了摆设。
 */
const NON_COST_CATEGORY: Record<string, string | undefined> = {
  sale: '收入',
  transfer: '转账',
}

/**
 * 分类的中文名。
 *
 * 顺序是「非成本项表 → 设置里的成本项表 → 其他」。**绝不能硬编码一张成本项表**：
 * 它会漏掉 `quarantine` 与 `disposal` 两个内置项，而且用户自建的成本项会以英文 id
 * 直接显示在流水列表里（违反「界面文案用中文」）。
 */
export function catLabel(costItems: CostItemDef[], id: string): string {
  return NON_COST_CATEGORY[id] ?? costItems.find(c => c.id === id)?.name ?? '其他'
}

/**
 * 流水行的标题。有两种情况只显示类型名：
 * - 分类名与类型名相同：卖狗收入会显示成「收入 · 收入」；
 * - 分类是 `'transfer'`：`types.ts:129` 规定 `injection` / `reimbursement` /
 *   `distribution` 一律用这个值，它对自己的类型不含任何额外信息，
 *   显示成「注资 · 转账」只是把接口约定泄漏给用户。
 */
export function entryLabel(costItems: CostItemDef[], type: EntryType, category: string): string {
  const typeLabel = TYPE_LABEL[type]
  if (category === 'transfer') return typeLabel
  const cat = catLabel(costItems, category)
  return cat === typeLabel ? typeLabel : `${typeLabel} · ${cat}`
}

/**
 * 合伙人的名字。查不到就显示原始 id —— 宁可见到一个 id，
 * 也不要显示空白让人以为这笔钱没有归属。
 */
export function partnerName(partners: Partner[], id: string): string {
  return partners.find(p => p.id === id)?.name ?? id
}

/**
 * 这三种钱必须指明归属人。`data.settings.partners` 是空数组时 `partnerId` 初值是 `''`，
 * 放任下去会记出一笔**没有归属的钱**：`contributedCapital` / `advanceBalance` /
 * `distributedTo` 全都统计不到它，池子少了钱却没人认领。
 */
export function needsPartner(dialog: BookDialog): boolean {
  return dialog === 'injection' || dialog === 'reimbursement' || dialog === 'distribution'
}

/**
 * 「记下」按钮能不能用。两个条件缺一不可：
 * 金额必须解析得出「分」，需要归属人的类型必须真的有归属人。
 *
 * 判定与 `submit()` 里的守卫共用这一个函数：两边各写一遍的话，
 * 迟早出现「按钮亮着但点了没反应」或者「按钮灰着但其实能记」。
 */
export function canSubmit(dialog: BookDialog, amountInput: string, partnerId: string): boolean {
  if (parseMoney(amountInput) === null) return false
  return !needsPartner(dialog) || partnerId !== ''
}

/**
 * 金额输入非空但解析不出来（`abc`、`1200元`、`1e999`）。
 * 这种情况必须给中文提示 —— 只把按钮变灰，用户只会以为软件坏了。
 */
export function amountInvalid(amountInput: string): boolean {
  return amountInput.trim() !== '' && parseMoney(amountInput) === null
}
