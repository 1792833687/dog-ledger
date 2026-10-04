import { describe, it, expect } from 'vitest'
import { daysSinceBackup, shouldWarnBackup } from './backupStatus'

describe('daysSinceBackup', () => {
  it('从未备份时返回 null', () => {
    expect(daysSinceBackup(null, new Date('2026-10-03T10:00:00Z'))).toBeNull()
  })
  it('同一天返回 0', () => {
    expect(daysSinceBackup('2026-10-03T08:00:00Z', new Date('2026-10-03T20:00:00Z'))).toBe(0)
  })
  it('三天前返回 3', () => {
    expect(daysSinceBackup('2026-09-30T08:00:00Z', new Date('2026-10-03T09:00:00Z'))).toBe(3)
  })
  // 界面上的 now 是挂载时取的（useState 惰性初始化，渲染体里不许调 new Date()），
  // 而 lastBackupAt 是点完导出才写进去的 —— 于是刚导完那一瞬间 lastBackupAt 比 now 晚，
  // 差值算出来是 -1，面板会显示「-1 天前备份过」。天数没有负的，按 0 算。
  it('备份时间比 now 还晚（刚点完导出）→ 按 0 算，不出现负数', () => {
    expect(daysSinceBackup('2026-10-03T09:00:01Z', new Date('2026-10-03T09:00:00Z'))).toBe(0)
  })
})

describe('shouldWarnBackup', () => {
  it('从未备份且已有数据 → 警告', () => {
    expect(shouldWarnBackup(null, 5, new Date('2026-10-03T09:00:00Z'))).toBe(true)
  })
  it('从未备份但没有数据 → 不警告', () => {
    expect(shouldWarnBackup(null, 0, new Date('2026-10-03T09:00:00Z'))).toBe(false)
  })
  it('3 天前备份过且有数据 → 警告', () => {
    expect(shouldWarnBackup('2026-09-30T08:00:00Z', 5, new Date('2026-10-03T09:00:00Z'))).toBe(true)
  })
  it('1 天前备份过 → 不警告', () => {
    expect(shouldWarnBackup('2026-10-02T08:00:00Z', 5, new Date('2026-10-03T09:00:00Z'))).toBe(false)
  })
  it('备份时间比 now 还晚（刚点完导出）→ 不警告', () => {
    expect(shouldWarnBackup('2026-10-03T09:00:01Z', 5, new Date('2026-10-03T09:00:00Z'))).toBe(false)
  })
})
