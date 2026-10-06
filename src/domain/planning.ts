import type { AppData, Batch, ChannelId, Dog, LedgerEntry, Money, Settings } from './types'
import { newId } from './types'

export interface PlanInput {
  /** 预计收到几只 */
  n: number
  /** 每只收购价（分） */
  purchasePrice: Money
  /** 这一趟的油费 + 笼具（分，整批） */
  freight: Money
  /** 每只疫苗医疗（分） */
  medicalPerDog: Money
  /** 每只狗的检疫费（分）：狂犬病免疫抗体检测 + 检疫申报跑腿。法定前置，填 0 会低估保本价 */
  quarantinePerDog: Money
  /** 每只病死犬的无害化处理费（分）。只按预估死亡只数计入，不是按买回来的只数 */
  disposalPerDog: Money
  /** 预估死亡率，0~1 */
  mortalityRate: number
  /** 打算卖多少钱一只（分） */
  targetPrice: Money
}

export interface PlanScenario {
  soldCount: number
  revenue: Money
  profitFen: number
  perPartnerFen: number
}

export interface PlanResult {
  totalCost: Money
  expectedAlive: number
  /** ★ 保本价（分，可能带小数）：低于这个价卖出就是亏 */
  breakEvenPriceFen: number
  suggestedPriceFen: number
  scenarios: PlanScenario[]
}

export function plan(settings: Settings, input: PlanInput): PlanResult {
  const n = Math.max(0, Math.floor(input.n))
  // 检疫费按买回来的【全部】只数交：狗死了检疫的钱也不会退。
  // 无害化处理费只对【预估死亡】的那部分发生——所以两者算法不同，不能一起乘 n。
  const expectedDead = n * input.mortalityRate
  const totalCost =
    n * input.purchasePrice +
    input.freight +
    n * input.medicalPerDog +
    n * input.quarantinePerDog +
    expectedDead * input.disposalPerDog

  // 预估存活数：至少为 1（全部死光时不能除零，保本价退化为总成本）
  const expectedAlive = Math.max(1, n * (1 - input.mortalityRate))
  // 一只都没收时不谈保本价
  const breakEvenPriceFen = n === 0 ? 0 : totalCost / expectedAlive
  const suggestedPriceFen = breakEvenPriceFen * (1 + settings.targetMarginRate)

  const partnerCount = Math.max(1, settings.partners.length)
  // 三档：收回来六成 / 八成 / 全部卖掉
  const soldCounts = n === 0
    ? []
    : Array.from(new Set([Math.round(n * 0.6), Math.round(n * 0.8), n])).sort((a, b) => a - b)

  const scenarios: PlanScenario[] = soldCounts.map(soldCount => {
    const revenue = soldCount * input.targetPrice
    const profitFen = revenue - totalCost
    return { soldCount, revenue, profitFen, perPartnerFen: profitFen / partnerCount }
  })

  return { totalCost, expectedAlive, breakEvenPriceFen, suggestedPriceFen, scenarios }
}

/**
 * 建批次 + 建狗：全仓唯一的实现。收货（预定单与「算」页直接收货）都走这里。
 *
 * 只写收购款这一类流水——运输 / 疫苗 / 检疫 / 处理费要等真正付了钱，
 * 由补账（`addBatchCosts`）另记。这是「先做后补账」的落点：
 * 估算只是保本价的输入，不是已经发生的支出。
 *
 * 纯函数，不修改传入的 data。收购款默认由池子直付（paidBy: 'pool'）。
 */
export function addBatchWithDogs(
  data: AppData,
  input: {
    name: string
    date: string
    count: number
    unitPriceFen: Money
    channel: ChannelId
    source: string
    note: string
  },
): { data: AppData; batchId: string | null } {
  const count = Math.floor(input.count)
  // 一只都没收到就什么都不建：建一个没有狗的空批次只会让后面每个地方都要判空
  if (!Number.isFinite(count) || count < 1) {
    return { data, batchId: null }
  }

  const batchId = newId()
  const batch: Batch = {
    id: batchId, name: input.name, date: input.date, source: input.source, note: input.note,
    status: 'active', plannedChannel: input.channel,
  }

  const unitPriceFen = Math.max(0, Math.round(input.unitPriceFen))
  const dogs: Dog[] = []
  const entries: LedgerEntry[] = []

  for (let i = 1; i <= count; i++) {
    const dogId = newId()
    dogs.push({
      id: dogId, batchId, code: `${input.name}-${i}`, breed: '',
      sex: 'unknown', ageMonths: null, status: 'in_stock', note: '',
      // 刚买回来的狗还没接种、没检测、没证明。绝不预填今天——
      // 那会让检疫阶段的推导从第一天起就是错的。
      rabiesVaccinatedOn: null,
      antibodyTestedOn: null,
      antibodyReportNo: '',
      quarantineCertNo: '',
      quarantineCertIssuedOn: null,
      quarantineCertValidUntil: null,
    })
    if (unitPriceFen > 0) {
      entries.push({
        id: newId(), type: 'expense', category: 'purchase', amount: unitPriceFen,
        date: input.date, paidBy: 'pool', payee: null, batchId, dogId, note: '',
      })
    }
  }

  return {
    data: {
      ...data,
      batches: [...data.batches, batch],
      dogs: [...data.dogs, ...dogs],
      entries: [...data.entries, ...entries],
    },
    batchId,
  }
}

/** 「算」页直接收货：没有来源与备注，其余与 `addBatchWithDogs` 完全一样。 */
export function receiveBatch(
  data: AppData,
  input: { name: string; date: string; count: number; unitPriceFen: Money; channel: ChannelId },
): AppData {
  return addBatchWithDogs(data, { ...input, source: '', note: '' }).data
}
