import { describe, it, expect } from 'vitest'
import type { AppData, Batch, Dog, LedgerEntry } from './types'
import { DEFAULT_DATA } from './types'
import { batchSummary } from './costing'
import { costBreakdown, mortalityTrend } from './stats'

function makeBatch(id: string, date: string, over: Partial<Batch> = {}): Batch {
  return {
    id, name: `批次${id}`, date, source: '', note: '',
    status: 'active', plannedChannel: 'undecided', ...over,
  }
}

function makeDog(id: string, batchId: string, status: Dog['status']): Dog {
  return {
    id, batchId, code: id, breed: '', sex: 'unknown', ageMonths: null, status, note: '',
    rabiesVaccinatedOn: null, antibodyTestedOn: null, antibodyReportNo: '',
    quarantineCertNo: '', quarantineCertIssuedOn: null, quarantineCertValidUntil: null,
  }
}

function entry(over: Partial<LedgerEntry>): LedgerEntry {
  return {
    id: `e-${Math.random()}`, date: '2026-10-03', type: 'expense', category: 'purchase',
    amount: 0, paidBy: 'pool', payee: null, batchId: null, dogId: null, note: '', ...over,
  }
}

/** 一只有 N 只狗、状态按 [活着的状态…] 给的批次。 */
function dogsByStatus(batchId: string, statuses: Dog['status'][]): Dog[] {
  return statuses.map((s, i) => makeDog(`${batchId}-d${i}`, batchId, s))
}

describe('costBreakdown —— 钱花在哪了', () => {
  it('同一分类的多笔支出合并成一行', () => {
    const data: AppData = {
      ...DEFAULT_DATA,
      entries: [
        entry({ category: 'purchase', amount: 200000 }),
        entry({ category: 'purchase', amount: 100000 }),
      ],
    }
    const rows = costBreakdown(data)
    expect(rows).toHaveLength(1)
    expect(rows[0].category).toBe('purchase')
    expect(rows[0].totalFen).toBe(300000)
  })

  it('按 totalFen 降序', () => {
    const data: AppData = {
      ...DEFAULT_DATA,
      entries: [
        entry({ category: 'transport', amount: 50000 }),
        entry({ category: 'purchase', amount: 300000 }),
        entry({ category: 'medical', amount: 90000 }),
      ],
    }
    expect(costBreakdown(data).map(r => r.category)).toEqual(['purchase', 'medical', 'transport'])
  })

  it('只统计 expense：收入、注资、报销、分红一律不进成本结构', () => {
    const data: AppData = {
      ...DEFAULT_DATA,
      entries: [
        entry({ category: 'purchase', amount: 300000 }),
        entry({ type: 'income', category: 'sale', amount: 900000 }),
        entry({ type: 'injection', category: 'transfer', amount: 100000 }),
        entry({ type: 'reimbursement', category: 'transfer', amount: 40000 }),
        entry({ type: 'distribution', category: 'transfer', amount: 20000 }),
      ],
    }
    const rows = costBreakdown(data)
    expect(rows).toHaveLength(1)
    expect(rows[0].totalFen).toBe(300000)
    expect(rows[0].share).toBe(1)
  })

  it('share = 该项 / 全部支出', () => {
    const data: AppData = {
      ...DEFAULT_DATA,
      entries: [
        entry({ category: 'purchase', amount: 75000 }),
        entry({ category: 'transport', amount: 25000 }),
      ],
    }
    const rows = costBreakdown(data)
    expect(rows[0].share).toBe(0.75)
    expect(rows[1].share).toBe(0.25)
  })

  it('share 之和是 1 —— 分母与「报」页顶部那个「总支出」是同一个数', () => {
    const data: AppData = {
      ...DEFAULT_DATA,
      entries: [
        entry({ category: 'purchase', amount: 584000 }),
        entry({ category: 'transport', amount: 40000 }),
        entry({ category: 'medical', amount: 64000 }),
        entry({ category: 'quarantine', amount: 3000 }),
      ],
    }
    const rows = costBreakdown(data)
    const sum = rows.reduce((s, r) => s + r.totalFen, 0)
    const shareSum = rows.reduce((s, r) => s + r.share, 0)
    expect(sum).toBe(691000)
    expect(shareSum).toBeCloseTo(1, 10)
  })

  it('没有流水时返回空数组', () => {
    expect(costBreakdown(DEFAULT_DATA)).toEqual([])
  })

  it('只有收入、没有任何支出时返回空数组（不是一堆 share = NaN）', () => {
    const data: AppData = {
      ...DEFAULT_DATA,
      entries: [entry({ type: 'income', category: 'sale', amount: 900000 })],
    }
    expect(costBreakdown(data)).toEqual([])
  })

  it('支出总额为 0（记了一笔 0 元支出）时 share 是 0，绝不是 NaN', () => {
    const data: AppData = {
      ...DEFAULT_DATA,
      entries: [entry({ category: 'purchase', amount: 0 })],
    }
    const rows = costBreakdown(data)
    expect(rows).toHaveLength(1)
    expect(rows[0].share).toBe(0)
    expect(Number.isNaN(rows[0].share)).toBe(false)
  })

  it('名字从设置的 costItems 里解析（内置项也是走这条路）', () => {
    const data: AppData = {
      ...DEFAULT_DATA,
      entries: [
        entry({ category: 'quarantine', amount: 3000 }),
        entry({ category: 'aftercare_refund', amount: 20000 }),
      ],
    }
    expect(costBreakdown(data).map(r => r.name)).toEqual(['售后退款', '检疫（抗体检测+申报）'])
  })

  it('用户自建的成本项：名字同样解析得出来', () => {
    const data: AppData = {
      ...DEFAULT_DATA,
      settings: {
        ...DEFAULT_DATA.settings,
        costItems: [
          ...DEFAULT_DATA.settings.costItems,
          { id: 'grooming', name: '洗澡美容', scope: 'dog', isBuiltin: false },
        ],
      },
      entries: [entry({ category: 'grooming', amount: 12000 })],
    }
    expect(costBreakdown(data)[0].name).toBe('洗澡美容')
  })

  it('costItems 里没有这个 id 时回落「其他」（备份被外部编辑/导入会走到这里）', () => {
    const data: AppData = {
      ...DEFAULT_DATA,
      entries: [entry({ category: 'mystery', amount: 8000 })],
    }
    const rows = costBreakdown(data)
    expect(rows).toHaveLength(1)
    expect(rows[0].category).toBe('mystery')
    expect(rows[0].name).toBe('其他')
  })

  it('两个都不认识的分类各自成行、名字都叫「其他」（「按 category 汇总」的直接后果）', () => {
    const data: AppData = {
      ...DEFAULT_DATA,
      entries: [
        entry({ category: 'unknown_a', amount: 3000 }),
        entry({ category: 'unknown_b', amount: 1000 }),
      ],
    }
    const rows = costBreakdown(data)
    expect(rows).toHaveLength(2)
    expect(rows.map(r => r.name)).toEqual(['其他', '其他'])
    expect(rows.map(r => r.totalFen)).toEqual([3000, 1000])
  })

  it('不修改入参', () => {
    const data: AppData = {
      ...DEFAULT_DATA,
      entries: [
        entry({ category: 'purchase', amount: 100000 }),
        entry({ category: 'transport', amount: 50000 }),
      ],
    }
    const before = JSON.stringify(data)
    costBreakdown(data)
    expect(JSON.stringify(data)).toBe(before)
  })
})

