import { useState } from 'react'
import { useAppData } from '../../state/useAppData'
import { dogsOfBatch } from '../../domain/costing'
import { setDogQuarantine } from '../../domain/actions'
import { certExpiresIn, preSaleChecklist, quarantineStatus } from '../../domain/quarantine'
import { todayLocalIso } from '../planForm'
import { isOnHand } from '../dogLedger'
import type { Batch } from '../../domain/types'
import type { DogQuarantinePatch } from '../../domain/actions'
import type { QuarantineStage } from '../../domain/quarantine'

/**
 * 「检」页面 —— 这批狗谁能卖、谁不能卖、为什么。
 *
 * 这一页是**本工具唯一能防止 5 万级罚款的地方**（设计文档 §3.7）：没有《动物检疫合格证明》
 * 就出售，按货值 15~30 倍罚。所以它的两半缺一不可：
 * 上半是每只狗的阶段与下一步动作（把人推着往前走），下半是出栏前清单（把「这批 8 只里有
 * 3 只不能卖」直接摆出来）。清单只数**在库**的狗 —— 死狗与已售狗不在笼子里，把它们算进
 * 分母会让「在库 N 只里有 M 只不能卖」这句话失去意义。
 *
 * 页面自己不做任何判定：阶段、下一步、能不能卖、还要等几天全部来自 `domain/quarantine.ts`，
 * 写库一律走 `setDogQuarantine`（界面不许自己拼新 `AppData`）。
 */

/**
 * 最近创建的批次。
 *
 * 任务书写的是「`createdAt` 最大者」，但 `Batch` 上**没有 `createdAt` 这个字段**
 * （`types.ts:88-97` 只有 id/name/date/source/note/status/plannedChannel）。
 * `createBatch` 是往数组尾部追加的，所以「最后一条」就是最近建的那条 —— 这也是唯一
 * 与创建时刻相关的顺序。不拿 `date` 排：`date` 是这批狗的业务日期，用户可以同一天建两批、
 * 也可以给新批次填个过去的日期，按它排会把刚建的批次藏起来。
 */
function latestBatch(batches: Batch[]): Batch | null {
  return batches.length === 0 ? null : batches[batches.length - 1]
}

/** 快捷动作：把阶段往前推一格最省事的那一步。`focusCert` 表示这一格要人填东西，不是点一下能完成的。 */
interface QuickAction {
  text: string
  patch?: DogQuarantinePatch
  focusCert?: boolean
}

function quickAction(stage: QuarantineStage, today: string): QuickAction | null {
  switch (stage) {
    case 'unvaccinated': return { text: '今天已接种', patch: { rabiesVaccinatedOn: today } }
    case 'ready_to_test': return { text: '今天已送检', patch: { antibodyTestedOn: today } }
    case 'waiting_cert': return { text: '已有证明', focusCert: true }
    // 等待期内没有什么「点一下就好」的事；可售与已过期都不需要动作。
    case 'waiting_antibody': return null
    case 'certified': return null
    case 'cert_expired': return null
  }
}

/** 证明还有几天到期。`null` = 没填有效期（是「不知道」，不是「还剩 0 天」）。 */
function expiresText(days: number | null): string | null {
  if (days === null) return null
  if (days < 0) return `已过期 ${-days} 天`
  if (days === 0) return '今天到期'
  return `还有 ${days} 天到期`
}

const ROW = 'block border-b border-gray-100 py-2'
const ROW_LABEL = 'text-xs text-gray-500'
const ROW_INPUT = 'mt-1 w-full rounded-md bg-gray-100 px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500'

