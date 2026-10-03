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
  const [refundingDogId, setRefundingDogId] = useState<string | null>(null)
  const [refundAmount, setRefundAmount] = useState('')
  const [refundKeepSold, setRefundKeepSold] = useState(false)
  const [refundNote, setRefundNote] = useState('')

  // 解析不了（不是空、但不是数字）时必须给中文提示并且不写账，不能静默当 0：
  // 用户把「600元」打成「６00」而系统按 0 记账，那一批的成本从此就是错的，且没人会发现。
  const priceParsed = parseMoney(priceInput)
  const priceInvalid = priceInput.trim() !== '' && priceParsed === null
  const expenseParsed = parseMoney(expenseAmount)
  const expenseInvalid = expenseAmount.trim() !== '' && expenseParsed === null
  const refundParsed = parseMoney(refundAmount)
  const refundInvalid = refundAmount.trim() !== '' && refundParsed === null
  const refundDog = refundingDogId === null ? null : data.dogs.find(d => d.id === refundingDogId) ?? null

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

  // 已经记过退款的狗 id。用来把「退狗 / 钱退了狗没回来」两个按钮收掉：
  // 这两个动作都是「加一笔支出」，重复点会重复扣钱，而它们不像卖出那样
  // 能被状态挡住（钱退了狗没回来时状态本来就一直是 sold）。
  const refundedDogIds = new Set(
    data.entries
      .filter(e => e.type === 'expense' && e.category === 'aftercare_refund')
      .map(e => e.dogId)
      .filter((id): id is string => id !== null),
  )

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
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                {d.status === 'in_stock' && (
                  <button
                    type="button"
                    className="rounded-md bg-emerald-600 px-3 py-1 text-white"
                    onClick={() => { setSellingDogId(d.id); setPriceInput('') }}
                  >
                    卖出
                  </button>
                )}
                {/* 只有还在库的狗能标死亡。已售的狗标死亡会把 sold 覆盖成 dead，
                    而收入流水留在账上，批次盈亏从此是错的（markDogDead 里也有守卫兜底）。 */}
                {d.status === 'in_stock' && (
                  <button
                    type="button"
                    className="rounded-md bg-gray-100 px-3 py-1 text-gray-600"
                    onClick={() => void update(x => markDogDead(x, d.id))}
                  >
                    死亡
                  </button>
                )}
                {d.status === 'sold' && !refundedDogIds.has(d.id) && (
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
                {d.status === 'sold' && !refundedDogIds.has(d.id) && (
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
                {d.status === 'sold' && refundedDogIds.has(d.id) && (
                  <span className="self-center text-gray-400">已记退款</span>
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
          className="w-full rounded-lg bg-gray-100 px-3 py-2 text-lg outline-none"
          inputMode="decimal"
          placeholder="退回给客户的钱（元）"
          value={refundAmount}
          onChange={e => setRefundAmount(e.target.value)}
        />
        {refundInvalid && (
          <p className="mt-1 text-xs text-red-500">这不像一个数字，请重新填（只填元的数，如 1200）</p>
        )}

        {refundKeepSold && (
          <input
            className="mt-2 w-full rounded-lg bg-gray-100 px-3 py-2 text-sm outline-none"
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
