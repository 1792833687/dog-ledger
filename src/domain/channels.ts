import type { AppData, ChannelId, Money } from './types'
import { SALES_CHANNELS } from './types'
import { aliveCount, batchPerDogCostFen } from './costing'

/** 一条渠道的报价假设：打算卖多少、这条渠道每只多花多少、一次性花多少 */
export interface ChannelInput {
  channelId: ChannelId
  unitPriceFen: Money      // 你打算在这个渠道卖多少钱
  extraPerDogFen: Money    // 该渠道每只额外成本（包装、代卖抽成、送笼…）
  fixedCostFen: Money      // 该渠道专属固定成本（摊位费、进场费、一次性起送费…）
}

export interface ChannelBreakdown {
  channelId: ChannelId
  name: string                   // 取自 SALES_CHANNELS
  basePerDogCostFen: number      // 每只存活狗真实成本（含检疫）
  extraPerDogFen: Money
  fixedPerDogFen: number         // fixedCostFen ÷ 存活数
  breakEvenUnitPriceFen: number  // 保本单价 = base + extra + fixedPerDog
  perDogProfitFen: number        // unitPriceFen − breakEvenUnitPriceFen（负 = 亏）
  isLoss: boolean
}

/**
 * 渠道对照：同一批狗走不同渠道各自能不能赚。
 * 摊薄算法不在这里重写 —— 批次总成本经 batchPerDogCostFen 取，存活数经 aliveCount 取，
 * 与决策台（dilutedCostFen）是同一套数，否则两处报价会互相打架。
 */
export function compareChannels(data: AppData, batchId: string, inputs: ChannelInput[]): ChannelBreakdown[] {
  const alive = aliveCount(data, batchId)
  const basePerDogCostFen = batchPerDogCostFen(data, batchId)
  return inputs.map(input => {
    const fixedPerDogFen = alive === 0 ? 0 : input.fixedCostFen / alive
    const breakEvenUnitPriceFen = basePerDogCostFen + input.extraPerDogFen + fixedPerDogFen
    const perDogProfitFen = input.unitPriceFen - breakEvenUnitPriceFen
    // 渠道清单将来会变（也见过从旧备份里读回来的未知渠道）：查不到就退回 id 本身，不抛错。
    const channel = SALES_CHANNELS.find(c => c.id === input.channelId)
    return {
      channelId: input.channelId,
      name: channel ? channel.name : input.channelId,
      basePerDogCostFen,
      extraPerDogFen: input.extraPerDogFen,
      fixedPerDogFen,
      breakEvenUnitPriceFen,
      perDogProfitFen,
      isLoss: perDogProfitFen < 0,
    }
  })
}
