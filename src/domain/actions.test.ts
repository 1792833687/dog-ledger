import { describe, it, expect } from 'vitest'
import { DEFAULT_DATA, BUILTIN_COST_ITEMS } from './types'
import type { AppData, Dog, PreOrder } from './types'
import {
  setDogStatus, sellDog, markDogDead, addExpense, createBatch,
  addInjection, addIncome, addReimbursement, addDistribution, setDogQuarantine,
  updateSettings, renamePartner, setPartnerRatio, addCostItem, setBatchChannel,
  renameBatch,
} from './actions'
import { batchSummary, dogIncome, dogOwnCost, batchTotalCost, dogProfitFen } from './costing'
import { poolBalance, advanceBalance, contributedCapital, distributedTo } from './ledger'
import { quarantineStatus } from './quarantine'
import { validateSettings } from './settlement'
import {
  addPreOrder, updatePreOrder, cancelPreOrder, deletePreOrder, receivePreOrder,
  type AddPreOrderInput,
} from './actions'

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

describe('设置类动作', () => {
  it('updateSettings 只动 settings，不动流水', () => {
    const next = updateSettings(DEFAULT_DATA, { targetMarginRate: 0.5 })
    expect(next.settings.targetMarginRate).toBe(0.5)
    expect(next.entries).toEqual(DEFAULT_DATA.entries)
    expect(next.dogs).toEqual(DEFAULT_DATA.dogs)
  })

  it('不修改原数据', () => {
    updateSettings(DEFAULT_DATA, { targetMarginRate: 0.9 })
    expect(DEFAULT_DATA.settings.targetMarginRate).toBe(0.3)
  })

  it('renamePartner 只改名字', () => {
    const next = renamePartner(DEFAULT_DATA, 'p1', '阿强')
    expect(next.settings.partners.find(p => p.id === 'p1')?.name).toBe('阿强')
    expect(next.settings.partners.find(p => p.id === 'p2')?.name).toBe('伙伴')
  })

  it('setPartnerRatio 改比例后，校验能挡住不是 100% 的组合', () => {
    const next = setPartnerRatio(DEFAULT_DATA, 'p1', 0.6)
    expect(validateSettings(next.settings)).toBe('分成比例之和必须等于 100%')
    const fixed = setPartnerRatio(next, 'p2', 0.4)
    expect(validateSettings(fixed.settings)).toBeNull()
  })

  it('addCostItem 追加一个自定义成本项，且不是内置项', () => {
    const next = addCostItem(DEFAULT_DATA, '狗粮', 'batch')
    const item = next.settings.costItems.find(c => c.name === '狗粮')
    expect(item?.scope).toBe('batch')
    expect(item?.isBuiltin).toBe(false)
    expect(next.settings.costItems).toHaveLength(DEFAULT_DATA.settings.costItems.length + 1)
  })

  it('updateSettings 一次改多个键，没传的键保持原值', () => {
    const next = updateSettings(DEFAULT_DATA, {
      targetMarginRate: 0.5, expectedMortalityRate: 0.2, quarantinePerDog: 5000,
    })
    expect(next.settings.targetMarginRate).toBe(0.5)
    expect(next.settings.expectedMortalityRate).toBe(0.2)
    expect(next.settings.quarantinePerDog).toBe(5000)
    expect(next.settings.disposalPerDog).toBe(DEFAULT_DATA.settings.disposalPerDog)
    expect(next.settings.rabiesWaitDays).toBe(21)
  })

  it('★ updateSettings 不重建 partners / entries / dogs / batches', () => {
    const next = updateSettings(DEFAULT_DATA, { targetMarginRate: 0.5 })
    expect(next.settings).not.toBe(DEFAULT_DATA.settings)
    expect(next.settings.partners).toBe(DEFAULT_DATA.settings.partners)
    expect(next.entries).toBe(DEFAULT_DATA.entries)
    expect(next.dogs).toBe(DEFAULT_DATA.dogs)
    expect(next.batches).toBe(DEFAULT_DATA.batches)
  })

  it('★ renamePartner 找不到这个合伙人时原样返回同一引用', () => {
    expect(renamePartner(DEFAULT_DATA, 'ghost', '幽灵')).toBe(DEFAULT_DATA)
  })

  it('★ renamePartner 不换比例，也不换别人的对象引用', () => {
    const next = renamePartner(DEFAULT_DATA, 'p1', '阿强')
    expect(next.settings.partners[1]).toBe(DEFAULT_DATA.settings.partners[1])
    expect(next.settings.partners[0]).not.toBe(DEFAULT_DATA.settings.partners[0])
    expect(next.settings.partners[0].shareRatio).toBe(0.5)
    expect(next.batches).toBe(DEFAULT_DATA.batches)
  })

  it('★ setPartnerRatio 找不到这个人时原样返回同一引用', () => {
    expect(setPartnerRatio(DEFAULT_DATA, 'ghost', 0.5)).toBe(DEFAULT_DATA)
  })

  it('★ setPartnerRatio 只换那一个人的对象', () => {
    const next = setPartnerRatio(DEFAULT_DATA, 'p1', 0.6)
    expect(next.settings.partners[0].shareRatio).toBe(0.6)
    expect(next.settings.partners[1]).toBe(DEFAULT_DATA.settings.partners[1])
    expect(next.entries).toBe(DEFAULT_DATA.entries)
  })

  it('★ 比例被写成 0 会被校验挡住 —— 所以界面必须在空输入时就不写', () => {
    const next = setPartnerRatio(DEFAULT_DATA, 'p1', 0)
    expect(next.settings.partners[0].shareRatio).toBe(0)
    expect(validateSettings(next.settings)).toBe('分成比例之和必须等于 100%')
  })

  it('★ addCostItem 生成的 id 不与内置项、也不与已有成本项相撞', () => {
    const builtinIds = new Set(BUILTIN_COST_ITEMS.map(c => c.id))
    let data = DEFAULT_DATA
    for (let i = 0; i < 20; i++) data = addCostItem(data, `自定义${i}`, 'dog')
    const custom = data.settings.costItems.filter(c => !builtinIds.has(c.id))
    expect(custom).toHaveLength(20)
    expect(new Set(custom.map(c => c.id)).size).toBe(20)
    for (const c of custom) expect(c.id.length).toBeGreaterThan(0)
  })

  it('addCostItem 追加在末尾，已有的成本项连对象引用都没换', () => {
    const next = addCostItem(DEFAULT_DATA, '狗粮', 'batch')
    const before = DEFAULT_DATA.settings.costItems
    expect(next.settings.costItems).toHaveLength(before.length + 1)
    for (let i = 0; i < before.length; i++) expect(next.settings.costItems[i]).toBe(before[i])
    expect(next.settings.costItems[next.settings.costItems.length - 1].name).toBe('狗粮')
  })

  it('addCostItem 不动流水/狗/批次，名字原样保存（trim 是界面的事）', () => {
    const next = addCostItem(DEFAULT_DATA, '狗粮 ', 'dog')
    expect(next.entries).toBe(DEFAULT_DATA.entries)
    expect(next.dogs).toBe(DEFAULT_DATA.dogs)
    expect(next.batches).toBe(DEFAULT_DATA.batches)
    const item = next.settings.costItems[next.settings.costItems.length - 1]
    expect(item.name).toBe('狗粮 ')
    expect(item.scope).toBe('dog')
    expect(item.isBuiltin).toBe(false)
  })

  it('★ setPartnerRatio 与 addCostItem 不修改传入的 data', () => {
    const data = DEFAULT_DATA
    const ratioBefore = data.settings.partners[0].shareRatio
    const itemsBefore = data.settings.costItems.length
    setPartnerRatio(data, 'p1', 0.9)
    addCostItem(data, '狗粮', 'dog')
    expect(ratioBefore).toBe(0.5)
    expect(itemsBefore).toBe(BUILTIN_COST_ITEMS.length)
    expect(data.settings.partners[0].shareRatio).toBe(0.5)
    expect(data.settings.costItems).toHaveLength(itemsBefore)
  })
})

