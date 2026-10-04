import type { ChannelId, SalesChannelDef } from '../domain/types'
import { SALES_CHANNELS } from '../domain/types'
import type { ChannelInput } from '../domain/channels'
import { parseMoney } from '../domain/money'

/**
 * 「算」页面渠道对照与批次「计划去向」下拉用到的纯函数。
 *
 * 抽出来是为了能单测：这里查错渠道、把「还没填」和「填错了」混成一件事、
 * 或者算出个错的默认存活数，用户就会看到错的中文名、或者把固定成本摊到错误的只数上。
 * 全部是纯函数，**不 import React**（与 `dogLedger.ts` / `moneyBook.ts` / `quarantineView.ts` 同一套路）。
 *
 * 这里**没有任何成本算法**：保本价与利润由 `src/domain/channels.ts` 的
 * `compareChannelCosts` 算，本文件只负责把界面上的文本翻译成它的入参。
 */

/** 按 id 找渠道定义。找不到返回 `null`（旧备份里可能有本版本不认识的渠道）。 */
export function findChannel(id: string): SalesChannelDef | null {
  return SALES_CHANNELS.find(c => c.id === id) ?? null
}

/** 渠道 id → 中文名。查不到时原样返回 id 本身（旧备份里可能有未知渠道）。 */
export function channelName(id: string): string {
  return findChannel(id)?.name ?? id
}

/** 渠道对照里「存活数」输入框的默认值：预估存活数向上取整，至少 1。 */
export function defaultAliveInput(expectedAlive: number): number {
  return Math.max(1, Math.ceil(expectedAlive))
}

/**
 * 渠道对照表里逐行列出的渠道：`SALES_CHANNELS` 去掉 `undecided`。
 *
 * 「还没定」不是一个可以报价的路子（它没有自己的成本结构与固定成本），
 * 所以它不进这张逐行表，而是表格上方单独一个默认选中的单选 —— 行为 6 需要一个
 * 「这批还没定」的选项，但它不该被当成第 9 条渠道去算保本价。
 */
export function comparisonChannels(): SalesChannelDef[] {
  return SALES_CHANNELS.filter(c => c.id !== 'undecided')
}

/** 下拉里的一项。`id` 用 `string` 而不是 `ChannelId`：未知渠道会被补进来。 */
export interface ChannelOption {
  id: string
  name: string
}

/**
 * 批次详情「计划去向」下拉的选项：`SALES_CHANNELS` 全部（含 `undecided`）。
 *
 * `current` 是账本里当前存着的值；若它不在清单里就补一条。不补的话，
 * `<select value={未知值}>` 在浏览器里会静默显示成第一条（「未定」），
 * 用户看到的名字与他实际存着的去向不一致，一碰就被改掉了（旧备份通过
 * `src/storage/backup.ts` 的 `JSON.parse` 直接进应用，未知渠道是真会出现的）。
 */
export function channelOptions(current: string): ChannelOption[] {
  const options: ChannelOption[] = SALES_CHANNELS.map(c => ({ id: c.id, name: c.name }))
  if (findChannel(current) === null) {
    options.push({ id: current, name: `${current}（未知渠道）` })
  }
  return options
}

/** 渠道对照里一行的三个输入框文本。 */
export interface ChannelRowText {
  unitPrice: string
  extraPerDog: string
  fixedCost: string
}

const EMPTY_ROW: ChannelRowText = { unitPrice: '', extraPerDog: '', fixedCost: '' }

/** 逐行输入框的初始状态：8 条渠道、三格全空（空 = 按 0 算）。 */
export function emptyChannelRows(): Record<string, ChannelRowText> {
  const rows: Record<string, ChannelRowText> = {}
  for (const c of comparisonChannels()) rows[c.id] = { ...EMPTY_ROW }
  return rows
}

/**
 * 解析一行输入后的结果：就是 `compareChannelCosts` 要的一条入参，外加一个 `invalid`。
 *
 * `invalid` 为 true 时三个金额都退回了 0，**调用方必须靠它把这一行的结论藏起来**，
 * 不许把退回的 0 当成真的报价显示出去。
 */
export interface ParsedChannelRow extends ChannelInput {
  /** true = 这一行有「填了但不是数字」或「填了负数」的格子 */
  invalid: boolean
}

/** 一个输入框的文本 → 分。空 = 0；填了但不是合法金额 = invalid。 */
function amount(raw: string): { fen: number; invalid: boolean } {
  const trimmed = raw.trim()
  // 必须自己判空：`parseMoney('')` 返回的也是 null，直接用它会分不清
  // 「留空（= 0，任务书要求）」与「填错了（= 不许当 0）」，而后者会变成一个
  // 看着正常、实际偏低的保本价，用户会照着它出门定价。
  if (trimmed === '') return { fen: 0, invalid: false }
  const parsed = parseMoney(trimmed)
  if (parsed === null || parsed < 0) return { fen: 0, invalid: true }
  return { fen: parsed, invalid: false }
}

/** 解析一行的三个输入框。 */
export function parseChannelRow(channelId: ChannelId, row: ChannelRowText): ParsedChannelRow {
  const unitPrice = amount(row.unitPrice)
  const extra = amount(row.extraPerDog)
  const fixed = amount(row.fixedCost)
  return {
    channelId,
    unitPriceFen: unitPrice.fen,
    extraPerDogFen: extra.fen,
    fixedCostFen: fixed.fen,
    invalid: unitPrice.invalid || extra.invalid || fixed.invalid,
  }
}

/** 8 行文本 → `compareChannelCosts` 的入参；顺序与 `comparisonChannels()` 一致。 */
export function channelInputsFromRows(rows: Record<string, ChannelRowText>): ParsedChannelRow[] {
  return comparisonChannels().map(c => parseChannelRow(c.id, rows[c.id] ?? EMPTY_ROW))
}

/**
 * 解析「存活数」。它是「几只狗」，所以只收整数；空串按 0 处理（还没填）。
 *
 * 这里**不做取整也不做夹取**：用户填 0 就传 0（`compareChannelCosts` 有
 * `aliveDogCount === 0` 的分支，固定成本摊成 0，不会除零）。界面替用户改数，
 * 他就永远看不到自己填错了。
 */
export function parseAliveInput(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed === '') return 0
  if (!/^\d+$/.test(trimmed)) return null
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : null
}
