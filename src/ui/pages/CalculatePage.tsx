import { useMemo, useState } from 'react'
import type { ChannelId } from '../../domain/types'
import type { PlanResult } from '../../domain/planning'
import { receiveBatch, plan } from '../../domain/planning'
import { compareChannelCosts } from '../../domain/channels'
import { formatMoney, parseMoney } from '../../domain/money'
import { useAppData } from '../../state/useAppData'
import { Field } from '../components/Field'
import { Modal } from '../components/Modal'
import type { ChannelRowText } from '../channelView'
import {
  channelInputsFromRows, channelName, comparisonChannels, defaultAliveInput,
  emptyChannelRows, parseAliveInput,
} from '../channelView'
import type { PlanFieldKey, PlanTextForm } from '../planForm'
import { defaultPlanText, fenToTextInput, localTimeHm, parsePlanText, todayLocalIso } from '../planForm'

/** 一行没填过的渠道：三格全空 = 全按 0 算。 */
const EMPTY_ROW: ChannelRowText = { unitPrice: '', extraPerDog: '', fixedCost: '' }

/** 渠道对照里一个「元」输入框。表格窄，标签放左边、字号压到最小。 */
function MiniMoney({
  label, value, onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <label className="flex items-center justify-between gap-1">
      <span className="shrink-0 text-[10px] text-gray-500">{label}</span>
      <span className="flex items-center gap-1">
        <input
          className="w-16 rounded-md bg-gray-100 px-1.5 py-1 text-right text-xs outline-none focus:bg-white focus:ring-1 focus:ring-emerald-500"
          inputMode="decimal"
          value={value}
          onChange={e => onChange(e.target.value)}
        />
        <span className="text-[10px] text-gray-500">元</span>
      </span>
    </label>
  )
}

/**
 * 「算」页面 —— 决策台。
 *
 * 它只回答一个问题：**这批狗低于多少钱一只就别收**。
 * 所以整个页面只有一个大数字，其余全是它的输入项与推导过程。
 *
 * 表单状态是 8 个字符串，翻译成 `PlanInput` 的那一步在 `../planForm.ts` 里，
 * 是纯函数、有测试。这里只负责摆位置、把错误显示出来、以及把决策落成批次。
 *
 * 页面下方那块「渠道对照」回答下一个问题：**这批走哪条路更划算**。
 * 它的第一个参数直接用 `plan()` 算好的保本价，**界面里不算第二遍成本** ——
 * 这里没有真实批次、没有狗、没有支出流水，自己数狗或造个假批次只会把
 * 底价与固定成本一起算成 0（见 `channels.ts` 的注释）。
 */
