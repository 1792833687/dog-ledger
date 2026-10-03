import { useState } from 'react'
import { useAppData } from '../../state/useAppData'
import { poolBalance, advanceBalance } from '../../domain/ledger'
import { formatMoney } from '../../domain/money'
import { Modal } from '../components/Modal'
import { todayLocalIso } from '../planForm'
import {
  TYPE_LABEL, canSubmit, amountInvalid, entryLabel, needsPartner, partnerName,
  overAdvance, overAdvanceHint, applyBooking,
} from '../moneyBook'
import type { BookDialog } from '../moneyBook'

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

  const pool = poolBalance(data)
  const recent = [...data.entries].reverse().slice(0, 60)
  const partners = data.settings.partners
  const missingPartner = dialog !== null && needsPartner(dialog) && partnerId === ''
  // 被选中那个人当前的垫付余额。报销的上限由它决定 —— 所以余额必须按选中的人算，
  // 算错人就会放过一笔超报（或者拦住一笔正常报销）。
  const advanceFen = advanceBalance(data, partnerId)
  const over = dialog !== null && overAdvance(dialog, amount, advanceFen)

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

  return (
    <div className="px-4 pb-6 pt-6">
      <div className="rounded-xl bg-gray-900 p-5 text-white shadow-sm">
        <div className="text-xs opacity-70">池子里的现金</div>
        <div className="mt-1 text-3xl font-bold">{formatMoney(pool)}</div>
      </div>

      {partners.length === 0 ? (
        <p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-700">
          还没有合伙人。注资、报销、分红都要指明是谁的钱，先去「设置」页把人加上。
        </p>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {partners.map(p => {
            const adv = advanceBalance(data, p.id)
            return (
              <div key={p.id} className="rounded-xl bg-white p-3 shadow-sm">
                <div className="text-xs text-gray-500">{p.name} 垫付未还</div>
                <div className={`mt-0.5 text-lg font-semibold ${adv > 0 ? 'text-amber-600' : 'text-gray-400'}`}>
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
        {recent.map(e => (
          <li key={e.id} className="flex items-center justify-between px-3 py-2 text-sm">
            <div>
              <div>{entryLabel(data.settings.costItems, e.type, e.category)}</div>
              <div className="text-xs text-gray-400">
                {e.date}
                {e.type === 'expense' && e.paidBy !== 'pool'
                  && ` · ${partnerName(partners, e.paidBy)} 垫付`}
                {/* 注资的 paidBy 就是注入人。不显示出来，这一页就答不了「这钱是谁的」。 */}
                {e.type === 'injection' && ` · ${partnerName(partners, e.paidBy)} 注入`}
                {e.payee && ` · 给 ${partnerName(partners, e.payee)}`}
                {e.note && ` · ${e.note}`}
              </div>
            </div>
            <div className={e.type === 'expense' ? 'text-red-500' : e.type === 'income' ? 'text-emerald-600' : 'text-gray-700'}>
              {e.type === 'expense' ? '-' : '+'}{formatMoney(e.amount)}
            </div>
          </li>
        ))}
        {recent.length === 0 && (
          <li className="px-3 py-6 text-center text-sm text-gray-400">还没有任何流水</li>
        )}
      </ul>

      <Modal
        open={dialog !== null}
        title={`记账：${dialog === null ? '' : TYPE_LABEL[dialog]}`}
        onClose={close}
      >
        <input
          autoFocus
          className="w-full rounded-lg bg-gray-100 px-3 py-2 text-lg outline-none"
          inputMode="decimal"
          placeholder="金额（元）"
          value={amount}
          onChange={e => setAmount(e.target.value)}
        />

        {amountInvalid(amount) && (
          <p className="mt-1 text-xs text-red-500">金额只能填数字，例如 1200 或 1200.50</p>
        )}

        {/* 两条红色提示互斥：金额解析不出来时 overAdvance 恒为 false，归上面那条管。 */}
        {over && <p className="mt-1 text-xs text-red-500">{overAdvanceHint(advanceFen)}</p>}

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
          className="mt-2 w-full rounded-lg bg-gray-100 px-3 py-2 text-sm outline-none"
          placeholder="备注（可留空）"
          value={note}
          onChange={e => setNote(e.target.value)}
        />

        {missingPartner && (
          <p className="mt-1 text-xs text-amber-600">
            这笔钱要记在某个合伙人名下，先去「设置」页添加合伙人。
          </p>
        )}

        <button
          type="button"
          className="mt-3 w-full rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white disabled:opacity-40"
          disabled={dialog === null || !canSubmit(dialog, amount, partnerId, advanceFen)}
          onClick={submit}
        >
          记下
        </button>
      </Modal>
    </div>
  )
}
