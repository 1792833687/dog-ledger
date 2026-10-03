import { describe, it, expect, vi } from 'vitest'
import { loadPersistedData, persistData } from './persistence'
import type { Storage } from '../storage/types'
import { indexedDbStorage } from '../storage/indexeddb'
import { createMemoryStorage } from '../storage/memory'
import { DEFAULT_DATA } from '../domain/types'

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
