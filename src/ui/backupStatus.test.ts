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
})
