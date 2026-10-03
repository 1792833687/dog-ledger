import type { Money } from '../domain/types'
import { parseMoney } from '../domain/money'
// 死亡率的解析规则**只有这一处**（`src/ui/planForm.ts`）。「算」页与「设置」页必须给同一个
// 输入同一个结论，所以这里复用而不是重写一遍。
import { parseMortalityPercent } from './planForm'

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
 * 默认预估死亡率：越界**拒绝**，不夹取（`parseMortalityPercent` 要求 0~99%）。
 *
 * 早先这里是把输入夹到 0~99 再写账的，坏处是静默：填 125 的人框里看到 99、没有红字，
 * 以为设在 125%，账里却是 99% —— 这个数直接决定决策台预估死几只、进而决定保本价。
 * 而且「算」页对同一个 125 是报红字的，同一件事两个页面两种结果没人能建立预期。
 * 现在两边都跟着 `src/ui/planForm.ts:100-110` 走：拒绝 + 红字，绝不写账。
 *
 * **草稿永远原样保留**（`draft: raw`）—— 打 `12.` 的那一下不能被改写成 `12`，否则小数点
 * 又没了，想填 12.5 的人永远填不进去。
 */
export function applyMortalityInput(raw: string): { draft: string; ratio: number | null } {
  const rate = parseMortalityPercent(raw)
  if (rate === null) return { draft: raw, ratio: null }
  return { draft: raw, ratio: rate }
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
 * 死亡率越界（`125` / `99.5` / `-1`）**算**输入错误：它会被拒绝、不写账，所以必须让用户看见
 * 自己填错了 —— 错的数字比没有数字危险得多。文案与 `src/ui/planForm.ts:142` 逐字相同。
 * 比例越界不算输入错误，由页面底部那句 `validateSettings` 的红字去说
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
      return parseMortalityPercent(text) === null ? '死亡率要填 0 到 99 之间的数字' : undefined
    case 'ratio':
    case 'margin':
      return parseNumber(text) === null ? '填一个数字，例如 30 或 30.5' : undefined
  }
}
