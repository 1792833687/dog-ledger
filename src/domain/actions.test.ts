import { describe, it, expect } from 'vitest'
import { DEFAULT_DATA } from './types'
import {
  setDogStatus, sellDog, markDogDead, addExpense, createBatch,
  addInjection, addIncome, addReimbursement, addDistribution, setDogQuarantine,
} from './actions'
import { batchSummary, dogIncome, dogOwnCost, batchTotalCost, dogProfitFen } from './costing'
import { poolBalance, advanceBalance, contributedCapital, distributedTo } from './ledger'
import { quarantineStatus } from './quarantine'

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

describe('markDogDead 的守卫（只挡「收入已入账」的已售狗与已记过的已死狗，不挡退回的狗）', () => {
  it('对已售的狗调 markDogDead：原样返回同一引用，状态仍是 sold', () => {
    // 这是实机走查抓到的账目污染：把 sold 覆盖成 dead 之后，
    // 那笔 income/sale 流水留在账上一动不动，狗的购置成本却进了「死亡损耗」，
    // 批次盈亏直接算错。而且 dead 的卡上一个按钮都不剩，点错了改不回来。
    const data = sellSeed()
    const dogId = data.dogs[0].id
    const sold = sellDog(data, dogId, 120000, '2026-10-05')
    const next = markDogDead(sold, dogId)
    expect(next).toBe(sold)
    expect(next.dogs.find(d => d.id === dogId)!.status).toBe('sold')
  })

  it('对已死的狗再标一次死亡：原样返回，不重复改', () => {
    const data = sellSeed()
    const dogId = data.dogs[0].id
    const dead = markDogDead(data, dogId)
    expect(markDogDead(dead, dogId)).toBe(dead)
  })

  /**
   * 退回的狗是「在册的活狗」：设计文档 :156 把它算进 `inStockCount`、:157 算进 `aliveCount`。
   * 它站在笼子里，所以会病、会死、也要再卖一次。守卫真正要挡的是
   * 「收入已入账、狗已经不在我们账上」（`sold`）和「已经记过死亡」（`dead`），
   * 而不是「不是 `in_stock`」—— 后者会把退回的狗一起堵死。
   */
  it('对退回的狗能标死亡：状态变 dead', () => {
    const data = sellSeed()
    const dogId = data.dogs[0].id
    const returned = setDogStatus(data, dogId, 'returned')
    const next = markDogDead(returned, dogId)
    expect(next).not.toBe(returned)
    expect(next.dogs.find(d => d.id === dogId)!.status).toBe('dead')
  })

  it('退回后再死亡：购置成本照样进死亡损耗（退回不等于免于损耗）', () => {
    const data = sellSeed()
    const batchId = data.batches[0].id
    const dogId = data.dogs[0].id
    const own = dogOwnCost(data, dogId)
    expect(own).toBe(60000 + 8000)
    const dead = markDogDead(setDogStatus(data, dogId, 'returned'), dogId)
    expect(batchSummary(dead, batchId).deadLoss).toBe(own)
  })

  it('对不存在的狗原样返回', () => {
    const data = sellSeed()
    expect(markDogDead(data, '没有这只')).toBe(data)
  })

  it('在库的狗仍然能标死亡（回归：守卫没有把正常路径一起堵掉）', () => {
    const data = sellSeed()
    const dogId = data.dogs[0].id
    const next = markDogDead(data, dogId)
    expect(next).not.toBe(data)
    expect(next.dogs.find(d => d.id === dogId)!.status).toBe('dead')
  })
})

