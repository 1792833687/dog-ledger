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

  // exportBackup 原样序列化整个 data，而 importBackup 是逐字重建的白名单对象：
  // 白名单里漏一个字段，就会「导出含预定单、导入就丢」，而只测旧格式导入的用例照样全绿。
  it('预定单经导出再导入后逐条还原', () => {
    const data = {
      ...DEFAULT_DATA,
      preOrders: [
        {
          id: 'p1', sellerName: '张大爷', sellerContact: '13800000000', expectedCount: 3,
          collectDate: '2026-10-05', traits: '两只黄的一只黑的', note: '说好周日上午去',
          createdAt: '2026-10-03T08:30:00.000Z', status: 'reserved' as const,
          receivedCount: 0, receivedBatchId: null, cancelReason: '',
        },
        {
          id: 'p2', sellerName: '李婶', sellerContact: '', expectedCount: 1,
          collectDate: '2026-10-04', traits: '', note: '',
          createdAt: '2026-10-04T09:00:00.000Z', status: 'received' as const,
          receivedCount: 1, receivedBatchId: 'b1', cancelReason: '',
        },
      ],
    }
    expect(importBackup(exportBackup(data)).preOrders).toEqual(data.preOrders)
  })

  it('导入不含 preOrders 的旧备份时预定单是空数组', () => {
    const legacy = JSON.stringify({
      app: 'dog-ledger', version: 1, exportedAt: '2026-10-03T00:00:00.000Z',
      data: {
        version: 1,
        settings: { partners: [{ id: 'p1', name: '我', shareRatio: 1 }], costItems: [] },
        batches: [], dogs: [], entries: [],
      },
    })
    expect(importBackup(legacy).preOrders).toEqual([])
  })
})
