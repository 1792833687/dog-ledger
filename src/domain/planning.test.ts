import { describe, it, expect } from 'vitest'
import { DEFAULT_DATA, DEFAULT_SETTINGS } from './types'
import type { AppData } from './types'
import { plan, addBatchWithDogs, receiveBatch, type PlanInput } from './planning'
import { formatMoney } from './money'
import { batchTotalCost, batchSummary } from './costing'

/**
 * 设计文档 3.6 案例：8 只 × 600 + 油费 400 + 每只疫苗 80，预估死亡率 25%。
 * 这里刻意把检疫费与无害化处理费设为 0，好让「损耗摊薄」这个教学案例的数字
 * 与设计文档 3.6 节严格对得上。这两项由下面单独一组测试覆盖。
 */
const input: PlanInput = {
  n: 8,
  purchasePrice: 60000,
  freight: 40000,
  medicalPerDog: 8000,
  quarantinePerDog: 0,
  disposalPerDog: 0,
  mortalityRate: 0.25,
  targetPrice: 120000,
}

describe('plan', () => {
  it('预估总成本按买入的全部只数计算，不因预估死亡而减少', () => {
    expect(plan(DEFAULT_SETTINGS, input).totalCost).toBe(584000)
  })

  it('预估存活数 = 只数 × (1 − 死亡率)', () => {
    expect(plan(DEFAULT_SETTINGS, input).expectedAlive).toBeCloseTo(6, 10)
  })

  it('★ 保本价 = 总成本 ÷ 预估存活数', () => {
    const r = plan(DEFAULT_SETTINGS, input)
    expect(r.breakEvenPriceFen).toBeCloseTo(584000 / 6, 6)
    expect(formatMoney(r.breakEvenPriceFen)).toBe('¥973.33')
  })

  it('建议售价 = 保本价 × (1 + 目标毛利率)，默认 30%', () => {
    const r = plan(DEFAULT_SETTINGS, input)
    expect(r.suggestedPriceFen).toBeCloseTo((584000 / 6) * 1.3, 6)
  })

  it('死亡率 0 时保本价 = 总成本 ÷ 只数', () => {
    const r = plan(DEFAULT_SETTINGS, { ...input, mortalityRate: 0 })
    expect(r.breakEvenPriceFen).toBeCloseTo(584000 / 8, 6)
  })

  it('死亡率 100% 时不崩溃，保本价退化为总成本本身', () => {
    const r = plan(DEFAULT_SETTINGS, { ...input, mortalityRate: 1 })
    expect(Number.isFinite(r.breakEvenPriceFen)).toBe(true)
    expect(r.breakEvenPriceFen).toBe(584000)
  })

  it('只数 0 时不崩溃且保本价为 0', () => {
    const r = plan(DEFAULT_SETTINGS, { ...input, n: 0 })
    expect(r.totalCost).toBe(40000)
    expect(r.breakEvenPriceFen).toBe(0)
  })

  it('风险模拟给出 60% / 80% / 100% 三档，亏损按人头平摊', () => {
    const r = plan(DEFAULT_SETTINGS, input)
    expect(r.scenarios.map(s => s.soldCount)).toEqual([5, 6, 8])
    const s8 = r.scenarios.find(s => s.soldCount === 8)!
    expect(s8.revenue).toBe(960000)
    expect(s8.profitFen).toBe(960000 - 584000)
    expect(s8.perPartnerFen).toBe((960000 - 584000) / 2)
  })

  it('只卖掉大半时利润被摊得很薄', () => {
    const r = plan(DEFAULT_SETTINGS, input)
    const s5 = r.scenarios.find(s => s.soldCount === 5)!
    const s8 = r.scenarios.find(s => s.soldCount === 8)!
    expect(s5.profitFen).toBe(5 * 120000 - 584000)   // 16000 分 = ¥160
    expect(s5.perPartnerFen).toBe(8000)              // 每人 ¥80
    expect(s5.profitFen).toBeLessThan(s8.profitFen)
  })

  it('售价压到保本价以下时每人为负', () => {
    const r = plan(DEFAULT_SETTINGS, { ...input, targetPrice: 90000 })
    const s5 = r.scenarios.find(s => s.soldCount === 5)!
    expect(s5.profitFen).toBe(5 * 90000 - 584000)
    expect(s5.perPartnerFen).toBeLessThan(0)
  })
})