describe('setBatchChannel', () => {
  it('改一个批次的计划去向', () => {
    const data = createBatch(DEFAULT_DATA, '一批', '2026-10-03')
    const next = setBatchChannel(data, data.batches[0].id, 'pet_shop')
    expect(next.batches[0].plannedChannel).toBe('pet_shop')
  })

  it('只换那一个批次对象，其余批次连引用都不换、顺序不变', () => {
    let data = createBatch(DEFAULT_DATA, '一', '2026-10-03')
    data = createBatch(data, '二', '2026-10-04')
    data = createBatch(data, '三', '2026-10-05')
    const before = data.batches
    const next = setBatchChannel(data, before[1].id, 'meat')
    expect(next.batches).toHaveLength(3)
    expect(next.batches[0]).toBe(before[0])
    expect(next.batches[1]).not.toBe(before[1])
    expect(next.batches[2]).toBe(before[2])
    expect(next.batches.map(b => b.name)).toEqual(['一', '二', '三'])
    expect(next.batches[1].plannedChannel).toBe('meat')
    expect(next.batches[1].id).toBe(before[1].id)
    expect(next.batches[1].name).toBe('二')
  })

  it('dogs / entries / settings 一律不动（连引用都不换）', () => {
    const data = sellSeed()
    const next = setBatchChannel(data, data.batches[0].id, 'individual')
    expect(next.dogs).toBe(data.dogs)
    expect(next.entries).toBe(data.entries)
    expect(next.settings).toBe(data.settings)
  })

  it('批次不存在时原样返回同一引用', () => {
    const data = sellSeed()
    expect(setBatchChannel(data, 'no-such-batch', 'meat')).toBe(data)
  })

  it('改两个不同批次互不影响', () => {
    let data = createBatch(DEFAULT_DATA, '一', '2026-10-03')
    data = createBatch(data, '二', '2026-10-04')
    const [b1, b2] = data.batches
    const next = setBatchChannel(setBatchChannel(data, b1.id, 'kennel'), b2.id, 'ecommerce')
    expect(next.batches[0].plannedChannel).toBe('kennel')
    expect(next.batches[1].plannedChannel).toBe('ecommerce')
    expect(data.batches[0].plannedChannel).toBe('undecided')
  })

  it('不修改传入的 data 本身', () => {
    const data = createBatch(DEFAULT_DATA, '一批', '2026-10-03')
    const id = data.batches[0].id
    setBatchChannel(data, id, 'rural_fair')
    expect(data.batches[0].plannedChannel).toBe('undecided')
    expect(DEFAULT_DATA.batches).toHaveLength(0)
  })
})

