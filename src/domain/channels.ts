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
 * 渠道对照的核心：给定「每只存活狗的底价」与「存活只数」，算各渠道的保本单价与每只利润。
 * 这是全仓唯一的渠道成本算法 —— compareChannels 只是从账本里取出这两个数再调它。
 * 「算」页面还没有真实批次时直接调它，不要造临时 AppData、不要造假狗：
 * 那时账本里既没有狗也没有支出，走包装层只会把底价与固定成本都算成 0。
 * `basePerDogCostFen` 原样透传，不乘不除；`aliveDogCount` 允许是小数（plan() 的 expectedAlive）。
 */
export function compareChannelCosts(
  basePerDogCostFen: number,
  aliveDogCount: number,
  inputs: readonly ChannelInput[],
): ChannelBreakdown[] {
  return inputs.map(input => {
    const fixedPerDogFen = aliveDogCount === 0 ? 0 : input.fixedCostFen / aliveDogCount
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

/** 从账本取数后调 compareChannelCosts。真实批次（已有狗、已有支出）走这条。 */
export function compareChannels(data: AppData, batchId: string, inputs: ChannelInput[]): ChannelBreakdown[] {
  return compareChannelCosts(batchPerDogCostFen(data, batchId), aliveCount(data, batchId), inputs)
}
