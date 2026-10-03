import { describe, it, expect } from 'vitest'
import {
  formatPercent, applyPercentInput, applyMortalityInput, applyMoneyInput, inputError,
} from './settingsForm'
// 只读的参考实现：「算」页的死亡率解析规则。用来钉「两个页面同一个输入同一个结论」。
import { parseMortalityPercent } from './planForm'

describe('formatPercent：比例 -> 输入框里显示什么', () => {
  it('整数百分比不拖小数点', () => {
    expect(formatPercent(0.3)).toBe('30')
    expect(formatPercent(0.5)).toBe('50')
    expect(formatPercent(0)).toBe('0')
    expect(formatPercent(1)).toBe('100')
  })

  it('★ 不是整数百分比时保留两位小数，不能四舍五入成整数', () => {
    // 0.605 这类值四舍五入到整数会显示成「61」，而账上存的是 60.5% —— 看到的与存下的对不上
    expect(formatPercent(0.605)).toBe('60.5')
    expect(formatPercent(0.395)).toBe('39.5')
    expect(formatPercent(0.125)).toBe('12.5')
  })

  it('★ 不吐浮点尾巴（0.07*100 是 7.000000000000001）', () => {
    expect(formatPercent(0.07)).toBe('7')
    expect(formatPercent(0.29)).toBe('29')
    expect(formatPercent(0.605).split('.')[1].length).toBeLessThanOrEqual(2)
  })
})

describe('applyPercentInput：比例输入框', () => {
  it('合法数字：草稿就是你打的字，比例是它除以 100', () => {
    expect(applyPercentInput('60')).toEqual({ draft: '60', ratio: 0.6 })
    expect(applyPercentInput('60.5')).toEqual({ draft: '60.5', ratio: 0.605 })
  })

  it('★ 打「60.」的那一刻草稿原样保留（小数点不能被吃掉）', () => {
    const r = applyPercentInput('60.')
    expect(r.draft).toBe('60.')
    expect(r.ratio).toBe(0.6)
  })

  it('空串与不是数字的：ratio 是 null（一个字都别写进账），草稿仍然是你打的字', () => {
    expect(applyPercentInput('')).toEqual({ draft: '', ratio: null })
    expect(applyPercentInput('  ')).toEqual({ draft: '  ', ratio: null })
    expect(applyPercentInput('6o')).toEqual({ draft: '6o', ratio: null })
    expect(applyPercentInput('1e999')).toEqual({ draft: '1e999', ratio: null })
  })

  it('负数与超过 100 都算「数字」，交给 validateSettings 去报「和必须等于 100%」', () => {
    expect(applyPercentInput('-5').ratio).toBe(-0.05)
    expect(applyPercentInput('120').ratio).toBe(1.2)
  })
})

describe('applyMortalityInput：死亡率越界拒绝，不夹取（0~99%）', () => {
  it('范围内的值原样保留草稿', () => {
    expect(applyMortalityInput('15')).toEqual({ draft: '15', ratio: 0.15 })
    expect(applyMortalityInput('12.5')).toEqual({ draft: '12.5', ratio: 0.125 })
    expect(applyMortalityInput('0')).toEqual({ draft: '0', ratio: 0 })
  })

  it('★ 草稿永远原样保留（打到一半的「12.」不能被改写，否则小数点会被吃掉）', () => {
    expect(applyMortalityInput('12.')).toEqual({ draft: '12.', ratio: null })
    expect(applyMortalityInput('125')).toEqual({ draft: '125', ratio: null })
    expect(applyMortalityInput('-3')).toEqual({ draft: '-3', ratio: null })
  })

  it('★ 越界不再夹成 99：账里一个字都不写（错的数字比没有数字危险）', () => {
    // 夹取会把「我打错了」这个信息抹掉：夹完框里是 99，用户没有任何线索知道自己打的是 125。
    expect(applyMortalityInput('125').ratio).toBeNull()
    expect(applyMortalityInput('100').ratio).toBeNull()
    expect(applyMortalityInput('100').draft).toBe('100')
  })

  it('★ 上界是 99：99 合法（0.99），99.5 不合法', () => {
    expect(applyMortalityInput('99')).toEqual({ draft: '99', ratio: 0.99 })
    expect(applyMortalityInput('99.5').ratio).toBeNull()
    expect(applyMortalityInput('99.5').draft).toBe('99.5')
  })

  it('空串与不是数字的：ratio 是 null', () => {
    expect(applyMortalityInput('').ratio).toBeNull()
    expect(applyMortalityInput('abc').ratio).toBeNull()
    expect(applyMortalityInput('abc').draft).toBe('abc')
  })
})

