import { describe, it, expect } from 'vitest'
import { createMemoryStorage } from './memory'
import { DEFAULT_DATA } from '../domain/types'
import type { AppData } from '../domain/types'

describe('createMemoryStorage', () => {
  it('没有数据时 load 返回 null', async () => {
    expect(await createMemoryStorage().load()).toBeNull()
  })

  it('保存后能原样读回', async () => {
    const s = createMemoryStorage()
    const data = { ...DEFAULT_DATA, batches: [{ id: 'b1', name: 'x', date: '2026-10-03', source: '', note: '', status: 'active' as const, plannedChannel: 'undecided' as const }] }
    await s.save(data)
    expect(await s.load()).toEqual(data)
  })

  it('clear 后 load 返回 null', async () => {
    const s = createMemoryStorage()
    await s.save(DEFAULT_DATA)
    await s.clear()
    expect(await s.load()).toBeNull()
  })

  it('存进来的对象是快照，之后修改原对象不影响已存数据', async () => {
    const s = createMemoryStorage()
    // 计划原文这里写的是 `const data = { ...DEFAULT_DATA, batches: [] }`，
    // 但 `[]` 会被推断成 `never[]`，下面那句 push 直接 tsc 报 TS2345。
    // 加显式类型标注（不是 as 断言）：空数组按 AppData.batches 的 Batch[] 定型。
    const data: AppData = { ...DEFAULT_DATA, batches: [] }
    await s.save(data)
    data.batches.push({ id: 'b9', name: 'late', date: '2026-10-04', source: '', note: '', status: 'active', plannedChannel: 'undecided' })
    expect((await s.load())!.batches).toHaveLength(0)
  })
})
