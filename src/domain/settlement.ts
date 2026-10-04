import type { AppData, Money, Settings } from './types'
import {
  totalIncome, totalExpense, poolBalance,
  advanceBalance, contributedCapital, distributedTo,
} from './ledger'

export interface PartnerSettlement {
  id: string
  name: string
  shareRatio: number
  /** 尚未归还的垫付 */
  advance: Money
  /** 注资本金 */
  contributed: Money
  /** 已领分红 */
  distributed: Money
  /** 应分未分（可为负，表示已超额领取） */
  claimable: Money
}

export interface Settlement {
  totalIncome: Money
  totalExpense: Money
  netProfit: Money
  pool: Money
  partners: PartnerSettlement[]
}

export function settle(data: AppData): Settlement {
  const income = totalIncome(data)
  const expense = totalExpense(data)
  const netProfit = income - expense
  return {
    totalIncome: income,
    totalExpense: expense,
    netProfit,
    pool: poolBalance(data),
    partners: data.settings.partners.map(p => ({
      id: p.id,
      name: p.name,
      shareRatio: p.shareRatio,
      advance: advanceBalance(data, p.id),
      contributed: contributedCapital(data, p.id),
      distributed: distributedTo(data, p.id),
      claimable: Math.round(netProfit * p.shareRatio) - distributedTo(data, p.id),
    })),
  }
}

/** 校验设置合法性。返回 null 表示通过，否则返回给用户看的中文错误信息。 */
export function validateSettings(settings: Settings): string | null {
  if (settings.partners.length === 0) return '至少需要一个合伙人'
  const sum = settings.partners.reduce((a, p) => a + p.shareRatio, 0)
  if (Math.abs(sum - 1) > 1e-9) return '分成比例之和必须等于 100%'
  if (!(settings.targetMarginRate >= 0)) return '目标毛利率不能为负'
  if (!(settings.expectedMortalityRate >= 0 && settings.expectedMortalityRate < 1)) {
    return '预估死亡率必须在 0% 到 100% 之间'
  }
  if (!(settings.quarantinePerDog >= 0)) return '检疫费不能为负'
  if (!(settings.disposalPerDog >= 0)) return '病死犬处理费不能为负'
  // 天数用 `!(x >= 0)` 而不是 `x < 0`：`NaN` 只有前者拦得住，
  // 而 NaN 天的等待期会让「检」页面把刚接种的狗判成「可以送检」。
  if (!(settings.rabiesWaitDays >= 0)) return '狂犬免疫后等待天数不能为负'
  if (!(settings.quarantineLeadDays >= 0)) return '检疫申报提前天数不能为负'
  return null
}