/**
 * Task 21：改批次名（消掉两条一模一样的下拉选项）。
 *
 * 这一组里最要紧的是「★ 狗号不变」那两条：`code` 是这批狗的**历史标识** ——
 * 对账单、纸质清单上已经按旧名写下来了，所以改批次名**刻意不追溯改狗号**
 * （`renameBatch` 的注释里写了为什么）。谁要是哪天"顺手"把狗号也跟着改了，
 * 这两条会立刻变红。
 *
 * 另一条钉子：`data` 里根本没有「靠批次名反查、重算狗号」这种机制 —— 所以
 * 界面上「批次名改了、狗号还是旧名」是**预期行为**，走查时不要当成 bug 报。
 */
describe('renameBatch', () => {
  /**
   * 一批 2 只狗，狗号按建批次时那条真实规则生成：`` `${批次名}-${序号}` ``
   * （`planning.ts:105` 是这条规则唯一的出处；手动补录走的是 `-补N`，见
   * `DogsPage.tsx:331`）。
   */
  function renameSeed() {
    const data = createBatch(DEFAULT_DATA, '收狗 2 只', '2026-10-03')
    const batch = data.batches[0]
    const dogs: Dog[] = [1, 2].map(i => ({
      id: `d${i}`, batchId: batch.id, code: `${batch.name}-${i}`, breed: '',
      sex: 'unknown', ageMonths: null, status: 'in_stock', note: '',
      rabiesVaccinatedOn: null, antibodyTestedOn: null, antibodyReportNo: '',
      quarantineCertNo: '', quarantineCertIssuedOn: null, quarantineCertValidUntil: null,
    }))
    return { ...data, dogs: [...data.dogs, ...dogs] }
  }

  it('改一个批次的名字', () => {
    const data = createBatch(DEFAULT_DATA, '一批', '2026-10-03')
    const next = renameBatch(data, data.batches[0].id, '10月3日李村')
    expect(next.batches[0].name).toBe('10月3日李村')
  })

  it('只换那一个批次对象，其余批次连引用都不换、顺序不变、别的字段不动', () => {
    let data = createBatch(DEFAULT_DATA, '一', '2026-10-03')
    data = createBatch(data, '二', '2026-10-04')
    data = createBatch(data, '三', '2026-10-05')
    const before = data.batches
    const next = renameBatch(data, before[1].id, '二（下午收的）')
    expect(next.batches).toHaveLength(3)
    expect(next.batches[0]).toBe(before[0])
    expect(next.batches[1]).not.toBe(before[1])
    expect(next.batches[2]).toBe(before[2])
    expect(next.batches.map(b => b.name)).toEqual(['一', '二（下午收的）', '三'])
    // 别的字段原样保留：改名不是「重建一个批次」。
    expect(next.batches[1].id).toBe(before[1].id)
    expect(next.batches[1].date).toBe('2026-10-04')
    expect(next.batches[1].plannedChannel).toBe(before[1].plannedChannel)
  })

  it('dogs / entries / settings 一律不动（连引用都不换）', () => {
    const data = renameSeed()
    const next = renameBatch(data, data.batches[0].id, '新名字')
    expect(next.dogs).toBe(data.dogs)
    expect(next.entries).toBe(data.entries)
    expect(next.settings).toBe(data.settings)
  })

  it('批次不存在时原样返回同一引用', () => {
    const data = renameSeed()
    expect(renameBatch(data, 'no-such-batch', '新名字')).toBe(data)
  })

  it('不修改传入的 data 本身', () => {
    const data = createBatch(DEFAULT_DATA, '一批', '2026-10-03')
    const id = data.batches[0].id
    renameBatch(data, id, '改过的名字')
    expect(data.batches[0].name).toBe('一批')
    expect(DEFAULT_DATA.batches).toHaveLength(0)
  })

  it('★ 改批次名之后已有狗的 code 一个都不变（刻意不追溯改狗号）', () => {
    const data = renameSeed()
    expect(data.dogs.map(d => d.code)).toEqual(['收狗 2 只-1', '收狗 2 只-2'])
    const next = renameBatch(data, data.batches[0].id, '下午收的 2 只')
    expect(next.batches[0].name).toBe('下午收的 2 只')
    // 狗号还是建批次时那批旧名 —— 纸质清单上就是按它写的，改了就对不上账。
    expect(next.dogs.map(d => d.code)).toEqual(['收狗 2 只-1', '收狗 2 只-2'])
  })

  it('★ 改批次名连狗对象本身都不换（没有任何「顺手改 code」的机会）', () => {
    const data = renameSeed()
    const next = renameBatch(data, data.batches[0].id, '下午收的 2 只')
    expect(next.dogs[0]).toBe(data.dogs[0])
    expect(next.dogs[1]).toBe(data.dogs[1])
  })
})

