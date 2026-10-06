import { describe, it, expect, vi } from 'vitest'
import { loadPersistedData, persistData } from './persistence'
import type { Storage } from '../storage/types'
import { indexedDbStorage } from '../storage/indexeddb'
import { createMemoryStorage } from '../storage/memory'
import { DEFAULT_DATA } from '../domain/types'
import type { AppData } from '../domain/types'

/** 只用于本用例：模拟「老版本存下来的对象缺了新字段」这种运行时状态。 */
type DeepPartial<T> = T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T

/** 一个永远失败的存储：模拟浏览器不给 IndexedDB，或配额已满。 */
const failingStorage: Storage = {
  load: () => Promise.reject(new Error('indexedDB is not defined')),
  save: () => Promise.reject(new Error('indexedDB is not defined')),
  clear: () => Promise.reject(new Error('indexedDB is not defined')),
}

describe('loadPersistedData', () => {
  it('存储里有数据时原样读回', async () => {
    const storage = createMemoryStorage()
    await storage.save(DEFAULT_DATA)
    expect(await loadPersistedData(storage)).toEqual(DEFAULT_DATA)
  })

  it('存储里没有数据时返回 null', async () => {
    expect(await loadPersistedData(createMemoryStorage())).toBeNull()
  })

  // 用户手机上已有的数据是在 preOrders 与 preOrderLeadDays 出现之前写的，
  // 读回来必须照常能用，而不是缺字段让界面炸掉。
  it('读回缺 preOrders 与 preOrderLeadDays 的老数据时补齐', async () => {
    const storage = createMemoryStorage()
    // 老版本写进 IndexedDB 的对象根本没有这两个键，所以从今天的真数据出发把键删掉最贴切。
    // DeepPartial 只是「删键」这件事的类型视图；下一步 save 要的是真实存储内容，
    // 那里必须还原成 AppData（本用例模拟的正是「运行时缺键但界面照常处理」）。
    const legacy: DeepPartial<AppData> = structuredClone(DEFAULT_DATA)
    Reflect.deleteProperty(legacy, 'preOrders')
    Reflect.deleteProperty(legacy.settings!, 'preOrderLeadDays')

    // 没有这两条断言，将来 DEFAULT_DATA 一旦不再带这两个键，本用例会静默空转。
    expect('preOrders' in legacy).toBe(false)
    expect('preOrderLeadDays' in legacy.settings!).toBe(false)

    await storage.save(legacy as AppData)

    const loaded = await loadPersistedData(storage)
    expect(loaded?.preOrders).toEqual([])
    expect(loaded?.settings.preOrderLeadDays).toBe(3)
    expect(loaded?.settings.partners).toEqual(DEFAULT_DATA.settings.partners)
  })

  // 这是整个应用骨架最容易挂掉的一条路径：启动时 storage.load() 一旦 reject，
  // 「ready」标志就永远不翻转，界面永远停在「正在载入…」，也就是一块白屏。
  it('load 失败时返回 null，绝不 reject', async () => {
    await expect(loadPersistedData(failingStorage)).resolves.toBeNull()
  })

  it('真实的 indexedDbStorage 在没有 IndexedDB 的 Node 环境下返回 null', async () => {
    expect(typeof globalThis.indexedDB).toBe('undefined')
    await expect(loadPersistedData(indexedDbStorage)).resolves.toBeNull()
  })
})

describe('persistData', () => {
  it('写入后能从存储读回', async () => {
    const storage = createMemoryStorage()
    await persistData(storage, DEFAULT_DATA)
    expect(await storage.load()).toEqual(DEFAULT_DATA)
  })

  it('save 失败时不抛错，只降级（避免每次改动都产生未处理的 rejection）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await expect(persistData(failingStorage, DEFAULT_DATA)).resolves.toBeUndefined()
      expect(warn).toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })
})
