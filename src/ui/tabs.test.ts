import { describe, it, expect } from 'vitest'
import { DEFAULT_TAB, TAB_ICON_KEYS, TABS } from './tabs'

describe('底部标签清单', () => {
  it('键唯一，每条都有非空的标签与图标', () => {
    const keys = TABS.map(t => t.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const t of TABS) {
      expect(t.label.length).toBeGreaterThan(0)
      expect(t.icon.length).toBeGreaterThan(0)
    }
  })

  // 「加一个标签只改一行」的前提：页面组件和导航项是同一份清单。
  it('每条标签自带页面组件，页面切换不需要第二份清单', () => {
    for (const t of TABS) expect(typeof t.component).toBe('function')
  })

  it('默认标签是「算」，并且就在清单里', () => {
    expect(DEFAULT_TAB).toBe('calc')
    expect(TABS.map(t => t.key)).toContain(DEFAULT_TAB)
  })

  /**
   * 顺序是契约的一部分（设计文档 §4 的表：算 / 狗 / 检 / 钱 / 报）。
   * 这条断言是 Task 17 加的：原文件只检查了「键唯一、标签非空」，
   * 把「检」插在别的位置一样能通过——而顺序变了用户的肌肉记忆就废了。
   */
  it('顺序固定为 算 / 狗 / 检 / 钱 / 报', () => {
    expect(TABS.map(t => t.key)).toEqual(['calc', 'dogs', 'quarantine', 'money', 'report'])
    expect(TABS.map(t => t.label)).toEqual(['算', '狗', '检', '钱', '报'])
  })
})

/**
 * 第三方审计盯上了底栏那五个 emoji（不同系统上字形、颜色、基线都不一样），
 * Task 35 换成手写的内联 SVG，`icon` 从「一个字符」变成「一个图标键」。
 *
 * 这几条是防止哪天又被顺手塞回一个 emoji —— 那种改动编译得过、lint 也不响，
 * 只有人眼在真机上才看得出来。
 */
describe('TABS 的图标键', () => {
  it('每个标签的 icon 都在允许的图标键里', () => {
    const bad = TABS.filter(t => !TAB_ICON_KEYS.includes(t.icon)).map(t => `${t.label}: ${t.icon}`)
    expect(bad).toEqual([])
  })

  it('图标键只有小写字母（emoji 与汉字都过不了这一条）', () => {
    const bad = TABS.filter(t => !/^[a-z]+$/.test(t.icon)).map(t => `${t.label}: ${t.icon}`)
    expect(bad).toEqual([])
  })

  it('五个标签的图标互不相同', () => {
    const icons = TABS.map(t => t.icon)
    expect(new Set(icons).size).toBe(icons.length)
  })

  it('允许的图标键每个都被用上（白名单不许留孤儿）', () => {
    const used = TABS.map(t => t.icon)
    expect(TAB_ICON_KEYS.filter(k => !used.includes(k))).toEqual([])
  })

  it('白名单自己不许有重复项', () => {
    expect(new Set(TAB_ICON_KEYS).size).toBe(TAB_ICON_KEYS.length)
  })
})
