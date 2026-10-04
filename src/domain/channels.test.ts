import { describe, it, expect } from 'vitest'
import type { AppData, Batch, ChannelId, Dog, LedgerEntry } from './types'
import { DEFAULT_DATA } from './types'
import { aliveCount, batchPerDogCostFen } from './costing'
import { compareChannels, compareChannelCosts } from './channels'
import type { ChannelInput } from './channels'

function makeBatch(over: Partial<Batch> = {}): Batch {
  return {
    id: 'b1', name: '10月3日一批', date: '2026-10-03', source: '农户', note: '',
    status: 'active', plannedChannel: 'undecided', ...over,
  }
}

function makeDog(id: string, status: Dog['status'], over: Partial<Dog> = {}): Dog {
  return {
    id, batchId: 'b1', code: id, breed: '', sex: 'unknown', ageMonths: null, status, note: '',
    rabiesVaccinatedOn: null, antibodyTestedOn: null, antibodyReportNo: '',
    quarantineCertNo: '', quarantineCertIssuedOn: null, quarantineCertValidUntil: null, ...over,
  }
}

function entry(over: Partial<LedgerEntry>): LedgerEntry {
  return {
    id: `e-${Math.random()}`, date: '2026-10-03', type: 'expense', category: 'purchase',
    amount: 0, paidBy: 'pool', payee: null, batchId: 'b1', dogId: null, note: '', ...over,
  }
}

/**
 * 与 costing.test.ts 同一个 3.6 案例：8 只 × 600 收购 + 400 运输 + 8 × 80 疫苗 = 5840 元，死 2 只。
 * 即批次总成本 584000 分、存活 6 只 —— 每只真实成本 97333.33… 分（带小数）。
 */
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

/** 批次总成本整除掉：2 只存活、总成本 200000 分 → 每只恰好 100000 分，便于断言「等于 0 不算亏」 */
function roundData(): AppData {
  const dogs = [makeDog('d1', 'in_stock'), makeDog('d2', 'in_stock')]
  const entries = [
    entry({ category: 'purchase', amount: 100000, dogId: 'd1' }),
    entry({ category: 'purchase', amount: 100000, dogId: 'd2' }),
  ]
  return { ...DEFAULT_DATA, batches: [makeBatch()], dogs, entries }
}

function input(channelId: ChannelId, over: Partial<Omit<ChannelInput, 'channelId'>> = {}): ChannelInput {
  return { channelId, unitPriceFen: 0, extraPerDogFen: 0, fixedCostFen: 0, ...over }
}

/**
 * 渠道清单将来会变：真实数据是从 localStorage 反序列化回来的，运行期 channelId 可能是任意字符串。
 * 这里用 JSON.parse 造出那种数据 —— 而不是用 `as ChannelId` 把一个假渠道硬塞进类型里。
 */
function runtimeInputs(json: string): ChannelInput[] {
  return JSON.parse(json)
}

describe('compareChannels —— 与决策台共用摊薄算法', () => {
  it('undecided 且两个成本都是 0 时，保本价精确等于 batchPerDogCostFen', () => {
    const data = scenarioData()
    const [row] = compareChannels(data, 'b1', [input('undecided')])
    expect(row.basePerDogCostFen).toBe(batchPerDogCostFen(data, 'b1'))
    expect(row.breakEvenUnitPriceFen).toBe(batchPerDogCostFen(data, 'b1'))
    expect(row.breakEvenUnitPriceFen).toBeCloseTo(584000 / 6, 6)
  })

  it('basePerDogCostFen 就是批次摊薄成本，与存活数一致', () => {
    const data = scenarioData()
    const [row] = compareChannels(data, 'b1', [input('undecided')])
    expect(aliveCount(data, 'b1')).toBe(6)
    expect(row.basePerDogCostFen).toBeCloseTo(584000 / aliveCount(data, 'b1'), 6)
  })

  it('name 取自 SALES_CHANNELS', () => {
    const data = scenarioData()
    const rows = compareChannels(data, 'b1', [input('undecided'), input('pet_shop')])
    expect(rows[0].name).toBe('未定')
    expect(rows[1].name).toBe('宠物店 / 宠物医院')
  })

  it('channelId 原样带回去', () => {
    const data = scenarioData()
    const rows = compareChannels(data, 'b1', [input('meat'), input('individual')])
    expect(rows.map(r => r.channelId)).toEqual(['meat', 'individual'])
  })
})

