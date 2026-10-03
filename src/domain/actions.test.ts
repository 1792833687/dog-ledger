import { describe, it, expect } from 'vitest'
import { DEFAULT_DATA } from './types'
import { setDogStatus, sellDog, markDogDead, addExpense, createBatch } from './actions'
import { batchSummary, dogIncome, dogOwnCost, batchTotalCost, dogProfitFen } from './costing'

/** 建一个批次，并记一笔运输费 */
function seed() {
  const data = createBatch(DEFAULT_DATA, '一批', '2026-10-03')
  const batchId = data.batches[0].id
  return addExpense(data, {
    batchId, dogId: null, category: 'transport',
    amount: 40000, paidBy: 'pool', date: '2026-10-03', note: '',
  })
}

/** 建一批 3 只狗、每只 600 + 80，用于售出/死亡测试 */
function sellSeed() {
  let data = createBatch(DEFAULT_DATA, '测试批', '2026-10-03')
  const batchId = data.batches[0].id
  for (let i = 1; i <= 3; i++) {
    const dogId = `d${i}`
    data = {
      ...data,
      dogs: [...data.dogs, {
        id: dogId, batchId, code: `${i}`, breed: '', sex: 'unknown',
        ageMonths: null, status: 'in_stock', note: '',
        // 刚买回来的狗：没接种、没检测、没证明（修订二新增的 6 个必填字段）
        rabiesVaccinatedOn: null, antibodyTestedOn: null,
        antibodyReportNo: '', quarantineCertNo: '',
        quarantineCertIssuedOn: null, quarantineCertValidUntil: null,
      }],
    }
    data = addExpense(data, { batchId, dogId, category: 'purchase', amount: 60000, paidBy: 'pool', date: '2026-10-03', note: '' })
    data = addExpense(data, { batchId, dogId, category: 'medical', amount: 8000, paidBy: 'pool', date: '2026-10-03', note: '' })
  }
  return data
}

describe('createBatch', () => {
  it('新增一个批次', () => {
    const data = createBatch(DEFAULT_DATA, '一批', '2026-10-03')
    expect(data.batches).toHaveLength(1)
    expect(data.batches[0].name).toBe('一批')
  })

  it('不修改原数据', () => {
    createBatch(DEFAULT_DATA, '一批', '2026-10-03')
    expect(DEFAULT_DATA.batches).toHaveLength(0)
  })

  it('新建批次时去向是「未定」，不替用户猜一条渠道', () => {
    const data = createBatch(DEFAULT_DATA, '一批', '2026-10-03')
    expect(data.batches[0].plannedChannel).toBe('undecided')
  })

  it('批次上记着传入的日期与 active 状态', () => {
    const data = createBatch(DEFAULT_DATA, '一批', '2026-10-03')
    expect(data.batches[0].date).toBe('2026-10-03')
    expect(data.batches[0].status).toBe('active')
  })

  it('已有批次时追加而不是替换', () => {
    const once = createBatch(DEFAULT_DATA, '一批', '2026-10-03')
    const twice = createBatch(once, '二批', '2026-10-04')
    expect(twice.batches.map(b => b.name)).toEqual(['一批', '二批'])
  })
})

describe('addExpense', () => {
  it('写入一笔支出，同时带 batchId 与 dogId', () => {
    const data = seed()
    const batchId = data.batches[0].id
    const next = addExpense(data, { batchId, dogId: null, category: 'purchase', amount: 60000, paidBy: 'pool', date: '2026-10-03', note: '' })
    expect(batchTotalCost(next, batchId)).toBe(100000)
  })

  it('可以记成某人垫付', () => {
    const data = seed()
    const batchId = data.batches[0].id
    const next = addExpense(data, { batchId, dogId: null, category: 'purchase', amount: 60000, paidBy: 'p1', date: '2026-10-03', note: '' })
    expect(next.entries.some(e => e.paidBy === 'p1')).toBe(true)
  })

  it('金额取整到分', () => {
    const data = seed()
    const next = addExpense(data, { batchId: null, dogId: null, category: 'medical', amount: 1234.6, paidBy: 'pool', date: '2026-10-03', note: '' })
    expect(next.entries[next.entries.length - 1].amount).toBe(1235)
  })

  it('负数金额被夹到 0，不会记出一笔负支出', () => {
    const data = seed()
    const next = addExpense(data, { batchId: null, dogId: null, category: 'medical', amount: -5000, paidBy: 'pool', date: '2026-10-03', note: '' })
    expect(next.entries[next.entries.length - 1].amount).toBe(0)
  })

  it('写进去的是 type: expense 且保留 category / date / note', () => {
    const data = seed()
    const next = addExpense(data, { batchId: null, dogId: null, category: 'disposal', amount: 3000, paidBy: 'pool', date: '2026-10-07', note: '埋了两只' })
    const entry = next.entries[next.entries.length - 1]
    expect(entry.type).toBe('expense')
    expect(entry.category).toBe('disposal')
    expect(entry.date).toBe('2026-10-07')
    expect(entry.note).toBe('埋了两只')
  })

  it('挂在单只狗上的支出会计入该狗的直接成本', () => {
    const data = sellSeed()
    const dogId = data.dogs[0].id
    const next = addExpense(data, { batchId: data.batches[0].id, dogId, category: 'disposal', amount: 2000, paidBy: 'pool', date: '2026-10-04', note: '' })
    expect(dogOwnCost(next, dogId)).toBe(60000 + 8000 + 2000)
  })

  it('不修改原数据', () => {
    const data = seed()
    const before = data.entries.length
    addExpense(data, { batchId: null, dogId: null, category: 'medical', amount: 100, paidBy: 'pool', date: '2026-10-03', note: '' })
    expect(data.entries).toHaveLength(before)
  })
})

