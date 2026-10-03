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

  it('默认数据的三个集合都是空数组', () => {
    expect(DEFAULT_DATA.batches).toEqual([])
    expect(DEFAULT_DATA.dogs).toEqual([])
    expect(DEFAULT_DATA.entries).toEqual([])
  })

  it('newId 每次返回不同的值', () => {
    expect(newId()).not.toBe(newId())
  })
})
