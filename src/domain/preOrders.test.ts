import { describe, it, expect } from 'vitest'
import { DEFAULT_DATA } from './types'
import type { AppData, PreOrder } from './types'
import { preOrderStage, duePreOrderCount, preOrderList } from './preOrders'

/** 造一张预定单。要试哪个字段就在参数里覆盖它，其余字段给一份合理的默认值。 */
function order(patch: Partial<PreOrder>): PreOrder {
  return {
    id: 'p1',
    sellerName: '老李',
    sellerContact: '13800000000',
    expectedCount: 6,
    collectDate: '2026-10-10',
    traits: '黑色，公',
    note: '',
    createdAt: '2026-10-01T09:00:00.000Z',
    status: 'reserved',
    receivedCount: 0,
    receivedBatchId: null,
    cancelReason: '',
    ...patch,
  }
}

/** 把几张预定单塞进一份空台账，供 duePreOrderCount / preOrderList 用。 */
function withOrders(orders: PreOrder[]): AppData {
  return { ...DEFAULT_DATA, preOrders: orders }
}

/** 清单结果只取 id 顺序，用来断言排序 */
function idsOf(list: { order: PreOrder }[]): string[] {
  return list.map(item => item.order.id)
}

describe('preOrderStage', () => {
  it('约定的那天就是今天 —— 算 due_soon（今天去收），不是 overdue', () => {
    expect(preOrderStage(order({ collectDate: '2026-10-10' }), '2026-10-10', 3)).toBe('due_soon')
  })

  it('正好提前 leadDays 天 —— 算 due_soon（提前提醒的第一天）', () => {
    expect(preOrderStage(order({ collectDate: '2026-10-10' }), '2026-10-07', 3)).toBe('due_soon')
  })

  it('再早一天 —— 还是 upcoming（提醒还没开始）', () => {
    expect(preOrderStage(order({ collectDate: '2026-10-10' }), '2026-10-06', 3)).toBe('upcoming')
  })

  it('过了约定的那天 —— overdue（晚一天就算过期）', () => {
    expect(preOrderStage(order({ collectDate: '2026-10-10' }), '2026-10-11', 3)).toBe('overdue')
  })

  it('leadDays = 0 —— 只有当天算 due_soon', () => {
    expect(preOrderStage(order({ collectDate: '2026-10-10' }), '2026-10-10', 0)).toBe('due_soon')
    expect(preOrderStage(order({ collectDate: '2026-10-10' }), '2026-10-09', 0)).toBe('upcoming')
  })

  it('leadDays = 0 —— 昨天算 overdue', () => {
    expect(preOrderStage(order({ collectDate: '2026-10-10' }), '2026-10-11', 0)).toBe('overdue')
  })

  it('cancelled 优先于任何日期判定，哪怕约定的日子早就过了', () => {
    const cancelled = order({ collectDate: '2020-01-01', status: 'cancelled' })
    expect(preOrderStage(cancelled, '2026-10-10', 3)).toBe('cancelled')
  })

  it('received 优先于任何日期判定，哪怕约定的日子早就过了', () => {
    const received = order({ collectDate: '2020-01-01', status: 'received' })
    expect(preOrderStage(received, '2026-10-10', 3)).toBe('received')
  })

  it('collectDate 是空串 —— 返回 upcoming，不抛错', () => {
    expect(preOrderStage(order({ collectDate: '' }), '2026-10-10', 3)).toBe('upcoming')
  })

  it('collectDate 不是日期 —— 返回 upcoming，不抛错', () => {
    // addDays 对非法日期串会抛 RangeError: Invalid time value（Date.UTC 得出 NaN），
    // 所以 preOrderStage 必须先校验形状再调它。这条用例就是钉住这一点。
    expect(preOrderStage(order({ collectDate: '不是日期' }), '2026-10-10', 3)).toBe('upcoming')
  })

  it('年月日位数对但日期不存在（2 月 30 日）—— 不抛错', () => {
    // 形状校验挡不住 2026-02-30 这种串，但 Date.UTC 会把它滚到 3 月 2 日而**不抛**，
    // 所以这里只要求「有个阶段、不炸」，不给它定死是哪一态。
    // 不做闰年 / 按月天数校验是**刻意**的：真实录入走 <input type="date">，浏览器保证
    // 是合法日历日；手改数据里的 '2026-02-30' 最坏只是「日子挪了几天」，不值得为它写
    // 十几行日历逻辑。这条用例就是这条裁定的说明书，别顺手把校验补上。
    expect(['upcoming', 'due_soon', 'overdue']).toContain(
      preOrderStage(order({ collectDate: '2026-02-30' }), '2026-10-10', 3),
    )
  })

  it('leadDays = -1 —— 当天还是 due_soon，不是 overdue', () => {
    // 「提前几天提醒」是提前量，-1 没有意义，一律当 0（只有当天算 due_soon）。
    expect(preOrderStage(order({ collectDate: '2026-10-10' }), '2026-10-10', -1)).toBe('due_soon')
    expect(preOrderStage(order({ collectDate: '2026-10-10' }), '2026-10-11', -1)).toBe('overdue')
    expect(preOrderStage(order({ collectDate: '2026-10-10' }), '2026-10-09', -1)).toBe('upcoming')
  })

  it('leadDays = NaN —— 当天 due_soon，且不抛错', () => {
    // 坏设置同样不能让界面白屏：不能写 Math.max(0, NaN)（结果还是 NaN，addDays 会抛）。
    expect(preOrderStage(order({ collectDate: '2026-10-10' }), '2026-10-10', Number.NaN)).toBe('due_soon')
    expect(preOrderStage(order({ collectDate: '2026-10-10' }), '2026-10-11', Number.NaN)).toBe('overdue')
    expect(preOrderStage(order({ collectDate: '2026-10-10' }), '2026-10-09', Number.NaN)).toBe('upcoming')
  })
})