describe('setDogStatus / markDogDead', () => {
  it('死亡会把状态改成 dead', () => {
    const data = sellSeed()
    const dogId = data.dogs[0].id
    const next = markDogDead(data, dogId)
    expect(next.dogs.find(d => d.id === dogId)!.status).toBe('dead')
  })

  it('死亡只影响那一只，其余狗不动', () => {
    const data = sellSeed()
    const next = markDogDead(data, data.dogs[0].id)
    expect(next.dogs.find(d => d.id === data.dogs[1].id)!.status).toBe('in_stock')
  })

  it('setDogStatus 可以改回在库（退狗）', () => {
    const data = sellSeed()
    const dogId = data.dogs[0].id
    const sold = sellDog(data, dogId, 120000, '2026-10-05')
    const back = setDogStatus(sold, dogId, 'returned')
    expect(back.dogs.find(d => d.id === dogId)!.status).toBe('returned')
  })

  it('setDogStatus 找不到这只狗时原样返回', () => {
    const data = sellSeed()
    const next = setDogStatus(data, '没有这只', 'dead')
    expect(next.dogs.map(d => d.status)).toEqual(data.dogs.map(d => d.status))
  })

  it('setDogStatus 不修改原数据', () => {
    const data = sellSeed()
    const original = data.dogs[0]
    setDogStatus(data, original.id, 'dead')
    expect(original.status).toBe('in_stock')
    expect(data.dogs[0].status).toBe('in_stock')
  })
})

describe('sellDog', () => {
  it('把狗标为已售，并写入一笔收入', () => {
    const data = sellSeed()
    const dogId = data.dogs[0].id
    const next = sellDog(data, dogId, 120000, '2026-10-05')
    expect(next.dogs.find(d => d.id === dogId)!.status).toBe('sold')
    expect(dogIncome(next, dogId)).toBe(120000)
  })

  it('收入流水同时挂上批次，才能进批次收入', () => {
    const data = sellSeed()
    const batchId = data.batches[0].id
    const next = sellDog(data, data.dogs[0].id, 120000, '2026-10-05')
    expect(batchSummary(next, batchId).income).toBe(120000)
  })

  it('写的是 type: income、category: sale，同时挂 batchId 与 dogId', () => {
    const data = sellSeed()
    const dog = data.dogs[0]
    const next = sellDog(data, dog.id, 120000, '2026-10-05')
    const entry = next.entries[next.entries.length - 1]
    expect(entry.type).toBe('income')
    expect(entry.category).toBe('sale')
    expect(entry.batchId).toBe(dog.batchId)
    expect(entry.dogId).toBe(dog.id)
    expect(entry.date).toBe('2026-10-05')
  })

  it('重复对同一只狗收款不会累加（已售则忽略）', () => {
    const data = sellSeed()
    const dogId = data.dogs[0].id
    const once = sellDog(data, dogId, 120000, '2026-10-05')
    const twice = sellDog(once, dogId, 120000, '2026-10-06')
    expect(dogIncome(twice, dogId)).toBe(120000)
  })

  it('对不存在的狗原样返回，不写进一笔无主的收入', () => {
    const data = sellSeed()
    const next = sellDog(data, '没有这只', 120000, '2026-10-05')
    expect(next).toBe(data)
    expect(next.entries).toHaveLength(data.entries.length)
  })

  it('售价取整、负数被夹到 0', () => {
    const data = sellSeed()
    const next = sellDog(data, data.dogs[0].id, -1, '2026-10-05')
    expect(dogIncome(next, next.dogs[0].id)).toBe(0)
    const rounded = sellDog(data, data.dogs[1].id, 999.6, '2026-10-05')
    expect(dogIncome(rounded, data.dogs[1].id)).toBe(1000)
  })

  it('不修改原数据', () => {
    const data = sellSeed()
    const entriesBefore = data.entries.length
    sellDog(data, data.dogs[0].id, 120000, '2026-10-05')
    expect(data.dogs[0].status).toBe('in_stock')
    expect(data.entries).toHaveLength(entriesBefore)
  })

  it('卖出后该狗摊薄成本不变、盈亏变成「售价 - 摊薄成本」', () => {
    const data = sellSeed()
    const dogId = data.dogs[0].id
    const before = dogProfitFen(data, dogId)
    const next = sellDog(data, dogId, 120000, '2026-10-05')
    // 3 只都在，摊薄成本 = 批次总成本 / 3 = (3*68000) / 3 = 68000
    expect(before).toBe(-68000)
    expect(dogProfitFen(next, dogId)).toBe(120000 - 68000)
  })
})
