import type { AppData, EntryType, Money } from './types'

function sumBy(data: AppData, type: EntryType, pick: (e: AppData['entries'][number]) => boolean): Money {
  return data.entries
    .filter(e => e.type === type && pick(e))
    .reduce((s, e) => s + e.amount, 0)
}

export function totalIncome(data: AppData): Money {
  return sumBy(data, 'income', () => true)
}

export function totalExpense(data: AppData): Money {
  return sumBy(data, 'expense', () => true)
}

/**
 * 池子现金余额。逐条对照设计文档 3.3 的四本账表格：
 * + 注资 + 收入 − 池子直付支出 − 报销 − 分红
 * （合伙人垫付的支出不动池子里的钱）
 */
export function poolBalance(data: AppData): Money {
  const injection = sumBy(data, 'injection', () => true)
  const income = totalIncome(data)
  const paidFromPool = sumBy(data, 'expense', e => e.paidBy === 'pool')
  const reimbursed = sumBy(data, 'reimbursement', () => true)
  const distributed = sumBy(data, 'distribution', () => true)
  return injection + income - paidFromPool - reimbursed - distributed
}

/** 某合伙人尚未被归还的垫付额 */
export function advanceBalance(data: AppData, partnerId: string): Money {
  const advanced = sumBy(data, 'expense', e => e.paidBy === partnerId)
  const reimbursed = sumBy(data, 'reimbursement', e => e.payee === partnerId)
  return advanced - reimbursed
}

/** 某合伙人的注资本金 */
export function contributedCapital(data: AppData, partnerId: string): Money {
  return sumBy(data, 'injection', e => e.paidBy === partnerId)
}

/** 某合伙人已领取的分红合计 */
export function distributedTo(data: AppData, partnerId: string): Money {
  return sumBy(data, 'distribution', e => e.payee === partnerId)
}
