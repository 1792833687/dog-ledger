import { useState } from 'react'
import { useAppData } from '../../state/useAppData'
import { batchSummary, dogsOfBatch, dilutedCostFen, dogIncome, dogProfitFen } from '../../domain/costing'
import { sellDog, markDogDead, setDogStatus, createBatch, addExpense } from '../../domain/actions'
import { formatMoney, parseMoney } from '../../domain/money'
import { newId } from '../../domain/types'
import { Modal } from '../components/Modal'
import { todayLocalIso } from '../planForm'

/**
 * 「狗」页面 —— 批次台账。
 *
 * 两个状态：批次列表 ⇄ 某一个批次的详情。详情里回答两个问题：
 * 这一批现在赚了还是亏了，以及**剩下的每只至少卖多少钱整批才不亏**。
 *
 * 记账一律走 `Modal` + 中文表单，不用 `window.prompt`：记账是最高频的动作，
 * 弹三个系统框、还要用户手打英文成本项，第二天就不会有人再记了。
 * 成本项下拉直接读 `data.settings.costItems`，与「钱」页面共用同一套选项。
 */

const STATUS_LABEL: Record<string, string> = {
  in_stock: '在库', sold: '已售', dead: '死亡', returned: '退回',
}

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

  // 解析不了（不是空、但不是数字）时必须给中文提示并且不写账，不能静默当 0：
  // 用户把「600元」打成「６00」而系统按 0 记账，那一批的成本从此就是错的，且没人会发现。
  const priceParsed = parseMoney(priceInput)
  const priceInvalid = priceInput.trim() !== '' && priceParsed === null
  const expenseParsed = parseMoney(expenseAmount)
  const expenseInvalid = expenseAmount.trim() !== '' && expenseParsed === null

  if (!openBatchId) {
    return (
      <div className="px-4 pb-6 pt-6">
        <h1 className="text-xl font-bold">批次</h1>
        <p className="mt-1 text-xs text-gray-500">
          一批一个价，别把两批的账混在一起。
        </p>

        <div className="mt-4 flex gap-2">
          <input
            className="flex-1 rounded-lg bg-white px-3 py-2 text-sm shadow-sm outline-none"
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

        <ul className="mt-4 space-y-2">
          {data.batches.map(b => {
            const s = batchSummary(data, b.id)
            return (
              <li key={b.id}>
                <button
                  type="button"
                  onClick={() => setOpenBatchId(b.id)}
                  className="w-full rounded-xl bg-white p-3 text-left shadow-sm"
                >
                  <div className="flex items-baseline justify-between">
                    <span className="font-semibold">{b.name}</span>
                    <span className={`text-sm font-semibold ${s.netProfitFen >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
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
            <li className="rounded-xl bg-white p-6 text-center text-sm text-gray-400">
              还没有批次。去「算」标签页一键建一个。
            </li>
          )}
        </ul>
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
          onClick={() => setOpenBatchId(null)}
        >
          ← 回所有批次
        </button>
      </div>
    )
  }

  const summary = batchSummary(data, batch.id)
  const dogs = dogsOfBatch(data, batch.id)

  return (
    <div className="px-4 pb-6 pt-6">
      <button type="button" className="text-sm text-gray-500" onClick={() => setOpenBatchId(null)}>
        ← 所有批次
      </button>
      <h1 className="mt-2 text-xl font-bold">{batch.name}</h1>
      <p className="mt-1 text-xs text-gray-500">
        {batch.date} · 去向：{batch.plannedChannel === 'undecided' ? '未定' : batch.plannedChannel}
      </p>

      <div className="mt-3 rounded-xl bg-white p-4 shadow-sm">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div><span className="text-gray-500">总成本</span> <b>{formatMoney(summary.totalCost)}</b></div>
          <div><span className="text-gray-500">已收款</span> <b>{formatMoney(summary.income)}</b></div>
          <div><span className="text-gray-500">死亡损耗</span> <b className="text-red-500">{formatMoney(summary.deadLoss)}</b></div>
          <div>
            <span className="text-gray-500">盈亏</span>{' '}
            <b className={summary.netProfitFen >= 0 ? 'text-emerald-600' : 'text-red-500'}>
              {formatMoney(summary.netProfitFen)}
            </b>
          </div>
        </div>
        {summary.floorPriceFen !== null && (
          <div className="mt-3 rounded-lg bg-emerald-50 p-3">
            <div className="text-xs text-emerald-700">剩下的每只至少卖</div>
            <div className="text-2xl font-bold text-emerald-700">{formatMoney(summary.floorPriceFen)}</div>
            <div className="text-xs text-emerald-600">整批才不亏</div>
          </div>
        )}
      </div>

      <ul className="mt-4 space-y-2">
        {dogs.map(d => {
          const income = dogIncome(data, d.id)
          const cost = dilutedCostFen(data, d.id)
          const profit = dogProfitFen(data, d.id)
          return (
            <li key={d.id} className="rounded-xl bg-white p-3 shadow-sm">
              <div className="flex items-baseline justify-between">
                <span className="font-semibold">{d.code}</span>
                <span className="text-xs text-gray-500">{STATUS_LABEL[d.status]}</span>
              </div>
              <div className="mt-1 text-xs text-gray-500">
                摊薄成本 {formatMoney(cost)}
                {d.status === 'sold' && (
                  <> · 售价 {formatMoney(income)} ·{' '}
                    <span className={profit >= 0 ? 'text-emerald-600' : 'text-red-500'}>
                      {profit >= 0 ? '赚' : '亏'} {formatMoney(Math.abs(profit))}
                    </span>
                  </>
                )}
              </div>
              <div className="mt-2 flex gap-2 text-xs">
                {d.status !== 'sold' && d.status !== 'dead' && (
                  <button
                    type="button"
                    className="rounded-md bg-emerald-600 px-3 py-1 text-white"
                    onClick={() => { setSellingDogId(d.id); setPriceInput('') }}
                  >
                    卖出
                  </button>
                )}
                {d.status !== 'dead' && (
                  <button
                    type="button"
                    className="rounded-md bg-gray-100 px-3 py-1 text-gray-600"
                    onClick={() => void update(x => markDogDead(x, d.id))}
                  >
                    死亡
                  </button>
                )}
                {d.status === 'sold' && (
                  <button
                    type="button"
                    className="rounded-md bg-gray-100 px-3 py-1 text-gray-600"
                    onClick={() => void update(x => setDogStatus(x, d.id, 'returned'))}
                  >
                    退狗
                  </button>
                )}
              </div>
            </li>
          )
        })}
        {dogs.length === 0 && (
          <li className="rounded-xl bg-white p-6 text-center text-sm text-gray-400">
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
      <p className="mt-2 text-xs text-gray-400">
        这里只记池子直接付掉的钱。合伙人先垫付的，去「钱」标签页记，那笔将来要从池子还给他。
      </p>

      <Modal
        open={sellingDogId !== null}
        title="卖出了多少钱？"
        onClose={() => setSellingDogId(null)}
      >
        <input
          autoFocus
          className="w-full rounded-lg bg-gray-100 px-3 py-2 text-lg outline-none"
          inputMode="decimal"
          placeholder="售价（元）"
          value={priceInput}
          onChange={e => setPriceInput(e.target.value)}
        />
        {priceInvalid && (
          <p className="mt-1 text-xs text-red-500">这不像一个数字，请重新填（只填元的数，如 1200）</p>
        )}
        <button
          type="button"
          className="mt-3 w-full rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white disabled:opacity-40"
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
          className="w-full rounded-lg bg-gray-100 px-3 py-2 text-lg outline-none"
          inputMode="decimal"
          placeholder="金额（元）"
          value={expenseAmount}
          onChange={e => setExpenseAmount(e.target.value)}
        />
        {expenseInvalid && (
          <p className="mt-1 text-xs text-red-500">这不像一个数字，请重新填（只填元的数，如 400）</p>
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
          className="mt-2 w-full rounded-lg bg-gray-100 px-3 py-2 text-sm outline-none"
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
    </div>
  )
}