describe('addPreOrder', () => {
  const good: AddPreOrderInput = {
    sellerName: '老李',
    sellerContact: '13800000000',
    expectedCount: 6,
    collectDate: '2026-10-20',
    traits: '黑色，公',
    note: '',
    createdAt: '2026-10-04T09:00:00.000Z',
  }

  /** 取第 `index` 张预定单。下标越界就让测试炸掉，好过用 `!` 静音。 */
  function at(data: AppData, index: number): PreOrder {
    const found = data.preOrders[index]
    if (!found) throw new Error(`第 ${index} 张预定单不存在`)
    return found
  }

  it('追加一张预定单，状态从 reserved 起（收货与取消的字段都还没写）', () => {
    const next = addPreOrder(DEFAULT_DATA, good)
    expect(next.preOrders).toHaveLength(1)
    const created = at(next, 0)
    expect(created.sellerName).toBe('老李')
    expect(created.sellerContact).toBe('13800000000')
    expect(created.expectedCount).toBe(6)
    expect(created.collectDate).toBe('2026-10-20')
    expect(created.traits).toBe('黑色，公')
    expect(created.note).toBe('')
    expect(created.createdAt).toBe('2026-10-04T09:00:00.000Z')
    expect(created.status).toBe('reserved')
    expect(created.receivedCount).toBe(0)
    expect(created.receivedBatchId).toBeNull()
    expect(created.cancelReason).toBe('')
    expect(created.id).toBeTruthy()
    expect(next.preOrders[0]).not.toBe(good)
  })

  it('已有一张时追加在后面，前面的连引用都不换', () => {
    const first = addPreOrder(DEFAULT_DATA, good)
    const second = addPreOrder(first, { ...good, sellerName: '老王' })
    expect(second.preOrders).toHaveLength(2)
    expect(second.preOrders[0]).toBe(at(first, 0))
    expect(second.preOrders[1].sellerName).toBe('老王')
  })

  it('卖家名为空（含只有空格）—— 原样返回同一引用', () => {
    expect(addPreOrder(DEFAULT_DATA, { ...good, sellerName: '' })).toBe(DEFAULT_DATA)
    expect(addPreOrder(DEFAULT_DATA, { ...good, sellerName: '   ' })).toBe(DEFAULT_DATA)
  })

  it('约定只数小于 1 —— 原样返回同一引用', () => {
    expect(addPreOrder(DEFAULT_DATA, { ...good, expectedCount: 0 })).toBe(DEFAULT_DATA)
    expect(addPreOrder(DEFAULT_DATA, { ...good, expectedCount: -3 })).toBe(DEFAULT_DATA)
  })

  it('去收的日子为空（含只有空格）—— 原样返回同一引用', () => {
    expect(addPreOrder(DEFAULT_DATA, { ...good, collectDate: '' })).toBe(DEFAULT_DATA)
    expect(addPreOrder(DEFAULT_DATA, { ...good, collectDate: '  ' })).toBe(DEFAULT_DATA)
  })

  it('卖家名与去收日子存的是 trim 之后的值', () => {
    const next = addPreOrder(DEFAULT_DATA, { ...good, sellerName: ' 老李 ', collectDate: ' 2026-10-20 ' })
    expect(at(next, 0).sellerName).toBe('老李')
    expect(at(next, 0).collectDate).toBe('2026-10-20')
  })

  it('不修改传入的 data（batches / dogs / entries / settings 连引用都不换）', () => {
    const next = addPreOrder(DEFAULT_DATA, good)
    expect(next.batches).toBe(DEFAULT_DATA.batches)
    expect(next.dogs).toBe(DEFAULT_DATA.dogs)
    expect(next.entries).toBe(DEFAULT_DATA.entries)
    expect(next.settings).toBe(DEFAULT_DATA.settings)
    expect(DEFAULT_DATA.preOrders).toHaveLength(0)
  })
})

