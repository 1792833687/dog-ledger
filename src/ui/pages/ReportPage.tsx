import { useMemo, useState } from 'react'
import { useAppData } from '../../state/useAppData'
import { settle } from '../../domain/settlement'
import { batchSummary } from '../../domain/costing'
import { formatMoney } from '../../domain/money'
import { buildReceiptRows, receiptToBlob } from '../receipt'
import { todayLocalIso } from '../planForm'

/**
 * 「报」页面 —— 分账与一键对账单图片。
 *
 * 这一页回答一个问题：**这笔生意到底赚了多少、每个人该分多少、池子里还剩多少。**
 * 三种数字刻意排在一起：应分（权益）、已分红（已经拿走的）、垫付未还（还替池子垫着的钱），
 * 少看一个就会算错账。底下的批次排行是给「下一批该不该接着做」用的。
 */
export function ReportPage() {
  const { data } = useAppData()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  // 本机时区的今天。不要用 `toISOString().slice(0, 10)`：那是 UTC，
  // 东八区晚上 8 点后返回的是昨天。惰性初始化而不是在渲染体里调 `new Date()`
  // —— 后者会被 lint 的 react(purity) 拦下。
  const [today] = useState(() => todayLocalIso(new Date()))

  const s = settle(data)
  const ranking = useMemo(
    () => data.batches
      .map(b => ({ batch: b, summary: batchSummary(data, b.id) }))
      .sort((a, b) => b.summary.netProfitFen - a.summary.netProfitFen),
    [data],
  )

  function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    // 必须先进 DOM 再 click：游离节点上的 click 在部分浏览器里不会触发下载
    document.body.appendChild(a)
    a.click()
    a.remove()
    // 立刻 revokeObjectURL 会让下载中断，推到下一个宏任务再回收
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  async function shareReceipt() {
    setBusy(true)
    setMessage('')
    try {
      const blob = await receiptToBlob(buildReceiptRows(data), '狗账对账单', `截至 ${today}`)
      const filename = `对账单-${today}.png`
      const file = new File([blob], filename, { type: 'image/png' })

      // 优先用系统分享（微信/相册都在里面）；不支持就退回下载。
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: '狗账对账单' })
          setMessage('已调起分享')
        } catch (e) {
          // 用户自己取消了分享：不是错误，什么都不用说
          if (e instanceof Error && e.name === 'AbortError') return
          // iOS 上 `await receiptToBlob` 会消耗掉「用户手势」的时效，
          // share 抛 NotAllowedError —— 这时退回下载，别让用户以为白点了
          if (e instanceof Error && e.name === 'NotAllowedError') {
            downloadBlob(blob, filename)
            setMessage('已保存图片，请手动分享到微信')
            return
          }
          throw e
        }
      } else {
        downloadBlob(blob, filename)
        setMessage('图片已保存，去相册里发微信')
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '生成失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="px-4 pb-6 pt-6">
      <h1 className="text-lg font-bold text-gray-800">对账</h1>

      <button
        type="button"
        className="mt-3 w-full rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white disabled:opacity-40"
        disabled={busy}
        onClick={shareReceipt}
      >
        {busy ? '生成中…' : '生成对账单图片，发给伙伴'}
      </button>
      {message !== '' && <p className="mt-2 text-xs text-gray-500">{message}</p>}

      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-white p-3 shadow-sm">
          <div className="text-xs text-gray-500">总收入</div>
          <div className="mt-0.5 text-lg font-semibold">{formatMoney(s.totalIncome)}</div>
        </div>
        <div className="rounded-xl bg-white p-3 shadow-sm">
          <div className="text-xs text-gray-500">总支出</div>
          <div className="mt-0.5 text-lg font-semibold">{formatMoney(s.totalExpense)}</div>
        </div>
        <div className="rounded-xl bg-white p-3 shadow-sm">
          <div className="text-xs text-gray-500">净利</div>
          <div className={`mt-0.5 text-lg font-semibold ${s.netProfit >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
            {formatMoney(s.netProfit)}
          </div>
        </div>
        <div className="rounded-xl bg-white p-3 shadow-sm">
          <div className="text-xs text-gray-500">池子余额</div>
          <div className="mt-0.5 text-lg font-semibold">{formatMoney(s.pool)}</div>
        </div>
      </div>

      <h2 className="mt-6 text-sm font-semibold text-gray-700">分账</h2>
      {s.partners.length === 0 ? (
        <p className="mt-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-700">还没有合伙人，先去「设置」页把人加上。</p>
      ) : (
        <div className="mt-2 overflow-hidden rounded-xl bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-400">
                <th className="px-3 py-2 text-left font-normal">合伙人</th>
                <th className="px-3 py-2 text-right font-normal">应分</th>
                <th className="px-3 py-2 text-right font-normal">已分红</th>
                <th className="px-3 py-2 text-right font-normal">垫付未还</th>
              </tr>
            </thead>
            <tbody>
              {s.partners.map(p => (
                <tr key={p.id} className="border-t border-gray-100">
                  <td className="px-3 py-2">
                    {p.name}
                    <span className="ml-1 text-xs text-gray-400">{(p.shareRatio * 100).toFixed(0)}%</span>
                  </td>
                  <td className="px-3 py-2 text-right font-semibold">{formatMoney(p.claimable)}</td>
                  <td className="px-3 py-2 text-right text-gray-600">{formatMoney(p.distributed)}</td>
                  <td className={`px-3 py-2 text-right ${p.advance > 0 ? 'text-amber-600' : 'text-gray-400'}`}>
                    {formatMoney(p.advance)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-2 text-xs text-gray-500">应分是账上算出来的权益，不点「分红」钱就一直留在池子里周转。</p>

      {ranking.length > 0 && (
        <>
          <h2 className="mt-6 text-sm font-semibold text-gray-700">批次盈亏排行</h2>
          <ul className="mt-2 divide-y divide-gray-100 rounded-xl bg-white shadow-sm">
            {ranking.map(({ batch, summary }) => {
              // 死亡率的分母只数一遍：`inStock` 里已经含了退回的狗（见 costing.ts 的 inStockCount），
              // 再加 `returned` 会把退回的狗算两次，让死亡率偏低。
              const total = summary.sold + summary.dead + summary.inStock
              return (
                <li key={batch.id} className="flex items-center justify-between px-3 py-2 text-sm">
                  <div>
                    <div>{batch.name}</div>
                    <div className="text-xs text-gray-400">
                      {batch.date} · 共 {total} 只 · 死亡 {summary.dead} 只
                      {total > 0 && ` · 死亡率 ${((summary.dead / total) * 100).toFixed(1)}%`}
                    </div>
                  </div>
                  <div className={summary.netProfitFen >= 0 ? 'text-emerald-600' : 'text-red-500'}>
                    {formatMoney(summary.netProfitFen)}
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}
