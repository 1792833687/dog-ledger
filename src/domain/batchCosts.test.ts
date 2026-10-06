import { describe, it, expect } from 'vitest'
import { DEFAULT_DATA } from './types'
import type { AppData, Dog, DogStatus, LedgerEntry } from './types'
import { addBatchCosts, previewBatchCosts, batchCostsIncomplete } from './batchCosts'
import { batchTotalCost } from './costing'
import { addBatchWithDogs } from './planning'

const BATCH_ID = 'b1'

/** 取数组里第 `index` 个元素。越界就让测试炸掉，好过用 `!` 静音。 */
function at<T>(items: T[], index: number): T {
  const found = items[index]
  if (found === undefined) throw new Error(`第 ${index} 个元素不存在`)
  return found
}

function byCategory(entries: LedgerEntry[], category: string): LedgerEntry[] {
  return entries.filter(e => e.category === category)
}

/** 造一只狗。六个检疫字段一律留空：补账表不碰它们。 */
function makeDog(id: string, status: DogStatus): Dog {
  return {
    id, batchId: BATCH_ID, code: `一批-${id}`, breed: '', sex: 'unknown', ageMonths: null,
    status, note: '',
    rabiesVaccinatedOn: null, antibodyTestedOn: null, antibodyReportNo: '',
    quarantineCertNo: '', quarantineCertIssuedOn: null, quarantineCertValidUntil: null,
  }
}

/**
 * 一个批次 + 八只狗：2 只死、4 只在库、1 只已卖、1 只退回。
 * 另有一笔收货时记下的收购款（Task 24 的入口）。
 */
function seedEightDogs(): AppData {
  return {
    ...DEFAULT_DATA,
    batches: [{
      id: BATCH_ID, name: '一批', date: '2026-10-03', source: '', note: '',
      status: 'active', plannedChannel: 'undecided',
    }],
    dogs: [
      makeDog('d1', 'dead'), makeDog('d2', 'dead'),
      makeDog('d3', 'in_stock'), makeDog('d4', 'in_stock'),
      makeDog('d5', 'in_stock'), makeDog('d6', 'in_stock'),
      makeDog('d7', 'sold'), makeDog('d8', 'returned'),
    ],
    entries: [{
      id: 'e-purchase', date: '2026-10-03', type: 'expense', category: 'purchase', amount: 60000,
      paidBy: 'pool', payee: null, batchId: BATCH_ID, dogId: 'd1', note: '',
    }],
  }
}

/** 补账的默认入参。类型直接取自函数签名，签名加字段时这里会跟着报错。 */
const costs: Parameters<typeof addBatchCosts>[1] = {
  batchId: BATCH_ID,
  date: '2026-10-10',
  transportFen: 40000,      // 整批 ¥400
  medicalPerDogFen: 8000,   // 每只 ¥80
  quarantinePerDogFen: 5000, // 每只 ¥50
  disposalPerDogFen: 20000, // 每只病死犬 ¥200
}

/** 这次调用新增的流水（把收货那笔收购款排除掉）。 */
function addedBy(next: AppData, before: AppData): LedgerEntry[] {
  const known = new Set(before.entries.map(e => e.id))
  return next.entries.filter(e => !known.has(e.id))
}

/** 收货建一批 8 只狗，此时账上只有收购款（Task 24 的入口，用来承担旧的「17 笔」口径）。 */
function receivedEightDogs(): { data: AppData; batchId: string } {
  const result = addBatchWithDogs(DEFAULT_DATA, {
    name: '收狗 8 只 09:10', date: '2026-10-03', count: 8,
    unitPriceFen: 60000, channel: 'undecided', source: '', note: '',
  })
  if (result.batchId === null) throw new Error('收货没有建出批次')
  return { data: result.data, batchId: result.batchId }
}