describe('updatePreOrder', () => {
  const good: AddPreOrderInput = {
    sellerName: '老李', sellerContact: '13800000000', expectedCount: 6,
    collectDate: '2026-10-20', traits: '黑色，公', note: '', createdAt: '2026-10-04T09:00:00.000Z',
  }

  function at(data: AppData, index: number): PreOrder {
    const found = data.preOrders[index]
    if (!found) throw new Error(`第 ${index} 张预定单不存在`)
    return found
  }

  it('六个可改字段都能改', () => {
    const data = addPreOrder(DEFAULT_DATA, good)
    const id = at(data, 0).id
    const next = updatePreOrder(data, id, {
      sellerName: '老王', sellerContact: '13900000000', expectedCount: 8,
      collectDate: '2026-10-25', traits: '花的', note: '带笼子',
    })
    const updated = at(next, 0)
    expect(updated.sellerName).toBe('老王')
    expect(updated.sellerContact).toBe('13900000000')
    expect(updated.expectedCount).toBe(8)
    expect(updated.collectDate).toBe('2026-10-25')
    expect(updated.traits).toBe('花的')
    expect(updated.note).toBe('带笼子')
  })

  it('patch 里没提到的键保持原值（显式传 undefined 也算没提到）', () => {
    const data = addPreOrder(DEFAULT_DATA, good)
    const id = at(data, 0).id
    const next = updatePreOrder(data, id, { note: '只改备注', sellerName: undefined })
    const updated = at(next, 0)
    expect(updated.note).toBe('只改备注')
    expect(updated.sellerName).toBe('老李')
    expect(updated.expectedCount).toBe(6)
    expect(updated.collectDate).toBe('2026-10-20')
  })

  it('改不了 status / receivedCount / receivedBatchId（白名单之外）', () => {
    const data = addPreOrder(DEFAULT_DATA, good)
    const id = at(data, 0).id
    const next = updatePreOrder(data, id, { note: 'x' })
    expect(at(next, 0).status).toBe('reserved')
    expect(at(next, 0).receivedCount).toBe(0)
    expect(at(next, 0).receivedBatchId).toBeNull()
  })

  it('★ 已收货的预定单只能改 note，其余键一律忽略（防绕过守卫再收一次）', () => {
    const data = addPreOrder(DEFAULT_DATA, good)
    const id = at(data, 0).id
    const received: AppData = {
      ...data,
      preOrders: data.preOrders.map(o =>
        o.id === id ? { ...o, status: 'received', receivedCount: 6, receivedBatchId: 'b1' } : o),
    }
    const next = updatePreOrder(received, id, {
      note: '实收 6 只', sellerName: '改了', expectedCount: 99,
      collectDate: '2030-01-01', sellerContact: '改了', traits: '改了',
    })
    const updated = at(next, 0)
    expect(updated.note).toBe('实收 6 只')
    expect(updated.sellerName).toBe('老李')
    expect(updated.expectedCount).toBe(6)
    expect(updated.collectDate).toBe('2026-10-20')
    expect(updated.status).toBe('received')
    expect(updated.receivedBatchId).toBe('b1')
  })

  it('找不到 id —— 原样返回同一引用', () => {
    const data = addPreOrder(DEFAULT_DATA, good)
    expect(updatePreOrder(data, 'no-such-order', { note: 'x' })).toBe(data)
  })

  it('只换这一张，其余预定单连引用都不换、顺序不变', () => {
    let data = addPreOrder(DEFAULT_DATA, good)
    data = addPreOrder(data, { ...good, sellerName: '老王' })
    data = addPreOrder(data, { ...good, sellerName: '老张' })
    const before = data.preOrders
    const next = updatePreOrder(data, before[1].id, { note: '中间那张' })
    expect(next.preOrders).toHaveLength(3)
    expect(next.preOrders[0]).toBe(before[0])
    expect(next.preOrders[1]).not.toBe(before[1])
    expect(next.preOrders[2]).toBe(before[2])
    expect(next.preOrders.map(o => o.sellerName)).toEqual(['老李', '老王', '老张'])
  })
})

