import { parseMoney } from '../domain/money'
import type { AppData, LedgerEntry, Money } from '../domain/types'
import { lastSaleIndex, refundedCurrentSale } from './dogLedger'

/**
 * 「钱」页面「就地改一笔 / 删一笔」的判断层。
 *
 * 为什么要有这一层：`domain/actions.ts` 里的 `updateEntry` / `deleteEntry` 是**照做**的执行者
 * —— 它不会替你判断「这个草稿该不该写」和「删掉这一笔到底会发生什么」。界面上要显示红字、
 * 要禁用按钮、要在确认弹窗里把后果说清楚，如果这些都写在 JSX 里，就没法单独测；
 * 而这三件事判错的代价都是**账**：金额写岔、把用户没碰的字段一起写掉、或者
 * 弹窗承诺「这只狗会回到在库」而它其实不会。
 *
 * 这里全是纯函数：同一份输入永远同一个输出，不碰 `Date`、不碰库。
 */

/** 「钱」页面里一笔流水在编辑框里的样子（金额是**元**的字符串，不是分）。 */
export interface EntryDraft {
  amount: string
  date: string
  note: string
  paidBy: 'pool' | string
  category: string
}

/** `updateEntry` 认的那几个键。界面能改的字段就这么多，`id`/`type`/挂靠都不在里面。 */
export interface EntryPatch {
  amount?: Money
  date?: string
  note?: string
  paidBy?: string
  category?: string
}

/**
 * 把库里的流水还原成编辑框里的草稿。
 *
 * 金额按**元**写回去（`String(fen / 100)`）：用户的直觉是「这笔 60 元」，不是「6000 分」；
 * 整数元不带小数点（`5000` → `'50'`），不然打开弹窗就看见一个 `'50.0'`。
 */
export function entryDraftFrom(entry: LedgerEntry): EntryDraft {
  return {
    amount: String(entry.amount / 100),
    date: entry.date,
    note: entry.note,
    paidBy: entry.paidBy,
    category: entry.category,
  }
}

/**
 * 草稿 → `updateEntry` 的 patch：**只带真正改了的键**。
 *
 * 为什么非这么严：`updateEntry` 没提到的键取原值，提到的键就照写。要是这里图省事把五个键
 * 全带上，用户在备注里加一个字，金额也一并被写一遍 —— 金额走的是 `Math.max(0, Math.round(x))`，
 * 而 `parseMoney` 认负数、认 `¥`、认千分位，于是「只改备注」这条路随时可能顺手改掉金额。
 * 空对象是**合法且有用**的返回值：没改就什么都没有，`updateEntry` 于是返回同一引用，界面直接关弹窗。
 */
export function entryPatch(entry: LedgerEntry, draft: EntryDraft): EntryPatch {
  const patch: EntryPatch = {}

  const fen = parseMoney(draft.amount.trim())
  // 负数一个字节都不送：`updateEntry` 会把负数夹成 0，那等于把用户想改的那笔账悄悄改成 0 元
  // ——「什么都没发生」比「变成 0」好。界面上这种草稿本来就点不下去（见 `entryDraftIssue`），
  // 这里挡的是将来的另一个调用方。
  if (fen !== null && fen >= 0 && fen !== entry.amount) patch.amount = fen

  const date = draft.date.trim()
  if (date !== '' && date !== entry.date) patch.date = date

  // 备注**不 trim**：用户写的空格是他自己写的，我们只负责原样存回去。
  // `undefined` 是「别动」，空串才是「清空」—— 这个区别就是这里 `!==` 判等判出来的。
  if (draft.note !== entry.note) patch.note = draft.note

  if (draft.paidBy !== entry.paidBy) patch.paidBy = draft.paidBy

  // 类别只有支出能改（`updateEntry` 也只对 `expense` 采纳）：
  // 收入/注资/报销/分红的类别是「这笔钱是什么性质」，改它等于换一种账。
  if (entry.type === 'expense' && draft.category !== entry.category) patch.category = draft.category

  return patch
}

/**
 * 草稿有什么不对，返回红字；没问题返回 null。红字与「按钮禁用」用的是同一个判断
 * （`patch === null` 就等于草稿不合法），不会出现「有红字但按钮还亮着」。
 *
 * `entry` 参与判断的地方只有一处：支出的类别不能空。这一项正常选不出来空值，
 * 但设置里删掉一个成本项之后，老流水会留下一个不在表里的 id —— 那种仍然让它保存
 * （改自己的数据是用户的事），只有真的成了空串才拦。
 */
export function entryDraftIssue(entry: LedgerEntry, draft: EntryDraft): string | null {
  const raw = draft.amount.trim()
  if (raw === '') return '金额不能空着，填个数（单位是元）'
  const fen = parseMoney(raw)
  if (fen === null) return '金额只能填数字，例如 1200 或 1200.5'
  if (fen < 0) return '金额不能是负数'
  if (draft.date.trim() === '') return '日期不能空着，这笔账要记在哪一天？'
  if (entry.type === 'expense' && draft.category.trim() === '') return '类别不能空着，选一个'
  return null
}