describe('plan 计入合规成本（检疫与无害化处理）', () => {
  // docs/compliance/ 查明的两项法定支出：检疫是出售的前置条件，
  // 病死犬无害化处理是强制支出。它们之前完全不在成本模型里，
  // 结果就是这个软件最值钱的那个数字——保本价——是偏低的。
  const compliance: PlanInput = {
    ...input,
    quarantinePerDog: 5000,   // 每只 ¥50
    disposalPerDog: 20000,    // 每只病死犬 ¥200
  }

  it('检疫费按买回来的全部只数计，包括后来会死掉的那两只', () => {
    const r = plan(DEFAULT_SETTINGS, { ...compliance, mortalityRate: 0, disposalPerDog: 0 })
    expect(r.totalCost).toBe(584000 + 8 * 5000)   // 5840 元 + 400 元
  })

  it('无害化处理费按预估死亡只数计，不是按买回来的只数计', () => {
    const r = plan(DEFAULT_SETTINGS, { ...compliance, quarantinePerDog: 0 })
    expect(r.totalCost).toBe(584000 + 2 * 20000)  // 8 × 25% = 2 只 × 200 元
  })

  it('★ 两项都算进去后，保本价从 ¥973 抬到 ¥1,106', () => {
    const r = plan(DEFAULT_SETTINGS, compliance)
    expect(r.totalCost).toBe(664000)              // 5840 + 400 + 400 = 6640 元
    expect(r.expectedAlive).toBeCloseTo(6, 10)
    expect(r.breakEvenPriceFen).toBeCloseTo(664000 / 6, 6)
    expect(formatMoney(r.breakEvenPriceFen)).toBe('¥1,106.67')
  })
})

// ——— 收货（Task 24）———
//
// 「收货」是全仓唯一的「建批次 + 建狗」实现：它**只写收购款这一类流水**。
// 运输 / 疫苗 / 检疫 / 处理费一概不在这里写（那是 Task 25 的补账表，设计 D14 的
// 「先做后补账」就落在这条线上）。所以这里刻意不再出现「17 笔」「8 笔 quarantine」
// 那两条笔数口径 —— 它们已经搬去 Task 25 的 `addBatchCosts` 测试。

/** 收货的默认入参。类型直接取自函数签名，签名加字段时这里会跟着报错。 */
const receiveInput: Parameters<typeof addBatchWithDogs>[1] = {
  name: '收狗 3 只 09:10',
  date: '2026-10-03',
  count: 3,
  unitPriceFen: 60000,
  channel: 'undecided',
  source: '',
  note: '',
}

/** 取出这次调用建出来的批次 id。没建出来就让测试炸掉，好过用 `!` 静音。 */
function createdBatchId(result: { batchId: string | null }): string {
  if (result.batchId === null) throw new Error('这次调用没有建出批次')
  return result.batchId
}

/** 取出批次在库保本价。为 null 就让测试炸掉，好过用 `!` 静音。 */
function floorPriceFen(data: AppData, batchId: string): number {
  const value = batchSummary(data, batchId).floorPriceFen
  if (value === null) throw new Error('这个批次算不出在库保本价')
  return value
}

