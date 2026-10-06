import type { AppData } from '../domain/types'
import { DEFAULT_SETTINGS, BUILTIN_COST_ITEMS } from '../domain/types'

const APP_TAG = 'dog-ledger'
const CURRENT_VERSION = 1

export function exportBackup(data: AppData): string {
  return JSON.stringify({
    app: APP_TAG,
    version: CURRENT_VERSION,
    exportedAt: new Date().toISOString(),
    data,
  })
}

export function importBackup(json: string): AppData {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('备份文件不是合法的 JSON')
  }

  const file = parsed as { app?: unknown; data?: unknown }
  if (!file || typeof file !== 'object' || file.app !== APP_TAG) {
    throw new Error('这不是狗账的备份文件')
  }

  const data = file.data as Partial<AppData> | undefined
  if (!data || typeof data !== 'object'
    || !data.settings || !Array.isArray(data.batches)
    || !Array.isArray(data.dogs) || !Array.isArray(data.entries)) {
    throw new Error('备份文件结构不完整')
  }

  return {
    version: CURRENT_VERSION,
    settings: {
      ...DEFAULT_SETTINGS,
      ...data.settings,
      partners: data.settings.partners ?? DEFAULT_SETTINGS.partners,
      costItems: data.settings.costItems?.length ? data.settings.costItems : BUILTIN_COST_ITEMS,
    },
    batches: data.batches,
    dogs: data.dogs,
    entries: data.entries,
    // 这里**不能**写 []：exportBackup 是原样序列化整个 data，写死空数组会造成
    // 「导出时带着预定单、导入回来就没了」，而只测旧格式导入的用例照样全绿，
    // 丢数据这件事要等用户真去导一次才发现。
    preOrders: data.preOrders ?? [],
  }
}