describe('applyMoneyInput：检疫费 / 处理费（单位分）', () => {
  it('合法金额：草稿是你打的字，值是分', () => {
    expect(applyMoneyInput('1200')).toEqual({ draft: '1200', fen: 120000 })
    expect(applyMoneyInput('1200.50')).toEqual({ draft: '1200.50', fen: 120050 })
  })

  it('★ 带 ¥ 与千分位逗号能解析出来', () => {
    expect(applyMoneyInput('¥1,200.50').fen).toBe(120050)
  })

  it('★★ 打「1200.」时草稿必须保留小数点', () => {
    // 这是本地草稿存在的**唯一**理由：div 显示的 fenToTextInput(120000) 是 '1200'，
    // 小数点会在你打下一个字符之前消失，于是想打 1200.50 的人会打出 12005（差 10 倍）。
    expect(applyMoneyInput('1200.').draft).toBe('1200.')
    expect(applyMoneyInput('1200.').fen).toBe(120000)
  })

  it('空串与不是数字的：fen 是 null', () => {
    expect(applyMoneyInput('')).toEqual({ draft: '', fen: null })
    expect(applyMoneyInput('12oo')).toEqual({ draft: '12oo', fen: null })
  })

  it('★ 负数不算合法（否则会把检疫费记成 -100 元，成本凭空变小）', () => {
    expect(applyMoneyInput('-5').fen).toBeNull()
    expect(applyMoneyInput('-5').draft).toBe('-5')
    expect(inputError('money', '-5')).toContain('负')
  })
})

describe('inputError：什么时候该在输入框下面显示红字', () => {
  it('空输入不算错（还没开始填）', () => {
    expect(inputError('money', '')).toBeUndefined()
    expect(inputError('ratio', '  ')).toBeUndefined()
    expect(inputError('mortality', '')).toBeUndefined()
  })

  it('填了但不是数字才算错，且是中文', () => {
    const e = inputError('money', '1200元')
    expect(e).toBeDefined()
    expect(e).toContain('金额')
    expect(inputError('ratio', '6o')).toBeDefined()
    expect(inputError('margin', '6o')).toBeDefined()
    expect(inputError('mortality', '6o')).toBeDefined()
  })

  it('★ 死亡率的越界现在算「输入错误」（报红字，不再夹住）；比例的越界仍由「和必须等于 100%」报', () => {
    // 文案与 src/ui/planForm.ts:142 逐字相同 —— 全仓只有一条死亡率文案
    expect(inputError('mortality', '125')).toBe('死亡率要填 0 到 99 之间的数字')
    expect(inputError('mortality', '-3')).toBe('死亡率要填 0 到 99 之间的数字')
    expect(inputError('mortality', '99.5')).toBe('死亡率要填 0 到 99 之间的数字')
    expect(inputError('mortality', '99')).toBeUndefined()
    expect(inputError('ratio', '120')).toBeUndefined()
    expect(inputError('ratio', '-5')).toBeUndefined()
  })

  it('合法输入没有错误', () => {
    expect(inputError('money', '¥1,200.50')).toBeUndefined()
    expect(inputError('ratio', '60.5')).toBeUndefined()
    expect(inputError('mortality', '12.5')).toBeUndefined()
  })
})

describe('一致性：报了红字的输入绝不会被写进账', () => {
  it('★ 有红字 ⇒ 一个字都不写进账', () => {
    const samples = ['', '  ', 'abc', '6o', '1200元', '1e999', '0', '60.5', '¥1,200.50', '-5', '120']
    for (const raw of samples) {
      if (inputError('ratio', raw) !== undefined) expect(applyPercentInput(raw).ratio).toBeNull()
      if (inputError('margin', raw) !== undefined) expect(applyPercentInput(raw).ratio).toBeNull()
      if (inputError('mortality', raw) !== undefined) expect(applyMortalityInput(raw).ratio).toBeNull()
      if (inputError('money', raw) !== undefined) expect(applyMoneyInput(raw).fen).toBeNull()
    }
  })

  it('空输入永远没有红字，也永远不写账', () => {
    for (const kind of ['ratio', 'margin', 'mortality', 'money'] as const) {
      expect(inputError(kind, '')).toBeUndefined()
    }
    expect(applyPercentInput('').ratio).toBeNull()
    expect(applyMortalityInput('').ratio).toBeNull()
    expect(applyMoneyInput('').fen).toBeNull()
  })
})

describe('一致性：设置页与算页的死亡率是同一套口径（拒绝，不夹取）', () => {
  it('★ 同一个输入，两边要么都收、要么都拒，且拒绝时必定有红字', () => {
    const samples = ['', '  ', '0', '12.5', '99', '99.5', '100', '125', '-1', 'abc', '12.', '25%']
    for (const raw of samples) {
      const rate = parseMortalityPercent(raw) // 「算」页（src/ui/planForm.ts:100-110）
      const { ratio } = applyMortalityInput(raw) // 「设置」页
      expect(ratio === null).toBe(rate === null)
      if (rate !== null) expect(ratio).toBe(rate)
      // 被拒的那一侧必须同时出红字，别让用户对着 125 看不到任何线索
      expect(inputError('mortality', raw) !== undefined).toBe(rate === null && raw.trim() !== '')
    }
  })

  it('★ 125：算页拒绝 + 设置页拒绝，两边都不写账', () => {
    expect(inputError('mortality', '125') !== undefined).toBe(true)
    expect(parseMortalityPercent('125')).toBeNull()
    expect(applyMortalityInput('125')).toEqual({ draft: '125', ratio: null })
  })

  it('★ 打到一半的「12.」不写账，接着填成「12.5」才写账 0.125', () => {
    expect(applyMortalityInput('12.')).toEqual({ draft: '12.', ratio: null })
    expect(applyMortalityInput('12.5')).toEqual({ draft: '12.5', ratio: 0.125 })
  })
})
