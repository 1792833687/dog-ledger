import type { AppData, CostItemDef, EntryType, Money, Partner } from '../domain/types'
import { parseMoney, formatMoney } from '../domain/money'
import { addExpense, addInjection, addIncome, addReimbursement, addDistribution } from '../domain/actions'
import { advanceBalance } from '../domain/ledger'

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
 * 「记下」按钮能不能用。三个条件缺一不可：
 * 金额必须解析得出「分」；需要归属人的类型必须真的有归属人；报销不能超过垫付。
 *
 * 判定与 `submit()` 里的守卫共用这一个函数：两边各写一遍的话，
 * 迟早出现「按钮亮着但点了没反应」或者「按钮灰着但其实能记」。
 *
 * `advanceFen` 必须是**被选中那个人**当前的垫付余额（`advanceBalance(data, partnerId)`），
 * 只有 `reimbursement` 用得上；传错人的余额会算错账。
 */
export function canSubmit(
  dialog: BookDialog,
  amountInput: string,
  partnerId: string,
  advanceFen: Money,
): boolean {
  if (parseMoney(amountInput) === null) return false
  if (needsPartner(dialog) && partnerId === '') return false
  return !overAdvance(dialog, amountInput, advanceFen)
}

/**
 * 报销额是否超过了这个人当前的垫付余额（`ledger.ts:32` 的 `advanceBalance` 是纯减法，
 * 超报会让「垫付未还」变成负数，同时池子被多扣一笔）。
 *
 * 只有 `reimbursement` 有这条上限：支出超过任何余额都是正常的，
 * 注资与分红也没有「上限」这个概念。
 *
 * 金额解析不出来时返回 `false` —— 那种情况归 `amountInvalid` 管，
 * 两条红色提示绝不能同时出现（用户会以为填错了两个地方）。
 */
export function overAdvance(dialog: BookDialog, amountInput: string, advanceFen: Money): boolean {
  if (dialog !== 'reimbursement') return false
  const fen = parseMoney(amountInput)
  if (fen === null) return false
  return fen > advanceFen
}

/** 超报时的中文提示。必须把「现在只垫付了多少」说出来，否则用户不知道该改成多少。 */
export function overAdvanceHint(advanceFen: Money): string {
  return `该合伙人现在只垫付了 ${formatMoney(advanceFen)}，报销不能超过这个数`
}

/**
 * 金额输入非空但解析不出来（`abc`、`1200元`、`1e999`）。
 * 这种情况必须给中文提示 —— 只把按钮变灰，用户只会以为软件坏了。
 */
export function amountInvalid(amountInput: string): boolean {
  return amountInput.trim() !== '' && parseMoney(amountInput) === null
}

/** 记账弹窗里用户填的那张表。 */
export type BookingDraft = {
  dialog: BookDialog
  /** 用户输入的金额原文，还没解析。 */
  amountInput: string
  /** 钱的归属人：注资的注入人、报销与分红的收款人。 */
  partnerId: string
  /** 只有支出用得上：`CostItemDef.id`。 */
  category: string
  paidBy: 'pool' | string
  note: string
  /** `'YYYY-MM-DD'`。域层不取时间，一律由界面传进来。 */
  date: string
}

/**
 * 把弹窗里填的东西写进账。判定不过就**原样返回传入的 `data`**（同一个引用），
 * 一分钱都不写 —— 让「按钮灰着」与「点了真的不写账」由同一处决定。
 *
 * 垫付余额在这里自己算（按 `draft.partnerId`），调用方不需要、也不该把余额传进来：
 * 少一个能传错人的参数。
 */
export function applyBooking(data: AppData, draft: BookingDraft): AppData {
  const advanceFen = advanceBalance(data, draft.partnerId)
  if (!canSubmit(draft.dialog, draft.amountInput, draft.partnerId, advanceFen)) return data
  const fen = parseMoney(draft.amountInput)
  if (fen === null) return data
  // switch 覆盖 BookDialog 的全部成员且没有 default：将来多一种记账弹窗，
  // tsc 会在这里报「函数可能不返回 AppData」，而不是静默地少记一笔账。
  switch (draft.dialog) {
    case 'expense':
      return addExpense(data, {
        batchId: null,
        dogId: null,
        category: draft.category,
        amount: fen,
        paidBy: draft.paidBy,
        date: draft.date,
        note: draft.note,
      })
    case 'injection': return addInjection(data, draft.partnerId, fen, draft.date, draft.note)
    case 'income': return addIncome(data, fen, draft.date, draft.note)
    case 'reimbursement': return addReimbursement(data, draft.partnerId, fen, draft.date)
    case 'distribution': return addDistribution(data, draft.partnerId, fen, draft.date)
  }
}