export function CalculatePage() {
  const { data, update } = useAppData()

  // 初始值由设置推导一次。刻意不写 useEffect 去同步：用户改了设置之后跑回这一页，
  // 他刚才手输的数字不该被悄悄冲掉。
  const [form, setForm] = useState<PlanTextForm>(() => defaultPlanText(data.settings))
  const [created, setCreated] = useState<{ name: string; channel: ChannelId } | null>(null)

  // 存活数：`null` = 用户还没碰过这个框，显示 `plan()` 给的默认值（预估存活向上取整）。
  // 用户一旦手输，就再也不替它改 —— 与上面表单同一个道理。
  const [aliveText, setAliveText] = useState<string | null>(null)
  const [channelsOpen, setChannelsOpen] = useState(false)
  const [channelRows, setChannelRows] = useState<Record<string, ChannelRowText>>(() => emptyChannelRows())
  const [selectedChannel, setSelectedChannel] = useState<ChannelId>('undecided')

  // 收货弹窗：只问两个数 —— 实际收到几只、每只多少钱。默认就是上面表单里刚填的那两个，
  // 因为它们正是用户出门前估的数；不相等时改这里，不回头改表单（表单要留着算下一次）。
  const [receiveOpen, setReceiveOpen] = useState(false)
  const [receiveCountText, setReceiveCountText] = useState('')
  const [receivePriceText, setReceivePriceText] = useState('')

  const { input, errors } = useMemo(
    () => parsePlanText(form, data.settings),
    [form, data.settings],
  )

  const errorKeys = Object.keys(errors) as PlanFieldKey[]
  // 有任何一个输入有问题就**不展示保本价**。半截的输入算出来的数字看着像真的，
  // 而用户会照着它出门定价 —— 宁可不给数字。
  const result: PlanResult | null = errorKeys.length === 0 ? plan(data.settings, input) : null

  // 存活数决定固定成本摊到几只上。默认值只跟结果走、不跟用户手输的值打架。
  const aliveRaw = aliveText ?? (result === null ? '1' : String(defaultAliveInput(result.expectedAlive)))
  const aliveParsed = parseAliveInput(aliveRaw)

  const rows = channelInputsFromRows(channelRows)
  // 全仓唯一的渠道成本算法，在这里被调用一次。第一个参数就是决策台那个保本价。
  const breakdown = result !== null && aliveParsed !== null
    ? compareChannelCosts(result.breakEvenPriceFen, aliveParsed, rows)
    : null

  // 收货弹窗的校验。只数必须是至少 1 的整数；收购价留空当 0（等于「这批没花钱」，
  // 合法），填了就必须是数字。两个都过了才允许点确认。
  const receiveCount = parseAliveInput(receiveCountText)
  const receiveCountError = receiveCount === null || receiveCount < 1
    ? '实收只数要填一个整数，至少 1 只'
    : undefined
  const receivePriceTrimmed = receivePriceText.trim()
  const receivePriceFen = receivePriceTrimmed === '' ? 0 : parseMoney(receivePriceTrimmed)
  const receivePriceError = receivePriceFen === null || receivePriceFen < 0
    ? '每只收购价只能填数字，例如 1200 或 1200.50'
    : undefined
  const receiveReady = receiveCountError === undefined && receivePriceError === undefined

  function set(key: PlanFieldKey) {
    return (value: string) => {
      setForm(prev => ({ ...prev, [key]: value }))
    }
  }

  function setRow(channelId: ChannelId, key: keyof ChannelRowText) {
    return (value: string) => {
      setChannelRows(prev => {
        const current = prev[channelId] ?? EMPTY_ROW
        return { ...prev, [channelId]: { ...current, [key]: value } }
      })
    }
  }

  /** 打开收货弹窗：把表单里刚填的数填成默认值，用户确认前还能改。 */
  function openReceive() {
    setReceiveCountText(form.n)
    setReceivePriceText(fenToTextInput(input.purchasePrice))
    setReceiveOpen(true)
  }

  function handleReceive() {
    if (receiveCount === null || receivePriceFen === null) return
    // `now` 必须留在事件处理器里：把它提到组件体（渲染期）会被 lint 的 react(purity)
    // 拦下（本仓门禁是 0 warning），而且重新渲染时会拿到"另一个现在"。
    // 同一个 `now` 同时喂给批次名和日期 —— 跨过午夜那一下也不会出现「名字是昨天、日期是今天」。
    const now = new Date()
    // 默认名带上时间：同一天收两批只数相同的狗（上午 2 只、下午 2 只）就不会再重名，
    // 批次选择器里也就不会出现两条读起来一模一样的选项。
    // 名字里的只数是**实收**只数，不是上面表单里预估的那个。
    const name = `收狗 ${receiveCount} 只 ${localTimeHm(now)}`
    void update(d => receiveBatch(d, {
      name,
      date: todayLocalIso(now),
      count: receiveCount,
      unitPriceFen: receivePriceFen,
      channel: selectedChannel,
    }))
    setCreated({ name, channel: selectedChannel })
    setReceiveOpen(false)
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
        <p className="mt-2 text-xs text-gray-500">
          检疫是法定前置：没有《动物检疫合格证明》就出售，按《动物防疫法》第九十七条最高可处货值 15~30 倍罚款，
          货值不足一万元的处 5 万~15 万，负责人 5 年内不得从事相关活动。这一栏填 0，上面的「低于这个价别卖」就偏低。
        </p>
      </section>

      {result === null ? (
        <section className="mt-4 rounded-xl bg-white p-4 text-sm text-gray-500 shadow-sm">
          上面有填错的地方，改好才能算保本价。
        </section>
      ) : (
        <section className="mt-4 rounded-xl bg-emerald-700 p-4 text-white shadow-sm">
          <div className="text-xs text-emerald-50">低于这个价别卖</div>
          <div className="mt-1 text-3xl font-bold">{formatMoney(result.breakEvenPriceFen)}</div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
            <div>
              <div className="text-emerald-50">预估总成本</div>
              <div className="mt-0.5 text-sm font-semibold">{formatMoney(result.totalCost)}</div>
            </div>
            <div>
              <div className="text-emerald-50">预估存活</div>
              <div className="mt-0.5 text-sm font-semibold">{result.expectedAlive.toFixed(1)} 只</div>
            </div>
            <div>
              <div className="text-emerald-50">建议售价</div>
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
              <tr className="text-xs text-gray-500">
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
                  <td className={`py-2 text-right font-semibold ${s.profitFen >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                    {formatMoney(s.profitFen)}
                  </td>
                  <td className={`py-2 text-right ${s.perPartnerFen >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                    {formatMoney(s.perPartnerFen)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {result !== null && (
        <section className="mt-4 rounded-xl bg-white p-4 shadow-sm">
          <button
            type="button"
            className="flex w-full items-baseline justify-between gap-3 text-left"
            onClick={() => setChannelsOpen(v => !v)}
          >
            <span className="text-sm font-semibold text-gray-700">
              渠道对照 {channelsOpen ? '▾' : '▸'}
            </span>
            <span className="text-right text-xs text-gray-500">
              {/* 折叠着也要看得见选了哪条路：下面那个按钮照样会带着它建批次。 */}
              <span className="block font-semibold text-gray-600">
                去向：{channelName(selectedChannel)}
              </span>
              <span className="mt-0.5 block">
                同一批狗，走不同的路，最低可卖价不一样。
              </span>
            </span>
          </button>

          {channelsOpen && (
            <>
              <div className="mt-2 border-t border-gray-100">
                <Field
                  label="存活数（固定成本摊到几只上）"
                  value={aliveRaw}
                  onChange={setAliveText}
                  suffix="只"
                  inputMode="numeric"
                  error={aliveParsed === null ? '存活数要填一个整数（几只狗）' : undefined}
                />
              </div>

              <label className="mt-3 flex items-start gap-2 rounded-lg bg-gray-50 p-3">
                <input
                  type="radio"
                  name="plannedChannel"
                  className="mt-0.5"
                  checked={selectedChannel === 'undecided'}
                  onChange={() => setSelectedChannel('undecided')}
                />
                <span className="text-xs text-gray-500">
                  <span className="text-sm font-semibold text-gray-700">未定</span>
                  <span className="ml-2">还没定就选这个，存批次时去向记「未定」。</span>
                </span>
              </label>

              {breakdown === null ? (
                <p className="mt-3 text-xs text-red-700">
                  存活数填的不是整数（几只狗只能是整数），改好才能算渠道对照。
                </p>
              ) : (
                <table className="mt-3 w-full text-xs">
                  <thead>
                    <tr className="text-gray-500">
                      <th className="text-left font-normal">走哪条路</th>
                      <th className="text-left font-normal">价格假设（元）</th>
                      <th className="text-right font-normal">算出来</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparisonChannels().map(c => {
                      const row = channelRows[c.id] ?? EMPTY_ROW
                      const parsed = rows.find(r => r.channelId === c.id)
                      const b = breakdown.find(x => x.channelId === c.id) ?? null
                      const bad = parsed?.invalid === true
                      return (
                        <tr
                          key={c.id}
                          className={`border-t border-gray-100 align-top ${b?.isLoss ? 'bg-red-50' : ''}`}
                        >
                          <td className="py-2 pr-2">
                            <label className="flex items-start gap-1.5">
                              <input
                                type="radio"
                                name="plannedChannel"
                                className="mt-0.5"
                                checked={selectedChannel === c.id}
                                onChange={() => setSelectedChannel(c.id)}
                              />
                              <span>
                                <span className="block text-sm text-gray-700">{c.name}</span>
                                <span className="mt-0.5 block text-[10px] leading-tight text-gray-500">
                                  {c.note}
                                </span>
                              </span>
                            </label>
                          </td>
                          <td className="py-2 pr-2">
                            <div className="flex flex-col gap-1">
                              <MiniMoney label="预期单价" value={row.unitPrice} onChange={setRow(c.id, 'unitPrice')} />
                              <MiniMoney label="每只额外" value={row.extraPerDog} onChange={setRow(c.id, 'extraPerDog')} />
                              <MiniMoney label="该渠道固定" value={row.fixedCost} onChange={setRow(c.id, 'fixedCost')} />
                            </div>
                            {bad && <div className="mt-1 text-right text-red-700">这不像数字</div>}
                          </td>
                          <td className="py-2 text-right">
                            {bad || b === null ? (
                              <span className="text-gray-500">—</span>
                            ) : (
                              <>
                                <div className="text-gray-700">保本 {formatMoney(b.breakEvenUnitPriceFen)}</div>
                                <div className={`font-semibold ${b.isLoss ? 'text-red-700' : 'text-emerald-700'}`}>
                                  {b.isLoss
                                    ? `亏 ${formatMoney(Math.abs(b.perDogProfitFen))}`
                                    : `赚 ${formatMoney(b.perDogProfitFen)}`}
                                </div>
                                <div className="text-[10px] text-gray-500">
                                  固定成本每只摊 {formatMoney(b.fixedPerDogFen)}
                                </div>
                              </>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}

              <p className="mt-2 text-xs text-gray-500">
                底价用的是上面那个保本价（{formatMoney(result.breakEvenPriceFen)}）。
                固定成本按上面的存活数摊到每只身上 —— 摊位费填多少，这里就摊多少。
              </p>
            </>
          )}
        </section>
      )}

      <button
        type="button"
        onClick={openReceive}
        disabled={input.n <= 0}
        className="mt-4 w-full rounded-xl bg-gray-900 py-3 text-sm font-semibold text-white disabled:opacity-40"
      >
        收货
      </button>

      {created && (
        <p className="mt-2 text-center text-xs text-emerald-700">
          已收货，批次「{created.name}」，去向「{channelName(created.channel)}」。到「狗」标签页记账。
        </p>
      )}

      <Modal open={receiveOpen} title="收货" onClose={() => setReceiveOpen(false)}>
        <Field
          label="实收只数" value={receiveCountText} onChange={setReceiveCountText}
          suffix="只" inputMode="numeric" error={receiveCountError}
        />
        <Field
          label="每只收购价" value={receivePriceText} onChange={setReceivePriceText}
          suffix="元" error={receivePriceError}
        />
        <p className="mt-1 text-xs text-gray-500">
          只记收购款。运输、疫苗、检疫与病死犬处理费都还没付，等真付了钱去「狗」标签页补账。
        </p>
        <button
          type="button"
          onClick={handleReceive}
          disabled={!receiveReady}
          className="mt-3 w-full rounded-xl bg-emerald-700 py-3 text-sm font-semibold text-white disabled:opacity-40"
        >
          收货
        </button>
      </Modal>
    </div>
  )
}
