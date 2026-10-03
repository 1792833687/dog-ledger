import type { Money } from '../domain/types'
import { parseMoney } from '../domain/money'

/**
 * 「设置」面板里那几个数字输入框的纯逻辑。
 *
 * 为什么要单独抽一个模块：这一页的输入框**不能**把 `value` 直接绑到账上的数字上。
 * `fenToTextInput(120000)` 是 `'1200'` —— 想填 1200.50 的人敲到 `1200.` 的那一刻，
 * 小数点会被重渲抹掉，接着敲 `5` 就成了 `12005`（差 10 倍）；毛利率填 60.5 会变成 605%。
 * 所以每个框都留一份**本地草稿**，显示草稿、只有解析成功才写账，解析不了就报红字。
 * 这里放的就是「草稿怎么变、账写什么」的判定，能单测。
 */

/** 数字输入框的种类。拼错不会静默通过（`inputError` 是穷尽 switch）。 */
export type InputKind = 'ratio' | 'margin' | 'mortality' | 'money'

/** 输入框文本 -> 数字。空串与不是数字的（含 `1e999`）都返回 `null`。 */
function parseNumber(raw: string): number | null {
  const text = raw.trim()
  if (text === '') return null
  const n = Number(text)
  return Number.isFinite(n) ? n : null
}

/**
 * 比例 -> 输入框里显示的文本。
 *
 * 保留两位小数：`Math.round(ratio * 100)` 会把 60.5% 显示成「61」，于是「看到的」与
 * 「存下的」对不上。`* 10000` 之后再除回来是为了避开 `0.07 * 100 === 7.000000000000001`
 * 这类浮点尾巴。
 */
export function formatPercent(ratio: number): string {
  return String(Math.round(ratio * 10000) / 100)
}

/** 分成比例 / 目标毛利率：任何有限的数字都收，范围由 `validateSettings` 去报。 */
export function applyPercentInput(raw: string): { draft: string; ratio: number | null } {
  const percent = parseNumber(raw)
  return { draft: raw, ratio: percent === null ? null : percent / 100 }
}

/**
 * 默认预估死亡率：夹到 0~99%（`validateSettings` 要求 `>= 0 && < 1`）。
 *
 * **只有真的夹了才改写草稿** —— 否则打 `12.` 的那一下会被改写成 `12`，小数点又没了，
 * 想填 12.5 的人永远填不进去。夹住的时候改写草稿是故意的：让「框里显示的」就是「存下的」。
 */
export function applyMortalityInput(raw: string): { draft: string; ratio: number | null } {
  const percent = parseNumber(raw)
  if (percent === null) return { draft: raw, ratio: null }
  const clamped = Math.min(99, Math.max(0, percent))
  return { draft: clamped === percent ? raw : String(clamped), ratio: clamped / 100 }
}

/**
 * 检疫费 / 病死犬处理费（单位分）。
 *
 * 负数不收：检疫费填 -100 元会让成本凭空变小，而 `validateSettings` 不检查这两项，
 * 静默存下去没人会发现。要改回 0 就填 0。
 */
export function applyMoneyInput(raw: string): { draft: string; fen: Money | null } {
  const fen = parseMoney(raw)
  if (fen === null || fen < 0) return { draft: raw, fen: null }
  return { draft: raw, fen }
}

/**
 * 这个框下面要不要显示红字。返回 `undefined` 表示合法（`Field` 的 `error` prop 就是不传）。
 *
 * 只有「填了但不是数字」（以及钱填成负数）才算输入错误：**数字但越界不算** ——
 * 死亡率越界会被夹住，比例越界由页面底部那句 `validateSettings` 的红字去说
 * （分成比例之和必须等于 100%），一个框一条红字比两处报同一件事清楚。
 */
export function inputError(kind: InputKind, raw: string): string | undefined {
  const text = raw.trim()
  if (text === '') return undefined
  switch (kind) {
    case 'money': {
      const fen = parseMoney(text)
      if (fen === null) return '金额只能填数字，例如 1200 或 1200.50'
      if (fen < 0) return '金额不能是负数，还不知道就填 0'
      return undefined
    }
    case 'mortality':
      return parseNumber(text) === null ? '填一个 0~99 之间的数字，例如 15 或 12.5' : undefined
    case 'ratio':
    case 'margin':
      return parseNumber(text) === null ? '填一个数字，例如 30 或 30.5' : undefined
  }
}
