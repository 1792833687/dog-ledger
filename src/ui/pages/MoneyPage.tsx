import { useState } from 'react'
import { useAppData } from '../../state/useAppData'
import { poolBalance, advanceBalance } from '../../domain/ledger'
import { formatMoney } from '../../domain/money'
import { deleteEntry, updateEntry } from '../../domain/actions'
import type { LedgerEntry } from '../../domain/types'
import { Modal } from '../components/Modal'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { todayLocalIso } from '../planForm'
import {
  TYPE_LABEL, canSubmit, amountInvalid, entryLabel, needsPartner, partnerName,
  overAdvance, overAdvanceHint, applyBooking,
} from '../moneyBook'
import type { BookDialog } from '../moneyBook'
import {
  deleteWarning, entryDraftFrom, entryDraftIssue, entryPatch, entryScope,
} from '../entryForm'
import type { EntryDraft } from '../entryForm'
import { requestSettings } from '../navigation'

/**
 * 「最近流水」默认显示几笔。
 *
 * 抽成具名常量而不是在两处各写一个 60：判断（要不要出「显示全部」）与渲染（切到第几笔）
 * 必须用同一个数，写岔了要么按钮不出现、要么出现了点开还是那 60 笔。
 */
const RECENT_LIMIT = 60

/**
 * 「钱」页面 —— 资金流水与池子。
 *
 * 这一页回答一个问题：**现在池子里还有多少现金、这些钱是谁的。**
 * 支出分两种走法（池子直付 / 合伙人先垫付），后三种动作是把钱在池子和人之间挪
 * （注资、报销垫付、分红），它们都不属于任何一批、任何一只狗。
 *
 * 判定逻辑（分类名怎么显示、哪个按钮能用）都放在 `../moneyBook` 里，那里能单测。
 */
