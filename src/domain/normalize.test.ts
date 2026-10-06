import { describe, it, expect } from 'vitest'
import { normalizeAppData } from './normalize'
import { BUILTIN_COST_ITEMS, DEFAULT_DATA, DEFAULT_SETTINGS } from './types'
import type { AppData } from './types'

describe('normalizeAppData', () => {
  // 老数据的样子：AppData 加 preOrders 之前存进去的对象，settings 里只有 partners 与 costItems。
  // 手动写出补齐后的期望值，逐字钉住「补齐没有顺手改动别的字段」。
  it('老数据（缺 preOrders 与 preOrderLeadDays）补齐后其余字段逐字不变', () => {
    const legacy: unknown = {
      version: 1,
      settings: {
        partners: [{ id: 'p1', name: '我', shareRatio: 1 }],
        costItems: [{ id: 'purchase', name: '收购价', scope: 'dog', isBuiltin: true }],
      },
      batches: [{ id: 'b1', name: '一批', date: '2026-10-03', source: '农户', note: '', status: 'active', plannedChannel: 'undecided' }],
      dogs: [{
        id: 'd1', batchId: 'b1', code: '一批-1', breed: '土狗', sex: 'unknown', ageMonths: null,
        status: 'in_stock', note: '',
        rabiesVaccinatedOn: null, antibodyTestedOn: null, antibodyReportNo: '',
        quarantineCertNo: '', quarantineCertIssuedOn: null, quarantineCertValidUntil: null,
      }],
      entries: [{ id: 'e1', date: '2026-10-03', type: 'expense', category: 'purchase', amount: 120000, paidBy: 'pool', payee: null, batchId: 'b1', dogId: 'd1', note: '' }],
    }

    const expected = {
      version: 1,
      settings: {
        ...DEFAULT_SETTINGS,
        partners: [{ id: 'p1', name: '我', shareRatio: 1 }],
        costItems: [{ id: 'purchase', name: '收购价', scope: 'dog', isBuiltin: true }],
      },
      batches: [{ id: 'b1', name: '一批', date: '2026-10-03', source: '农户', note: '', status: 'active', plannedChannel: 'undecided' }],
      dogs: [{
        id: 'd1', batchId: 'b1', code: '一批-1', breed: '土狗', sex: 'unknown', ageMonths: null,
        status: 'in_stock', note: '',
        rabiesVaccinatedOn: null, antibodyTestedOn: null, antibodyReportNo: '',
        quarantineCertNo: '', quarantineCertIssuedOn: null, quarantineCertValidUntil: null,
      }],
      entries: [{ id: 'e1', date: '2026-10-03', type: 'expense', category: 'purchase', amount: 120000, paidBy: 'pool', payee: null, batchId: 'b1', dogId: 'd1', note: '' }],
      preOrders: [],
    }

    expect(normalizeAppData(legacy)).toEqual(expected)
  })

  it('完整数据原样通过，且不改动传入的对象', () => {
    const raw = structuredClone(DEFAULT_DATA)
    const snapshot = structuredClone(raw)
    expect(normalizeAppData(raw)).toEqual(DEFAULT_DATA)
    expect(raw).toEqual(snapshot)
  })

  it('集合字段不是数组时回落空数组，settings 不是对象时回落默认设置', () => {
    expect(normalizeAppData({ preOrders: null }).preOrders).toEqual([])
    expect(normalizeAppData({ entries: {} }).entries).toEqual([])
    expect(normalizeAppData({ settings: null }).settings).toEqual(DEFAULT_SETTINGS)
  })

  // costItems 与 partners 的回落口径**不同**，与 importBackup 的白名单逐字一致：
  // 本仓没有删除成本项的入口，costItems 为空只可能是手改或坏数据，透传下去会让
  // 记账时的支出类别下拉变成零个选项；而合伙人清空是一种真实状态，要原样保留。
  it('costItems 空数组回落内置项，partners 空数组原样保留', () => {
    const normalized = normalizeAppData({ settings: { costItems: [], partners: [] } })
    expect(normalized.settings.costItems.length).toBeGreaterThan(0)
    expect(normalized.settings.costItems).toEqual(BUILTIN_COST_ITEMS)
    expect(normalized.settings.partners).toEqual([])
  })

  it('垃圾输入返回默认数据', () => {
    expect(normalizeAppData(null)).toEqual(DEFAULT_DATA)
    expect(normalizeAppData('abc')).toEqual(DEFAULT_DATA)
    expect(normalizeAppData(42)).toEqual(DEFAULT_DATA)
    expect(normalizeAppData([])).toEqual(DEFAULT_DATA)
  })

  // 返回的对象一旦与 DEFAULT_DATA / BUILTIN_COST_ITEMS 共享引用，
  // 界面就地 push 一次就会永久污染模块常量，所有后续测试与新建数据都会中招。
  it('补齐时深拷贝模块常量，返回值与 DEFAULT_DATA 不共享引用', () => {
    const normalized: AppData = normalizeAppData(null)
    normalized.preOrders.push({
      id: 'p1', sellerName: '张大爷', sellerContact: '', expectedCount: 2, collectDate: '2026-10-05',
      traits: '', note: '', createdAt: '2026-10-03T00:00:00.000Z', status: 'reserved',
      receivedCount: 0, receivedBatchId: null, cancelReason: '',
    })
    expect(DEFAULT_DATA.preOrders).toEqual([])

    normalized.settings.costItems.push({ id: 'feed', name: '狗粮', scope: 'batch', isBuiltin: false })
    expect(BUILTIN_COST_ITEMS).toHaveLength(6)
  })
})