describe('addBatchCosts', () => {
  it('★ 8 只狗 2 只死：四类一共 19 笔，逐类都要数对', () => {
    const before = seedEightDogs()
    const next = addBatchCosts(before, costs)
    const added = addedBy(next, before)
    // 只数总数是不够的：「medical 8 + quarantine 8 + 别的 3」也能凑出 19
    expect(byCategory(added, 'transport')).toHaveLength(1)
    expect(byCategory(added, 'medical')).toHaveLength(8)
    expect(byCategory(added, 'quarantine')).toHaveLength(8)
    expect(byCategory(added, 'disposal')).toHaveLength(2)
    expect(added).toHaveLength(19)
  })

  it('每一类流水的字段都照约定写：expense / 池子直付 / 批号 / 传入日期 / 空备注', () => {
    const before = seedEightDogs()
    const next = addBatchCosts(before, costs)
    const transport = at(byCategory(addedBy(next, before), 'transport'), 0)
    expect(transport).toMatchObject({
      type: 'expense', category: 'transport', amount: 40000, paidBy: 'pool', payee: null,
      batchId: BATCH_ID, dogId: null, date: '2026-10-10', note: '',
    })
    // 只有运输挂整批，其余三类都挂到具体的狗上
    for (const category of ['medical', 'quarantine', 'disposal']) {
      for (const entry of byCategory(addedBy(next, before), category)) {
        expect(entry.dogId).not.toBeNull()
        expect(entry.type).toBe('expense')
        expect(entry.batchId).toBe(BATCH_ID)
        expect(entry.date).toBe('2026-10-10')
        expect(entry.note).toBe('')
      }
    }
  })

  it('medical 与 quarantine 覆盖这一批的全部狗：卖掉的与退回的照样各一笔', () => {
    const before = seedEightDogs()
    const next = addBatchCosts(before, {
      ...costs, transportFen: 0, disposalPerDogFen: 0,
    })
    const added = addedBy(next, before)
    // d7 已卖、d8 已退回，它们也打过疫苗 —— 这是用户口径，不过滤状态
    expect(byCategory(added, 'medical').map(e => e.dogId).sort())
      .toEqual(['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8'])
    expect(byCategory(added, 'quarantine')).toHaveLength(8)
    expect(added).toHaveLength(16)
  })

  it('disposal 只算点击那一刻已标死亡的狗：只有 2 笔，不是 8 笔', () => {
    const before = seedEightDogs()
    const next = addBatchCosts(before, {
      ...costs, transportFen: 0, medicalPerDogFen: 0, quarantinePerDogFen: 0,
    })
    const disposal = byCategory(addedBy(next, before), 'disposal')
    expect(disposal).toHaveLength(2)
    expect(disposal.map(e => e.dogId).sort()).toEqual(['d1', 'd2'])
  })

  it('★ disposal 按点击那一刻取快照，不自动追溯：后来死的那只要自己再补一次', () => {
    const before = seedEightDogs()
    const onlyDisposal = { ...costs, transportFen: 0, medicalPerDogFen: 0, quarantinePerDogFen: 0 }
    const first = addBatchCosts(before, onlyDisposal)
    const firstDisposal = byCategory(addedBy(first, before), 'disposal')
    expect(firstDisposal).toHaveLength(2)

    // 补完账之后又死了一只（在库的 d3）
    const marked: AppData = {
      ...first,
      dogs: first.dogs.map((d): Dog => (d.id === 'd3' ? { ...d, status: 'dead' } : d)),
    }
    const second = addBatchCosts(marked, onlyDisposal)
    const added = byCategory(addedBy(second, marked), 'disposal')
    // 按「点击那一刻」的 3 只死亡犬各记一笔。函数不会去翻旧账补一只，
    // 它就是把当前这一刻整个算一遍 —— 死了一只就必须自己回来再补一次。
    expect(added).toHaveLength(3)
    expect(added.map(e => e.dogId).sort()).toEqual(['d1', 'd2', 'd3'])
    // 已有的那两笔一个字都没动，连引用都没换
    expect(at(byCategory(second.entries, 'disposal'), 0)).toBe(at(firstDisposal, 0))
    expect(at(byCategory(second.entries, 'disposal'), 1)).toBe(at(firstDisposal, 1))
  })

  it('★ 同一张表连点两次会记两遍 —— 设计 §3.10 明写这是刻意的，不是 bug', () => {
    // 「只新增不替换」的代价就是它没有幂等性。这条测试是那个代价的说明书：
    // 如果哪天有人为了「防重复」给它加上按项目替换或去重，这条会红，那时要回去读设计 D14。
    const before = seedEightDogs()
    const once = addBatchCosts(before, costs)
    const twice = addBatchCosts(once, costs)
    expect(addedBy(twice, once)).toHaveLength(19)
    expect(byCategory(addedBy(twice, once), 'transport')).toHaveLength(1)
    expect(byCategory(addedBy(twice, once), 'medical')).toHaveLength(8)
    expect(twice.entries).toHaveLength(1 + 19 + 19)
  })

  it('只填运输时只新增 1 笔', () => {
    const before = seedEightDogs()
    const next = addBatchCosts(before, {
      ...costs, medicalPerDogFen: 0, quarantinePerDogFen: 0, disposalPerDogFen: 0,
    })
    expect(addedBy(next, before)).toHaveLength(1)
  })

  it('四行全 0 时一笔都不新增，原样返回同一引用', () => {
    const before = seedEightDogs()
    const next = addBatchCosts(before, {
      ...costs, transportFen: 0, medicalPerDogFen: 0, quarantinePerDogFen: 0, disposalPerDogFen: 0,
    })
    expect(next).toBe(before)
    expect(next.entries).toHaveLength(1)
  })

  it('负数、NaN 与 Infinity 都静默地什么都不产生（NaN 绝不溜进金额里）', () => {
    const before = seedEightDogs()
    const next = addBatchCosts(before, {
      ...costs, transportFen: -1, medicalPerDogFen: NaN,
      quarantinePerDogFen: Infinity, disposalPerDogFen: -0.5,
    })
    expect(next).toBe(before)
    expect(next.entries.every(e => Number.isFinite(e.amount))).toBe(true)
  })

  it('金额先取整再落库（0.6 分记成 1 分，0.4 分则什么都不产生）', () => {
    const before = seedEightDogs()
    const next = addBatchCosts(before, {
      ...costs, transportFen: 0.6, medicalPerDogFen: 0.4,
      quarantinePerDogFen: 0, disposalPerDogFen: 0,
    })
    const added = addedBy(next, before)
    expect(added).toHaveLength(1)
    expect(at(added, 0).amount).toBe(1)
  })

  it('★ 只新增不替换：先手记的自定义支出与手记运输逐字还在，原有条目连引用都不换', () => {
    const before = seedEightDogs()
    const manual: LedgerEntry[] = [
      {
        id: 'e-dogfood', date: '2026-10-05', type: 'expense', category: 'dogfood', amount: 12000,
        paidBy: 'pool', payee: null, batchId: BATCH_ID, dogId: null, note: '用户自己记的狗粮',
      },
      {
        id: 'e-manual-transport', date: '2026-10-04', type: 'expense', category: 'transport',
        amount: 3000, paidBy: 'p1', payee: null, batchId: BATCH_ID, dogId: null, note: '自己开的车',
      },
    ]
    const data: AppData = { ...before, entries: [...before.entries, ...manual] }

    const next = addBatchCosts(data, costs)
    expect(next.entries).toHaveLength(data.entries.length + 19)
    // 原有三笔在同样的位置上、连引用都没换
    expect(at(next.entries, 0)).toBe(at(data.entries, 0))
    expect(at(next.entries, 1)).toBe(at(data.entries, 1))
    expect(at(next.entries, 2)).toBe(at(data.entries, 2))
    expect(next.entries.find(e => e.id === 'e-dogfood')).toEqual(at(manual, 0))
    expect(next.entries.filter(e => e.id === 'e-dogfood')).toHaveLength(1)
    expect(next.entries.filter(e => e.id === 'e-manual-transport')).toHaveLength(1)
  })

  it('找不到这个批次时原样返回同一引用', () => {
    const before = seedEightDogs()
    expect(addBatchCosts(before, { ...costs, batchId: '不存在的批次' })).toBe(before)
  })

  it('不修改传入的 data 本身', () => {
    const before = seedEightDogs()
    const snapshot = structuredClone(before)
    addBatchCosts(before, costs)
    expect(before).toEqual(snapshot)
  })

  it('★ 旧的「17 笔」口径：收货 8 只后再补运输与疫苗，这一批一共 17 笔支出', () => {
    const { data, batchId } = receivedEightDogs()
    const next = addBatchCosts(data, {
      batchId, date: '2026-10-10',
      transportFen: 40000, medicalPerDogFen: 8000, quarantinePerDogFen: 0, disposalPerDogFen: 0,
    })
    // 8 笔收购 + 1 笔运输 + 8 笔疫苗
    expect(next.entries.filter(e => e.batchId === batchId)).toHaveLength(17)
    expect(batchTotalCost(next, batchId)).toBe(8 * 60000 + 40000 + 8 * 8000)
  })

  it('★ 旧的「8 笔 quarantine」口径：检疫费按每只狗一笔', () => {
    const { data, batchId } = receivedEightDogs()
    const next = addBatchCosts(data, {
      batchId, date: '2026-10-10',
      transportFen: 0, medicalPerDogFen: 0, quarantinePerDogFen: 5000, disposalPerDogFen: 0,
    })
    expect(next.entries.filter(e => e.category === 'quarantine' && e.batchId === batchId)).toHaveLength(8)
  })

  it('★ 旧的「运输费为 0 时不记运输支出」口径：仍是一笔都不写', () => {
    const { data, batchId } = receivedEightDogs()
    const next = addBatchCosts(data, {
      batchId, date: '2026-10-10',
      transportFen: 0, medicalPerDogFen: 8000, quarantinePerDogFen: 0, disposalPerDogFen: 0,
    })
    expect(next.entries.filter(e => e.category === 'transport')).toHaveLength(0)
    expect(next.entries.filter(e => e.category === 'medical')).toHaveLength(8)
  })
})