describe('addBatchWithDogs', () => {
  it('★ 只数 0 —— 一个批次都不建，传入的 data 原样返回（同一引用）', () => {
    const result = addBatchWithDogs(DEFAULT_DATA, { ...receiveInput, count: 0 })
    expect(result.batchId).toBeNull()
    expect(result.data).toBe(DEFAULT_DATA)
  })

  it('负数只数同样什么都不建', () => {
    const result = addBatchWithDogs(DEFAULT_DATA, { ...receiveInput, count: -3 })
    expect(result.batchId).toBeNull()
    expect(result.data).toBe(DEFAULT_DATA)
  })

  it('只数不是有限数字（NaN / Infinity）时什么都不建', () => {
    // `Math.floor(NaN)` 与 `Math.floor(Infinity)` 都不是「小于 1」的数，
    // 光写 `count < 1` 会让这两种输入滑过去：NaN 建出一个没有狗的空批次，
    // Infinity 直接死循环。
    const nan = addBatchWithDogs(DEFAULT_DATA, { ...receiveInput, count: NaN })
    expect(nan.batchId).toBeNull()
    expect(nan.data).toBe(DEFAULT_DATA)
    const infinity = addBatchWithDogs(DEFAULT_DATA, { ...receiveInput, count: Infinity })
    expect(infinity.batchId).toBeNull()
    expect(infinity.data).toBe(DEFAULT_DATA)
  })

  it('只数带小数时向下取整，不建出半只狗', () => {
    const result = addBatchWithDogs(DEFAULT_DATA, { ...receiveInput, count: 2.7 })
    expect(result.data.dogs).toHaveLength(2)
  })

  it('建 1 个批次与只数只狗，狗号形如 批次名-序号（序号从 1 开始）', () => {
    const result = addBatchWithDogs(DEFAULT_DATA, receiveInput)
    expect(result.data.batches).toHaveLength(1)
    expect(createdBatchId(result)).toBe(result.data.batches[0].id)
    expect(result.data.dogs.map(d => d.code)).toEqual([
      '收狗 3 只 09:10-1', '收狗 3 只 09:10-2', '收狗 3 只 09:10-3',
    ])
    expect(result.data.dogs.every(d => d.status === 'in_stock')).toBe(true)
    expect(result.data.dogs.every(d => d.batchId === result.data.batches[0].id)).toBe(true)
    expect(result.data.batches[0].name).toBe('收狗 3 只 09:10')
    expect(result.data.batches[0].date).toBe('2026-10-03')
    expect(result.data.batches[0].status).toBe('active')
  })

  it('source 与 note 逐字存进新批次', () => {
    const result = addBatchWithDogs(DEFAULT_DATA, {
      ...receiveInput, source: '老李家', note: '来自预定单：老李家',
    })
    expect(result.data.batches[0].source).toBe('老李家')
    expect(result.data.batches[0].note).toBe('来自预定单：老李家')
  })

  it('plannedChannel 按传入的渠道落库', () => {
    expect(addBatchWithDogs(DEFAULT_DATA, { ...receiveInput, channel: 'undecided' })
      .data.batches[0].plannedChannel).toBe('undecided')
    expect(addBatchWithDogs(DEFAULT_DATA, { ...receiveInput, channel: 'pet_shop' })
      .data.batches[0].plannedChannel).toBe('pet_shop')
  })

  it('★ 每只狗一笔收购款，从池子直付，amount 逐字等于传入的单价', () => {
    const result = addBatchWithDogs(DEFAULT_DATA, receiveInput)
    const batchId = createdBatchId(result)
    const purchases = result.data.entries.filter(e => e.category === 'purchase')
    expect(purchases).toHaveLength(3)
    for (const entry of purchases) {
      expect(entry.type).toBe('expense')
      expect(entry.amount).toBe(60000)
      expect(entry.paidBy).toBe('pool')
      expect(entry.date).toBe('2026-10-03')
      expect(entry.batchId).toBe(batchId)
    }
    // 三笔流水分别挂在三只**不同**的狗身上
    expect(new Set(purchases.map(e => e.dogId)).size).toBe(3)
    expect(batchTotalCost(result.data, batchId)).toBe(180000)
  })

  it('★ 单价 0 时一笔收购款都不写（不是写 0 元流水）', () => {
    const result = addBatchWithDogs(DEFAULT_DATA, { ...receiveInput, unitPriceFen: 0 })
    expect(result.data.entries).toHaveLength(0)
    expect(batchTotalCost(result.data, createdBatchId(result))).toBe(0)
    expect(result.data.dogs).toHaveLength(3)
  })

  it('★ 只写收购款这一类：运输 / 疫苗 / 检疫 / 处理费一笔都不在这里写', () => {
    const result = addBatchWithDogs(DEFAULT_DATA, { ...receiveInput, count: 8 })
    const expenses = result.data.entries.filter(e => e.type === 'expense')
    expect(expenses).toHaveLength(8)
    expect(expenses.every(e => e.category === 'purchase')).toBe(true)
    // 那四项只是「算」页保本价的输入，收货这一刻一分钱都还没花出去。
    for (const category of ['transport', 'medical', 'quarantine', 'disposal']) {
      expect(result.data.entries.filter(e => e.category === category)).toHaveLength(0)
    }
  })

  it('新买回来的狗检疫台账全部为空，绝不预填今天', () => {
    const result = addBatchWithDogs(DEFAULT_DATA, receiveInput)
    for (const dog of result.data.dogs) {
      expect(dog.rabiesVaccinatedOn).toBeNull()
      expect(dog.antibodyTestedOn).toBeNull()
      expect(dog.antibodyReportNo).toBe('')
      expect(dog.quarantineCertNo).toBe('')
      expect(dog.quarantineCertIssuedOn).toBeNull()
      expect(dog.quarantineCertValidUntil).toBeNull()
    }
  })

  it('不修改传入的 data（纯函数）', () => {
    const before = JSON.stringify(DEFAULT_DATA)
    addBatchWithDogs(DEFAULT_DATA, receiveInput)
    expect(JSON.stringify(DEFAULT_DATA)).toBe(before)
  })

  it('已有批次不被动过，新批次追加在其后', () => {
    const first = addBatchWithDogs(DEFAULT_DATA, { ...receiveInput, name: '一批', count: 3 })
    const firstBatch = first.data.batches[0]
    const second = addBatchWithDogs(first.data, { ...receiveInput, name: '二批', count: 2 })
    expect(second.data.batches[0]).toBe(firstBatch)
    expect(second.data.batches).toHaveLength(2)
    expect(second.data.batches[1].name).toBe('二批')
    expect(second.data.dogs).toHaveLength(5)
  })

  it('新批次的在库保本价 = 已写进去的收购款 ÷ 只数', () => {
    const result = addBatchWithDogs(DEFAULT_DATA, { ...receiveInput, count: 8 })
    expect(formatMoney(floorPriceFen(result.data, createdBatchId(result)))).toBe('¥600')
  })
})

describe('receiveBatch', () => {
  it('建批次与狗、只记收购款，来源与备注都是空串', () => {
    const next = receiveBatch(DEFAULT_DATA, {
      name: '收狗 2 只 14:07', date: '2026-10-03', count: 2, unitPriceFen: 40000, channel: 'pet_shop',
    })
    expect(next.batches).toHaveLength(1)
    expect(next.batches[0].name).toBe('收狗 2 只 14:07')
    expect(next.batches[0].source).toBe('')
    expect(next.batches[0].note).toBe('')
    expect(next.batches[0].plannedChannel).toBe('pet_shop')
    expect(next.dogs.map(d => d.code)).toEqual(['收狗 2 只 14:07-1', '收狗 2 只 14:07-2'])
    expect(next.entries.filter(e => e.category === 'purchase')).toHaveLength(2)
    expect(next.entries.filter(e => e.category !== 'purchase')).toHaveLength(0)
  })

  it('只数 0 时原样返回同一引用，什么都不建', () => {
    const next = receiveBatch(DEFAULT_DATA, {
      name: '空批次', date: '2026-10-03', count: 0, unitPriceFen: 40000, channel: 'undecided',
    })
    expect(next).toBe(DEFAULT_DATA)
  })
})
