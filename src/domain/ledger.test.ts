import { describe, it, expect } from 'vitest'
import type { AppData, LedgerEntry } from './types'
import { DEFAULT_DATA } from './types'
import {
  totalIncome, totalExpense, poolBalance,
  advanceBalance, contributedCapital, distributedTo,
} from './ledger'

function withEntries(entries: Partial<LedgerEntry>[]): AppData {
  const full = entries.map((e, i) => ({
    id: `e${i}`, date: '2026-10-03', type: 'expense', category: 'purchase',
    amount: 0, paidBy: 'pool', payee: null, batchId: null, dogId: null, note: '',
    ...e,
  })) as LedgerEntry[]
  return { ...DEFAULT_DATA, entries: full }
}

describe('损益', () => {
  it('总收入 / 总支出', () => {
    const data = withEntries([
      { type: 'income', amount: 90000 },
      { type: 'income', amount: 10000 },
      { type: 'expense', amount: 30000 },
    ])
    expect(totalIncome(data)).toBe(100000)
    expect(totalExpense(data)).toBe(30000)
  })

  it('注资 / 报销 / 分红都不算收入也不算成本', () => {
    const data = withEntries([
      { type: 'injection', amount: 500000, paidBy: 'p1' },
      { type: 'reimbursement', amount: 20000, payee: 'p1' },
      { type: 'distribution', amount: 50000, payee: 'p2' },
    ])
    expect(totalIncome(data)).toBe(0)
    expect(totalExpense(data)).toBe(0)
  })
})

describe('池子现金', () => {
  it('注资 + 收入 − 池子直付支出 − 报销 − 分红', () => {
    const data = withEntries([
      { type: 'injection', amount: 500000, paidBy: 'p1' },
      { type: 'injection', amount: 500000, paidBy: 'p2' },
      { type: 'income', amount: 120000 },
      { type: 'expense', amount: 40000, paidBy: 'pool' },   // 池子直付
      { type: 'expense', amount: 60000, paidBy: 'p1' },     // p1 垫付：池子不动
      { type: 'reimbursement', amount: 60000, payee: 'p1' },
      { type: 'distribution', amount: 30000, payee: 'p1' },
    ])
    // 1000000 + 120000 - 40000 - 60000 - 30000
    expect(poolBalance(data)).toBe(990000)
  })
})

describe('垫付账', () => {
  it('某人垫付的支出之和，减去已报销给他的', () => {
    const data = withEntries([
      { type: 'expense', amount: 50000, paidBy: 'p1' },
      { type: 'expense', amount: 20000, paidBy: 'p1' },
      { type: 'expense', amount: 90000, paidBy: 'p2' },
      { type: 'reimbursement', amount: 30000, payee: 'p1' },
    ])
    expect(advanceBalance(data, 'p1')).toBe(40000)
    expect(advanceBalance(data, 'p2')).toBe(90000)
  })

  it('池子直付不产生垫付', () => {
    const data = withEntries([{ type: 'expense', amount: 50000, paidBy: 'pool' }])
    expect(advanceBalance(data, 'p1')).toBe(0)
  })
})

describe('注资本金与分红账', () => {
  it('注资按注入人累计', () => {
    const data = withEntries([
      { type: 'injection', amount: 500000, paidBy: 'p1' },
      { type: 'injection', amount: 300000, paidBy: 'p2' },
    ])
    expect(contributedCapital(data, 'p1')).toBe(500000)
    expect(contributedCapital(data, 'p2')).toBe(300000)
  })

  it('注资不计入分红账', () => {
    const data = withEntries([{ type: 'injection', amount: 500000, paidBy: 'p1' }])
    expect(distributedTo(data, 'p1')).toBe(0)
  })

  it('分红按收款人累计', () => {
    const data = withEntries([
      { type: 'distribution', amount: 30000, payee: 'p1' },
      { type: 'distribution', amount: 20000, payee: 'p1' },
    ])
    expect(distributedTo(data, 'p1')).toBe(50000)
  })
})