describe('mortalityTrend —— 死亡率趋势', () => {
  it('按日期升序，老的在前（输入顺序打乱也一样）', () => {
    const data: AppData = {
      ...DEFAULT_DATA,
      batches: [makeBatch('b3', '2026-10-20'), makeBatch('b1', '2026-10-01'), makeBatch('b2', '2026-10-10')],
    }
    expect(mortalityTrend(data).map(p => p.batchId)).toEqual(['b1', 'b2', 'b3'])
  })

  it('同一天的两个批次保持 data.batches 里的原顺序', () => {
    const data: AppData = {
      ...DEFAULT_DATA,
      batches: [makeBatch('second', '2026-10-05'), makeBatch('first', '2026-10-05')],
    }
    expect(mortalityTrend(data).map(p => p.batchId)).toEqual(['second', 'first'])
  })

  it('total 是全部狗（在库/已售/死亡/退回都算），dead 只数 status === dead', () => {
    const data: AppData = {
      ...DEFAULT_DATA,
      batches: [makeBatch('b1', '2026-10-01')],
      dogs: dogsByStatus('b1', ['sold', 'sold', 'sold', 'sold', 'dead', 'dead', 'in_stock', 'in_stock', 'returned', 'returned']),
    }
    const p = mortalityTrend(data)[0]
    expect(p.total).toBe(10)
    expect(p.dead).toBe(2)
    expect(p.rate).toBe(0.2)
  })

  it('分母与「批次盈亏排行」用的那个数恒等：sold + dead + inStock', () => {
    const data: AppData = {
      ...DEFAULT_DATA,
      batches: [makeBatch('b1', '2026-10-01')],
      dogs: dogsByStatus('b1', ['sold', 'sold', 'sold', 'sold', 'dead', 'dead', 'in_stock', 'in_stock', 'returned', 'returned']),
    }
    const s = batchSummary(data, 'b1')
    expect(mortalityTrend(data)[0].total).toBe(s.sold + s.dead + s.inStock)
  })

  it('批次里一只狗都没有时 rate 是 0，不除零、不出 NaN', () => {
    const data: AppData = { ...DEFAULT_DATA, batches: [makeBatch('empty', '2026-10-01')] }
    const p = mortalityTrend(data)[0]
    expect(p.total).toBe(0)
    expect(p.dead).toBe(0)
    expect(p.rate).toBe(0)
    expect(Number.isNaN(p.rate)).toBe(false)
  })

  it('每个批次一条，顺序只由日期决定', () => {
    const data: AppData = {
      ...DEFAULT_DATA,
      batches: [makeBatch('b1', '2026-10-01'), makeBatch('b2', '2026-10-02')],
      dogs: [
        ...dogsByStatus('b1', ['dead', 'in_stock']),
        ...dogsByStatus('b2', ['in_stock', 'in_stock', 'in_stock', 'in_stock']),
      ],
    }
    const points = mortalityTrend(data)
    expect(points).toHaveLength(2)
    expect(points.map(p => p.name)).toEqual(['批次b1', '批次b2'])
    expect(points.map(p => p.date)).toEqual(['2026-10-01', '2026-10-02'])
  })

  it('deltaFromPrevious：第一批是 null（「首批」不等于「与上一批持平」）', () => {
    const data: AppData = {
      ...DEFAULT_DATA,
      batches: [makeBatch('b1', '2026-10-01')],
      dogs: dogsByStatus('b1', ['dead', 'in_stock']),
    }
    expect(mortalityTrend(data)[0].deltaFromPrevious).toBeNull()
  })

  it('deltaFromPrevious：第二批等于两批 rate 之差', () => {
    const data: AppData = {
      ...DEFAULT_DATA,
      batches: [makeBatch('b1', '2026-10-01'), makeBatch('b2', '2026-10-02')],
      dogs: [
        ...dogsByStatus('b1', ['dead', 'dead', 'in_stock', 'in_stock']),                 // 0.5
        ...dogsByStatus('b2', ['dead', 'in_stock', 'in_stock', 'in_stock', 'in_stock']), // 0.2
      ],
    }
    const points = mortalityTrend(data)
    expect(points[0].rate).toBe(0.5)
    expect(points[1].rate).toBe(0.2)
    expect(points[1].deltaFromPrevious).toBeCloseTo(-0.3, 10)
  })

  it('deltaFromPrevious 只看紧邻的上一批，不跟第一批比', () => {
    const data: AppData = {
      ...DEFAULT_DATA,
      batches: [makeBatch('b1', '2026-10-01'), makeBatch('b2', '2026-10-02'), makeBatch('b3', '2026-10-03')],
      dogs: [
        ...dogsByStatus('b1', ['dead', 'in_stock']),                                       // 0.5
        ...dogsByStatus('b2', ['dead', 'in_stock', 'in_stock', 'in_stock', 'in_stock', 'in_stock', 'in_stock', 'in_stock', 'in_stock', 'in_stock']), // 0.1
        ...dogsByStatus('b3', ['dead', 'dead', 'dead', 'in_stock', 'in_stock', 'in_stock', 'in_stock', 'in_stock', 'in_stock', 'in_stock']),          // 0.3
      ],
    }
    const points = mortalityTrend(data)
    expect(points.map(p => p.rate)).toEqual([0.5, 0.1, 0.3])
    expect(points[1].deltaFromPrevious).toBeCloseTo(-0.4, 10)
    // 第三批只看第二批：0.3 − 0.1 = +0.2。若错成跟第一批比会得到 0.3 − 0.5 = −0.2。
    expect(points[2].deltaFromPrevious).toBeCloseTo(0.2, 10)
  })

  it('两批死亡率持平（且都不为 0）时 deltaFromPrevious 是 0', () => {
    const data: AppData = {
      ...DEFAULT_DATA,
      batches: [makeBatch('b1', '2026-10-01'), makeBatch('b2', '2026-10-02')],
      dogs: [
        ...dogsByStatus('b1', ['dead', 'in_stock']),
        ...dogsByStatus('b2', ['dead', 'in_stock']),
      ],
    }
    expect(mortalityTrend(data)[1].deltaFromPrevious).toBe(0)
  })

  it('没有批次时返回空数组', () => {
    expect(mortalityTrend(DEFAULT_DATA)).toEqual([])
  })

  it('不修改入参：data.batches 的顺序原样不动', () => {
    const data: AppData = {
      ...DEFAULT_DATA,
      batches: [makeBatch('b2', '2026-10-20'), makeBatch('b1', '2026-10-01')],
    }
    const before = data.batches.map(b => b.id)
    mortalityTrend(data)
    expect(data.batches.map(b => b.id)).toEqual(before)
  })
})