export function QuarantinePage() {
  const { data, update } = useAppData()
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string[]>([])
  const [focusCertFor, setFocusCertFor] = useState<string | null>(null)

  // 每只狗的阶段判定都要用「今天」，所以「今天」必须在渲染期就存在（不能像「狗」页面那样
  // 包成函数、只在点击时才算）。惰性初始化是唯一能过门禁的写法：
  // `useMemo` 会被 react(purity) 拦，`useEffect` + `setToday` 会被 react(set-state-in-effect) 拦。
  // 也不要写 `toISOString().slice(0, 10)`：那是 UTC，东八区晚上 8 点后返回昨天。
  const [today] = useState(() => todayLocalIso(new Date()))

  const batch = data.batches.find(b => b.id === selectedBatchId) ?? latestBatch(data.batches)
  if (batch === null) {
    return (
      <div className="px-4 pb-6 pt-6">
        <h1 className="text-xl font-bold">检疫</h1>
        <p className="mt-3 rounded-xl bg-white p-6 text-center text-sm text-gray-400">
          先去「算」页面建一个批次。
        </p>
      </div>
    )
  }

  const onHandDogs = dogsOfBatch(data, batch.id).filter(isOnHand)
  const checklist = preSaleChecklist(data, batch.id, today)
  const onHandCount = checklist.sellable.length + checklist.blocked.length

  function patchDog(dogId: string, p: DogQuarantinePatch): void {
    void update(x => setDogQuarantine(x, dogId, p))
  }

  function toggleExpanded(dogId: string): void {
    setExpanded(prev => {
      if (prev.includes(dogId)) {
        if (focusCertFor === dogId) setFocusCertFor(null)
        return prev.filter(id => id !== dogId)
      }
      return [...prev, dogId]
    })
  }

  return (
    <div className="px-4 pb-6 pt-6">
      <h1 className="text-xl font-bold">检疫</h1>
      <p className="mt-1 text-xs text-gray-500">
        没有《动物检疫合格证明》就出售，按货值 15~30 倍罚。
      </p>

      <select
        className="mt-3 w-full rounded-lg bg-white px-3 py-2 text-sm shadow-sm"
        value={batch.id}
        onChange={e => setSelectedBatchId(e.target.value)}
      >
        {data.batches.map(b => (
          <option key={b.id} value={b.id}>{b.name}（{b.date}）</option>
        ))}
      </select>

      <ul className="mt-3 space-y-2">
        {onHandDogs.map(d => {
          const status = quarantineStatus(d, data.settings, today)
          const action = quickAction(status.stage, today)
          const open = expanded.includes(d.id)
          const expires = expiresText(certExpiresIn(d, today))
          // 2026-10-03 裁定：有证明就能卖，接种日期只是台账的完整性问题。
          // 判据写在界面侧（域层不为这一条加字段、也不改 QuarantineStatus 的形状）。
          const missingVaccinationDate = d.rabiesVaccinatedOn === null && status.stage === 'certified'
          return (
            <li key={d.id} className="rounded-xl bg-white p-3 shadow-sm">
              <div className="flex items-baseline justify-between">
                <span className="font-semibold">{d.code}</span>
                <span className={`text-sm font-semibold ${status.isSellable ? 'text-emerald-600' : 'text-amber-600'}`}>
                  {status.label}
                </span>
              </div>

              <div className="mt-1 text-xs text-gray-500">
                {status.nextAction}
                {d.status === 'returned' && <span className="ml-1 text-amber-600">· 退回的狗</span>}
              </div>

              {status.daysUntilTestable !== null && (
                <div className="mt-1 text-xs text-gray-400">
                  还要等 {status.daysUntilTestable} 天才能采血送检
                </div>
              )}

              {(d.quarantineCertNo !== '' || d.quarantineCertValidUntil !== null) && (
                <div className="mt-1 text-xs text-gray-500">
                  证明 {d.quarantineCertNo === '' ? '（编号未填）' : d.quarantineCertNo}
                  {d.quarantineCertValidUntil !== null && ` · 有效期至 ${d.quarantineCertValidUntil}`}
                  {expires !== null && ` · ${expires}`}
                </div>
              )}

              {missingVaccinationDate && (
                <div className="mt-1 text-xs text-gray-400">
                  接种日期未记录（不影响出售，但能补就补上）
                </div>
              )}

              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                {action !== null && (
                  <button
                    type="button"
                    className="rounded-md bg-emerald-600 px-3 py-1 text-white"
                    onClick={() => {
                      if (action.focusCert === true) {
                        if (!open) setExpanded(prev => [...prev, d.id])
                        setFocusCertFor(d.id)
                        return
                      }
                      const p = action.patch
                      if (p === undefined) return
                      patchDog(d.id, p)
                    }}
                  >
                    {action.text}
                  </button>
                )}
                <button
                  type="button"
                  className="rounded-md bg-gray-100 px-3 py-1 text-gray-600"
                  onClick={() => toggleExpanded(d.id)}
                >
                  {open ? '收起' : '展开填检疫信息'}
                </button>
              </div>

              {open && (
                <div className="mt-2 border-t border-gray-100 pt-1">
                  <label className={ROW}>
                    <span className={ROW_LABEL}>狂犬病疫苗接种日期</span>
                    <input
                      className={ROW_INPUT}
                      type="date"
                      value={d.rabiesVaccinatedOn ?? ''}
                      onChange={e => patchDog(d.id, { rabiesVaccinatedOn: e.target.value === '' ? null : e.target.value })}
                    />
                  </label>

                  <label className={ROW}>
                    <span className={ROW_LABEL}>抗体检测日期</span>
                    <input
                      className={ROW_INPUT}
                      type="date"
                      value={d.antibodyTestedOn ?? ''}
                      onChange={e => patchDog(d.id, { antibodyTestedOn: e.target.value === '' ? null : e.target.value })}
                    />
                  </label>

                  <label className={ROW}>
                    <span className={ROW_LABEL}>抗体检测报告编号</span>
                    <input
                      className={ROW_INPUT}
                      value={d.antibodyReportNo}
                      placeholder="照抄报告上的原文"
                      onChange={e => patchDog(d.id, { antibodyReportNo: e.target.value })}
                    />
                  </label>

                  <label className={ROW}>
                    <span className={ROW_LABEL}>《动物检疫合格证明》编号</span>
                    <input
                      autoFocus={focusCertFor === d.id}
                      className={ROW_INPUT}
                      value={d.quarantineCertNo}
                      placeholder="一证多用也算「未经检疫」，编号必须逐只对上"
                      onChange={e => patchDog(d.id, { quarantineCertNo: e.target.value })}
                    />
                  </label>

                  <label className={ROW}>
                    <span className={ROW_LABEL}>证明签发日期</span>
                    <input
                      className={ROW_INPUT}
                      type="date"
                      value={d.quarantineCertIssuedOn ?? ''}
                      onChange={e => patchDog(d.id, { quarantineCertIssuedOn: e.target.value === '' ? null : e.target.value })}
                    />
                  </label>

                  <label className={ROW}>
                    <span className={ROW_LABEL}>证明有效期至</span>
                    <input
                      className={ROW_INPUT}
                      type="date"
                      value={d.quarantineCertValidUntil ?? ''}
                      onChange={e => patchDog(d.id, { quarantineCertValidUntil: e.target.value === '' ? null : e.target.value })}
                    />
                  </label>
                </div>
              )}
            </li>
          )
        })}
        {onHandDogs.length === 0 && (
          <li className="rounded-xl bg-white p-6 text-center text-sm text-gray-400">
            这一批目前没有在库的狗。
          </li>
        )}
      </ul>

      <h2 className="mt-6 text-sm font-semibold text-gray-700">出栏前检查</h2>

      {onHandCount === 0 ? (
        <p className="mt-2 rounded-xl bg-white p-4 text-sm text-gray-400">
          这一批目前没有在库的狗。
        </p>
      ) : checklist.blocked.length === 0 ? (
        <p className="mt-2 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-700">
          这批在库的 {onHandCount} 只全部具备有效检疫证明，可以出售。
        </p>
      ) : (
        <div className="mt-2 rounded-xl bg-amber-50 p-4">
          <div className="text-sm font-semibold text-amber-800">
            在库 {onHandCount} 只里有 {checklist.blocked.length} 只不能卖
          </div>
          <ul className="mt-2 space-y-1 text-xs text-amber-800">
            {checklist.blocked.map(b => (
              <li key={b.dog.id}>
                {b.dog.code} · {b.status.label} · {b.status.nextAction}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-amber-700">
            检疫证明与狗不一致（数量超出证明载明部分、种类不符、使用别人的证明）会被按「未经检疫」处理，罚款是货值的 15~30 倍。
          </p>
        </div>
      )}
    </div>
  )
}
