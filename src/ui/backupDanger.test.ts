import { describe, it, expect } from 'vitest'
import { canClearData, clearPhrase } from './backupDanger'

describe('clearPhrase', () => {
  it('就是要用户打出来的那两个字', () => {
    expect(clearPhrase()).toBe('清空')
  })
})

describe('canClearData', () => {
  it('逐字打出来才算数', () => {
    expect(canClearData('清空')).toBe(true)
  })

  it('前后多打了空格也算 —— 手机上打字很容易带出空格，为这个卡住用户不值得', () => {
    expect(canClearData(' 清空 ')).toBe(true)
  })

  it('全角空格同样算（trim 认得它，与半角空格一个待遇）', () => {
    expect(canClearData('\u3000清空\u3000')).toBe(true)
  })

  it('什么都没打不算', () => {
    expect(canClearData('')).toBe(false)
  })

  it('只打了一个字不算', () => {
    expect(canClearData('清')).toBe(false)
  })

  it('两个字中间夹了空格不算 —— 那不是「清空」这两个字，是三个字符', () => {
    expect(canClearData('清 空')).toBe(false)
  })

  it('多打了别的字不算', () => {
    expect(canClearData('清空全部')).toBe(false)
  })

  it('大小写、别的语言一律不算', () => {
    expect(canClearData('Clear')).toBe(false)
    expect(canClearData('清空。')).toBe(false)
  })
})