describe('compareChannels —— 保本价与利润', () => {
  it('保本价 = base + extra + fixedPerDog', () => {
    const data = scenarioData()
    const [row] = compareChannels(data, 'b1', [input('ecommerce', { extraPerDogFen: 5000, fixedCostFen: 30000 })])
    expect(row.extraPerDogFen).toBe(5000)
    expect(row.fixedPerDogFen).toBeCloseTo(30000 / 6, 6)
    expect(row.breakEvenUnitPriceFen).toBeCloseTo(584000 / 6 + 5000 + 30000 / 6, 6)
  })

  it('fixedCostFen 摊到存活数上：fixedPerDogFen === fixedCostFen / alive', () => {
    const data = scenarioData()
    const alive = aliveCount(data, 'b1')
    const [row] = compareChannels(data, 'b1', [input('dog_market', { fixedCostFen: 10000 })])
    expect(alive).toBe(6)
    expect(row.fixedPerDogFen).toBe(10000 / alive)
  })

  it('允许小数分，不在这里四舍五入', () => {
    const data = scenarioData()
    const [row] = compareChannels(data, 'b1', [input('dog_market', { fixedCostFen: 10000 })])
    expect(row.fixedPerDogFen).toBeCloseTo(10000 / 6, 10)
    expect(Number.isInteger(row.fixedPerDogFen)).toBe(false)
    expect(row.breakEvenUnitPriceFen).toBeCloseTo(584000 / 6 + 10000 / 6, 6)
  })

  it('同一 unitPriceFen 下，一条赚一条亏', () => {
    const data = scenarioData()
    const rows = compareChannels(data, 'b1', [
      input('individual', { unitPriceFen: 100000 }),
      input('ecommerce', { unitPriceFen: 100000, extraPerDogFen: 2000, fixedCostFen: 12000 }),
    ])
    const [cheap, pricey] = rows
    expect(cheap.perDogProfitFen).toBeCloseTo(100000 - 584000 / 6, 6)
    expect(cheap.perDogProfitFen).toBeGreaterThan(0)
    expect(cheap.isLoss).toBe(false)
    expect(pricey.perDogProfitFen).toBeCloseTo(100000 - (584000 / 6 + 2000 + 12000 / 6), 6)
    expect(pricey.perDogProfitFen).toBeLessThan(0)
    expect(pricey.isLoss).toBe(true)
  })

  it('perDogProfitFen = unitPriceFen - breakEvenUnitPriceFen', () => {
    const data = scenarioData()
    const [row] = compareChannels(data, 'b1', [
      input('kennel', { unitPriceFen: 150000, extraPerDogFen: 1000, fixedCostFen: 6000 }),
    ])
    expect(row.breakEvenUnitPriceFen).toBeCloseTo(584000 / 6 + 1000 + 6000 / 6, 6)
    expect(row.perDogProfitFen).toBeCloseTo(150000 - row.breakEvenUnitPriceFen, 6)
    expect(row.isLoss).toBe(row.perDogProfitFen < 0)
  })

  it('利润恰好等于 0 不算亏', () => {
    const data = roundData()
    const [row] = compareChannels(data, 'b1', [input('middleman', { unitPriceFen: 100000 })])
    expect(row.perDogProfitFen).toBe(0)
    expect(row.isLoss).toBe(false)
  })
})

describe('compareChannels —— 边界', () => {
  it('整批死光：不除零、不抛错，fixedPerDogFen 与 base 都是 0', () => {
    const data = scenarioData()
    data.dogs.forEach(d => { d.status = 'dead' })
    expect(aliveCount(data, 'b1')).toBe(0)
    const [row] = compareChannels(data, 'b1', [
      input('rural_fair', { unitPriceFen: 50000, extraPerDogFen: 200, fixedCostFen: 30000 }),
    ])
    expect(row.fixedPerDogFen).toBe(0)
    expect(row.basePerDogCostFen).toBe(0)
    expect(row.breakEvenUnitPriceFen).toBe(200)
    expect(row.perDogProfitFen).toBe(50000 - 200)
    expect(row.isLoss).toBe(false)
  })

  it('批次一只狗都没有：同样不除零', () => {
    const data = { ...DEFAULT_DATA, batches: [makeBatch()] }
    const [row] = compareChannels(data, 'b1', [input('undecided', { fixedCostFen: 99999 })])
    expect(row.basePerDogCostFen).toBe(0)
    expect(row.fixedPerDogFen).toBe(0)
    expect(row.breakEvenUnitPriceFen).toBe(0)
  })

  it('返回顺序与 inputs 一致，不排序', () => {
    const data = scenarioData()
    const wanted: ChannelId[] = ['meat', 'undecided', 'ecommerce', 'pet_shop', 'kennel']
    const rows = compareChannels(data, 'b1', wanted.map(id => input(id)))
    expect(rows.map(r => r.channelId)).toEqual(wanted)
  })

  it('空 inputs 返回空数组', () => {
    expect(compareChannels(scenarioData(), 'b1', [])).toEqual([])
  })

  it('未知 channelId 回落为字符串本身，不抛错', () => {
    const data = scenarioData()
    const rows = compareChannels(data, 'b1', runtimeInputs(
      '[{"channelId":"taobao_live","unitPriceFen":120000,"extraPerDogFen":3000,"fixedCostFen":0}]',
    ))
    expect(rows).toHaveLength(1)
    expect(rows[0].channelId).toBe('taobao_live')
    expect(rows[0].name).toBe('taobao_live')
    expect(rows[0].breakEvenUnitPriceFen).toBeCloseTo(584000 / 6 + 3000, 6)
  })
})

