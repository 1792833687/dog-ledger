import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  clearSettingsRequest,
  onSettingsRequest,
  requestSettings,
  settingsRequested,
} from './navigation'

/**
 * 这根电话线本身没有界面，所以只能在这一层钉住它：
 * 通知全部订阅者、退订立刻生效、以及「请求先挂着、等面板第一次渲染时读到」这条时序约定。
 */
describe('requestSettings / onSettingsRequest', () => {
  it('没有订阅者时请求也不报错', () => {
    expect(() => requestSettings()).not.toThrow()
  })

  it('请求会通知订阅者', () => {
    const listener = vi.fn()
    const off = onSettingsRequest(listener)
    try {
      requestSettings()
      expect(listener).toHaveBeenCalledTimes(1)
      requestSettings()
      expect(listener).toHaveBeenCalledTimes(2)
    } finally {
      off()
    }
  })

  it('多个订阅者都收到（一次请求通知所有人）', () => {
    const a = vi.fn()
    const b = vi.fn()
    const offA = onSettingsRequest(a)
    const offB = onSettingsRequest(b)
    try {
      requestSettings()
      expect(a).toHaveBeenCalledTimes(1)
      expect(b).toHaveBeenCalledTimes(1)
    } finally {
      offA()
      offB()
    }
  })

  it('退订之后不再收到', () => {
    const listener = vi.fn()
    const off = onSettingsRequest(listener)
    off()
    requestSettings()
    expect(listener).not.toHaveBeenCalled()
  })

  it('退订两次不报错（effect 在 StrictMode 下会跑两遍）', () => {
    const off = onSettingsRequest(vi.fn())
    off()
    expect(() => off()).not.toThrow()
  })

  it('订阅者在通知过程中退订，也不会漏掉别人', () => {
    const second = vi.fn()
    let offSecond: (() => void) | null = null
    const offFirst = onSettingsRequest(() => {
      // 第一个订阅者一边被通知一边退订自己和下一个人
      offFirst()
      if (offSecond !== null) offSecond()
    })
    offSecond = onSettingsRequest(second)
    requestSettings()
    // 已经进了这一轮的通知清单，所以照样收到这一次
    expect(second).toHaveBeenCalledTimes(1)
  })
})

describe('挂起标志（settingsRequested / clearSettingsRequest）', () => {
  // 标志是模块级的（这正是它的用法：请求先挂着，等面板第一次渲染时读），
  // 所以每条用例开头先清掉上一条留下的 —— 上面那组用例每次 `requestSettings()`
  // 都会把它置位、没有人取走。
  beforeEach(() => {
    clearSettingsRequest()
  })

  it('没人请求过时是 false', () => {
    expect(settingsRequested()).toBe(false)
  })

  it('请求过就是 true', () => {
    requestSettings()
    expect(settingsRequested()).toBe(true)
  })

  it('清掉之后又变回 false', () => {
    requestSettings()
    clearSettingsRequest()
    expect(settingsRequested()).toBe(false)
  })

  it('设置面板还没挂载时的请求，靠渲染时读标志补上', () => {
    // 点按钮的人在「钱」页，那一刻「报」页的设置面板根本没挂载
    requestSettings()
    const notMountedYet = vi.fn()
    // 挂载太晚，这一轮通知收不到 —— 但标志还在，面板第一次渲染就读得到
    const off = onSettingsRequest(notMountedYet)
    try {
      expect(notMountedYet).not.toHaveBeenCalled()
      expect(settingsRequested()).toBe(true)
    } finally {
      off()
    }
  })
})
