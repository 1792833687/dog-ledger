import type { AppData } from '../domain/types'
import type { Storage } from './types'

/** 内存实现，只用于测试。存入时做深拷贝，模拟真实存储的隔离性。 */
export function createMemoryStorage(): Storage {
  let stored: AppData | null = null
  return {
    async load() {
      return stored === null ? null : structuredClone(stored)
    },
    async save(data) {
      stored = structuredClone(data)
    },
    async clear() {
      stored = null
    },
  }
}
