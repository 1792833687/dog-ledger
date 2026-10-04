import { describe, it, expect } from 'vitest'
import { SALES_CHANNELS } from '../domain/types'
import {
  channelInputsFromRows,
  channelName,
  channelOptions,
  comparisonChannels,
  defaultAliveInput,
  emptyChannelRows,
  findChannel,
  parseAliveInput,
  parseChannelRow,
} from './channelView'

describe('channelName：渠道 id → 中文名', () => {
  it('undecided 是「未定」', () => {
    expect(channelName('undecided')).toBe('未定')
  })

  it('pet_shop 是「宠物店 / 宠物医院」（连空格都要对）', () => {
    expect(channelName('pet_shop')).toBe('宠物店 / 宠物医院')
  })

  it('dog_market 是「犬只交易市场 / 花鸟市场」，note 里带进出场记录那句', () => {
    expect(channelName('dog_market')).toBe('犬只交易市场 / 花鸟市场')
    // 2026-10-03 用户拍板：不加字段，只在渠道说明里补「进出场记录」这一句。
    expect(findChannel('dog_market')?.note).toContain('进出场记录')
  })

  it('未知渠道原样回落成 id 本身，不抛错也不空白', () => {
    expect(channelName('taobao_live')).toBe('taobao_live')
    expect(channelName('')).toBe('')
  })

  it('findChannel 找不到时是 null（不是 undefined，调用方好判）', () => {
    expect(findChannel('nope')).toBeNull()
    expect(findChannel('pet_shop')?.name).toBe('宠物店 / 宠物医院')
  })
})

describe('defaultAliveInput：存活数输入框的默认值', () => {
  it('6.8 → 7（向上取整）', () => {
    expect(defaultAliveInput(6.8)).toBe(7)
  })

  it('0.4 → 1（不足一只也算一只）', () => {
    expect(defaultAliveInput(0.4)).toBe(1)
  })

  it('0 → 1（不除零：plan() 的 expectedAlive 也是至少 1）', () => {
    expect(defaultAliveInput(0)).toBe(1)
  })

  it('负数与 0 一样落到 1，不会给出负的只数', () => {
    expect(defaultAliveInput(-3)).toBe(1)
  })

  it('整数原样返回', () => {
    expect(defaultAliveInput(1)).toBe(1)
    expect(defaultAliveInput(7)).toBe(7)
    expect(defaultAliveInput(6.0000001)).toBe(7)
  })
})

describe('comparisonChannels：逐行列出的 8 条渠道', () => {
  it('正好 8 条，且不含 undecided', () => {
    const channels = comparisonChannels()
    expect(channels).toHaveLength(8)
    expect(channels.some(c => c.id === 'undecided')).toBe(false)
  })

  it('顺序与 SALES_CHANNELS 一致（只去掉 undecided，不重排）', () => {
    expect(comparisonChannels().map(c => c.id)).toEqual(
      SALES_CHANNELS.filter(c => c.id !== 'undecided').map(c => c.id),
    )
    expect(comparisonChannels()[0].id).toBe('pet_shop')
    expect(comparisonChannels()[7].id).toBe('ecommerce')
  })

  it('每条的 name 与 note 都不为空（渠道说明要显示给用户）', () => {
    for (const c of comparisonChannels()) {
      expect(c.name.length).toBeGreaterThan(0)
      expect(c.note.length).toBeGreaterThan(0)
    }
  })
})

describe('channelOptions：批次「计划去向」下拉的选项', () => {
  it('正常渠道：9 条（含 undecided），顺序与 SALES_CHANNELS 一致', () => {
    const options = channelOptions('undecided')
    expect(options).toHaveLength(9)
    expect(options.map(o => o.id)).toEqual(SALES_CHANNELS.map(c => c.id))
    expect(options[0]).toEqual({ id: 'undecided', name: '未定' })
  })

  it('账本里存着未知渠道时补一条，绝不把它从下拉里藏掉', () => {
    const options = channelOptions('taobao_live')
    expect(options).toHaveLength(10)
    expect(options[9]).toEqual({ id: 'taobao_live', name: 'taobao_live（未知渠道）' })
    // 已知渠道那条不能被顶掉
    expect(options.filter(o => o.id === 'pet_shop')).toHaveLength(1)
  })
})

describe('emptyChannelRows：8 行输入框的初始状态', () => {
  it('键正好是 8 条渠道，三格都是空串', () => {
    const rows = emptyChannelRows()
    expect(Object.keys(rows)).toEqual(comparisonChannels().map(c => c.id))
    for (const id of Object.keys(rows)) {
      expect(rows[id]).toEqual({ unitPrice: '', extraPerDog: '', fixedCost: '' })
    }
  })

  it('每次调用返回新对象（不能共用同一个可变行）', () => {
    const first = emptyChannelRows()
    const second = emptyChannelRows()
    expect(first).not.toBe(second)
    expect(first.pet_shop).not.toBe(second.pet_shop)
  })
})