describe('cancelPreOrder 与 deletePreOrder', () => {
  const good: AddPreOrderInput = {
    sellerName: '老李', sellerContact: '13800000000', expectedCount: 6,
    collectDate: '2026-10-20', traits: '黑色，公', note: '', createdAt: '2026-10-04T09:00:00.000Z',
  }

  function at(data: AppData, index: number): PreOrder {
    const found = data.preOrders[index]
    if (!found) throw new Error(`第 ${index} 张预定单不存在`)
    return found
  }

  /** 把唯一那张预定单改成已收货 */
  function receivedOne(): AppData {
    const data = addPreOrder(DEFAULT_DATA, good)
    const id = at(data, 0).id
    return {
      ...data,
      preOrders: data.preOrders.map(o =>
        o.id === id ? { ...o, status: 'received', receivedCount: 6, receivedBatchId: 'b1' } : o),
    }
  }

  it('取消一张预定中的单：写 cancelled 与原因', () => {
    const data = addPreOrder(DEFAULT_DATA, good)
    const id = at(data, 0).id
    const next = cancelPreOrder(data, id, '卖家不卖了')
    expect(at(next, 0).status).toBe('cancelled')
    expect(at(next, 0).cancelReason).toBe('卖家不卖了')
  })

  it('原因为空串就存空串（提示是界面的事）', () => {
    const data = addPreOrder(DEFAULT_DATA, good)
    const id = at(data, 0).id
    expect(at(cancelPreOrder(data, id, ''), 0).cancelReason).toBe('')
  })

  it('已收货的不能取消 —— 原样返回同一引用', () => {
    const received = receivedOne()
    expect(cancelPreOrder(received, at(received, 0).id, '不收了')).toBe(received)
  })

  it('已取消的不能重复取消 —— 原样返回同一引用', () => {
    const data = addPreOrder(DEFAULT_DATA, good)
    const id = at(data, 0).id
    const cancelled = cancelPreOrder(data, id, '黄了')
    expect(cancelPreOrder(cancelled, id, '又黄了')).toBe(cancelled)
  })

  it('找不到 id 时不能取消 —— 原样返回同一引用', () => {
    const data = addPreOrder(DEFAULT_DATA, good)
    expect(cancelPreOrder(data, 'no-such-order', 'x')).toBe(data)
  })

  it('预定中的单可以真的删掉', () => {
    const data = addPreOrder(DEFAULT_DATA, good)
    const id = at(data, 0).id
    const next = deletePreOrder(data, id)
    expect(next.preOrders).toEqual([])
    expect(next).not.toBe(data)
  })

  it('删掉中间一张，其余顺序与引用不变', () => {
    let data = addPreOrder(DEFAULT_DATA, good)
    data = addPreOrder(data, { ...good, sellerName: '老王' })
    data = addPreOrder(data, { ...good, sellerName: '老张' })
    const before = data.preOrders
    const next = deletePreOrder(data, before[1].id)
    expect(next.preOrders).toHaveLength(2)
    expect(next.preOrders[0]).toBe(before[0])
    expect(next.preOrders[1]).toBe(before[2])
  })

  it('★ 已收货的不能删（它连着批次）—— 原样返回同一引用', () => {
    const received = receivedOne()
    expect(deletePreOrder(received, at(received, 0).id)).toBe(received)
  })

  it('找不到 id —— 原样返回同一引用', () => {
    const data = addPreOrder(DEFAULT_DATA, good)
    expect(deletePreOrder(data, 'no-such-order')).toBe(data)
  })

  it('取消之后就能删了（cancel 的唯一出口）', () => {
    const data = addPreOrder(DEFAULT_DATA, good)
    const id = at(data, 0).id
    expect(deletePreOrder(cancelPreOrder(data, id, '黄了'), id).preOrders).toEqual([])
  })

  it('不修改传入的 data 本身', () => {
    const data = addPreOrder(DEFAULT_DATA, good)
    const id = at(data, 0).id
    cancelPreOrder(data, id, '黄了')
    deletePreOrder(data, id)
    expect(data.preOrders).toHaveLength(1)
    expect(at(data, 0).status).toBe('reserved')
  })
})