describe('退回的狗要能再卖一次（设计文档 :156「退狗回到在库」）', () => {
  it('returned 的狗 sellDog 成功：状态变 sold', () => {
    const data = sellSeed()
    const dogId = data.dogs[0].id
    const returned = setDogStatus(data, dogId, 'returned')
    const next = sellDog(returned, dogId, 100000, '2026-10-08')
    expect(next.dogs.find(d => d.id === dogId)!.status).toBe('sold')
    expect(next).not.toBe(returned)
  })

  it('再次卖出写入第二笔 income/sale（上一笔退款不作废）', () => {
    const data = sellSeed()
    const batchId = data.batches[0].id
    const dogId = data.dogs[0].id
    const first = sellDog(data, dogId, 120000, '2026-10-05')
    const refunded = addExpense(first, {
      batchId, dogId, category: 'aftercare_refund',
      amount: 120000, paidBy: 'pool', date: '2026-10-06', note: '',
    })
    const again = sellDog(setDogStatus(refunded, dogId, 'returned'), dogId, 110000, '2026-10-08')
    const sales = again.entries.filter(e => e.type === 'income' && e.dogId === dogId)
    expect(sales).toHaveLength(2)
    expect(dogIncome(again, dogId)).toBe(120000 + 110000)
  })
})

describe('setDogStatus 不设守卫（这是纠错入口能成立的前提）', () => {
  it('setDogStatus 本身不设守卫：纠错入口要能把 dead / returned 改回在库', () => {
    const data = sellSeed()
    const dogId = data.dogs[0].id
    const dead = markDogDead(data, dogId)
    const back = setDogStatus(dead, dogId, 'in_stock')
    expect(back.dogs.find(d => d.id === dogId)!.status).toBe('in_stock')
    const deadAgain = markDogDead(back, dogId)
    expect(deadAgain.dogs.find(d => d.id === dogId)!.status).toBe('dead')
  })
})