/**
 * 一笔流水挂在哪只狗 / 哪一批上：`狗 收狗 3 只 09:10-2` / `批次 10月3日李村` / `—`。
 *
 * 用狗的 `code` 而不是库里那个 uuid（用户看到 uuid 只会更糊涂）。**狗号是收货那天写下的快照，
 * 批次改名字不追溯它** —— 于是「狗号里的批次名」与「批次现在的名字」不一致是**正常**情况，
 * 不是 bug，别去「修正」它：那会把当初的留痕抹掉。
 *
 * 挂靠的东西查不到时给 `—`，不显示一个光秃秃的编号 —— 那看着像一笔有归属的账，其实是孤儿。
 */
export function entryScope(data: AppData, entry: LedgerEntry): string {
  if (entry.dogId !== null) {
    const dog = data.dogs.find(d => d.id === entry.dogId)
    return dog === undefined ? '—' : `狗 ${dog.code}`
  }
  if (entry.batchId !== null) {
    const batch = data.batches.find(b => b.id === entry.batchId)
    return batch === undefined ? '—' : `批次 ${batch.name}`
  }
  return '—'
}

/**
 * 删这一笔之前，把**真的会发生什么**说清楚（`ConfirmDialog` 的正文）。
 *
 * 这份文案的分量在于：`deleteEntry` 是物理删除，删了没有撤销，而它**唯一**的连带动作
 * 是「删掉某只狗最后一条销售流水、且那只狗现在是已卖出/已退回 → 把狗改回在库」。
 * 这句话有**三个前提**，少对一条都会让文案变成谎话：
 * ①它是那只狗**最后一条**销售流水（后面还有一笔卖出，狗本来就不该回到在库）；
 * ②狗现在真的是 `sold`/`returned`（狗已经记过死亡，删收入**不会**把它复活）；
 * ③（同一条流水上）它确实关联着那只狗。
 * 所以这里不写「删了狗就回到在库」，而是照着这三个前提分别说话。
 *
 * 另外两件容易承诺错的事：
 * - 删流水**不动预定单**（`preOrders.receivedBatchId` 不跟着变），所以文案里根本不提收货；
 * - 删掉**退款**那一笔之后，那只狗的退款按钮会重新露出来（界面是照着有没有退款流水算的），
 *   得提醒用户别顺手再退一次。
 */
export function deleteWarning(data: AppData, entry: LedgerEntry): string {
  const scope = entryScope(data, entry)
  const where = scope === '—' ? '它不挂在任何一批、任何一只狗上。' : `它挂在${scope}。`
  const base = `这笔账删了就没有撤销。${where}`

  // 退款流水：删掉它唯一看得见的后果是把「退款」按钮放回去。
  if (entry.type === 'expense' && entry.category === 'aftercare_refund') {
    return `${base}这只狗的最近一次卖出底下就没有退款记录了，界面会重新给它一个「退款」按钮 —— 别对同一只狗再退一次。`
  }

  // 带狗的销售流水：唯一会改动狗状态的那种删除。
  if (entry.type === 'income' && entry.dogId !== null) {
    const parts = [base, saleRevertText(data, entry)]
    if (refundedCurrentSale(data.entries, entry.dogId)) {
      parts.push('这只狗还挂着一笔退款支出，删掉这笔收入之后，那笔退款从此在界面上对不上任何一只狗，请自己去核一下。')
    }
    return parts.join('')
  }

  return base
}

/**
 * 删掉这条销售流水之后，那只狗会怎么样 —— 一句话，照着 `deleteEntry` 的三条前提说。
 * 前提对不上时说的都是「状态不变」，绝不说「回到在库」。
 */
function saleRevertText(data: AppData, entry: LedgerEntry): string {
  const dogId = entry.dogId
  if (dogId === null) return ''

  const index = data.entries.findIndex(e => e.id === entry.id)
  // 不是该狗最后一条卖出 → `deleteEntry` 不动狗。先判这一条，后面的状态才有意义。
  if (lastSaleIndex(data.entries, dogId) !== index) return '后面还有一笔卖出，狗的状态不变。'

  const dog = data.dogs.find(d => d.id === dogId)
  if (dog === undefined) return '这只狗的记录找不到了，删了它也不会有什么变化。'
  if (dog.status === 'dead') return '这只狗已经记过死亡，删掉这笔收入不会把它复活。'
  if (dog.status === 'sold' || dog.status === 'returned') return '这是这只狗最后一条销售流水，这只狗会回到在库。'
  return '这只狗现在就在库，删掉这笔收入不用动它。'
}
