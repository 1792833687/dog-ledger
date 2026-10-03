import { useState } from 'react'
import { useAppData } from '../../state/useAppData'
import { validateSettings } from '../../domain/settlement'
import { updateSettings, renamePartner, setPartnerRatio, addCostItem } from '../../domain/actions'
import { Field } from '../components/Field'
import { fenToTextInput } from '../planForm'
import { formatPercent, applyPercentInput, applyMortalityInput, applyMoneyInput, inputError } from '../settingsForm'

/**
 * 「设置」面板：合伙人 / 分成比例 / 目标毛利率 / 自定义成本项。
 *
 * 没有这一页，`DEFAULT_SETTINGS` 里写死的「我 / 伙伴 各 50% / 毛利率 30% / 死亡率 15%」
 * 就只能改代码才能变。
 *
 * **每个数字输入框都用本地草稿，不直接把 value 绑到账上的数字上。** 理由见
 * `../settingsForm.ts` 的头注释：`fenToTextInput(120000)` 是 `'1200'`，绑死的话
 * 想填 1200.50 的人敲到 `1200.` 时小数点会被重渲抹掉，接着敲 `5` 就成了 `12005`。
 * 草稿只在解析成功时写账，解析不了就留一行红字并且什么也不写。
 */
export function SettingsPanel() {
  const { data, update } = useAppData()
  const [newItemName, setNewItemName] = useState('')
  const [newItemScope, setNewItemScope] = useState<'batch' | 'dog'>('dog')
  // 草稿表：`undefined` 表示这个框还没被碰过，显示账上存的值。
  const [nameDrafts, setNameDrafts] = useState<Record<string, string | undefined>>({})
  const [ratioDrafts, setRatioDrafts] = useState<Record<string, string | undefined>>({})
  const [marginDraft, setMarginDraft] = useState<string | null>(null)
  const [mortalityDraft, setMortalityDraft] = useState<string | null>(null)
  const [quarantineDraft, setQuarantineDraft] = useState<string | null>(null)
  const [disposalDraft, setDisposalDraft] = useState<string | null>(null)

  const s = data.settings
  const error = validateSettings(s)

  function writeName(partnerId: string, value: string) {
    setNameDrafts(d => ({ ...d, [partnerId]: value }))
    // 名字清空不写库：`validateSettings` 不检查名字，存下空名的话「钱」页的垫付卡片
    // 会变成一行没有主语的空白，没人会拦住。留草稿是为了还能清空重打。
    if (value.trim() === '') return
    void update(d => renamePartner(d, partnerId, value))
  }

  function writeRatio(partnerId: string, value: string) {
    setRatioDrafts(d => ({ ...d, [partnerId]: value }))
    // 解构到 const 再判断：窄化结果进不了下面那个箭头函数（`r.ratio` 是可变属性，
    // 进了闭包 TS 就不认刚才那句 `=== null` 了，会报 TS2345）。
    const { ratio } = applyPercentInput(value)
    if (ratio === null) return
    void update(d => setPartnerRatio(d, partnerId, ratio))
  }

  return (
    <details className="mt-4 rounded-xl bg-white p-4 shadow-sm">
      <summary className="cursor-pointer text-sm font-semibold text-gray-700">
        设置（合伙人 / 分成 / 目标毛利）
      </summary>

      <div className="mt-3 space-y-2">
        {s.partners.map(p => {
          // 同样要先落到 const：`ratioDrafts[p.id]` 这种下标访问不会被三目窄化。
          const draft = ratioDrafts[p.id]
          const ratioError = draft === undefined ? undefined : inputError('ratio', draft)
          return (
            <div key={p.id}>
              <div className="flex items-center gap-2">
                <input
                  className="flex-1 rounded-md bg-gray-100 px-2 py-1.5 text-sm outline-none"
                  value={nameDrafts[p.id] ?? p.name}
                  onChange={e => writeName(p.id, e.target.value)}
                />
                <input
                  className="w-20 rounded-md bg-gray-100 px-2 py-1.5 text-right text-sm outline-none"
                  inputMode="decimal"
                  value={ratioDrafts[p.id] ?? formatPercent(p.shareRatio)}
                  onChange={e => writeRatio(p.id, e.target.value)}
                />
                <span className="text-xs text-gray-500">%</span>
              </div>
              {ratioError !== undefined && <p className="mt-0.5 text-xs text-red-500">{ratioError}</p>}
            </div>
          )
        })}
      </div>

      {s.partners.length === 0 && (
        <p className="mt-2 text-xs text-amber-600">
          还没有合伙人。没有人的话，注资、报销、分红都不知道该记在谁名下。
        </p>
      )}

      <h3 className="mt-4 text-sm font-semibold text-gray-700">目标与预估</h3>
      <div className="mt-2 space-y-2">
        <Field
          label="目标毛利率"
          suffix="%"
          inputMode="numeric"
          value={marginDraft ?? formatPercent(s.targetMarginRate)}
          error={marginDraft === null ? undefined : inputError('margin', marginDraft)}
          onChange={v => {
            setMarginDraft(v)
            const { ratio } = applyPercentInput(v)
            if (ratio === null) return
            void update(d => updateSettings(d, { targetMarginRate: ratio }))
          }}
        />
        <Field
          label="默认预估死亡率"
          suffix="%"
          inputMode="numeric"
          value={mortalityDraft ?? formatPercent(s.expectedMortalityRate)}
          error={mortalityDraft === null ? undefined : inputError('mortality', mortalityDraft)}
          onChange={v => {
            const { draft, ratio } = applyMortalityInput(v)
            // 草稿原样写回框里（打「12.」时小数点不会被吃掉）。
            // 越界（例如填 125）`ratio` 是 null：**不写账、只出红字**，让人看见自己填错了。
            setMortalityDraft(draft)
            if (ratio === null) return
            void update(d => updateSettings(d, { expectedMortalityRate: ratio }))
          }}
        />
        <Field
          label="默认每只检疫费"
          suffix="元"
          inputMode="decimal"
          value={quarantineDraft ?? fenToTextInput(s.quarantinePerDog)}
          error={quarantineDraft === null ? undefined : inputError('money', quarantineDraft)}
          onChange={v => {
            const { draft, fen } = applyMoneyInput(v)
            setQuarantineDraft(draft)
            if (fen === null) return
            void update(d => updateSettings(d, { quarantinePerDog: fen }))
          }}
        />
        <Field
          label="默认每只病死犬处理费"
          suffix="元"
          inputMode="decimal"
          value={disposalDraft ?? fenToTextInput(s.disposalPerDog)}
          error={disposalDraft === null ? undefined : inputError('money', disposalDraft)}
          onChange={v => {
            const { draft, fen } = applyMoneyInput(v)
            setDisposalDraft(draft)
            if (fen === null) return
            void update(d => updateSettings(d, { disposalPerDog: fen }))
          }}
        />
      </div>
      <p className="mt-2 text-xs text-gray-400">
        这两项会预填到「算」页面。填 0 表示还不知道——检疫费与抗体检测价格请先向当地动物卫生监督机构问清。
      </p>

      <h3 className="mt-4 text-sm font-semibold text-gray-700">成本项</h3>
      <ul className="mt-1 text-xs text-gray-500">
        {s.costItems.map(c => (
          <li key={c.id}>
            {c.name}
            {' · '}
            {c.scope === 'batch' ? '整批' : '单只'}
            {c.isBuiltin ? ' · 内置' : ''}
          </li>
        ))}
      </ul>
      <div className="mt-2 flex items-center gap-2">
        <input
          className="flex-1 rounded-md bg-gray-100 px-2 py-1.5 text-sm outline-none"
          placeholder="新增成本项，如 狗粮"
          value={newItemName}
          onChange={e => setNewItemName(e.target.value)}
        />
        <select
          className="rounded-md bg-gray-100 px-2 py-1.5 text-sm"
          value={newItemScope}
          onChange={e => setNewItemScope(e.target.value === 'batch' ? 'batch' : 'dog')}
        >
          <option value="dog">单只</option>
          <option value="batch">整批</option>
        </select>
        <button
          type="button"
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
          disabled={!newItemName.trim()}
          onClick={() => {
            void update(d => addCostItem(d, newItemName.trim(), newItemScope))
            setNewItemName('')
          }}
        >
          加
        </button>
      </div>
      <p className="mt-2 text-xs text-gray-400">
        新增的成本项会出现在「钱」页面记支出时的下拉里。
      </p>

      {error !== null && <p className="mt-2 text-xs text-red-500">{error}</p>}
      <p className="mt-2 text-xs text-gray-400">
        分成比例之和必须是 100%，否则不让你保存。改比例不会动已经发生过的账。
      </p>
    </details>
  )
}
