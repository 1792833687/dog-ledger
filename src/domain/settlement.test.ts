import { describe, it, expect } from 'vitest'
import type { AppData, LedgerEntry, Settings } from './types'
import { DEFAULT_DATA, DEFAULT_SETTINGS } from './types'
import { settle, validateSettings } from './settlement'

function withEntries(entries: Partial<LedgerEntry>[]): AppData {
  const full = entries.map((e, i) => ({
    id: `e${i}`, date: '2026-10-03', type: 'expense', category: 'purchase',
    amount: 0, paidBy: 'pool', payee: null, batchId: null, dogId: null, note: '',
    ...e,
  })) as LedgerEntry[]
  return { ...DEFAULT_DATA, entries: full }
}

describe('settle', () => {
  it('净利 = 总收入 − 总支出；垫付与分红不计入损益', () => {
    const data = withEntries([
      { type: 'injection', amount: 1000000, paidBy: 'p1' },
      { type: 'expense', amount: 584000, paidBy: 'p1' },
      { type: 'income', amount: 720000 },
      { type: 'reimbursement', amount: 100000, payee: 'p1' },
      { type: 'distribution', amount: 50000, payee: 'p2' },
    ])
    const s = settle(data)
    expect(s.totalIncome).toBe(720000)
    expect(s.totalExpense).toBe(584000)
    expect(s.netProfit).toBe(136000)
  })

  it('两人各 50% 时应分未分 = 净利 × 0.5 − 已分红', () => {
    const data = withEntries([
      { type: 'expense', amount: 100000, paidBy: 'p1' },
      { type: 'income', amount: 300000 },
      { type: 'distribution', amount: 20000, payee: 'p2' },
    ])
    const s = settle(data)
    const p1 = s.partners.find(p => p.id === 'p1')!
    const p2 = s.partners.find(p => p.id === 'p2')!
    expect(p1.claimable).toBe(100000)   // 200000×0.5 − 0
    expect(p2.claimable).toBe(80000)    // 200000×0.5 − 20000
  })

  it('垫付余额按人分别统计', () => {
    const data = withEntries([
      { type: 'expense', amount: 70000, paidBy: 'p1' },
      { type: 'expense', amount: 40000, paidBy: 'p2' },
      { type: 'reimbursement', amount: 40000, payee: 'p2' },
      { type: 'income', amount: 500000 },
    ])
    const s = settle(data)
    expect(s.partners.find(p => p.id === 'p1')!.advance).toBe(70000)
    expect(s.partners.find(p => p.id === 'p2')!.advance).toBe(0)
  })

  it('池子现金与净利是两回事：净利留在池子里也可以不分红', () => {
    const data = withEntries([
      { type: 'injection', amount: 100000, paidBy: 'p1' },
      { type: 'income', amount: 50000 },
    ])
    const s = settle(data)
    expect(s.pool).toBe(150000)
    expect(s.netProfit).toBe(50000)
    expect(s.partners.find(p => p.id === 'p1')!.claimable).toBe(25000)
  })
})

describe('validateSettings', () => {
  it('比例之和为 1 时通过', () => {
    expect(validateSettings(DEFAULT_SETTINGS)).toBeNull()
  })

  it('比例之和不为 1 时返回错误信息', () => {
    const bad: Settings = {
      ...DEFAULT_SETTINGS,
      partners: [
        { id: 'p1', name: '我', shareRatio: 0.5 },
        { id: 'p2', name: '伙伴', shareRatio: 0.6 },
      ],
    }
    expect(validateSettings(bad)).toBe('分成比例之和必须等于 100%')
  })

  it('没有合伙人时报错', () => {
    expect(validateSettings({ ...DEFAULT_SETTINGS, partners: [] })).toBe('至少需要一个合伙人')
  })

  // 合规成本项（检疫 / 无害化处理）不许填负数——负数会让保本价被低估，是危险的方向。
  it('检疫费为负时报错', () => {
    expect(validateSettings({ ...DEFAULT_SETTINGS, quarantinePerDog: -1 })).toBe('检疫费不能为负')
  })

  it('病死犬处理费为负时报错', () => {
    expect(validateSettings({ ...DEFAULT_SETTINGS, disposalPerDog: -1 })).toBe('病死犬处理费不能为负')
  })

  // 检疫相关的天数：为负的话「检」页面上的日期会倒着算（等待期变成负数，
  // 刚接种的狗会被判成「可以送检」）。与上面两条一样用 `!(x >= 0)` 的写法，
  // 这样 `NaN` 也拦得住。
  it('狂犬免疫后等待天数为负时报错', () => {
    expect(validateSettings({ ...DEFAULT_SETTINGS, rabiesWaitDays: -1 }))
      .toBe('狂犬免疫后等待天数不能为负')
  })

  it('检疫申报提前天数为负时报错', () => {
    expect(validateSettings({ ...DEFAULT_SETTINGS, quarantineLeadDays: -1 }))
      .toBe('检疫申报提前天数不能为负')
  })

  it('★ 天数是 NaN 时报错（`x < 0` 拦不住 NaN，`!(x >= 0)` 才拦得住）', () => {
    expect(validateSettings({ ...DEFAULT_SETTINGS, rabiesWaitDays: NaN }))
      .toBe('狂犬免疫后等待天数不能为负')
    expect(validateSettings({ ...DEFAULT_SETTINGS, quarantineLeadDays: NaN }))
      .toBe('检疫申报提前天数不能为负')
  })

  it('天数为 0 是合法的（＝不等待）', () => {
    expect(validateSettings({ ...DEFAULT_SETTINGS, rabiesWaitDays: 0, quarantineLeadDays: 0 }))
      .toBeNull()
  })

  // 预定单提醒提前天数：负数同样会让「狗」页顶部的提醒算不出来（提前量是负数
  // 意味着「还没到那一天就已经该去收了」），用同一个 `!(x >= 0)` 拦 NaN。
  it('预定单提醒提前天数为负时报错', () => {
    expect(validateSettings({ ...DEFAULT_SETTINGS, preOrderLeadDays: -1 }))
      .toBe('预定单提醒提前天数不能为负')
  })

  it('预定单提醒提前天数是 NaN 时报错', () => {
    expect(validateSettings({ ...DEFAULT_SETTINGS, preOrderLeadDays: NaN }))
      .toBe('预定单提醒提前天数不能为负')
  })

  it('预定单提醒提前天数为 0 是合法的（＝当天才提醒）', () => {
    expect(validateSettings({ ...DEFAULT_SETTINGS, preOrderLeadDays: 0 })).toBeNull()
  })
})
