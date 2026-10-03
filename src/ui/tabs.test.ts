import { describe, it, expect } from 'vitest'
import { DEFAULT_TAB, TABS } from './tabs'

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
})
