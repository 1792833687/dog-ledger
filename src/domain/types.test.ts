import { describe, it, expect } from 'vitest'
import { DEFAULT_SETTINGS, DEFAULT_DATA, BUILTIN_COST_ITEMS, SALES_CHANNELS, newId } from './types'

describe('默认设置', () => {
  it('分成比例之和为 1', () => {
    const sum = DEFAULT_SETTINGS.partners.reduce((a, p) => a + p.shareRatio, 0)
    expect(sum).toBeCloseTo(1, 10)
  })

  it('内置成本项包含收购价与运输，且运输是批次级、收购价是单只级', () => {
    const purchase = BUILTIN_COST_ITEMS.find(c => c.id === 'purchase')!
    const transport = BUILTIN_COST_ITEMS.find(c => c.id === 'transport')!
    expect(purchase.scope).toBe('dog')
    expect(transport.scope).toBe('batch')
  })

  // 合规调研（docs/compliance/）查明：检疫是出售的法定前置，无害化处理是病死的强制支出。
  // 这两项必须在成本项里，否则「保本价」会把两块真金白银的支漏掉。
  it('内置成本项包含检疫与病死犬无害化处理', () => {
    const quarantine = BUILTIN_COST_ITEMS.find(c => c.id === 'quarantine')!
    const disposal = BUILTIN_COST_ITEMS.find(c => c.id === 'disposal')!
    expect(quarantine).toBeDefined()
    expect(quarantine.scope).toBe('dog')
    expect(disposal).toBeDefined()
    expect(disposal.scope).toBe('batch')
  })

  it('检疫与无害化处理的默认值都是 0，不许编造价格', () => {
    expect(DEFAULT_SETTINGS.quarantinePerDog).toBe(0)
    expect(DEFAULT_SETTINGS.disposalPerDog).toBe(0)
  })

  it('默认数据的三个集合都是空数组', () => {
    expect(DEFAULT_DATA.batches).toEqual([])
    expect(DEFAULT_DATA.dogs).toEqual([])
    expect(DEFAULT_DATA.entries).toEqual([])
  })

  it('newId 每次返回不同的值', () => {
    expect(newId()).not.toBe(newId())
  })
})

describe('销售渠道', () => {
  // 抖音小店与「抖音引流到微信」两条路都已堵死（见 docs/compliance/ 平台篇与销售路径篇），
  // 所以渠道清单里不该出现任何抖音相关选项 —— 留着会诱导用户去走那条会被永久封号的路。
  it('渠道清单里没有抖音相关渠道，默认是「未定」', () => {
    expect(SALES_CHANNELS.length).toBeGreaterThan(1)
    expect(SALES_CHANNELS[0].id).toBe('undecided')
    const ids = SALES_CHANNELS.map(c => c.id)
    expect(ids).not.toContain('douyin')
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('每条渠道都有名字和说明', () => {
    for (const c of SALES_CHANNELS) {
      expect(c.name.length).toBeGreaterThan(0)
      expect(c.note.length).toBeGreaterThan(0)
    }
  })
})

describe('检疫流程参数', () => {
  it('免疫等待天数与申报提前天数有默认值', () => {
    expect(DEFAULT_SETTINGS.rabiesWaitDays).toBe(21)
    expect(DEFAULT_SETTINGS.quarantineLeadDays).toBe(3)
  })

  // 记录已知的别名陷阱：DEFAULT_DATA.settings 就是 DEFAULT_SETTINGS 本身。
  // 任何组件把它直接交给 useState 都会让界面状态与模块常量共享引用，
  // 一次就地 push/改字段就会永久污染常量 —— 必须先 structuredClone。
  it('DEFAULT_DATA.settings 与 DEFAULT_SETTINGS 是同一个对象（调用方必须先克隆）', () => {
    expect(DEFAULT_DATA.settings).toBe(DEFAULT_SETTINGS)
    expect(DEFAULT_DATA.settings.costItems).toBe(BUILTIN_COST_ITEMS)
  })
})