describe('compareChannelCosts —— 包装层与核心同参同结果', () => {
  it('compareChannels 就是「从账本取数 + compareChannelCosts」，结果深度相等', () => {
    const data = scenarioData()
    const inputs = [
      input('undecided', { unitPriceFen: 100000 }),
      input('ecommerce', { unitPriceFen: 100000, extraPerDogFen: 2000, fixedCostFen: 12000 }),
      input('dog_market', { unitPriceFen: 90000, fixedCostFen: 5000 }),
    ]
    expect(compareChannels(data, 'b1', inputs)).toEqual(
      compareChannelCosts(batchPerDogCostFen(data, 'b1'), aliveCount(data, 'b1'), inputs),
    )
  })

  it('整批死光时包装层与核心也一致（两条路都是 base 0）', () => {
    const data = scenarioData()
    data.dogs.forEach(d => { d.status = 'dead' })
    const inputs = [input('rural_fair', { unitPriceFen: 50000, fixedCostFen: 30000 })]
    expect(compareChannels(data, 'b1', inputs)).toEqual(compareChannelCosts(0, 0, inputs))
  })
})

describe('compareChannelCosts —— 核心的边界', () => {
  it('basePerDogCostFen 原样透传，不乘不除也不取整', () => {
    const [row] = compareChannelCosts(12345.678, 3.5, [input('undecided')])
    expect(row.basePerDogCostFen).toBe(12345.678)
    expect(row.breakEvenUnitPriceFen).toBe(12345.678)
  })

  it('底价原样透传：固定成本另摊，不参与底价的缩放', () => {
    const [row] = compareChannelCosts(12345.678, 3.5, [input('dog_market', { fixedCostFen: 7000 })])
    expect(row.fixedPerDogFen).toBe(7000 / 3.5)
    expect(row.breakEvenUnitPriceFen).toBe(12345.678 + 2000)
  })

  it('aliveDogCount 允许小数（plan() 的 expectedAlive 就是小数），不取整', () => {
    const [row] = compareChannelCosts(0, 3.5, [input('dog_market', { fixedCostFen: 10000 })])
    expect(row.fixedPerDogFen).toBe(10000 / 3.5)
    expect(row.fixedPerDogFen).toBeCloseTo(2857.142857142857, 6)
  })

  it('aliveDogCount === 0：不除零、不抛错，保本价 = 底价 + extra', () => {
    const rows = compareChannelCosts(88888.5, 0, [
      input('meat', { unitPriceFen: 90000, extraPerDogFen: 300, fixedCostFen: 99999 }),
      input('undecided'),
    ])
    expect(rows[0].fixedPerDogFen).toBe(0)
    expect(rows[0].breakEvenUnitPriceFen).toBe(88888.5 + 300)
    expect(rows[0].perDogProfitFen).toBe(90000 - (88888.5 + 300))
    expect(rows[0].isLoss).toBe(false)
    expect(rows[1].breakEvenUnitPriceFen).toBe(88888.5)
  })

  it('顺序与 inputs 一致、未知 channelId 回落为字符串，都在核心层', () => {
    const rows = compareChannelCosts(1000, 2, runtimeInputs(
      '[{"channelId":"taobao_live","unitPriceFen":1500,"extraPerDogFen":0,"fixedCostFen":0},'
      + '{"channelId":"pet_shop","unitPriceFen":1500,"extraPerDogFen":0,"fixedCostFen":0}]',
    ))
    expect(rows.map(r => r.channelId)).toEqual(['taobao_live', 'pet_shop'])
    expect(rows[0].name).toBe('taobao_live')
    expect(rows[1].name).toBe('宠物店 / 宠物医院')
  })
})
