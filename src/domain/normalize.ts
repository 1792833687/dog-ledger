import { DEFAULT_DATA, DEFAULT_SETTINGS } from './types'
import type { AppData, Settings } from './types'

/**
 * 把存储里读回来的任意对象补齐成当前版本的 AppData。
 *
 * 这是 AppData 加字段后的「老数据补齐」落点：用户手机上已有的数据是在 preOrders 与
 * preOrderLeadDays 出现之前写进去的，读回来必须能照常使用。**version 不升** —— 这里只补
 * 缺字段、不改语义，没有值得做破坏性迁移的变更，升版本号只会把老数据挡在门外。
 *
 * 导入路径不跑本函数：那边在 `importBackup` 的白名单对象里显式补，两条路径各自保持
 * 自己已经测过的口径。
 *
 * 纯函数：不就地修改传入的 raw，返回的对象与模块常量不共享引用（内部做深拷贝）。
 */
export function normalizeAppData(raw: unknown): AppData {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return structuredClone(DEFAULT_DATA)
  }

  const source = raw as Partial<AppData>
  const { settings } = source
  const sourceSettings: Partial<Settings> =
    settings !== undefined && settings !== null && typeof settings === 'object' && !Array.isArray(settings)
      ? settings
      : {}

  const { partners, costItems } = sourceSettings

  return structuredClone({
    version: 1,
    batches: Array.isArray(source.batches) ? source.batches : [],
    dogs: Array.isArray(source.dogs) ? source.dogs : [],
    entries: Array.isArray(source.entries) ? source.entries : [],
    preOrders: Array.isArray(source.preOrders) ? source.preOrders : [],
    settings: {
      ...DEFAULT_SETTINGS,
      ...sourceSettings,
      partners: Array.isArray(partners) ? partners : DEFAULT_SETTINGS.partners,
      costItems: Array.isArray(costItems) ? costItems : DEFAULT_SETTINGS.costItems,
    },
  })
}
