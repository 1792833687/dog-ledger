import { describe, it, expect } from 'vitest'
import type { AppData, Batch, Dog, LedgerEntry } from './types'
import { DEFAULT_DATA } from './types'
import {
  dogOwnCost, batchTotalCost, batchIncome, inStockCount, aliveCount,
  deadLoss, dilutedCostFen, dogIncome, dogProfitFen,
  remainingFloorPriceFen, batchSummary,
} from './costing'
import { formatMoney } from './money'

function makeBatch(over: Partial<Batch> = {}): Batch {
  return { id: 'b1', name: '10月3日一批', date: '2026-10-03', source: '农户', note: '', status: 'active', ...over }
}

function makeDog(id: string, status: Dog['status'], over: Partial<Dog> = {}): Dog {
  return { id, batchId: 'b1', code: id, breed: '', sex: 'unknown', ageMonths: null, status, note: '', ...over }
}

function entry(over: Partial<LedgerEntry>): LedgerEntry {
  return {
    id: `e-${Math.random()}`, date: '2026-10-03', type: 'expense', category: 'purchase',
    amount: 0, paidBy: 'pool', payee: null, batchId: 'b1', dogId: null, note: '', ...over,
  }
}

/** 设计文档 3.6 的关键案例：8 只 × 600 收购 + 400 运输 + 8 × 80 疫苗 = 5840 元，死 2 只 */
function scenarioData(): AppData {
  const dogs: Dog[] = []
  for (let i = 1; i <= 8; i++) dogs.push(makeDog(`d${i}`, i <= 2 ? 'dead' : 'in_stock'))
  const entries: LedgerEntry[] = [entry({ category: 'transport', amount: 40000 })]
  for (let i = 1; i <= 8; i++) {
    entries.push(entry({ category: 'purchase', amount: 60000, dogId: `d${i}` }))
    entries.push(entry({ category: 'medical', amount: 8000, dogId: `d${i}` }))
  }
  return { ...DEFAULT_DATA, batches: [makeBatch()], dogs, entries }
}

describe('批次成本', () => {
  it('批次总成本 = 所有关联该批次的支出，含单只狗层面的', () => {
    expect(batchTotalCost(scenarioData(), 'b1')).toBe(584000)
  })

  it('单只狗的直接成本只算挂到它自己的支出', () => {
    expect(dogOwnCost(scenarioData(), 'd3')).toBe(68000) // 600 + 80
  })

  it('批次收入只算挂到该批次的收入', () => {
    const data = scenarioData()
    data.entries.push(entry({ type: 'income', category: 'sale', amount: 90000, dogId: 'd3' }))
    expect(batchIncome(data, 'b1')).toBe(90000)
  })

  it('在库数与存活数：dead 既不在库也不存活', () => {
    const data = scenarioData()
    expect(inStockCount(data, 'b1')).toBe(6)
    expect(aliveCount(data, 'b1')).toBe(6)
  })

  it('退狗（returned）算在库也算存活', () => {
    const data = scenarioData()
    data.dogs.find(d => d.id === 'd3')!.status = 'returned'
    expect(inStockCount(data, 'b1')).toBe(6)
    expect(aliveCount(data, 'b1')).toBe(6)
  })

  it('已售出（sold）算存活但不在库', () => {
    const data = scenarioData()
    data.dogs.find(d => d.id === 'd3')!.status = 'sold'
    expect(inStockCount(data, 'b1')).toBe(5)
    expect(aliveCount(data, 'b1')).toBe(6)
  })

  it('死亡损耗 = 两只死狗的直接成本之和', () => {
    expect(deadLoss(scenarioData(), 'b1')).toBe(136000) // (600+80) × 2
  })
})

describe('★ 损耗摊薄（设计文档 3.6 案例）', () => {
  it('存活狗真实成本 = 批次总成本 ÷ 存活数', () => {
    const data = scenarioData()
    const cost = dilutedCostFen(data, 'd3')
    expect(formatMoney(cost)).toBe('¥973.33')
    expect(cost).toBeCloseTo(584000 / 6, 6)
  })

  it('按 900 元卖出是亏的，而当事人会以为赚了 300', () => {
    const data = scenarioData()
    data.dogs.find(d => d.id === 'd3')!.status = 'sold'
    data.entries.push(entry({ type: 'income', category: 'sale', amount: 90000, dogId: 'd3' }))
    expect(dogIncome(data, 'd3')).toBe(90000)
    expect(dogProfitFen(data, 'd3')).toBeCloseTo(90000 - 584000 / 6, 6)
    expect(formatMoney(dogProfitFen(data, 'd3'))).toBe('-¥73.33')
  })

  it('整批死光时不崩溃，且退化为该狗自身成本', () => {
    const data = scenarioData()
    data.dogs.forEach(d => { d.status = 'dead' })
    expect(aliveCount(data, 'b1')).toBe(0)
    expect(dilutedCostFen(data, 'd3')).toBe(68000)
  })
})

describe('★ 批次剩余保本单价（指标 A）', () => {
  it('未卖出任何一只时 = 总成本 ÷ 在库数', () => {
    const data = scenarioData()
    expect(formatMoney(remainingFloorPriceFen(data, 'b1')!)).toBe('¥973.33')
  })

  it('卖出后随收款额下降', () => {
    const data = scenarioData()
    data.dogs.find(d => d.id === 'd3')!.status = 'sold'
    data.entries.push(entry({ type: 'income', category: 'sale', amount: 200000, dogId: 'd3' }))
    // (584000 - 200000) ÷ 5 在库
    expect(remainingFloorPriceFen(data, 'b1')).toBeCloseTo(384000 / 5, 6)
  })

  it('已回本时返回 0，不是负数', () => {
    const data = scenarioData()
    data.entries.push(entry({ type: 'income', category: 'sale', amount: 999999, batchId: 'b1' }))
    expect(remainingFloorPriceFen(data, 'b1')).toBe(0)
  })

  it('没有在库狗时返回 null', () => {
    const data = scenarioData()
    data.dogs.forEach(d => { if (d.status === 'in_stock') d.status = 'sold' })
    expect(remainingFloorPriceFen(data, 'b1')).toBeNull()
  })
})

describe('batchSummary', () => {
  it('汇总各计数与金额', () => {
    const data = scenarioData()
    data.dogs.find(d => d.id === 'd3')!.status = 'sold'
    data.entries.push(entry({ type: 'income', category: 'sale', amount: 120000, dogId: 'd3' }))
    const s = batchSummary(data, 'b1')
    expect(s.totalCost).toBe(584000)
    expect(s.income).toBe(120000)
    expect(s.inStock).toBe(5)
    expect(s.sold).toBe(1)
    expect(s.dead).toBe(2)
    expect(s.returned).toBe(0)
    expect(s.netProfitFen).toBe(120000 - 584000)
  })
})
