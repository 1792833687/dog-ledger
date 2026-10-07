import { useState } from 'react'
import { useAppData } from '../../state/useAppData'
import {
  batchSummary, batchTotalCost, dogsOfBatch, dilutedCostFen, dogIncome, dogProfitFen,
} from '../../domain/costing'
// 补账表：笔数与金额只由 `previewBatchCosts` 说了算，「还没补过成本」只由
// `batchCostsIncomplete` 说了算 —— 界面里一处都不自己数、不自己求和（见 task 28 的中心要求）。
import { addBatchCosts, batchCostsIncomplete, previewBatchCosts } from '../../domain/batchCosts'
import {
  sellDog, markDogDead, setDogStatus, createBatch, addExpense, setBatchChannel, renameBatch,
  addPreOrder, updatePreOrder, cancelPreOrder, deletePreOrder, receivePreOrder,
} from '../../domain/actions'
import { formatMoney, parseMoney } from '../../domain/money'
import { newId } from '../../domain/types'
import type { PreOrder } from '../../domain/types'
import { duePreOrderCount, preOrderList } from '../../domain/preOrders'
import type { PreOrderStage } from '../../domain/preOrders'
import { Modal } from '../components/Modal'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Field } from '../components/Field'
import { todayLocalIso, localTimeHm } from '../planForm'
import { isOnHand, refundedCurrentSale } from '../dogLedger'
import { channelOptions, findChannel, parseAliveInput } from '../channelView'
import {
  canSubmitPreOrder, draftFromOrder, draftIssue, emptyPreOrderDraft, preOrderInput, preOrderPatch, stageText,
} from '../preOrderForm'
import type { PreOrderDraft } from '../preOrderForm'
import {
  batchCostRowIssue, batchCostsInput, emptyBatchCostDraft, previewText,
} from '../batchCostsForm'
import type { BatchCostDraft } from '../batchCostsForm'

/**
 * 「狗」页面 —— 批次台账。
 *
 * 两个状态：批次列表 ⇄ 某一个批次的详情。详情里回答两个问题：
 * 这一批现在赚了还是亏了，以及**剩下的每只至少卖多少钱整批才不亏**。
 *
 * 记账一律走 `Modal` + 中文表单，不用 `window.prompt`：记账是最高频的动作，
 * 弹三个系统框、还要用户手打英文成本项，第二天就不会有人再记了。
 * 成本项下拉直接读 `data.settings.costItems`，与「钱」页面共用同一套选项。
 *
 * 列表视图顶部另挂一块**预定单区**（设计 §3.9）：还没拉回来的狗先记一张单子，
 * 到了日子在页面上提醒去收，收回来就地把这张单子变成一批狗（批次名、只数、
 * 每只收购价都从收货那一步来），不做了就标「黄了」。它只活在列表视图里。
 */

const STATUS_LABEL: Record<string, string> = {
  in_stock: '在库', sold: '已售', dead: '死亡', returned: '退回',
}

/**
 * 阶段标签的**颜色**（四个状态一张表）。文案不在这里 —— `due_soon` 与 `overdue`
 * 要写出「还有 N 天」/「已经过期 N 天」，一张常量表表达不了，改由
 * `stageText(order, stage, today)` 现算（`../preOrderForm`）。
 * 颜色上两者仍然同一档：对要出门收狗的两个人来说，急的事是同一件。
 */
const PRE_ORDER_STAGE_CLASS: Record<PreOrderStage, string> = {
  upcoming: 'text-gray-500',
  due_soon: 'text-red-700',
  overdue: 'text-red-700',
  received: 'text-emerald-700',
  cancelled: 'text-gray-500',
}

const PRE_ORDER_FORM_INPUT =
  'w-full rounded-lg bg-gray-100 px-3 py-2 text-sm outline-none placeholder:text-gray-600'

/**
 * 本机时区的今天，`YYYY-MM-DD`。不要用 `toISOString().slice(0, 10)`——那是 UTC，
 * 东八区晚上 8 点后返回昨天，晚上出门收的狗会记成前一天的账。
 *
 * 包成函数、只在点击时调用，而不是在渲染体里算一个 `today` 常量：
 * `new Date()` 是 impure 的，放在渲染体里会被 lint 的 react(purity) 拦下
 * （本仓门禁是 0 warning），而且重新渲染时会拿到"另一个今天"。
 */
function todayIso(): string {
  return todayLocalIso(new Date())
}

