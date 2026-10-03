import { describe, it, expect } from 'vitest'
import { yuanToFen, fenToYuan, formatMoney, parseMoney } from './money'

describe('yuanToFen', () => {
  it('元转分并四舍五入', () => {
    expect(yuanToFen(600)).toBe(60000)
    expect(yuanToFen(9.734)).toBe(973)
    expect(yuanToFen(9.736)).toBe(974)
  })
})

describe('fenToYuan', () => {
  it('分转元', () => {
    expect(fenToYuan(60000)).toBe(600)
  })
})

describe('formatMoney', () => {
  it('整数元不显示小数', () => {
    expect(formatMoney(60000)).toBe('¥600')
  })
  it('带角分时保留两位', () => {
    expect(formatMoney(97333)).toBe('¥973.33')
  })
  it('摊薄产生的无限小数被四舍五入到分', () => {
    // 5840 元 ÷ 6 = 973.3333... 元
    expect(formatMoney(584000 / 6)).toBe('¥973.33')
  })
  it('千位分隔', () => {
    expect(formatMoney(123456789)).toBe('¥1,234,567.89')
  })
  it('负数保留符号', () => {
    expect(formatMoney(-7300)).toBe('-¥73')
  })
})

describe('parseMoney', () => {
  it('解析纯数字', () => {
    expect(parseMoney('600')).toBe(60000)
  })
  it('容忍 ¥ 与千位逗号与空格', () => {
    expect(parseMoney(' ¥1,200.50 ')).toBe(120050)
  })
  it('空字符串返回 null', () => {
    expect(parseMoney('')).toBeNull()
    expect(parseMoney('   ')).toBeNull()
  })
  it('非数字返回 null', () => {
    expect(parseMoney('abc')).toBeNull()
  })
})
