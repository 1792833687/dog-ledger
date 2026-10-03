import type { Money } from './types'

export function yuanToFen(yuan: number): Money {
  return Math.round(yuan * 100)
}

export function fenToYuan(fen: Money): number {
  return fen / 100
}

/** 把「分」格式化为可读金额。传入值允许是小数（摊薄除法的中间结果），显示时四舍五入到分。 */
export function formatMoney(fen: number): string {
  const negative = fen < 0
  const cents = Math.round(Math.abs(fen))
  const yuan = Math.floor(cents / 100)
  const rest = cents % 100
  const yuanStr = yuan.toLocaleString('en-US')
  const body = rest === 0
    ? `¥${yuanStr}`
    : `¥${yuanStr}.${String(rest).padStart(2, '0')}`
  return negative ? `-${body}` : body
}

/** 解析用户输入的金额文本为「分」。无法解析时返回 null（空输入也返回 null）。 */
export function parseMoney(input: string): Money | null {
  const cleaned = input.replace(/[¥,\s]/g, '')
  if (cleaned === '') return null
  if (!/^-?\d*\.?\d*$/.test(cleaned)) return null
  const value = Number(cleaned)
  if (!Number.isFinite(value)) return null
  return Math.round(value * 100)
}