export function DogsPage() {
  const { data, update } = useAppData()
  const [openBatchId, setOpenBatchId] = useState<string | null>(null)
  const [sellingDogId, setSellingDogId] = useState<string | null>(null)
  const [priceInput, setPriceInput] = useState('')
  const [expenseOpen, setExpenseOpen] = useState(false)
  const [expenseAmount, setExpenseAmount] = useState('')
  const [expenseCategory, setExpenseCategory] = useState('medical')
  const [expenseNote, setExpenseNote] = useState('')
  const [newBatchName, setNewBatchName] = useState('')
  const [refundingDogId, setRefundingDogId] = useState<string | null>(null)
  const [refundAmount, setRefundAmount] = useState('')
  const [refundKeepSold, setRefundKeepSold] = useState(false)
  const [refundNote, setRefundNote] = useState('')
  // 批次名的编辑草稿：`null` = 没在改，显示的还是账上存的名字（与 `SettingsPanel.tsx`
  // 的草稿约定一致）。**不**把输入框直接绑到 `data` 上每个击键写库 —— 重渲会把用户
  // 没打完的输入吃掉（Task 13 踩过这个坑）。
  //
  // 这份草稿只属于「当前打开的那个批次」，所以换批次（打开另一个批次、或退回列表）
  // 时必须连它一起丢掉。为什么不能指望空白分支自己清：提交空名字会**故意**停在编辑态
  // 并出红字（见 `commitBatchName`），那条提前 `return` 的分支根本走不到
  // `setBatchNameDraft(null)`。于是草稿会一直攥在手里：用户清空 A 的名字、点「← 所有批次」
  // 退回列表，再打开批次 B，B 一进详情就是空的编辑框，外加一句红字「批次名不能是空的」
  // —— 那是 A 留下的，用户会以为 B 的名字被弄坏了（库里其实一个字都没改）。
  const [batchNameDraft, setBatchNameDraft] = useState<string | null>(null)

  // ── 补成本区（设计 §3.10）的状态 ────────────────────────────────────────────
  // 四行金额的草稿。它和 `batchNameDraft` 是同一类东西：**只属于「当前打开的那一批」**。
  // 打开下一批时框里还留着上一批的金额，用户照着点一下确认，那一批就被记上了别人的运费
  // —— 所以离开批次时必须连它一起丢掉（见 `resetBatchDrafts`）。
  const [costDraft, setCostDraft] = useState<BatchCostDraft>(emptyBatchCostDraft)
  // 补账区默认折叠：收完狗回来的人先看的是这一批的盈亏与「剩下的每只至少卖多少」，
  // 补账是过几天把钱付掉了才回来做的事，摊开占半屏会把上面那两块挤下去。
  const [costOpen, setCostOpen] = useState(false)
  // 确认弹窗。笔数与金额先给用户看一遍再落库：一按下去就多出十几笔流水，
  // 这是全仓唯一一个「点一下同时写很多条账」的动作。
  const [costConfirmOpen, setCostConfirmOpen] = useState(false)

  /**
   * 离开当前批次时把两份草稿都丢掉（批次名 + 补账金额），并收起补账区与它的确认弹窗。
   *
   * 为什么必须显式丢：提交空批次名会**故意**停在编辑态并出红字（见 `commitBatchName`），
   * 那条路走不到清草稿的分支；补账草稿更是只要用户填了一半就一直在。不丢的话，
   * 用户清空 A 的名字 / 填了 A 的运费、退回列表、再打开 B，B 一进详情就是 A 留下的内容
   * —— 那不只是难看，是**会把 A 的钱记到 B 头上**（Task 21b 的批次名串台是同一类缺陷）。
   */
  const resetBatchDrafts = (): void => {
    setBatchNameDraft(null)
    setCostDraft(emptyBatchCostDraft())
    setCostOpen(false)
    setCostConfirmOpen(false)
  }

  // ── 预定单区（设计 §3.9）的状态 ────────────────────────────────────────────
  // 界面要拿「今天」判断哪张单子该去收了，但 `new Date()` 是 impure 的，放在渲染体里
  // 会被 lint 的 react(purity) 拦下（本仓门禁 0 warning），重新渲染还会拿到「另一个今天」。
  // 所以按「钱」「检疫」「报」三页的体例，用惰性 useState 取一次、这一屏内当常量用。
  // 真正写账那一刻的「现在」仍然在事件处理器里现取（`todayIso()` / 收货那一段）。
  const [today] = useState(() => todayLocalIso(new Date()))
  // 表单草稿：`null` = 表单收起。一份草稿只属于「正在编辑的那张单子」，
  // 所以打开任何一处之前都先 `closePreOrderPanels()`，收起时也把它丢掉。
  // 不这么做就会出现 Task 21b 那个批次名草稿的同类缺陷：点开 B 单，
  // 框里是 A 单没提交的内容，用户会以为 B 单被改了（账上其实一个字没动）。
  const [preOrderDraft, setPreOrderDraft] = useState<PreOrderDraft | null>(null)
  // `null` = 正在新建；非 `null` = 正在改这张单子（已收货的单子只剩备注能改）。
  const [preOrderEditId, setPreOrderEditId] = useState<string | null>(null)
  // 收货弹窗：默认按约定的只数收，每只收购价留空（空着按 0 算，见 `confirmReceivePreOrder`）。
  const [receivingId, setReceivingId] = useState<string | null>(null)
  const [receiveCount, setReceiveCount] = useState('')
  const [receivePrice, setReceivePrice] = useState('')
  // 收完货给一句回执「已收货，批次：X」。批次名是收货那一刻现起的（带时刻），
  // 与其回头再去 `data.batches` 里按 id 查一次，不如当时就记住这个名字。
  const [receiveDone, setReceiveDone] = useState<string | null>(null)
  const [cancelingId, setCancelingId] = useState<string | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // 解析不了（不是空、但不是数字）时必须给中文提示并且不写账，不能静默当 0：
  // 用户把「600元」打成「６00」而系统按 0 记账，那一批的成本从此就是错的，且没人会发现。
  const priceParsed = parseMoney(priceInput)
  const priceInvalid = priceInput.trim() !== '' && priceParsed === null
  const expenseParsed = parseMoney(expenseAmount)
  const expenseInvalid = expenseAmount.trim() !== '' && expenseParsed === null
  const refundParsed = parseMoney(refundAmount)
  const refundInvalid = refundAmount.trim() !== '' && refundParsed === null
  const refundDog = refundingDogId === null ? null : data.dogs.find(d => d.id === refundingDogId) ?? null
  // 只含空白 = 空名字，不写库。红字由草稿推导、不用额外的错误状态：
  // 只要用户还停在编辑态、框里是空的，这句话就一直在（和 SettingsPanel 的 inputError 一致）。
  const batchNameBlank = batchNameDraft !== null && batchNameDraft.trim() === ''

  // ── 预定单区的派生值 ──────────────────────────────────────────────────────
  // 顺序、分组全由 `preOrderList` 定（该去收的在最前面），界面只管照着画，
  // 不自己排序 —— 排序规则两处各写一份，迟早对不上。拿到的 `order` 是
  // `data.preOrders` 里的**原对象**，只读、不就地改。
  const preOrderRows = preOrderList(data, today)
  const preOrderDueCount = duePreOrderCount(data, today)
  const preOrderEditing = preOrderEditId === null
    ? null
    : (data.preOrders.find(o => o.id === preOrderEditId) ?? null)
  // 已收货的单子域层只认 note 一个字段（`updatePreOrder` 的白名单），
  // 表单于是也只画一个备注框，别的框画出来就是骗人的。
  const preOrderNoteOnly = preOrderEditing !== null && preOrderEditing.status === 'received'
  const preOrderIssue = preOrderDraft === null || preOrderNoteOnly ? null : draftIssue(preOrderDraft)
  const preOrderSavable = preOrderDraft !== null && (preOrderNoteOnly || canSubmitPreOrder(preOrderDraft))
  // 实收只数走和「存活数」同一个口径（`parseAliveInput`）：只认整只、至少 1 只。
  // `receivePreOrder` 遇到不合法是**原样返回**，界面不先拦住就是点了确认毫无反应。
  const receiveCountParsed = parseAliveInput(receiveCount)
  const receiveCountInvalid = receiveCount.trim() !== ''
    && (receiveCountParsed === null || receiveCountParsed < 1)
  const receivePriceParsed = parseMoney(receivePrice)
  const receivePriceInvalid = receivePrice.trim() !== '' && receivePriceParsed === null

  /**
   * 记退款支出。设计文档 §3.4 与 §6 要求 `returned` 必须伴随一笔
   * 「售后退款」支出，否则账上会留着一笔根本没赚到的利润。
   * 两种情况共用这一个处理器：狗要不要回来由调用方先改状态。
   */
  function confirmRefund(dogId: string, keepSold: boolean): void {
    const amount = parseMoney(refundAmount)
    if (amount === null) return
    const dog = data.dogs.find(d => d.id === dogId)
    if (!dog) return
    if (!keepSold) void update(d => setDogStatus(d, dogId, 'returned'))
    void update(d => addExpense(d, {
      batchId: dog.batchId, dogId, category: 'aftercare_refund', amount,
      paidBy: 'pool', date: todayIso(), note: refundNote.trim() || (keepSold ? '钱退了，狗没回来' : '客户退狗'),
    }))
    setRefundingDogId(null)
  }

  // ── 预定单区的处理器 ──────────────────────────────────────────────────────

  /**
   * 收起预定单区的表单和三个弹窗，连草稿一起丢掉。
   * 打开任何一处之前都先调它：界面上一时刻只能有一份没提交的输入，
   * 换卡片、换批次视图时也不会把上一张单子没提交的内容带过去（见 `preOrderDraft` 处的说明）。
   */
  function closePreOrderPanels(): void {
    setPreOrderDraft(null)
    setPreOrderEditId(null)
    setReceivingId(null)
    setReceiveCount('')
    setReceivePrice('')
    setReceiveDone(null)
    setCancelingId(null)
    setCancelReason('')
    setDeletingId(null)
  }

  function patchPreOrderDraft(patch: Partial<PreOrderDraft>): void {
    setPreOrderDraft(d => (d === null ? d : { ...d, ...patch }))
  }

  function openNewPreOrder(): void {
    closePreOrderPanels()
    setPreOrderDraft(emptyPreOrderDraft())
  }

  /** 改一张：草稿**每次从这张单子现摊一份**，不复用上一次的。 */
  function openEditPreOrder(order: PreOrder): void {
    closePreOrderPanels()
    setPreOrderEditId(order.id)
    setPreOrderDraft(draftFromOrder(order))
  }

  function openReceivePreOrder(order: PreOrder): void {
    closePreOrderPanels()
    setReceivingId(order.id)
    // 默认「按约定的只数收」：多数时候就是这个数，改成少数比从空框开始快。
    // 每只收购价不给默认值 —— 替用户猜一个价，猜错了就是成本记错，空着按 0 算更清楚。
    setReceiveCount(String(order.expectedCount))
  }

  function openCancelPreOrder(preOrderId: string): void {
    closePreOrderPanels()
    setCancelingId(preOrderId)
  }

  function openDeletePreOrder(preOrderId: string): void {
    closePreOrderPanels()
    setDeletingId(preOrderId)
  }

  /** 记一张 / 改一张。已收货的单子只剩备注能改（域层白名单也是这么认的）。 */
  function submitPreOrder(): void {
    const draft = preOrderDraft
    if (draft === null) return
    const editing = preOrderEditing
    if (editing !== null && editing.status === 'received') {
      void update(d => updatePreOrder(d, editing.id, { note: draft.note }))
      closePreOrderPanels()
      return
    }
    if (editing === null) {
      // `createdAt` 是 ISO datetime 而不是 `YYYY-MM-DD`：同一天记的几张单子要能排出先后。
      // 取「现在」只能在事件处理器里做，所以这里现取一次再传进去。
      const input = preOrderInput(draft, new Date().toISOString())
      if (input === null) return
      void update(d => addPreOrder(d, input))
    } else {
      const patch = preOrderPatch(draft)
      if (patch === null) return
      void update(d => updatePreOrder(d, editing.id, patch))
    }
    closePreOrderPanels()
  }

  /**
   * 收货：只认整只、至少 1 只。按钮那边已经禁用了，这里再判一次是因为
   * `receivePreOrder` 的守卫是「原样返回同一引用」——真进去了它也不报错，
   * 只是什么都没发生，那种「点了没反应」比一句红字难查得多。
   */
  function confirmReceivePreOrder(): void {
    const preOrderId = receivingId
    if (preOrderId === null) return
    if (receiveCountParsed === null || receiveCountParsed < 1 || receivePriceInvalid) return
    const count = receiveCountParsed
    // 「现在」在事件处理器里现取：批次名里的时刻、记账的日子都是点下去那一刻的，
    // 不能用渲染时那个 `today`（页面开着过夜，跨零点就错了）。
    const name = `收狗 ${count} 只 ${localTimeHm(new Date())}`
    void update(d => receivePreOrder(d, preOrderId, {
      name, date: todayIso(), receivedCount: count, unitPriceFen: receivePriceParsed ?? 0,
    }))
    closePreOrderPanels()
    // 必须排在 `closePreOrderPanels()` 后面：它会把回执一起清掉（两者都是入队的状态更新，
    // 后写的赢），顺序反了这句回执就永远看不见。
    setReceiveDone(name)
  }

  function confirmCancelPreOrder(): void {
    const preOrderId = cancelingId
    if (preOrderId === null) return
    void update(d => cancelPreOrder(d, preOrderId, cancelReason.trim()))
    closePreOrderPanels()
  }

  function confirmDeletePreOrder(): void {
    const preOrderId = deletingId
    if (preOrderId === null) return
    void update(d => deletePreOrder(d, preOrderId))
    closePreOrderPanels()
  }

  if (!openBatchId) {
    return (
      <div className="px-4 pb-6 pt-6">
        <h1 className="text-xl font-bold">批次</h1>
        <p className="mt-1 text-xs text-gray-500">
          一批一个价，别把两批的账混在一起。
        </p>

        <div className="mt-4 flex gap-2">
          <input
            className="flex-1 rounded-lg bg-white px-3 py-2 text-sm shadow-sm outline-none placeholder:text-gray-500"
            placeholder="新批次名称，如 10月3日李村"
            value={newBatchName}
            onChange={e => setNewBatchName(e.target.value)}
          />
          <button
            type="button"
            className="rounded-lg bg-gray-900 px-4 text-sm font-semibold text-white disabled:opacity-40"
            disabled={!newBatchName.trim()}
            onClick={() => {
              const name = newBatchName.trim()
              void update(d => createBatch(d, name, todayIso()))
              setNewBatchName('')
            }}
          >
            新建
          </button>
        </div>

        {/* ── 预定单区（设计 §3.9）：放在批次列表之前 ──
            还没拉回来的狗不属于任何一批，所以它排在批次上面：
            出门要干什么先看见，然后才是账上已经有的事。 */}
        <div className="mt-6">
          {preOrderRows.length === 0 && preOrderDraft === null ? (
            // 一张预定单都没有：不留空标题、不留空列表（与「报」页空态一个处理）。
            // 但这个按钮必须在 —— 全仓只有它能建第一张预定单，连它一起藏掉，
            // 这功能就永远进不去了（详见交付报告第 7 节）。
            <button
              type="button"
              className="w-full rounded-xl border border-dashed border-gray-300 py-3 text-sm text-gray-500"
              onClick={openNewPreOrder}
            >
              + 记一张预定单
            </button>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold">预定单</h2>
                <button
                  type="button"
                  className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white"
                  onClick={openNewPreOrder}
                >
                  + 记一张
                </button>
              </div>

              {preOrderDueCount > 0 && (
                <p className="mt-1 text-sm font-semibold text-red-700">
                  有 {preOrderDueCount} 张该去收了
                </p>
              )}

              {receiveDone !== null && (
                <p className="mt-1 text-sm text-emerald-700">已收货，批次：{receiveDone}</p>
              )}

              {preOrderDraft !== null && (
                <div className="mt-2 rounded-xl bg-white p-3 shadow-sm">
                  <p className="text-sm font-semibold">
                    {preOrderNoteOnly ? '改备注' : preOrderEditing === null ? '记一张预定单' : '改这张预定单'}
                  </p>
                  <div className="mt-2 space-y-2">
                    {preOrderNoteOnly ? (
                      <input
                        className={PRE_ORDER_FORM_INPUT}
                        placeholder="备注（可留空）"
                        value={preOrderDraft.note}
                        onChange={e => patchPreOrderDraft({ note: e.target.value })}
                      />
                    ) : (
                      <>
                        <input
                          className={PRE_ORDER_FORM_INPUT}
                          placeholder="卖家（谁家的狗）"
                          value={preOrderDraft.sellerName}
                          onChange={e => patchPreOrderDraft({ sellerName: e.target.value })}
                        />
                        <input
                          className={PRE_ORDER_FORM_INPUT}
                          placeholder="联系方式（电话 / 微信，可留空）"
                          value={preOrderDraft.sellerContact}
                          onChange={e => patchPreOrderDraft({ sellerContact: e.target.value })}
                        />
                        <input
                          className={PRE_ORDER_FORM_INPUT}
                          inputMode="numeric"
                          placeholder="约几只"
                          value={preOrderDraft.expectedCount}
                          onChange={e => patchPreOrderDraft({ expectedCount: e.target.value })}
                        />
                        <input
                          className={PRE_ORDER_FORM_INPUT}
                          type="date"
                          value={preOrderDraft.collectDate}
                          onChange={e => patchPreOrderDraft({ collectDate: e.target.value })}
                        />
                        <input
                          className={PRE_ORDER_FORM_INPUT}
                          placeholder="特征（几个黄的、大概多大，可留空）"
                          value={preOrderDraft.traits}
                          onChange={e => patchPreOrderDraft({ traits: e.target.value })}
                        />
                        <input
                          className={PRE_ORDER_FORM_INPUT}
                          placeholder="备注（可留空）"
                          value={preOrderDraft.note}
                          onChange={e => patchPreOrderDraft({ note: e.target.value })}
                        />
                      </>
                    )}
                  </div>
                  {preOrderIssue !== null && (
                    <p className="mt-1 text-xs text-red-700">{preOrderIssue}</p>
                  )}
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      className="flex-1 rounded-xl bg-gray-100 py-2.5 text-sm font-semibold text-gray-700"
                      onClick={closePreOrderPanels}
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      className="flex-1 rounded-xl bg-gray-900 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
                      disabled={!preOrderSavable}
                      onClick={submitPreOrder}
                    >
                      保存
                    </button>
                  </div>
                </div>
              )}

              <ul className="mt-3 space-y-2">
                {preOrderRows.map(({ order, stage }) => {
                  // 批次名现查：`receivedBatchId` 是 `string | null`，查不到就只显示「已收货」
                  // 不给链接（批次万一被删过，点进去会是一页空；也不写 `!`）。
                  const batch = order.receivedBatchId === null
                    ? null
                    : (data.batches.find(b => b.id === order.receivedBatchId) ?? null)
                  return (
                    <li key={order.id} className="rounded-xl bg-white p-3 shadow-sm">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-semibold">{order.sellerName}</span>
                        <span className={`shrink-0 text-xs font-semibold ${PRE_ORDER_STAGE_CLASS[stage]}`}>
                          {stageText(order, stage, today)}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-gray-500">
                        约 {order.expectedCount} 只 · {order.collectDate} 去收
                        {order.sellerContact !== '' && ` · 联系 ${order.sellerContact}`}
                      </div>
                      {order.traits !== '' && (
                        <div className="mt-1 text-xs text-gray-500">特征：{order.traits}</div>
                      )}
                      {order.note !== '' && (
                        <div className="mt-1 text-xs text-gray-500">备注：{order.note}</div>
                      )}
                      {order.status === 'cancelled' && order.cancelReason !== '' && (
                        <div className="mt-1 text-xs text-gray-500">原因：{order.cancelReason}</div>
                      )}

                      {order.status === 'reserved' && (
                        <div className="mt-2 flex gap-2">
                          <button
                            type="button"
                            // 过了日子的那张，「收货」用绿色主色顶出来：今天最该点的就是它。
                            className={`flex-1 rounded-lg py-2 text-xs font-semibold text-white ${
                              stage === 'overdue' ? 'bg-emerald-700' : 'bg-gray-900'
                            }`}
                            onClick={() => openReceivePreOrder(order)}
                          >
                            收货
                          </button>
                          <button
                            type="button"
                            className="rounded-lg bg-gray-100 px-3 py-2 text-xs font-semibold text-gray-700"
                            onClick={() => openEditPreOrder(order)}
                          >
                            改
                          </button>
                          <button
                            type="button"
                            className="rounded-lg bg-gray-100 px-3 py-2 text-xs font-semibold text-gray-700"
                            onClick={() => openCancelPreOrder(order.id)}
                          >
                            黄了
                          </button>
                        </div>
                      )}

                      {/* 「预定中」也能直接删掉（设计 §3.9：记错了可以整条删掉，例外只有已收货）。
                          单独放第二行、右对齐：第一行那三个是「去办这件事」的动作，
                          删掉是「这张单子记错了」——混在一行里，375px 下四个按钮会挤到一起，
                          也容易点错。样式与 `cancelled` 卡的「删掉」逐字相同，同一个动作长得一样。 */}
                      {order.status === 'reserved' && (
                        <div className="mt-1 flex justify-end">
                          <button
                            type="button"
                            className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-semibold text-red-700"
                            onClick={() => openDeletePreOrder(order.id)}
                          >
                            删掉
                          </button>
                        </div>
                      )}

                      {order.status === 'received' && (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-emerald-700">已收货</span>
                          {batch !== null && (
                            <button
                              type="button"
                              className="rounded-lg bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-700"
                              onClick={() => {
                                closePreOrderPanels()
                                setOpenBatchId(batch.id)
                                setBatchNameDraft(null)
                              }}
                            >
                              批次：{batch.name}
                            </button>
                          )}
                          <button
                            type="button"
                            className="rounded-lg bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-700"
                            onClick={() => openEditPreOrder(order)}
                          >
                            改备注
                          </button>
                        </div>
                      )}

                      {order.status === 'cancelled' && (
                        <div className="mt-2 flex justify-end">
                          <button
                            type="button"
                            className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-semibold text-red-700"
                            onClick={() => openDeletePreOrder(order.id)}
                          >
                            删掉
                          </button>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </div>

        <ul className="mt-4 space-y-2">
          {data.batches.map(b => {
            const s = batchSummary(data, b.id)
            return (
              <li key={b.id}>
                <button
                  type="button"
                  onClick={() => {
                    // 打开一个批次时把上一个批次的草稿丢掉：草稿只属于它所属的那个批次，
                    // 漏下来就会变成「新批次一进来就在编辑态、还带着别人的红字」
                    // （见上面 batchNameDraft 处的说明）。
                    setOpenBatchId(b.id)
                    setBatchNameDraft(null)
                    // 预定单区的草稿同理：它长在列表视图里，进详情后看不见，
                    // 但状态还在身上；回到列表会突然弹出一张半填的单子（见 closePreOrderPanels）。
                    closePreOrderPanels()
                  }}
                  className="w-full rounded-xl bg-white p-3 text-left shadow-sm"
                >
                  <div className="flex items-baseline justify-between">
                    <span className="font-semibold">{b.name}</span>
                    <span className={`text-sm font-semibold ${s.netProfitFen >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                      {formatMoney(s.netProfitFen)}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    {b.date} · 在库 {s.inStock} · 已售 {s.sold} · 死亡 {s.dead}
                    {s.floorPriceFen !== null && ` · 剩余保本 ${formatMoney(s.floorPriceFen)}`}
                  </div>
                </button>
              </li>
            )
          })}
          {data.batches.length === 0 && (
            <li className="rounded-xl bg-white p-6 text-center text-sm text-gray-500">
              还没有批次。去「算」页一键建一个；也可以在上面记一张预定单，收到狗时自动建批次。
            </li>
          )}
        </ul>

        <Modal open={receivingId !== null} title="收货" onClose={closePreOrderPanels}>
          <input
            autoFocus
            className="w-full rounded-lg bg-gray-100 px-3 py-2 text-lg outline-none placeholder:text-gray-600"
            inputMode="numeric"
            placeholder="实收只数"
            value={receiveCount}
            onChange={e => setReceiveCount(e.target.value)}
          />
          {receiveCountInvalid && (
            <p className="mt-1 text-xs text-red-700">只数得是整数，而且至少 1 只（狗只有整只）</p>
          )}
          <input
            className="mt-2 w-full rounded-lg bg-gray-100 px-3 py-2 text-sm outline-none placeholder:text-gray-600"
            inputMode="decimal"
            placeholder="每只收购价（元，空着按 0 算）"
            value={receivePrice}
            onChange={e => setReceivePrice(e.target.value)}
          />
          {receivePriceInvalid && (
            <p className="mt-1 text-xs text-red-700">这不像一个数字，请重新填（只填元的数，如 800）</p>
          )}
          <p className="mt-2 text-xs text-gray-500">
            确认后会建一个批次把这几只放进去，批次名自动带上收货的时刻。
          </p>
          <button
            type="button"
            className="mt-3 w-full rounded-xl bg-emerald-700 py-3 text-sm font-semibold text-white disabled:opacity-40"
            disabled={receiveCountParsed === null || receiveCountParsed < 1 || receivePriceInvalid}
            onClick={confirmReceivePreOrder}
          >
            确认收货
          </button>
        </Modal>

        <Modal open={cancelingId !== null} title="这张预定单黄了？" onClose={closePreOrderPanels}>
          <input
            autoFocus
            className="w-full rounded-lg bg-gray-100 px-3 py-2 text-sm outline-none placeholder:text-gray-600"
            placeholder="不写原因也行，以后自己看得懂就行"
            value={cancelReason}
            onChange={e => setCancelReason(e.target.value)}
          />
          <p className="mt-2 text-xs text-gray-500">
            黄了就是这单不做了。单子会留在列表最底下，不占任何一批的账。
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className="flex-1 rounded-xl bg-gray-100 py-3 text-sm font-semibold text-gray-700"
              onClick={closePreOrderPanels}
            >
              先不黄
            </button>
            <button
              type="button"
              className="flex-1 rounded-xl bg-gray-900 py-3 text-sm font-semibold text-white"
              onClick={confirmCancelPreOrder}
            >
              黄了
            </button>
          </div>
        </Modal>

        <ConfirmDialog
          open={deletingId !== null}
          title="删掉这张预定单？"
          // 预定中与「黄了」共用这一个弹窗（同一个动作长得一样）。两句话都不能少：
          // 「删了就没有撤销」是叫人想一下，「删不掉已经记过的账」是叫人放心按下它
          // —— 收货过的单子本来就没有这个按钮，但用户不知道这条规矩。
          message="删了就没有撤销，这张单子以后也查不回来。预定单删掉不影响任何批次，也删不掉已经记过的账。"
          confirmLabel="删掉"
          onConfirm={confirmDeletePreOrder}
          onClose={closePreOrderPanels}
        />
      </div>
    )
  }

  const batch = data.batches.find(b => b.id === openBatchId)
  // 批次被删掉（或 id 失效）时退回列表，不能对着 undefined 渲染。
  if (!batch) {
    return (
      <div className="px-4 pb-6 pt-6">
        <p className="text-sm text-gray-500">这个批次已经不在了。</p>
        <button
          type="button"
          className="mt-3 w-full rounded-xl bg-gray-100 py-3 text-sm font-semibold text-gray-700"
          onClick={() => {
            // 退回列表同样要丢草稿（理由见上面 batchNameDraft 与 resetBatchDrafts 的说明），
            // 而且「清空名字 → 失焦留在编辑态 → 点这里」正是草稿最容易漏下来的走法。
            setOpenBatchId(null)
            resetBatchDrafts()
          }}
        >
          ← 回所有批次
        </button>
      </div>
    )
  }

  const summary = batchSummary(data, batch.id)
  const dogs = dogsOfBatch(data, batch.id)

  // ── 补成本区（设计 §3.10）的派生值 ──────────────────────────────────────────
  // 「还没补过成本」只由 `batchCostsIncomplete` 判（它的判据是「有没有一笔非收购款的支出」，
  // 不能用「总成本是不是 0」代替 —— 那个数含收购款，刚收完货就已经大于 0 了）
  const costIncomplete = batchCostsIncomplete(data, batch.id)
  const costTotal = batchTotalCost(data, batch.id)
  // 这一批已有几笔支出（**含收货那笔收购款**，与上面那个金额同一个口径）。
  // 这里只数条数、不求和：求和的唯一实现是 `batchTotalCost`，界面里不许再写一遍。
  const costEntryCount = data.entries.filter(e => e.type === 'expense' && e.batchId === batch.id).length
  // 有红字时 `batchCostsInput` 返回 null，于是连预览都算不出来 ——
  // 不可能出现「明明有红字、按钮还亮着」。
  // 预览里的日期用本屏挂载时那个 `today`（渲染体里不许现取 `new Date()`）；
  // 真正写库那一刻的日期在事件处理器里用 `todayIso()` 现取。
  const costInput = batchCostsInput(batch.id, today, costDraft)
  const costPreview = costInput === null ? null : previewBatchCosts(data, costInput)
  // 「有没有东西要补」只有 `previewBatchCosts` 说了算：只填了处理费而这一批没有死狗时，
  // 四行都合法却一笔也生不出来（那要数这一批有几只狗、几只死了，界面数不了也不该数）。
  const costSavable = costPreview !== null && costPreview.count > 0
  const costConfirmMessage = costPreview === null
    ? '现在没有要新增的流水。'
    : `这一次新增 ${costPreview.count} 笔支出，一共 ${formatMoney(costPreview.totalFen)}。`
      + '只新增，不删改已有流水 —— 你手记的那些账一笔不动。'

  /**
   * 提交批次名。回车与失焦都走这里。
   * 留空（或只有空白）**不写库**、留在编辑态并出红字：静默保留原名会让用户以为改成功了。
   * Esc 不走这里，直接丢草稿。
   *
   * 写成箭头函数而不是 `function` 声明是必需的：`batch` 在这里是 `Batch | undefined`
   * 被上面的提前 return 收窄过的，函数声明会被提升、收窄在它体内不成立（`tsc` 报 TS18048）。
   */
  const commitBatchName = (): void => {
    const name = batchNameDraft
    if (name === null) return
    if (name.trim() === '') return
    void update(d => renameBatch(d, batch.id, name))
    setBatchNameDraft(null)
  }

  /**
   * 打开补账的确认弹窗。笔数与金额先给用户看一遍再落库：这是全仓唯一一个
   * 按一下会同时写十几笔流水的动作，值得多问一句。
   */
  const openCostConfirm = (): void => {
    // 按钮在 `costSavable` 为假时本来就是灰的，这里再挡一次：
    // 将来多一个入口（回车提交之类）时闸门还在原处。
    if (!costSavable) return
    setCostConfirmOpen(true)
  }

  /** 真的补账。日期在**这一刻**现取：渲染体里的 `today` 是挂载时那一个，跨了零点就不准了。 */
  const confirmAddBatchCosts = (): void => {
    const input = batchCostsInput(batch.id, todayIso(), costDraft)
    if (input === null) return
    void update(d => addBatchCosts(d, input))
    // 补完就把四行清空、区块收起。**不清空就可能记重**：同一版金额留在框里，
    // 用户很容易再点一次确认，那一批的运输费就记了两遍。
    // 「补成功了」的样子在折叠着也看得见 —— 上面那行「已记账成本」当场变大、橙字消失，
    // 两个都是现算的派生值，不需要任何缓存失效动作。
    setCostDraft(emptyBatchCostDraft())
    setCostConfirmOpen(false)
    setCostOpen(false)
  }

  return (
    <div className="px-4 pb-6 pt-6">
      <button
        type="button"
        className="text-sm text-gray-500"
        onClick={() => {
          // 和上面那个「回所有批次」一样：离开这个批次就把草稿丢掉（连补账那四行金额一起），
          // 别让它跟着进下一个批次（理由见上面 batchNameDraft 与 resetBatchDrafts 的说明）。
          setOpenBatchId(null)
          resetBatchDrafts()
        }}
      >
        ← 所有批次
      </button>
      {/* 批次名点一下就地改。只做详情视图：列表里整张卡片是 <button>，名字在里面塞不下 <input>。
          <h1> 里放 <button> 是合法的（button 属于 phrasing content），Tailwind preflight
          已经把 button 的边框与背景清掉了，不用另写样式。 */}
      <h1 className="mt-2 text-xl font-bold">
        {batchNameDraft === null ? (
          <button type="button" className="text-left" onClick={() => setBatchNameDraft(batch.name)}>
            {batch.name}
          </button>
        ) : (
          <input
            autoFocus
            className="w-full rounded-lg bg-gray-100 px-2 py-1 outline-none"
            value={batchNameDraft}
            onChange={e => setBatchNameDraft(e.target.value)}
            onBlur={commitBatchName}
            onKeyDown={e => {
              if (e.key === 'Enter') commitBatchName()
              if (e.key === 'Escape') setBatchNameDraft(null)
            }}
          />
        )}
      </h1>
      {batchNameBlank && <p className="mt-1 text-xs text-red-700">批次名不能是空的</p>}
      <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
        <span>{batch.date} · 去向：</span>
        {/* 批次打算走哪条路。之前这里直接把 channelId 印给用户看（`去向：pet_shop`）。
            选项里带上「未定」；`channelOptions` 会把旧备份里认不出的渠道补在最后，
            免得下拉框静默显示第一条、用户一碰就把原值改掉。 */}
        <select
          className="rounded-lg bg-white px-2 py-1 text-xs text-gray-700 shadow-sm"
          value={batch.plannedChannel}
          onChange={e => {
            const picked = findChannel(e.target.value)
            if (picked === null) return
            void update(d => setBatchChannel(d, batch.id, picked.id))
          }}
        >
          {channelOptions(batch.plannedChannel).map(o => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
      </div>

      {/* 卖家与留痕。`Batch.source` / `Batch.note` 此前全仓没有任何渲染点：
          从预定单收来的货，卖家名和「比约定的少 2 只」都写进库里了，用户却一个字看不到。
          只含空白当作没写（渲染出来是一行空白反而像界面上多了个怪东西）。 */}
      {batch.source.trim() !== '' && (
        <p className="mt-1 text-xs text-gray-500">卖家：{batch.source.trim()}</p>
      )}
      {batch.note.trim() !== '' && (
        <p className="mt-0.5 text-xs text-gray-500">{batch.note.trim()}</p>
      )}

      <div className="mt-3 rounded-xl bg-white p-4 shadow-sm">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div><span className="text-gray-500">总成本</span> <b>{formatMoney(summary.totalCost)}</b></div>
          <div><span className="text-gray-500">已收款</span> <b>{formatMoney(summary.income)}</b></div>
          <div><span className="text-gray-500">死亡损耗</span> <b className="text-red-700">{formatMoney(summary.deadLoss)}</b></div>
          <div>
            <span className="text-gray-500">盈亏</span>{' '}
            <b className={summary.netProfitFen >= 0 ? 'text-emerald-700' : 'text-red-700'}>
              {formatMoney(summary.netProfitFen)}
            </b>
          </div>
        </div>
        {summary.floorPriceFen !== null && (
          <div className="mt-3 rounded-lg bg-emerald-50 p-3">
            <div className="text-xs text-emerald-700">剩下的每只至少卖</div>
            <div className="text-2xl font-bold text-emerald-700">{formatMoney(summary.floorPriceFen)}</div>
            <div className="text-xs text-emerald-700">整批才不亏</div>
          </div>
        )}
      </div>

      <ul className="mt-4 space-y-2">
        {dogs.map(d => {
          const income = dogIncome(data, d.id)
          const cost = dilutedCostFen(data, d.id)
          const profit = dogProfitFen(data, d.id)
          const onHand = isOnHand(d)
          // 两个退款按钮的显示条件。「钱退了，狗没回来」之后状态一直是 sold，
          // 没有任何东西挡得住第二次点击，所以必须靠这个把按钮收掉 —— 否则重复点就重复扣钱。
          const refunded = refundedCurrentSale(data.entries, d.id)
          return (
            <li key={d.id} className="rounded-xl bg-white p-3 shadow-sm">
              <div className="flex items-baseline justify-between">
                <span className="font-semibold">{d.code}</span>
                <span className="text-xs text-gray-500">
                  {STATUS_LABEL[d.status]}
                  {/* 退回的狗又站在笼子里了（设计文档 :156），不提示的话用户会以为
                      这只已经卖出去的狗和自己无关，也不会去点「卖出」。 */}
                  {d.status === 'returned' && <span className="ml-1 text-amber-700">· 回到在库，可再卖一次</span>}
                </span>
              </div>
              <div className="mt-1 text-xs text-gray-500">
                摊薄成本 {formatMoney(cost)}
                {/* 用「有没有卖出收入」而不是 status === 'sold' 判：退回的狗也卖过一次，
                    那笔收入还在账上，不显示的话这张卡看着像从没卖过。 */}
                {income > 0 && (
                  <> · 售价 {formatMoney(income)} ·{' '}
                    <span className={profit >= 0 ? 'text-emerald-700' : 'text-red-700'}>
                      {profit >= 0 ? '赚' : '亏'} {formatMoney(Math.abs(profit))}
                    </span>
                  </>
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                {onHand && (
                  <button
                    type="button"
                    className="rounded-md bg-emerald-700 px-3 py-1 text-white"
                    onClick={() => { setSellingDogId(d.id); setPriceInput('') }}
                  >
                    卖出
                  </button>
                )}
                {/* 「卖出」与「死亡」都在 isOnHand 里：在库 + 退回。
                    退回的狗是站在笼子里的活狗（设计文档 :156/:157），要能再卖一次、也会死。
                    已售的狗标死亡会把 sold 覆盖成 dead，而收入流水留在账上，
                    批次盈亏从此是错的（markDogDead 里也有守卫兜底）。 */}
                {onHand && (
                  <button
                    type="button"
                    className="rounded-md bg-gray-100 px-3 py-1 text-gray-600"
                    onClick={() => void update(x => markDogDead(x, d.id))}
                  >
                    死亡
                  </button>
                )}
                {d.status === 'sold' && !refunded && (
                  <button
                    type="button"
                    className="rounded-md bg-gray-100 px-3 py-1 text-gray-600"
                    onClick={() => {
                      setRefundingDogId(d.id); setRefundAmount(''); setRefundNote(''); setRefundKeepSold(false)
                    }}
                  >
                    退狗
                  </button>
                )}
                {d.status === 'sold' && !refunded && (
                  <button
                    type="button"
                    className="rounded-md bg-gray-100 px-3 py-1 text-gray-600"
                    onClick={() => {
                      setRefundingDogId(d.id); setRefundAmount(''); setRefundNote(''); setRefundKeepSold(true)
                    }}
                  >
                    钱退了，狗没回来
                  </button>
                )}
                {d.status === 'sold' && refunded && (
                  <span className="self-center text-gray-500">已记退款</span>
                )}
                {/* 纠错入口。死 / 退回都只是记一笔状态，记错了必须能改回来——
                    否则点错一次这只狗就永远挂在错的状态上，账也跟着错。 */}
                {d.status === 'dead' && (
                  <button
                    type="button"
                    className="rounded-md bg-amber-100 px-3 py-1 text-amber-700"
                    onClick={() => void update(x => setDogStatus(x, d.id, 'in_stock'))}
                  >
                    记错了，改回在库
                  </button>
                )}
                {d.status === 'returned' && (
                  <button
                    type="button"
                    className="rounded-md bg-amber-100 px-3 py-1 text-amber-700"
                    onClick={() => void update(x => setDogStatus(x, d.id, 'in_stock'))}
                  >
                    狗又要回来了
                  </button>
                )}
              </div>
            </li>
          )
        })}
        {dogs.length === 0 && (
          <li className="rounded-xl bg-white p-6 text-center text-sm text-gray-500">
            这一批还没有狗。用下面的按钮补录，或在「算」页面按只数一键建批次。
          </li>
        )}
      </ul>

      <button
        type="button"
        className="mt-4 w-full rounded-xl border border-gray-300 py-3 text-sm font-semibold text-gray-700"
        onClick={() => {
          const dogId = newId()
          void update(d => ({
            ...d,
            dogs: [...d.dogs, {
              id: dogId, batchId: batch.id, code: `${batch.name}-补${dogs.length + 1}`,
              breed: '', sex: 'unknown', ageMonths: null, status: 'in_stock', note: '',
              // 修订二新增的 6 个必填字段：补录的狗同样没接种、没检测、没证明。
              // 绝不预填今天——那会让检疫页从第一天起就告诉你可以卖。
              rabiesVaccinatedOn: null, antibodyTestedOn: null,
              antibodyReportNo: '', quarantineCertNo: '',
              quarantineCertIssuedOn: null, quarantineCertValidUntil: null,
            }],
          }))
        }}
      >
        + 补录一只狗
      </button>

      <button
        type="button"
        className="mt-2 w-full rounded-xl border border-gray-300 py-3 text-sm font-semibold text-gray-700"
        onClick={() => {
          setExpenseAmount('')
          setExpenseCategory('medical')
          setExpenseNote('')
          setExpenseOpen(true)
        }}
      >
        + 记一笔批次支出
      </button>
      <p className="mt-2 text-xs text-gray-500">
        这里只记池子直接付掉的钱。合伙人先垫付的，去「钱」标签页记，那笔将来要从池子还给他。
      </p>

      {/* ── 补成本（设计 §3.10）─────────────────────────────────────────────────
          收货那一刻只记了收购款，运输 / 疫苗 / 检疫 / 处理费都是过几天真把钱付掉了才回来补的。
          默认折叠，**但标题那一行连橙字一起常显**：折叠着要是连提醒也看不见，
          「保本价现在偏低」这件事就没人知道了。折叠体例照「算」页的渠道对照。 */}
      <section className="mt-4 rounded-xl bg-white p-4 shadow-sm">
        <button
          type="button"
          className="flex w-full items-baseline justify-between gap-3 text-left"
          onClick={() => setCostOpen(v => !v)}
        >
          <span className="text-sm font-semibold text-gray-700">补成本 {costOpen ? '▾' : '▸'}</span>
          <span className="text-right text-xs text-gray-500">
            {/* 常显行：金额与笔数都是派生值，补完账当场变大。两者都含收购款（设计 §3.10 的口径）。 */}
            <span className="block font-semibold text-gray-600">
              这一批已记成本 {formatMoney(costTotal)} · 共 {costEntryCount} 笔（含收购款）
            </span>
            <span className="mt-0.5 block">运输、笼具、疫苗、检疫、处理费，付掉了回来补一次。</span>
          </span>
        </button>

        {costIncomplete && (
          <p className="mt-2 text-xs font-semibold text-amber-700">
            这一批还没补成本，保本价现在是偏低的
          </p>
        )}

        {costOpen && (
          <div className="mt-2 border-t border-gray-100">
            {/* 后三行标签里都写清「每只」：写成总额的话用户会把整批的钱填进去，
                每只摊薄成本当场少算好几倍，而且算出来的保本价看着还挺合理。 */}
            <Field
              label="运输 + 笼具（整批一笔）"
              suffix="元"
              value={costDraft.transport}
              onChange={v => setCostDraft(d => ({ ...d, transport: v }))}
              error={batchCostRowIssue(costDraft.transport) ?? undefined}
            />
            <Field
              label="每只疫苗 / 驱虫 / 医疗"
              suffix="元"
              value={costDraft.medicalPerDog}
              onChange={v => setCostDraft(d => ({ ...d, medicalPerDog: v }))}
              error={batchCostRowIssue(costDraft.medicalPerDog) ?? undefined}
            />
            <Field
              label="每只检疫（抗体检测 + 申报）"
              suffix="元"
              value={costDraft.quarantinePerDog}
              onChange={v => setCostDraft(d => ({ ...d, quarantinePerDog: v }))}
              error={batchCostRowIssue(costDraft.quarantinePerDog) ?? undefined}
            />
            <Field
              label="每只病死犬处理费"
              suffix="元"
              value={costDraft.disposalPerDog}
              onChange={v => setCostDraft(d => ({ ...d, disposalPerDog: v }))}
              error={batchCostRowIssue(costDraft.disposalPerDog) ?? undefined}
            />

            <button
              type="button"
              className="mt-3 w-full rounded-xl bg-gray-900 py-3 text-sm font-semibold text-white disabled:opacity-40"
              disabled={!costSavable}
              onClick={openCostConfirm}
            >
              {/* 按钮上就写清楚这一次会加几笔、一共多少钱，不用点进去才知道。 */}
              {costPreview === null
                ? '先把红字那一行改对'
                : previewText(costPreview.count, costPreview.totalFen)}
            </button>
            {/* 按钮为什么是灰的，得说出来：用户会以为界面坏了。
                「只填了处理费但这一批没有死狗」也落在这一条上（那种情况确实没东西可补）。 */}
            {costPreview !== null && costPreview.count === 0 && (
              <p className="mt-2 text-xs text-gray-500">
                填 0 的行不会记流水，所以现在没有要补的账。
              </p>
            )}
          </div>
        )}
      </section>

      <ConfirmDialog
        open={costConfirmOpen}
        title="补这几笔成本？"
        message={costConfirmMessage}
        confirmLabel="记上"
        onConfirm={confirmAddBatchCosts}
        onClose={() => setCostConfirmOpen(false)}
      />

      <Modal
        open={sellingDogId !== null}
        title="卖出了多少钱？"
        onClose={() => setSellingDogId(null)}
      >
        <input
          autoFocus
          className="w-full rounded-lg bg-gray-100 px-3 py-2 text-lg outline-none placeholder:text-gray-600"
          inputMode="decimal"
          placeholder="售价（元）"
          value={priceInput}
          onChange={e => setPriceInput(e.target.value)}
        />
        {priceInvalid && (
          <p className="mt-1 text-xs text-red-700">这不像一个数字，请重新填（只填元的数，如 1200）</p>
        )}
        <button
          type="button"
          className="mt-3 w-full rounded-xl bg-emerald-700 py-3 text-sm font-semibold text-white disabled:opacity-40"
          disabled={priceParsed === null || sellingDogId === null}
          onClick={() => {
            const price = parseMoney(priceInput)
            const dogId = sellingDogId
            if (price === null || dogId === null) return
            void update(d => sellDog(d, dogId, price, todayIso()))
            setSellingDogId(null)
          }}
        >
          确认卖出
        </button>
      </Modal>

      <Modal open={expenseOpen} title="记一笔批次支出" onClose={() => setExpenseOpen(false)}>
        <input
          autoFocus
          className="w-full rounded-lg bg-gray-100 px-3 py-2 text-lg outline-none placeholder:text-gray-600"
          inputMode="decimal"
          placeholder="金额（元）"
          value={expenseAmount}
          onChange={e => setExpenseAmount(e.target.value)}
        />
        {expenseInvalid && (
          <p className="mt-1 text-xs text-red-700">这不像一个数字，请重新填（只填元的数，如 400）</p>
        )}

        <select
          className="mt-2 w-full rounded-lg bg-gray-100 px-3 py-2 text-sm"
          value={expenseCategory}
          onChange={e => setExpenseCategory(e.target.value)}
        >
          {data.settings.costItems.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>

        <input
          className="mt-2 w-full rounded-lg bg-gray-100 px-3 py-2 text-sm outline-none placeholder:text-gray-600"
          placeholder="备注（可留空）"
          value={expenseNote}
          onChange={e => setExpenseNote(e.target.value)}
        />

        <button
          type="button"
          className="mt-3 w-full rounded-xl bg-gray-900 py-3 text-sm font-semibold text-white disabled:opacity-40"
          disabled={expenseParsed === null}
          onClick={() => {
            const amount = parseMoney(expenseAmount)
            if (amount === null) return
            void update(d => addExpense(d, {
              batchId: batch.id, dogId: null, category: expenseCategory, amount,
              paidBy: 'pool', date: todayIso(), note: expenseNote,
            }))
            setExpenseOpen(false)
          }}
        >
          记下
        </button>
      </Modal>

      {/* 退狗 / 退款。设计文档要求 returned = 回到在库 + 医疗成本不冲销 + 另记一笔「售后退款」支出；
          若钱退了但狗没要回来，则状态保持 sold、只记那笔支出。两种情况共用这个弹窗。 */}
      <Modal
        open={refundDog !== null}
        title={refundKeepSold ? '钱退了，狗没回来' : '退狗：退给客户多少钱？'}
        onClose={() => setRefundingDogId(null)}
      >
        {refundDog !== null && (
          <p className="mb-2 text-xs text-gray-500">
            {refundDog.code}
            {refundKeepSold
              ? ' · 狗不回来了，状态仍记「已售」，只把退款记成支出'
              : ' · 狗回到在库，之前花掉的医疗成本不冲销'}
          </p>
        )}

        <input
          autoFocus
          className="w-full rounded-lg bg-gray-100 px-3 py-2 text-lg outline-none placeholder:text-gray-600"
          inputMode="decimal"
          placeholder="退回给客户的钱（元）"
          value={refundAmount}
          onChange={e => setRefundAmount(e.target.value)}
        />
        {refundInvalid && (
          <p className="mt-1 text-xs text-red-700">这不像一个数字，请重新填（只填元的数，如 1200）</p>
        )}

        {refundKeepSold && (
          <input
            className="mt-2 w-full rounded-lg bg-gray-100 px-3 py-2 text-sm outline-none placeholder:text-gray-600"
            placeholder="备注（可留空）"
            value={refundNote}
            onChange={e => setRefundNote(e.target.value)}
          />
        )}

        <button
          type="button"
          className="mt-3 w-full rounded-xl bg-gray-900 py-3 text-sm font-semibold text-white disabled:opacity-40"
          disabled={refundParsed === null || refundingDogId === null}
          onClick={() => {
            if (refundingDogId === null) return
            confirmRefund(refundingDogId, refundKeepSold)
          }}
        >
          {refundKeepSold ? '记下退款' : '确认退狗并记下退款'}
        </button>
      </Modal>
    </div>
  )
}