describe('duePreOrderCount', () => {
  it('overdue + due_soon 各一张、upcoming 一张 —— 合起来算 2 张', () => {
    const data = withOrders([
      order({ id: 'o1', collectDate: '2026-10-01' }), // 已过期
      order({ id: 'o2', collectDate: '2026-10-11' }), // 今天是 10-10，落进三天提醒窗口
      order({ id: 'o3', collectDate: '2026-10-30' }), // 还早
    ])
    expect(duePreOrderCount(data, '2026-10-10')).toBe(2)
  })

  it('已收货与已取消的都不算「该去收了」', () => {
    const data = withOrders([
      order({ id: 'o1', collectDate: '2026-10-01', status: 'received', receivedCount: 6, receivedBatchId: 'b1' }),
      order({ id: 'o2', collectDate: '2026-10-01', status: 'cancelled', cancelReason: '卖家不卖了' }),
    ])
    expect(duePreOrderCount(data, '2026-10-10')).toBe(0)
  })

  it('一张预定单都没有 —— 0', () => {
    expect(duePreOrderCount(DEFAULT_DATA, '2026-10-10')).toBe(0)
  })
})

describe('preOrderList', () => {
  it('五种阶段的精确顺序：该去收的（overdue 按日期在前）→ upcoming → received/cancelled 按 createdAt 降序', () => {
    const u1 = order({ id: 'u1', collectDate: '2026-11-01' })
    const r1 = order({ id: 'r1', collectDate: '2026-10-01', status: 'received', receivedCount: 6, receivedBatchId: 'b1', createdAt: '2026-09-01T09:00:00.000Z' })
    const d1 = order({ id: 'd1', collectDate: '2026-10-11' }) // 今天 10-10，due_soon
    const c1 = order({ id: 'c1', collectDate: '2026-10-01', status: 'cancelled', cancelReason: '黄了', createdAt: '2026-10-05T09:00:00.000Z' })
    const o1 = order({ id: 'o1', collectDate: '2026-10-02' }) // overdue
    const u2 = order({ id: 'u2', collectDate: '2026-10-20' }) // upcoming
    const data = withOrders([u1, r1, d1, c1, o1, u2])

    expect(preOrderList(data, '2026-10-10')).toEqual([
      { order: o1, stage: 'overdue' },
      { order: d1, stage: 'due_soon' },
      { order: u2, stage: 'upcoming' },
      { order: u1, stage: 'upcoming' },
      { order: c1, stage: 'cancelled' },
      { order: r1, stage: 'received' },
    ])
  })

  it('该去收的一组里：同一天的话 overdue 排在 due_soon 前面，日期近的排前面', () => {
    const data = withOrders([
      order({ id: 'b', collectDate: '2026-10-13' }), // 今天 → due_soon
      order({ id: 'm', collectDate: '2026-10-13' }), // 今天 → due_soon（同日期，靠 id 兜底）
      order({ id: 'c', collectDate: '2026-10-12' }), // 昨天 → overdue
      order({ id: 'a', collectDate: '2026-10-10' }), // 前天 → overdue（日期最早）
    ])
    const stages = preOrderList(data, '2026-10-13')
    expect(idsOf(stages)).toEqual(['a', 'c', 'b', 'm'])
    expect(stages.map(item => item.stage)).toEqual(['overdue', 'overdue', 'due_soon', 'due_soon'])
  })

  it('相同 collectDate 时用 id 兜底 —— 两次调用顺序完全一致', () => {
    const data = withOrders([
      order({ id: 'z', collectDate: '2026-10-20' }),
      order({ id: 'a', collectDate: '2026-10-20' }),
      order({ id: 'm', collectDate: '2026-10-20' }),
    ])
    const once = idsOf(preOrderList(data, '2026-10-10'))
    const twice = idsOf(preOrderList(data, '2026-10-10'))
    expect(once).toEqual(['a', 'm', 'z'])
    expect(twice).toEqual(once)
  })

  it('清单里带的是原样的预定单对象（不改、不复制）', () => {
    const one = order({ id: 'only' })
    const listed = preOrderList(withOrders([one]), '2026-10-10')
    expect(listed).toHaveLength(1)
    expect(listed[0].order).toBe(one)
  })

  it('一张预定单都没有 —— 空数组', () => {
    expect(preOrderList(DEFAULT_DATA, '2026-10-10')).toEqual([])
  })
})
