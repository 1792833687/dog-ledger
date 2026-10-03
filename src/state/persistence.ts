import type { AppData } from '../domain/types'
import type { Storage } from '../storage/types'

/**
 * 读取已保存的数据；存储不可用时返回 null，**绝不 reject**。
 *
 * `indexedDbStorage.load()` 在没有 IndexedDB 的环境里（Node 跑测试、浏览器隐私模式）
 * 会**异步** reject（`ReferenceError: indexedDB is not defined`）。如果把这个 rejection
 * 直接交给界面，启动路径上的「ready」标志就永远不会翻转，界面会永远停在「正在载入…」
 * —— 也就是一块白屏。所以在这里把失败翻译成「没有已保存的数据」，让界面照常起来。
 */
export async function loadPersistedData(storage: Storage): Promise<AppData | null> {
  try {
    return await storage.load()
  } catch {
    return null
  }
}

/**
 * 尽力保存：失败（存储不可用、配额满）时不让 Promise reject —— 否则每次改动都会抛出
 * 一个未处理的 rejection。降级为「这次改动只留在内存里」，并留一条控制台警告。
 */
export async function persistData(storage: Storage, data: AppData): Promise<void> {
  try {
    await storage.save(data)
  } catch (err) {
    console.warn('[狗账] 本地存储不可用，这次改动只留在内存里', err)
  }
}
