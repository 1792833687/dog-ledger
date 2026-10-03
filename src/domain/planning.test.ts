import { describe, it, expect } from 'vitest'
import { DEFAULT_DATA, DEFAULT_SETTINGS } from './types'
import { plan, createBatchFromPlan, type PlanInput } from './planning'
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

describe('createBatchFromPlan', () => {
  it('按计划创建批次、N 只狗、以及运输与每只狗的收购+疫苗支出', () => {
    const next = createBatchFromPlan(DEFAULT_DATA, input, '10月3日一批', '2026-10-03')
    expect(next.batches).toHaveLength(1)
    expect(next.dogs).toHaveLength(8)
    const batchId = next.batches[0].id
    expect(batchTotalCost(next, batchId)).toBe(584000)
    // 1 笔运输 + 8 笔收购 + 8 笔疫苗
    expect(next.entries.filter(e => e.type === 'expense')).toHaveLength(17)
  })

  it('检疫费按每只狗记一笔支出，且在建批次时就记上', () => {
    const next = createBatchFromPlan(
      DEFAULT_DATA, { ...input, quarantinePerDog: 5000 }, '10月3日一批', '2026-10-03',
    )
    const batchId = next.batches[0].id
    // 原来的 5840 元 + 8 只 × 50 元
    expect(batchTotalCost(next, batchId)).toBe(584000 + 8 * 5000)
    expect(next.entries.filter(e => e.type === 'expense' && e.category === 'quarantine')).toHaveLength(8)
    // 无害化处理费是「预估会死几只」的假设，不是已发生的支出，所以建批次时一笔都不记
    expect(next.entries.filter(e => e.type === 'expense' && e.category === 'disposal')).toHaveLength(0)
  })

  it('每只狗的编号形如 批次名-序号，且初始状态为在库', () => {
    const next = createBatchFromPlan(DEFAULT_DATA, input, '10月3日一批', '2026-10-03')
    expect(next.dogs[0].code).toBe('10月3日一批-1')
    expect(next.dogs.every(d => d.status === 'in_stock')).toBe(true)
    expect(next.dogs.every(d => d.batchId === next.batches[0].id)).toBe(true)
  })

  it('新批次的在库保本价 = 总成本 ÷ 只数（此时还没死，所以低于决策台的保本价）', () => {
    const next = createBatchFromPlan(DEFAULT_DATA, input, '10月3日一批', '2026-10-03')
    const s = batchSummary(next, next.batches[0].id)
    expect(formatMoney(s.floorPriceFen!)).toBe('¥730')
  })

  it('不修改传入的 data（纯函数）', () => {
    const before = JSON.stringify(DEFAULT_DATA)
    createBatchFromPlan(DEFAULT_DATA, input, 'X', '2026-10-03')
    expect(JSON.stringify(DEFAULT_DATA)).toBe(before)
  })

  it('新批次的 plan 去向默认为 undecided', () => {
    const next = createBatchFromPlan(DEFAULT_DATA, input, '10月3日一批', '2026-10-03')
    expect(next.batches[0].plannedChannel).toBe('undecided')
  })

  it('传入 plan 去向时按传入值落库', () => {
    const next = createBatchFromPlan(DEFAULT_DATA, input, '10月3日一批', '2026-10-03', 'pet_shop')
    expect(next.batches[0].plannedChannel).toBe('pet_shop')
  })

  it('新买回来的狗检疫台账全部为空，绝不预填今天', () => {
    const next = createBatchFromPlan(DEFAULT_DATA, input, '10月3日一批', '2026-10-03')
    for (const d of next.dogs) {
      expect(d.rabiesVaccinatedOn).toBeNull()
      expect(d.antibodyTestedOn).toBeNull()
      expect(d.antibodyReportNo).toBe('')
      expect(d.quarantineCertNo).toBe('')
      expect(d.quarantineCertIssuedOn).toBeNull()
      expect(d.quarantineCertValidUntil).toBeNull()
    }
  })

  it('已建好的批次不被动过，新批次追加在其后', () => {
    const first = createBatchFromPlan(DEFAULT_DATA, input, '一批', '2026-10-03')
    const firstBatch = first.batches[0]
    const second = createBatchFromPlan(first, { ...input, n: 2 }, '二批', '2026-10-05')
    expect(second.batches[0]).toBe(firstBatch)
    expect(second.batches).toHaveLength(2)
    expect(second.batches[1].name).toBe('二批')
    expect(second.dogs).toHaveLength(10)
  })

  it('运输费为 0 时不记运输支出', () => {
    const next = createBatchFromPlan(DEFAULT_DATA, { ...input, freight: 0 }, '10月3日一批', '2026-10-03')
    expect(next.entries.filter(e => e.category === 'transport')).toHaveLength(0)
    expect(batchTotalCost(next, next.batches[0].id)).toBe(544000)
  })

  it('只数 0 时建出一个没有狗的空批次', () => {
    const next = createBatchFromPlan(DEFAULT_DATA, { ...input, n: 0 }, '空批次', '2026-10-03')
    expect(next.batches).toHaveLength(1)
    expect(next.dogs).toHaveLength(0)
    expect(next.entries.filter(e => e.type === 'expense')).toHaveLength(1)  // 只有运输
  })
})