export function MoneyPage() {
  const { data, update } = useAppData()
  const [dialog, setDialog] = useState<BookDialog | null>(null)
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [category, setCategory] = useState('medical')
  const [partnerId, setPartnerId] = useState(data.settings.partners[0]?.id ?? '')
  const [paidBy, setPaidBy] = useState<'pool' | string>('pool')

  // 本机时区的今天。不要用 `toISOString().slice(0, 10)`：那是 UTC，
  // 东八区晚上 8 点后返回的是昨天，晚上记的账会落到前一天。
  // 惰性初始化而不是在渲染体里调 `new Date()` —— 后者会被 lint 的 react(purity) 拦下。
  const [today] = useState(() => todayLocalIso(new Date()))

  // 是否展开全部流水（默认只看最近 60 笔，手机上一屏能扫完）。
  const [showAll, setShowAll] = useState(false)

  // 正在改的那一笔。**草稿与 id 捆在同一个对象里**，不是两个 state：
  // 分成 `editId` + `editDraft` 的话，「改 A 改到一半去点 B」会留下 A 的草稿，
  // 打开 B 时框里是 A 的金额 —— 一保存就把 B 的钱改了（Task 21b 的批次名串台是同一类缺陷）。
  // 捆在一起还有一层用处：关弹窗只有一条路 `setEdit(null)`，草稿跟着一起没，不可能忘记清。
  const [edit, setEdit] = useState<{ id: string; draft: EntryDraft } | null>(null)
  // 正在确认要不要删的那一笔。这里只存 id，正文由 `deleteWarning` 现算（见下面 `deleting`）。
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const pool = poolBalance(data)
  // 先倒序再切片，**从不排序**：`entries` 的存储顺序就是「记账顺序」，
  // 域层（`deleteEntry` 找该狗最后一条卖出、`lastSaleIndex`）依赖它，写库路径里排一次序就全乱了。
  const ordered = [...data.entries].reverse()
  const shown = showAll ? ordered : ordered.slice(0, RECENT_LIMIT)
  const olderCount = ordered.length - shown.length
  const partners = data.settings.partners
  const missingPartner = dialog !== null && needsPartner(dialog) && partnerId === ''
  // 被选中那个人当前的垫付余额。报销的上限由它决定 —— 所以余额必须按选中的人算，
  // 算错人就会放过一笔超报（或者拦住一笔正常报销）。
  const advanceFen = advanceBalance(data, partnerId)
  const over = dialog !== null && overAdvance(dialog, amount, advanceFen)

  // 正在改的那一笔本体（草稿存在 `edit` 里，这里只把库里的流水捞回来）。
  // 捞不到就当作没在改：`editing === null` 时保存按钮是灰的，不会拿一份无从校验的草稿去写库。
  const editing = edit === null
    ? null
    : (data.entries.find(e => e.id === edit.id) ?? null)
  const editingIssue = edit === null || editing === null ? null : entryDraftIssue(editing, edit.draft)
  const editSavable = editing !== null && editingIssue === null
  const editingScope = editing === null ? '—' : entryScope(data, editing)
  const deleting = deletingId === null
    ? null
    : (data.entries.find(e => e.id === deletingId) ?? null)

  function close() {
    setDialog(null); setAmount(''); setNote('')
  }

  function submit() {
    if (dialog === null) return
    // 判定与下面按钮的 disabled 共用 canSubmit（`applyBooking` 内部也再判一次）。
    // 通不过就什么也不写：金额解析不出、该指明归属人却没人可选、报销超过垫付。
    if (!canSubmit(dialog, amount, partnerId, advanceFen)) return
    void update(d => applyBooking(d, {
      dialog, amountInput: amount, partnerId, category, paidBy, note, date: today,
    }))
    close()
  }

  /** 打开「改」：把库里这一笔原样摊成草稿（金额按元显示）。 */
  function openEdit(entry: LedgerEntry) {
    setEdit({ id: entry.id, draft: entryDraftFrom(entry) })
  }

  /** 只改草稿里被碰的那一格 —— 每次都是新对象，不改手里那份。 */
  function patchDraft(patch: Partial<EntryDraft>) {
    setEdit(cur => (cur === null ? null : { ...cur, draft: { ...cur.draft, ...patch } }))
  }

  /**
   * 保存这一笔。`entryPatch` 只带真正改了的键，所以「打开→直接保存」这条路什么都不会写
   * —— 空 patch 连 `updateEntry` 都不用叫（它会原样返回同一个引用），直接关弹窗即可。
   */
  function submitEdit() {
    if (edit === null || editing === null) return
    const patch = entryPatch(editing, edit.draft)
    if (Object.keys(patch).length > 0) void update(d => updateEntry(d, edit.id, patch))
    setEdit(null)
  }

  /** 真的删。`deleteEntry` 的回退规则（狗回不回到在库）由域层执行，界面只负责事先说清楚。 */
  function confirmDelete() {
    const id = deletingId
    if (id === null) return
    void update(d => deleteEntry(d, id))
    setDeletingId(null)
  }

  return (
    <div className="px-4 pb-6 pt-6">
      <div className="rounded-xl bg-gray-900 p-5 text-white shadow-sm">
        <div className="text-xs opacity-70">池子里的现金</div>
        <div className="mt-1 text-3xl font-bold">{formatMoney(pool)}</div>
      </div>

      {partners.length === 0 ? (
        <div className="mt-3 rounded-xl bg-amber-50 p-3">
          <p className="text-xs text-amber-700">
            还没有合伙人。注资、报销、分红都要指明是谁的钱。
          </p>
          {/* 以前这句话写「先去『设置』页把人加上」，可底栏根本没有「设置」这个标签 ——
              设置是「报」页最底下一个人默认收起的折叠块。用户照着找只会挨个标签点一遍。
              现在这个按钮自己去把设置摊开，不用人找。 */}
          <button
            type="button"
            onClick={() => requestSettings()}
            className="mt-2 rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white"
          >
            前往财务设置
          </button>
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {partners.map(p => {
            const adv = advanceBalance(data, p.id)
            return (
              <div key={p.id} className="rounded-xl bg-white p-3 shadow-sm">
                <div className="text-xs text-gray-500">{p.name} 垫付未还</div>
                <div className={`mt-0.5 text-lg font-semibold ${adv > 0 ? 'text-amber-700' : 'text-gray-500'}`}>
                  {formatMoney(adv)}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
        <button type="button" className="rounded-xl bg-white py-3 font-semibold shadow-sm" onClick={() => setDialog('expense')}>+ 支出</button>
        <button type="button" className="rounded-xl bg-white py-3 font-semibold shadow-sm" onClick={() => setDialog('income')}>+ 收入</button>
        <button type="button" className="rounded-xl bg-white py-3 font-semibold shadow-sm" onClick={() => setDialog('injection')}>+ 注资</button>
        <button type="button" className="rounded-xl bg-white py-3 text-xs font-semibold shadow-sm" onClick={() => setDialog('reimbursement')}>报销垫付</button>
        <button type="button" className="rounded-xl bg-white py-3 text-xs font-semibold shadow-sm" onClick={() => setDialog('distribution')}>分红</button>
      </div>

      <h2 className="mt-6 text-sm font-semibold text-gray-700">最近流水</h2>
      <ul className="mt-2 divide-y divide-gray-100 rounded-xl bg-white shadow-sm">
        {shown.map(e => (
          <li key={e.id} className="px-3 py-2 text-sm">
            {/* 第一行只放「这是什么账」与金额：金额是这一页最要紧的数字，
                别让「改」「删」两个按钮把它挤成省略号 —— 它们排在第二行。 */}
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 truncate">{entryLabel(data.settings.costItems, e.type, e.category)}</div>
              <div className={`shrink-0 ${e.type === 'expense' ? 'text-red-700' : e.type === 'income' ? 'text-emerald-700' : 'text-gray-700'}`}>
                {e.type === 'expense' ? '-' : '+'}{formatMoney(e.amount)}
              </div>
            </div>
            <div className="mt-0.5 flex items-center justify-between gap-2">
              <div className="min-w-0 text-xs text-gray-500">
                {e.date} · {entryScope(data, e)}
                {e.type === 'expense' && e.paidBy !== 'pool'
                  && ` · ${partnerName(partners, e.paidBy)} 垫付`}
                {/* 注资的 paidBy 就是注入人。不显示出来，这一页就答不了「这钱是谁的」。 */}
                {e.type === 'injection' && ` · ${partnerName(partners, e.paidBy)} 注入`}
                {e.payee && ` · 给 ${partnerName(partners, e.payee)}`}
                {e.note && ` · ${e.note}`}
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  className="rounded-lg bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-600"
                  onClick={() => openEdit(e)}
                >
                  改
                </button>
                <button
                  type="button"
                  className="rounded-lg bg-gray-100 px-2 py-1 text-xs font-semibold text-red-700"
                  onClick={() => setDeletingId(e.id)}
                >
                  删
                </button>
              </div>
            </div>
          </li>
        ))}
        {ordered.length === 0 && (
          <li className="px-3 py-6 text-center text-sm text-gray-500">还没有任何流水</li>
        )}
      </ul>

      {/* 更早的流水默认不渲染：手机上一屏扫不完，滚半天才摸到「+ 支出」那排按钮更难受。
          笔数由「总共多少 - 已经显示多少」现算，切片与判断共用 `RECENT_LIMIT`。
          点开是一次性展开全部（不做分页）：这是给自己看的一本小账，不是报表。 */}
      {olderCount > 0 && (
        <button
          type="button"
          className="mt-2 w-full rounded-xl bg-white py-3 text-sm font-semibold text-gray-600 shadow-sm"
          onClick={() => setShowAll(true)}
        >
          还有 {olderCount} 笔更早的 · 显示全部
        </button>
      )}

      <Modal
        open={dialog !== null}
        title={`记账：${dialog === null ? '' : TYPE_LABEL[dialog]}`}
        onClose={close}
      >
        <input
          autoFocus
          className="w-full rounded-lg bg-gray-100 px-3 py-2 text-lg outline-none placeholder:text-gray-600"
          inputMode="decimal"
          placeholder="金额（元）"
          value={amount}
          onChange={e => setAmount(e.target.value)}
        />

        {amountInvalid(amount) && (
          <p className="mt-1 text-xs text-red-700">金额只能填数字，例如 1200 或 1200.50</p>
        )}

        {/* 两条红色提示互斥：金额解析不出来时 overAdvance 恒为 false，归上面那条管。 */}
        {over && <p className="mt-1 text-xs text-red-700">{overAdvanceHint(advanceFen)}</p>}

        {dialog === 'reimbursement' && partnerId !== '' && !amountInvalid(amount) && !over && (
          <p className="mt-1 text-xs text-gray-500">
            {partnerName(partners, partnerId)} 现在垫付了 {formatMoney(advanceFen)}
          </p>
        )}

        {dialog === 'expense' && (
          <>
            <select
              className="mt-2 w-full rounded-lg bg-gray-100 px-3 py-2 text-sm"
              value={category}
              onChange={e => setCategory(e.target.value)}
            >
              {data.settings.costItems.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select
              className="mt-2 w-full rounded-lg bg-gray-100 px-3 py-2 text-sm"
              value={paidBy}
              onChange={e => setPaidBy(e.target.value)}
            >
              <option value="pool">从池子里出</option>
              {partners.map(p => (
                <option key={p.id} value={p.id}>{p.name} 先垫付</option>
              ))}
            </select>
          </>
        )}

        {dialog !== null && needsPartner(dialog) && (
          <select
            className="mt-2 w-full rounded-lg bg-gray-100 px-3 py-2 text-sm"
            value={partnerId}
            onChange={e => setPartnerId(e.target.value)}
          >
            {partners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}

        <input
          className="mt-2 w-full rounded-lg bg-gray-100 px-3 py-2 text-sm outline-none placeholder:text-gray-600"
          placeholder="备注（可留空）"
          value={note}
          onChange={e => setNote(e.target.value)}
        />

        {missingPartner && (
          <p className="mt-1 text-xs text-amber-700">
            这笔钱要记在某个合伙人名下，先去「设置」页添加合伙人。
          </p>
        )}

        <button
          type="button"
          className="mt-3 w-full rounded-xl bg-emerald-700 py-3 text-sm font-semibold text-white disabled:opacity-40"
          disabled={dialog === null || !canSubmit(dialog, amount, partnerId, advanceFen)}
          onClick={submit}
        >
          记下
        </button>
      </Modal>

      {/* 「改」一笔。能改的就是当初记账那几个里有道理的：金额、日期、经手人、支出类别、备注。
          类别只对支出显示（别的类型的「类别」是这笔钱的性质，改它等于换一种账）；
          经手人只对支出与注资有意义（前者是垫付人，后者是注入人）。
          挂靠（哪只狗、哪一批）**在库里就改不了**，这里也就不给入口。 */}
      <Modal open={editing !== null} title="改这一笔" onClose={() => setEdit(null)}>
        {edit !== null && editing !== null && (
          <>
            <input
              autoFocus
              className="w-full rounded-lg bg-gray-100 px-3 py-2 text-lg outline-none placeholder:text-gray-600"
              inputMode="decimal"
              placeholder="金额（元）"
              value={edit.draft.amount}
              onChange={e => patchDraft({ amount: e.target.value })}
            />

            {/* 红字与「保存」的禁用用同一个判定（`editingIssue` / `editSavable`），
                不会出现「有红字但能点保存」。 */}
            {editingIssue !== null && <p className="mt-1 text-xs text-red-700">{editingIssue}</p>}

            <input
              type="date"
              className="mt-2 w-full rounded-lg bg-gray-100 px-3 py-2 text-sm outline-none"
              value={edit.draft.date}
              onChange={e => patchDraft({ date: e.target.value })}
            />

            {editing.type === 'expense' && (
              <select
                className="mt-2 w-full rounded-lg bg-gray-100 px-3 py-2 text-sm"
                value={edit.draft.category}
                onChange={e => patchDraft({ category: e.target.value })}
              >
                {data.settings.costItems.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}

            {(editing.type === 'expense' || editing.type === 'injection') && (
              <select
                className="mt-2 w-full rounded-lg bg-gray-100 px-3 py-2 text-sm"
                value={edit.draft.paidBy}
                onChange={e => patchDraft({ paidBy: e.target.value })}
              >
                {editing.type === 'expense' && <option value="pool">从池子里出</option>}
                {partners.map(p => (
                  <option key={p.id} value={p.id}>
                    {editing.type === 'expense' ? `${p.name} 先垫付` : `${p.name} 注入`}
                  </option>
                ))}
              </select>
            )}

            <input
              className="mt-2 w-full rounded-lg bg-gray-100 px-3 py-2 text-sm outline-none placeholder:text-gray-600"
              placeholder="备注（可留空）"
              value={edit.draft.note}
              onChange={e => patchDraft({ note: e.target.value })}
            />

            {/* 把「这是哪一笔」亮在按钮上面：手机上开了弹窗，后面那行流水已经被盖住了，
                不写出来用户会不确定自己点的是哪一笔。 */}
            <p className="mt-2 text-xs text-gray-500">
              {editingScope === '—' ? '这笔账没挂在任何一批、任何一只狗上' : `它挂在${editingScope}`}
              {' · '}原来记的是 {formatMoney(editing.amount)}
            </p>

            <button
              type="button"
              className="mt-3 w-full rounded-xl bg-gray-900 py-3 text-sm font-semibold text-white disabled:opacity-40"
              disabled={!editSavable}
              onClick={submitEdit}
            >
              保存
            </button>
          </>
        )}
      </Modal>

      {/* 「删」一笔。这是全仓唯一一处物理删除（别的都是改状态或加抵消），所以后果必须先说清楚：
          正文由 `deleteWarning` 现算，它照着 `deleteEntry` 的三条回退前提说话，
          绝不在狗不会回到在库的时候写「会回到在库」。 */}
      <ConfirmDialog
        open={deleting !== null}
        title="删掉这一笔？"
        message={deleting === null ? '' : deleteWarning(data, deleting)}
        confirmLabel="删掉"
        onConfirm={confirmDelete}
        onClose={() => setDeletingId(null)}
      />
    </div>
  )
}
