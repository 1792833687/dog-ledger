import { describe, it, expect } from 'vitest'
import { DEFAULT_SETTINGS, DEFAULT_DATA, BUILTIN_COST_ITEMS, newId } from './types'

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