describe('退狗退款（aftercare_refund）', () => {
  it('记一笔 aftercare_refund 支出并挂在这只狗上', () => {
    const data = sellSeed()
    const dogId = data.dogs[0].id
    const sold = sellDog(data, dogId, 120000, '2026-10-05')
    const next = addExpense(sold, {
      batchId: sold.batches[0].id, dogId, category: 'aftercare_refund',
      amount: 120000, paidBy: 'pool', date: '2026-10-06', note: '',
    })
    const entry = next.entries[next.entries.length - 1]
    expect(entry.type).toBe('expense')
    expect(entry.category).toBe('aftercare_refund')
    expect(entry.dogId).toBe(dogId)
  })

  it('退款支出计入批次总成本，从而把虚增的利润压回去', () => {
    // 退狗只改状态不记退款，账上会留着一笔根本没赚到的利润 —— 这就是返工的原因。
    const data = sellSeed()
    const batchId = data.batches[0].id
    const dogId = data.dogs[0].id
    const sold = sellDog(data, dogId, 120000, '2026-10-05')
    const beforeRefund = batchSummary(sold, batchId)
    expect(beforeRefund.netProfitFen).toBe(beforeRefund.income - beforeRefund.totalCost)

    const refunded = addExpense(sold, {
      batchId, dogId, category: 'aftercare_refund',
      amount: 120000, paidBy: 'pool', date: '2026-10-06', note: '客户退狗',
    })
    for (const summary of [beforeRefund, batchSummary(refunded, batchId)]) {
      expect(summary.netProfitFen).toBe(summary.income - summary.totalCost)
    }
    expect(batchSummary(refunded, batchId).totalCost).toBe(batchTotalCost(refunded, batchId))
    expect(batchTotalCost(refunded, batchId)).toBe(beforeRefund.totalCost + 120000)
  })

  it('退回的狗重新计入在库，且不冲销已发生的医疗成本', () => {
    const data = sellSeed()
    const batchId = data.batches[0].id
    const dogId = data.dogs[0].id
    const sold = sellDog(data, dogId, 120000, '2026-10-05')
    const mine = dogOwnCost(sold, dogId)
    const refunded = addExpense(sold, {
      batchId, dogId, category: 'aftercare_refund',
      amount: 120000, paidBy: 'pool', date: '2026-10-06', note: '',
    })
    const returned = setDogStatus(refunded, dogId, 'returned')
    // inStockCount 把 returned 也算进去（costing.ts:29 的注释：它又站在笼子里了，
    // 还得再卖一次，所以进分母）：另外 2 只还在库 + 退回来的这 1 只 = 3。
    expect(batchSummary(returned, batchId).inStock).toBe(3)
    // 医疗成本没有被冲销：它还在那只狗的直接成本里，再加上退款。
    expect(dogOwnCost(returned, dogId)).toBe(mine + 120000)
  })

  it('钱退了但狗没要回来：状态保持 sold，只多一笔退款支出', () => {
    const data = sellSeed()
    const dogId = data.dogs[0].id
    const sold = sellDog(data, dogId, 120000, '2026-10-05')
    const refunded = addExpense(sold, {
      batchId: sold.batches[0].id, dogId, category: 'aftercare_refund',
      amount: 120000, paidBy: 'pool', date: '2026-10-06', note: '',
    })
    expect(refunded.dogs.find(d => d.id === dogId)!.status).toBe('sold')
    expect(refunded.entries).toHaveLength(sold.entries.length + 1)
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

describe('资金类流水', () => {
  it('注资让池子变多，并记在注入人名下', () => {
    const next = addInjection(DEFAULT_DATA, 'p1', 500000, '2026-10-03', '')
    expect(poolBalance(next)).toBe(500000)
    expect(contributedCapital(next, 'p1')).toBe(500000)
    expect(contributedCapital(next, 'p2')).toBe(0)
  })

  it('收入让池子变多', () => {
    const next = addIncome(DEFAULT_DATA, 120000, '2026-10-05', '')
    expect(poolBalance(next)).toBe(120000)
  })

  it('报销让池子变少、垫付余额变少', () => {
    const withAdvance = addExpense(DEFAULT_DATA, {
      batchId: null, dogId: null, category: 'purchase',
      amount: 70000, paidBy: 'p1', date: '2026-10-03', note: '',
    })
    const injected = addInjection(withAdvance, 'p1', 500000, '2026-10-03', '')
    const done = addReimbursement(injected, 'p1', 70000, '2026-10-04')
    expect(advanceBalance(done, 'p1')).toBe(0)
    expect(poolBalance(done)).toBe(430000)
  })

  it('分红让池子变少、已分红变多，且不影响损益', () => {
    const withMoney = addIncome(DEFAULT_DATA, 200000, '2026-10-05', '')
    const done = addDistribution(withMoney, 'p1', 50000, '2026-10-06')
    expect(poolBalance(done)).toBe(150000)
    expect(distributedTo(done, 'p1')).toBe(50000)
  })

  it('金额为负时被夹到 0', () => {
    const next = addIncome(DEFAULT_DATA, -100, '2026-10-05', '')
    expect(poolBalance(next)).toBe(0)
  })
})

describe('资金类流水的流水字段', () => {
  /** 四种转账类动作里，只有收入不带归属合伙人 */
  function lastEntry(data: Parameters<typeof poolBalance>[0]) {
    return data.entries[data.entries.length - 1]
  }

  it('注资：type injection、category transfer、paidBy 是注入人、payee 为空', () => {
    const next = addInjection(DEFAULT_DATA, 'p1', 500000, '2026-10-03', '第一笔')
    const e = lastEntry(next)
    expect(e.type).toBe('injection')
    expect(e.category).toBe('transfer')
    expect(e.paidBy).toBe('p1')
    expect(e.payee).toBeNull()
    expect(e.date).toBe('2026-10-03')
    expect(e.note).toBe('第一笔')
  })

  it('不挂狗的收入：type income、category sale、batchId / dogId 都是 null', () => {
    const next = addIncome(DEFAULT_DATA, 120000, '2026-10-05', '卖笼子')
    const e = lastEntry(next)
    expect(e.type).toBe('income')
    expect(e.category).toBe('sale')
    expect(e.batchId).toBeNull()
    expect(e.dogId).toBeNull()
    expect(e.paidBy).toBe('pool')
    expect(e.payee).toBeNull()
  })

  it('报销：pid 记在 payee（收款的合伙人），钱是从池子出的', () => {
    const next = addReimbursement(DEFAULT_DATA, 'p2', 70000, '2026-10-04')
    const e = lastEntry(next)
    expect(e.type).toBe('reimbursement')
    expect(e.category).toBe('transfer')
    expect(e.payee).toBe('p2')
    expect(e.paidBy).toBe('pool')
    expect(e.amount).toBe(70000)
  })

  it('分红：pid 记在 payee', () => {
    const next = addDistribution(DEFAULT_DATA, 'p2', 50000, '2026-10-06')
    const e = lastEntry(next)
    expect(e.type).toBe('distribution')
    expect(e.category).toBe('transfer')
    expect(e.payee).toBe('p2')
    expect(e.date).toBe('2026-10-06')
  })

  it('四种动作都不带 batchId / dogId（它们不属于任何一批任何一只狗）', () => {
    const in1 = addInjection(DEFAULT_DATA, 'p1', 1, '2026-10-03', '')
    const in2 = addIncome(DEFAULT_DATA, 1, '2026-10-03', '')
    const in3 = addReimbursement(DEFAULT_DATA, 'p1', 1, '2026-10-03')
    const in4 = addDistribution(DEFAULT_DATA, 'p1', 1, '2026-10-03')
    for (const d of [in1, in2, in3, in4]) {
      expect(lastEntry(d).batchId).toBeNull()
      expect(lastEntry(d).dogId).toBeNull()
    }
  })
})

describe('资金类流水的金额处理（与 addExpense 同一口径）', () => {
  it('小数取整到分：1234.6 → 1235', () => {
    const next = addInjection(DEFAULT_DATA, 'p1', 1234.6, '2026-10-03', '')
    expect(next.entries[0].amount).toBe(1235)
  })

  it('负数夹到 0：注资 -1 记成 0，不把池子记成负数', () => {
    const next = addInjection(DEFAULT_DATA, 'p1', -1, '2026-10-03', '')
    expect(next.entries[0].amount).toBe(0)
    expect(poolBalance(next)).toBe(0)
  })

  it('负数夹到 0：报销 -1 不让垫付余额被倒着加回去', () => {
    const withAdvance = addExpense(DEFAULT_DATA, {
      batchId: null, dogId: null, category: 'purchase',
      amount: 70000, paidBy: 'p1', date: '2026-10-03', note: '',
    })
    const done = addReimbursement(withAdvance, 'p1', -1, '2026-10-04')
    expect(advanceBalance(done, 'p1')).toBe(70000)
    const paid = addDistribution(withAdvance, 'p1', -1, '2026-10-04')
    expect(distributedTo(paid, 'p1')).toBe(0)
  })
})

describe('资金类流水不修改传入的数据', () => {
  it('addInjection 不改原对象、不往原数组里塞', () => {
    const before = DEFAULT_DATA.entries.length
    addInjection(DEFAULT_DATA, 'p1', 500000, '2026-10-03', '')
    expect(DEFAULT_DATA.entries).toHaveLength(before)
    expect(contributedCapital(DEFAULT_DATA, 'p1')).toBe(0)
  })

  it('addIncome 不改原对象，返回的是新引用', () => {
    const next = addIncome(DEFAULT_DATA, 120000, '2026-10-05', '')
    expect(next).not.toBe(DEFAULT_DATA)
    expect(next.entries).not.toBe(DEFAULT_DATA.entries)
    expect(DEFAULT_DATA.entries).toHaveLength(0)
  })

  it('报销与分红也不改原对象', () => {
    const withAdvance = addExpense(DEFAULT_DATA, {
      batchId: null, dogId: null, category: 'purchase',
      amount: 70000, paidBy: 'p1', date: '2026-10-03', note: '',
    })
    const snapshot = withAdvance.entries.length
    addReimbursement(withAdvance, 'p1', 70000, '2026-10-04')
    addDistribution(withAdvance, 'p1', 10000, '2026-10-04')
    expect(withAdvance.entries).toHaveLength(snapshot)
    expect(advanceBalance(withAdvance, 'p1')).toBe(70000)
    expect(distributedTo(withAdvance, 'p1')).toBe(0)
  })
})

describe('资金类流水与池子的口径', () => {
  it('合伙人垫付的支出不动池子里的钱（只有池子直付才减）', () => {
    const advanced = addExpense(DEFAULT_DATA, {
      batchId: null, dogId: null, category: 'purchase',
      amount: 70000, paidBy: 'p1', date: '2026-10-03', note: '',
    })
    expect(poolBalance(advanced)).toBe(0)
    expect(advanceBalance(advanced, 'p1')).toBe(70000)
  })

  it('注资不算垫付：把钱打进池子不等于替池子垫了钱', () => {
    const next = addInjection(DEFAULT_DATA, 'p1', 500000, '2026-10-03', '')
    expect(advanceBalance(next, 'p1')).toBe(0)
  })

  it('收入不算垫付、不算注资本金', () => {
    const next = addIncome(DEFAULT_DATA, 120000, '2026-10-05', '')
    expect(advanceBalance(next, 'p1')).toBe(0)
    expect(contributedCapital(next, 'p1')).toBe(0)
  })

  it('报销只冲掉垫付，不改注资本金', () => {
    const withAdvance = addExpense(DEFAULT_DATA, {
      batchId: null, dogId: null, category: 'purchase',
      amount: 70000, paidBy: 'p1', date: '2026-10-03', note: '',
    })
    const injected = addInjection(withAdvance, 'p1', 500000, '2026-10-03', '')
    const done = addReimbursement(injected, 'p1', 70000, '2026-10-04')
    expect(contributedCapital(done, 'p1')).toBe(500000)
  })

  it('分红不减某人的垫付余额（分红不是还钱）', () => {
    const withAdvance = addExpense(DEFAULT_DATA, {
      batchId: null, dogId: null, category: 'purchase',
      amount: 70000, paidBy: 'p1', date: '2026-10-03', note: '',
    })
    const injected = addInjection(withAdvance, 'p1', 500000, '2026-10-03', '')
    const done = addDistribution(injected, 'p1', 50000, '2026-10-06')
    expect(advanceBalance(done, 'p1')).toBe(70000)
    expect(poolBalance(done)).toBe(450000)
  })

  it('一笔分红只算在收款人名下，不给别人记上', () => {
    const withMoney = addIncome(DEFAULT_DATA, 200000, '2026-10-05', '')
    const done = addDistribution(withMoney, 'p1', 50000, '2026-10-06')
    expect(distributedTo(done, 'p1')).toBe(50000)
    expect(distributedTo(done, 'p2')).toBe(0)
  })
})

/**
 * Task 17 追加：改单只狗的检疫字段（「检」页面唯一的写入口）。
 *
 * 这一组关注的重点是「没传的键不能被碰到」：`undefined` 不等于「清空」。
 * 检疫字段里有 `quarantineCertNo` 这种域层会直接调 `.trim()` 的字符串，
 * 一个 `undefined` 混进去不是「少记一格」，而是 `Cannot read properties of undefined`。
 */
describe('setDogQuarantine', () => {
  /** 3 只狗，d1 上有完整的接种 + 检测记录、还没拿证 */
  function quarantineSeed() {
    const base = sellSeed()
    return {
      ...base,
      dogs: base.dogs.map(d => (d.id === 'd1'
        ? {
          ...d,
          rabiesVaccinatedOn: '2026-09-11', antibodyTestedOn: '2026-10-02',
          antibodyReportNo: 'R-1', quarantineCertNo: '',
          quarantineCertIssuedOn: null, quarantineCertValidUntil: null,
        }
        : d)),
    }
  }

  it('只改传进来的键，其余检疫字段保持原值', () => {
    const data = quarantineSeed()
    const next = setDogQuarantine(data, 'd1', { quarantineCertNo: 'JY-001' })
    const d1 = next.dogs[0]
    expect(d1.quarantineCertNo).toBe('JY-001')
    expect(d1.rabiesVaccinatedOn).toBe('2026-09-11')
    expect(d1.antibodyTestedOn).toBe('2026-10-02')
    expect(d1.antibodyReportNo).toBe('R-1')
    expect(d1.quarantineCertValidUntil).toBeNull()
  })

  it('显式传 undefined 不算「清空」（没传的键保持原值）', () => {
    const data = quarantineSeed()
    const next = setDogQuarantine(data, 'd1', { rabiesVaccinatedOn: undefined, antibodyReportNo: undefined })
    expect(next.dogs[0].rabiesVaccinatedOn).toBe('2026-09-11')
    expect(next.dogs[0].antibodyReportNo).toBe('R-1')
  })

  it('清空要显式传 null（日期）', () => {
    const data = quarantineSeed()
    const next = setDogQuarantine(data, 'd1', { antibodyTestedOn: null })
    expect(next.dogs[0].antibodyTestedOn).toBeNull()
    expect(next.dogs[0].rabiesVaccinatedOn).toBe('2026-09-11')
  })

  it('清空要显式传空串（编号）', () => {
    const data = quarantineSeed()
    const cleared = setDogQuarantine(data, 'd1', { antibodyReportNo: '' })
    expect(cleared.dogs[0].antibodyReportNo).toBe('')
  })

  it('一次传多个键全部生效', () => {
    const data = quarantineSeed()
    const next = setDogQuarantine(data, 'd1', {
      quarantineCertNo: 'JY-002', quarantineCertIssuedOn: '2026-10-03',
      quarantineCertValidUntil: '2026-10-13', antibodyReportNo: 'R-2',
    })
    const d1 = next.dogs[0]
    expect(d1.quarantineCertNo).toBe('JY-002')
    expect(d1.quarantineCertIssuedOn).toBe('2026-10-03')
    expect(d1.quarantineCertValidUntil).toBe('2026-10-13')
    expect(d1.antibodyReportNo).toBe('R-2')
  })

  it('同一份补丁里既能清空一个键、也能设置另一个键', () => {
    const data = quarantineSeed()
    const next = setDogQuarantine(data, 'd1', { rabiesVaccinatedOn: null, quarantineCertNo: 'JY-9' })
    expect(next.dogs[0].rabiesVaccinatedOn).toBeNull()
    expect(next.dogs[0].quarantineCertNo).toBe('JY-9')
  })

  it('★ 找不到这只狗时返回同一个引用（不凭空造狗）', () => {
    const data = quarantineSeed()
    expect(setDogQuarantine(data, '不存在', { quarantineCertNo: 'X' })).toBe(data)
  })

  it('★ 不碰 entries、不碰 batches', () => {
    const data = quarantineSeed()
    const next = setDogQuarantine(data, 'd1', { quarantineCertNo: 'JY-003' })
    expect(next.entries).toBe(data.entries)
    expect(next.batches).toBe(data.batches)
    expect(next.settings).toBe(data.settings)
  })

  it('★ 只改这一只：别的狗连对象引用都不变，数组顺序不变', () => {
    const data = quarantineSeed()
    const next = setDogQuarantine(data, 'd2', { quarantineCertNo: 'JY-004' })
    expect(next.dogs).toHaveLength(3)
    expect(next.dogs.map(d => d.id)).toEqual(['d1', 'd2', 'd3'])
    expect(next.dogs[0]).toBe(data.dogs[0])
    expect(next.dogs[2]).toBe(data.dogs[2])
    expect(next.dogs[1]).not.toBe(data.dogs[1])
    expect(next.dogs[1].quarantineCertNo).toBe('JY-004')
    expect(next.dogs[0].quarantineCertNo).toBe('')
  })

  it('不修改传入的 data', () => {
    const data = quarantineSeed()
    const before = data.dogs[0].quarantineCertNo
    setDogQuarantine(data, 'd1', { quarantineCertNo: 'JY-005' })
    expect(data.dogs[0].quarantineCertNo).toBe(before)
  })

  it('★ 改完的字段名能被检疫阶段推导直接读懂', () => {
    const data = quarantineSeed()
    const next = setDogQuarantine(data, 'd1', {
      quarantineCertNo: 'JY-006', quarantineCertValidUntil: '2026-12-31',
    })
    expect(quarantineStatus(next.dogs[0], next.settings, '2026-10-02').stage).toBe('certified')
    const dropped = setDogQuarantine(next, 'd1', { rabiesVaccinatedOn: null })
    expect(quarantineStatus(dropped.dogs[0], dropped.settings, '2026-10-02').isSellable).toBe(true)
  })
})
