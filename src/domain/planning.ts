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
 * 把一次决策直接变成可记账的批次：建批次 + N 只狗 + 运输支出 + 每只狗的收购、疫苗与检疫支出。
 * 纯函数，不修改传入的 data。所有支出默认由池子直付（paidBy: 'pool'）。
 *
 * 不记无害化处理费：那是「预估会死几只」的假设，不是已经发生的支出。
 */
export function createBatchFromPlan(
  data: AppData,
  input: PlanInput,
  batchName: string,
  date: string,
  plannedChannel: ChannelId = 'undecided',
): AppData {
  const batchId = newId()
  const batch: Batch = {
    id: batchId, name: batchName, date, source: '', note: '', status: 'active', plannedChannel,
  }

  const n = Math.max(0, Math.floor(input.n))
  const dogs: Dog[] = []
  const entries: LedgerEntry[] = []

  const baseEntry = {
    date, paidBy: 'pool' as const, payee: null, batchId, dogId: null as string | null, note: '',
  }

  if (input.freight > 0) {
    entries.push({ id: newId(), type: 'expense', category: 'transport', amount: input.freight, ...baseEntry })
  }

  for (let i = 1; i <= n; i++) {
    const dogId = newId()
    dogs.push({
      id: dogId, batchId, code: `${batchName}-${i}`, breed: '',
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
    if (input.purchasePrice > 0) {
      entries.push({ id: newId(), type: 'expense', category: 'purchase', amount: input.purchasePrice, ...baseEntry, dogId })
    }
    if (input.medicalPerDog > 0) {
      entries.push({ id: newId(), type: 'expense', category: 'medical', amount: input.medicalPerDog, ...baseEntry, dogId })
    }
    // 检疫费在建批次时就记上：买回来就得开始检疫流程，而这笔钱必须在能出售之前付掉。
    if (input.quarantinePerDog > 0) {
      entries.push({ id: newId(), type: 'expense', category: 'quarantine', amount: input.quarantinePerDog, ...baseEntry, dogId })
    }
  }

  return {
    ...data,
    batches: [...data.batches, batch],
    dogs: [...data.dogs, ...dogs],
    entries: [...data.entries, ...entries],
  }
}
