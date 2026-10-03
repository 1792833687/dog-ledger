import { describe, it, expect } from 'vitest'
import { exportBackup, importBackup } from './backup'
import { DEFAULT_DATA } from '../domain/types'

describe('exportBackup / importBackup', () => {
  it('导出再导入得到等价数据', () => {
    const data = {
      ...DEFAULT_DATA,
      batches: [{ id: 'b1', name: '一批', date: '2026-10-03', source: '农户', note: '', status: 'active' as const, plannedChannel: 'undecided' as const }],
    }
    const json = exportBackup(data)
    expect(importBackup(json)).toEqual(data)
  })

  it('导出内容带应用标识和版本，防止导错文件', () => {
    const parsed = JSON.parse(exportBackup(DEFAULT_DATA))
    expect(parsed.app).toBe('dog-ledger')
    expect(parsed.version).toBe(1)
    expect(typeof parsed.exportedAt).toBe('string')
  })

  it('拒绝非本应用的文件', () => {
    expect(() => importBackup('{"app":"something-else","data":{}}')).toThrow('这不是狗账的备份文件')
  })

  it('拒绝非法 JSON', () => {
    expect(() => importBackup('not json')).toThrow('备份文件不是合法的 JSON')
  })

  it('拒绝缺少必要集合的文件', () => {
    const bad = JSON.stringify({ app: 'dog-ledger', version: 1, data: { settings: {} } })
    expect(() => importBackup(bad)).toThrow('备份文件结构不完整')
  })

  it('补全缺失的可选设置字段，避免旧备份炸掉新版本', () => {
    const partial = JSON.stringify({
      app: 'dog-ledger', version: 1, exportedAt: '2026-10-03T00:00:00.000Z',
      data: { settings: { partners: [{ id: 'p1', name: '我', shareRatio: 1 }] }, batches: [], dogs: [], entries: [] },
    })
    const restored = importBackup(partial)
    expect(restored.settings.targetMarginRate).toBe(0.3)
    expect(restored.settings.expectedMortalityRate).toBe(0.15)
    expect(restored.settings.costItems.length).toBeGreaterThan(0)
  })
})