describe('receivePreOrder', () => {
  const order: AddPreOrderInput = {
    sellerName: '老李家', sellerContact: '13800000000', expectedCount: 4,
    collectDate: '2026-10-20', traits: '黑色，公', note: '', createdAt: '2026-10-04T09:00:00.000Z',
  }

  const receive = { name: '收狗 2 只 09:10', date: '2026-10-20', receivedCount: 2, unitPriceFen: 60000 }

  /** 取第 `index` 张预定单。下标越界就让测试炸掉，好过用 `!` 静音。 */
  function at(data: AppData, index: number): PreOrder {
    const found = data.preOrders[index]
    if (!found) throw new Error(`第 ${index} 张预定单不存在`)
    return found
  }

  /** 追加一张预定单，返回数据与它的 id。 */
  function reserved(input: AddPreOrderInput = order) {
    const data = addPreOrder(DEFAULT_DATA, input)
    return { data, id: at(data, 0).id }
  }

  it('★ 一次调用原子做完四件事：建批次、建狗、记收购款、把预定单标成已收货', () => {
    const { data, id } = reserved()
    const next = receivePreOrder(data, id, receive)
    expect(next.batches).toHaveLength(1)
    expect(next.dogs).toHaveLength(2)
    const batchId = next.batches[0].id
    expect(next.dogs.every(d => d.batchId === batchId)).toBe(true)
    expect(next.dogs.map(d => d.code)).toEqual(['收狗 2 只 09:10-1', '收狗 2 只 09:10-2'])
    expect(next.entries.filter(e => e.batchId === batchId && e.category === 'purchase')).toHaveLength(2)
    // 收货这一刻只写收购款，估算出来的运输 / 疫苗 / 检疫 / 处理费一个字都不进账
    expect(next.entries.filter(e => e.category !== 'purchase')).toHaveLength(0)
    const received = at(next, 0)
    expect(received.status).toBe('received')
    expect(received.receivedCount).toBe(2)
    expect(received.receivedBatchId).toBe(batchId)
  })

  it('批次去向记未定，卖家写进批次来源，留痕写明来自哪张预定单', () => {
    const { data, id } = reserved()
    const next = receivePreOrder(data, id, receive)
    expect(next.batches[0].plannedChannel).toBe('undecided')
    expect(next.batches[0].source).toBe('老李家')
    expect(next.batches[0].note).toBe('来自预定单：老李家；比约定的少 2 只')
  })

  it('收够数时留痕里不出现「比约定」', () => {
    const { data, id } = reserved({ ...order, expectedCount: 2 })
    const next = receivePreOrder(data, id, receive)
    expect(next.batches[0].note).toBe('来自预定单：老李家')
    expect(next.batches[0].note).not.toContain('比约定')
  })

  it('多收时写「多」与差额', () => {
    const { data, id } = reserved({ ...order, expectedCount: 2 })
    const next = receivePreOrder(data, id, { ...receive, receivedCount: 5 })
    expect(next.batches[0].note).toBe('来自预定单：老李家；比约定的多 3 只')
    expect(at(next, 0).receivedCount).toBe(5)
    expect(next.dogs).toHaveLength(5)
    expect(next.entries.filter(e => e.category === 'purchase')).toHaveLength(5)
  })

  it('找不到这张预定单 —— 原样返回同一引用', () => {
    const { data } = reserved()
    expect(receivePreOrder(data, '不存在的 id', receive)).toBe(data)
  })

  it('已经收过货的不能重复收 —— 原样返回同一引用', () => {
    const { data, id } = reserved()
    const once = receivePreOrder(data, id, receive)
    expect(receivePreOrder(once, id, receive)).toBe(once)
  })

  it('已取消的不能收 —— 原样返回同一引用', () => {
    const { data, id } = reserved()
    const cancelled = cancelPreOrder(data, id, '卖家不卖了')
    expect(receivePreOrder(cancelled, id, receive)).toBe(cancelled)
  })

  it('实收只数小于 1 —— 原样返回同一引用', () => {
    const { data, id } = reserved()
    expect(receivePreOrder(data, id, { ...receive, receivedCount: 0 })).toBe(data)
    expect(receivePreOrder(data, id, { ...receive, receivedCount: -2 })).toBe(data)
  })

  it('实收只数不是有限数字 —— 原样返回同一引用', () => {
    const { data, id } = reserved()
    expect(receivePreOrder(data, id, { ...receive, receivedCount: NaN })).toBe(data)
    expect(receivePreOrder(data, id, { ...receive, receivedCount: Infinity })).toBe(data)
  })

  it('实收只数带小数时向下取整，狗数与留痕都用取整后的数', () => {
    const { data, id } = reserved()
    const next = receivePreOrder(data, id, { ...receive, receivedCount: 2.9 })
    expect(next.dogs).toHaveLength(2)
    expect(at(next, 0).receivedCount).toBe(2)
    expect(next.batches[0].note).toBe('来自预定单：老李家；比约定的少 2 只')
  })

  it('单价 0 时批次照样建出来，只是一笔收购款都不写', () => {
    const { data, id } = reserved()
    const next = receivePreOrder(data, id, { ...receive, unitPriceFen: 0 })
    expect(next.batches).toHaveLength(1)
    expect(next.dogs).toHaveLength(2)
    expect(at(next, 0).status).toBe('received')
    expect(next.entries).toHaveLength(0)
  })

  it('★ 收货不动该批次以外的任何数据', () => {
    const base = seed()
    const baseBatchId = base.batches[0].id
    // 既有批次里放一只在库的狗，好确认收货之后它的 batchId 一个字符都没变
    const withDog: AppData = {
      ...base,
      dogs: [...base.dogs, {
        id: 'd-existing', batchId: baseBatchId, code: '一批-1', breed: '', sex: 'unknown',
        ageMonths: null, status: 'in_stock', note: '',
        rabiesVaccinatedOn: null, antibodyTestedOn: null, antibodyReportNo: '',
        quarantineCertNo: '', quarantineCertIssuedOn: null, quarantineCertValidUntil: null,
      }],
    }
    const withOrders = addPreOrder(addPreOrder(withDog, order), { ...order, sellerName: '老王' })
    const first = at(withOrders, 0)
    const other = at(withOrders, 1)
    const next = receivePreOrder(withOrders, first.id, receive)

    expect(next.batches).toHaveLength(2)
    // 既有批次、它的运输费、设置与另一张预定单：连引用都不换
    expect(next.batches[0]).toBe(withOrders.batches[0])
    expect(next.entries[0]).toBe(withOrders.entries[0])
    expect(next.settings).toBe(withOrders.settings)
    expect(next.preOrders[1]).toBe(other)
    expect(next.preOrders[1]).toEqual(other)
    // 既有那只狗的 batchId 逐字不变；新收的狗全挂在新建的第二个批次上
    expect(next.dogs[0]).toBe(withOrders.dogs[0])
    expect(next.dogs[0].batchId).toBe(baseBatchId)
    expect(next.dogs.slice(1).every(d => d.batchId === next.batches[1].id)).toBe(true)
    expect(next.preOrders[0].receivedBatchId).toBe(next.batches[1].id)
  })

  it('不修改传入的 data 本身', () => {
    const { data, id } = reserved()
    const before = JSON.stringify(data)
    receivePreOrder(data, id, receive)
    expect(JSON.stringify(data)).toBe(before)
    expect(at(data, 0).status).toBe('reserved')
  })
})