describe('previewBatchCosts', () => {
  it('★ 笔数与金额与 addBatchCosts 实际新增的逐字相等', () => {
    const before = seedEightDogs()
    const preview = previewBatchCosts(before, costs)
    const next = addBatchCosts(before, costs)
    const added = addedBy(next, before)
    expect(preview.count).toBe(19)
    expect(preview.totalFen).toBe(40000 + 8 * 8000 + 8 * 5000 + 2 * 20000)
    expect(preview.count).toBe(added.length)
    expect(preview.totalFen).toBe(added.reduce((sum, e) => sum + e.amount, 0))
  })

  it('只算这一次要新增的四行：不含收购款，也不含已经补过的成本', () => {
    const before = seedEightDogs()
    const next = addBatchCosts(before, costs)
    // 补完账再预览一次：还是 19 笔，没有把上一次那 19 笔算进去，也没算那笔收购款
    expect(previewBatchCosts(next, costs)).toEqual({ count: 19, totalFen: 184000 })
  })

  it('只填运输时是 1 笔，金额就是运输那一笔', () => {
    const preview = previewBatchCosts(seedEightDogs(), {
      ...costs, medicalPerDogFen: 0, quarantinePerDogFen: 0, disposalPerDogFen: 0,
    })
    expect(preview).toEqual({ count: 1, totalFen: 40000 })
  })

  it('四行全 0 时是 { count: 0, totalFen: 0 }', () => {
    expect(previewBatchCosts(seedEightDogs(), {
      ...costs, transportFen: 0, medicalPerDogFen: 0, quarantinePerDogFen: 0, disposalPerDogFen: 0,
    })).toEqual({ count: 0, totalFen: 0 })
  })

  it('批次不存在时是 { count: 0, totalFen: 0 }', () => {
    expect(previewBatchCosts(seedEightDogs(), { ...costs, batchId: '不存在的批次' }))
      .toEqual({ count: 0, totalFen: 0 })
  })

  it('预览不改动 data', () => {
    const before = seedEightDogs()
    const snapshot = structuredClone(before)
    previewBatchCosts(before, costs)
    expect(before).toEqual(snapshot)
  })
})

