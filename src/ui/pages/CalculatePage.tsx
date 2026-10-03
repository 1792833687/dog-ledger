import { useMemo, useState } from 'react'
import type { PlanResult } from '../../domain/planning'
import { createBatchFromPlan, plan } from '../../domain/planning'
import { formatMoney } from '../../domain/money'
import { useAppData } from '../../state/useAppData'
import { Field } from '../components/Field'
import type { PlanFieldKey, PlanTextForm } from '../planForm'
import { defaultPlanText, parsePlanText, todayLocalIso } from '../planForm'

/**
 * 「算」页面 —— 决策台。
 *
 * 它只回答一个问题：**这批狗低于多少钱一只就别收**。
 * 所以整个页面只有一个大数字，其余全是它的输入项与推导过程。
 *
 * 表单状态是 8 个字符串，翻译成 `PlanInput` 的那一步在 `../planForm.ts` 里，
 * 是纯函数、有测试。这里只负责摆位置、把错误显示出来、以及把决策落成批次。
 */
export function CalculatePage() {
  const { data, update } = useAppData()

  // 初始值由设置推导一次。刻意不写 useEffect 去同步：用户改了设置之后跑回这一页，
  // 他刚才手输的数字不该被悄悄冲掉。
  const [form, setForm] = useState<PlanTextForm>(() => defaultPlanText(data.settings))
  const [created, setCreated] = useState<string | null>(null)

  const { input, errors } = useMemo(
    () => parsePlanText(form, data.settings),
    [form, data.settings],
  )

  const errorKeys = Object.keys(errors) as PlanFieldKey[]
  // 有任何一个输入有问题就**不展示保本价**。半截的输入算出来的数字看着像真的，
  // 而用户会照着它出门定价 —— 宁可不给数字。
  const result: PlanResult | null = errorKeys.length === 0 ? plan(data.settings, input) : null

  function set(key: PlanFieldKey) {
    return (value: string) => {
      setForm(prev => ({ ...prev, [key]: value }))
    }
  }

  function handleCreateBatch() {
    const name = `收狗 ${input.n} 只`
    const date = todayLocalIso(new Date())
    void update(d => createBatchFromPlan(d, input, name, date))
    setCreated(name)
  }

  return (
    <div className="px-4 pb-6 pt-6">
      <h1 className="text-xl font-bold">收狗前的账</h1>
      <p className="mt-1 text-xs text-gray-500">先算清楚最多出多少钱，再出门。</p>

      <section className="mt-4 rounded-xl bg-white p-4 shadow-sm">
        <Field
          label="预计收几只" value={form.n} onChange={set('n')}
          suffix="只" inputMode="numeric" error={errors.n}
        />
        <Field
          label="每只收购价" value={form.purchasePrice} onChange={set('purchasePrice')}
          suffix="元" error={errors.purchasePrice}
        />
        <Field
          label="这趟油费 + 笼具" value={form.freight} onChange={set('freight')}
          suffix="元" error={errors.freight}
        />
        <Field
          label="每只疫苗医疗" value={form.medicalPerDog} onChange={set('medicalPerDog')}
          suffix="元" error={errors.medicalPerDog}
        />
        <Field
          label="每只检疫费" value={form.quarantinePerDog} onChange={set('quarantinePerDog')}
          suffix="元" error={errors.quarantinePerDog}
        />
        <Field
          label="每只病死犬处理费" value={form.disposalPerDog} onChange={set('disposalPerDog')}
          suffix="元" error={errors.disposalPerDog}
        />
        <Field
          label="预估死亡率" value={form.mortalityPercent} onChange={set('mortalityPercent')}
          suffix="%" inputMode="numeric" error={errors.mortalityPercent}
        />
        <Field
          label="打算卖多少钱一只" value={form.targetPrice} onChange={set('targetPrice')}
          suffix="元" error={errors.targetPrice}
        />
        <p className="mt-2 text-xs text-gray-400">
          检疫是法定前置：没有《动物检疫合格证明》就出售，按《动物防疫法》第九十七条最高可处货值 15~30 倍罚款，
          货值不足一万元的处 5 万~15 万，负责人 5 年内不得从事相关活动。这一栏填 0，上面的「低于这个价别卖」就偏低。
        </p>
      </section>

      {result === null ? (
        <section className="mt-4 rounded-xl bg-white p-4 text-sm text-gray-500 shadow-sm">
          上面有填错的地方，改好才能算保本价。
        </section>
      ) : (
        <section className="mt-4 rounded-xl bg-emerald-600 p-4 text-white shadow-sm">
          <div className="text-xs opacity-80">低于这个价别卖</div>
          <div className="mt-1 text-3xl font-bold">{formatMoney(result.breakEvenPriceFen)}</div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
            <div>
              <div className="opacity-80">预估总成本</div>
              <div className="mt-0.5 text-sm font-semibold">{formatMoney(result.totalCost)}</div>
            </div>
            <div>
              <div className="opacity-80">预估存活</div>
              <div className="mt-0.5 text-sm font-semibold">{result.expectedAlive.toFixed(1)} 只</div>
            </div>
            <div>
              <div className="opacity-80">建议售价</div>
              <div className="mt-0.5 text-sm font-semibold">{formatMoney(result.suggestedPriceFen)}</div>
            </div>
          </div>
        </section>
      )}

      {result !== null && result.scenarios.length > 0 && (
        <section className="mt-4 rounded-xl bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-700">卖不掉怎么办</h2>
          <table className="mt-2 w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-400">
                <th className="text-left font-normal">只卖掉</th>
                <th className="text-right font-normal">收入</th>
                <th className="text-right font-normal">盈亏</th>
                <th className="text-right font-normal">每人承担</th>
              </tr>
            </thead>
            <tbody>
              {result.scenarios.map(s => (
                <tr key={s.soldCount} className="border-t border-gray-100">
                  <td className="py-2">{s.soldCount} 只</td>
                  <td className="py-2 text-right">{formatMoney(s.revenue)}</td>
                  <td className={`py-2 text-right font-semibold ${s.profitFen >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                    {formatMoney(s.profitFen)}
                  </td>
                  <td className={`py-2 text-right ${s.perPartnerFen >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                    {formatMoney(s.perPartnerFen)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <button
        type="button"
        onClick={handleCreateBatch}
        disabled={input.n <= 0}
        className="mt-4 w-full rounded-xl bg-gray-900 py-3 text-sm font-semibold text-white disabled:opacity-40"
      >
        就按这个收 —— 一键建批次开始记账
      </button>

      {created && (
        <p className="mt-2 text-center text-xs text-emerald-600">
          已建批次「{created}」，到「狗」标签页记账。
        </p>
      )}
    </div>
  )
}