describe('parseChannelRow：一行三个输入框的解析', () => {
  it('全空 = 全 0，且不算填错（留空就是「还没填」）', () => {
    expect(parseChannelRow('pet_shop', { unitPrice: '', extraPerDog: '', fixedCost: '' }))
      .toEqual({
        channelId: 'pet_shop',
        unitPriceFen: 0,
        extraPerDogFen: 0,
        fixedCostFen: 0,
        invalid: false,
      })
  })

  it('元 → 分，带 ¥ 与千分位逗号也能认', () => {
    const row = parseChannelRow('ecommerce', {
      unitPrice: '1200', extraPerDog: '¥30', fixedCost: '1,200',
    })
    expect(row.unitPriceFen).toBe(120000)
    expect(row.extraPerDogFen).toBe(3000)
    expect(row.fixedCostFen).toBe(120000)
    expect(row.invalid).toBe(false)
  })

  it('小数元也照收（四舍五入到分由 parseMoney 负责）', () => {
    expect(parseChannelRow('kennel', { unitPrice: '12.345', extraPerDog: '', fixedCost: '' }).unitPriceFen)
      .toBe(1235)
  })

  it('填了但不是数字：标 invalid，绝不静默当 0', () => {
    const row = parseChannelRow('meat', { unitPrice: '６00', extraPerDog: '', fixedCost: '' })
    expect(row.invalid).toBe(true)
    expect(row.unitPriceFen).toBe(0)
  })

  it('负数也算填错（渠道成本不存在负数）', () => {
    expect(parseChannelRow('middleman', { unitPrice: '-5', extraPerDog: '', fixedCost: '' }).invalid).toBe(true)
    expect(parseChannelRow('middleman', { unitPrice: '', extraPerDog: '', fixedCost: '-1' }).invalid).toBe(true)
  })

  it('三格里任意一格填错，整行都是 invalid', () => {
    expect(parseChannelRow('rural_fair', { unitPrice: '', extraPerDog: 'abc', fixedCost: '' }).invalid).toBe(true)
    expect(parseChannelRow('rural_fair', { unitPrice: '', extraPerDog: '', fixedCost: 'x' }).invalid).toBe(true)
  })

  it('空格不算数字也不算填错（"   " 当留空）', () => {
    const row = parseChannelRow('individual', { unitPrice: '   ', extraPerDog: '', fixedCost: '' })
    expect(row.invalid).toBe(false)
    expect(row.unitPriceFen).toBe(0)
  })
})

describe('channelInputsFromRows：喂给 compareChannelCosts 的入参', () => {
  it('顺序与 comparisonChannels 一致，channelId 逐个对上', () => {
    const inputs = channelInputsFromRows(emptyChannelRows())
    expect(inputs.map(i => i.channelId)).toEqual(comparisonChannels().map(c => c.id))
  })

  it('缺键的行当全 0 处理（不抛错）', () => {
    const inputs = channelInputsFromRows({})
    expect(inputs).toHaveLength(8)
    expect(inputs.every(i => i.unitPriceFen === 0 && !i.invalid)).toBe(true)
  })

  it('把某一行填上，只有那一行变', () => {
    const rows = emptyChannelRows()
    rows.meat = { unitPrice: '800', extraPerDog: '20', fixedCost: '300' }
    const inputs = channelInputsFromRows(rows)
    const meat = inputs.find(i => i.channelId === 'meat')
    expect(meat).toEqual({
      channelId: 'meat', unitPriceFen: 80000, extraPerDogFen: 2000, fixedCostFen: 30000, invalid: false,
    })
    const other = inputs.find(i => i.channelId === 'kennel')
    expect(other?.unitPriceFen).toBe(0)
    expect(other?.fixedCostFen).toBe(0)
  })
})

describe('parseAliveInput：存活数输入框', () => {
  it('整数原样通过，不做取整也不做夹取', () => {
    expect(parseAliveInput('6')).toBe(6)
    expect(parseAliveInput('0')).toBe(0)
    expect(parseAliveInput('120')).toBe(120)
  })

  it('空 = 0（还没填）', () => {
    expect(parseAliveInput('')).toBe(0)
    expect(parseAliveInput('  ')).toBe(0)
  })

  it('小数返回 null（它不是「几只狗」，交给界面报错而不是偷偷取整）', () => {
    expect(parseAliveInput('6.8')).toBeNull()
    expect(parseAliveInput('6.0')).toBeNull()
  })

  it('负数、字母、千分位都返回 null', () => {
    expect(parseAliveInput('-1')).toBeNull()
    expect(parseAliveInput('abc')).toBeNull()
    expect(parseAliveInput('1,000')).toBeNull()
    expect(parseAliveInput('６')).toBeNull()
  })

  it('前导零也认（用户手打 007 不该被骂）', () => {
    expect(parseAliveInput('007')).toBe(7)
  })
})