describe('batchCostsIncomplete', () => {
  it('建好批次、账上只有收购款时是 true（成本还没补）', () => {
    expect(batchCostsIncomplete(seedEightDogs(), BATCH_ID)).toBe(true)
  })

  it('补进第一笔运输之后就变成 false', () => {
    const before = seedEightDogs()
    const next = addBatchCosts(before, {
      ...costs, medicalPerDogFen: 0, quarantinePerDogFen: 0, disposalPerDogFen: 0,
    })
    expect(batchCostsIncomplete(next, BATCH_ID)).toBe(false)
  })

  it('用户自己手记了一笔非收购支出之后也是 false（记了账就不再挂提示）', () => {
    const before = seedEightDogs()
    const data: AppData = {
      ...before,
      entries: [...before.entries, {
        id: 'e-dogfood', date: '2026-10-05', type: 'expense', category: 'dogfood', amount: 12000,
        paidBy: 'pool', payee: null, batchId: BATCH_ID, dogId: null, note: '',
      }],
    }
    expect(batchCostsIncomplete(data, BATCH_ID)).toBe(false)
  })

  it('只看支出：一笔收入不算把成本补过', () => {
    const before = seedEightDogs()
    const data: AppData = {
      ...before,
      entries: [...before.entries, {
        id: 'e-sale', date: '2026-10-06', type: 'income', category: 'sale', amount: 200000,
        paidBy: 'pool', payee: null, batchId: BATCH_ID, dogId: 'd7', note: '',
      }],
    }
    expect(batchCostsIncomplete(data, BATCH_ID)).toBe(true)
  })

  it('只看这一批：别的批次补过账不影响它', () => {
    const before = seedEightDogs()
    const data: AppData = {
      ...before,
      entries: [...before.entries, {
        id: 'e-other', date: '2026-10-05', type: 'expense', category: 'transport', amount: 1000,
        paidBy: 'pool', payee: null, batchId: '别的批次', dogId: null, note: '',
      }],
    }
    expect(batchCostsIncomplete(data, BATCH_ID)).toBe(true)
  })
})
