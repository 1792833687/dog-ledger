import type { Money } from '../domain/types'
import type { BatchCostsInput } from '../domain/batchCosts'
import { formatMoney, parseMoney } from '../domain/money'

/**
 * 补账表的「字符串 ⇄ 域层入参」这一层。与 `planForm.ts` / `preOrderForm.ts` 同一个套路：
 * 纯函数、不碰 DOM、不碰存储、不调无参 `new Date()`（所以能脱离浏览器测）。
 *
 * 为什么要有这一层（而不是在 `DogsPage.tsx` 里现拼）：
 * 1. **「有没有红字」与「能不能写好入参」必须是同一个判定。** `batchCostsInput` 直接
 *    拿 `batchCostDraftIssue` 当闸门：有红字就返回 `null`，界面拿不到入参自然也写不进账。
 *    写成两份判断迟早出现「按钮能点、点了写进一笔 `NaN`」。
 * 2. **「空 = 0」这条口径只写一次。** `parseMoney('')` 返回的是 `null` 而不是 0（它在
 *    域层服务的是"这笔钱填了没有"，空必须与 0 分开）。补账表问的是另一件事：「这一项
 *    不补」，所以空串在这里按 0 走 —— 而 0 的行域层本来就不生成流水（`plannedCostEntries`
 *    里 `> 0` 才 push），于是"不补这一项"与"这项是 0"在账上完全等价，不用界面额外做什么。
 * 3. **「将新增几笔」绝不在界面里算。** 笔数取决于"这一批有几只狗""其中几只死了"，
 *    只有 `previewBatchCosts` 那一条口径说了算。这里只负责把入参拼出来，以及把
 *    它给的 `{ count, totalFen }` 拼成一句话。
 */

/** 补账表在界面上是 4 个字符串（金额输入；元）。 */
export interface BatchCostDraft {
  /** 运输 + 笼具，整批一笔 */
  transport: string
  /** 每只疫苗 / 驱虫 / 医疗 */
  medicalPerDog: string
  /** 每只检疫（抗体检测 + 申报） */
  quarantinePerDog: string
  /** 每只病死犬处理费 */
  disposalPerDog: string
}

/**
 * 一张空的草稿。**每次调用都返回新对象**：草稿要被 `{ ...draft, 字段 }` 覆盖，
 * 全仓共用一个常量对象迟早有人就地改它，那就成了「打开下一批带着上一批的金额」。
 */
export function emptyBatchCostDraft(): BatchCostDraft {
  return { transport: '', medicalPerDog: '', quarantinePerDog: '', disposalPerDog: '' }
}

/**
 * 单行金额的解析口径：**空串（或只打了空格）= 0**，其余交给 `parseMoney`，
 * 认不出来返回 `null`。
 *
 * 负数在这里是「解析得出来」（`'-5'` → `-500`），拦不拦是 `batchCostDraftIssue` 的事：
 * 解析就是解析，不自作主张。用户删数字删到一半的空白也不该当场变红字
 * —— 与 `receiveCountInvalid` 那处的处理一致。
 */
export function parseBatchCostAmount(raw: string): Money | null {
  if (raw.trim() === '') return 0
  return parseMoney(raw)
}

/** 红字文案。四行共用一句话：`Field` 会把提示画在**它自己那一行**的输入框下面，位置已经说明了是哪一行。 */
const NOT_A_NUMBER = '这不像一个数字，请重新填（只填元的数，如 200）'
const NEGATIVE = '金额不能是负数，这一项不补就留空'

/**
 * 单行的红字（就是 `Field` 的 `error`）。`null` = 这一行填得对。
 *
 * 单独做成一行一个函数，是为了让**红字落在出错的那一行上**：四行共用一条「第一处错误」
 * 会让界面只能把提示画在表格外面，用户还得自己找是哪一行。
 * `batchCostDraftIssue` 也走这里，两处判定不会走岔。
 */
export function batchCostRowIssue(raw: string): string | null {
  const amount = parseBatchCostAmount(raw)
  if (amount === null) return NOT_A_NUMBER
  if (amount < 0) return NEGATIVE
  return null
}

/**
 * 草稿有什么问题 → 中文红字；`null` = 四行都填得对（**全空也算对**，只是没东西要补）。
 *
 * 只返回第一处、不把四条拼成一串：它只用来当「能不能提交」的闸门（`batchCostsInput`
 * 的守卫），红字本身由每一行自己的 `batchCostRowIssue` 画。顺序按屏幕上的顺序
 * （运输在最上面），和用户从上往下改的顺序一致。
 *
 * 「有没有东西要补」**不在这里判**：只填了处理费而这一批没有死狗时，四行都合法却一笔
 * 也生不出来（笔数取决于这一批有几只狗、几只死了）—— 那件事只有 `previewBatchCosts`
 * 知道，它要数狗。这里的 `null` 只表示「没有红字」。
 */
export function batchCostDraftIssue(draft: BatchCostDraft): string | null {
  for (const raw of [draft.transport, draft.medicalPerDog, draft.quarantinePerDog, draft.disposalPerDog]) {
    const issue = batchCostRowIssue(raw)
    if (issue !== null) return issue
  }
  return null
}

/**
 * 合法草稿 → 四个「分」。非法的那一行按 0 计，**永远不吐 `NaN`**
 * （域层 `safeMoney` 还会再兜一次，但界面这一层就不该让它有机会溜进去）。
 */
export function draftToAmounts(draft: BatchCostDraft): {
  transportFen: Money
  medicalPerDogFen: Money
  quarantinePerDogFen: Money
  disposalPerDogFen: Money
} {
  return {
    transportFen: parseBatchCostAmount(draft.transport) ?? 0,
    medicalPerDogFen: parseBatchCostAmount(draft.medicalPerDog) ?? 0,
    quarantinePerDogFen: parseBatchCostAmount(draft.quarantinePerDog) ?? 0,
    disposalPerDogFen: parseBatchCostAmount(draft.disposalPerDog) ?? 0,
  }
}

/**
 * 补账日期 + 草稿 → `addBatchCosts` / `previewBatchCosts` 的入参。**有红字 → `null`。**
 *
 * `date` 由调用方传（`'YYYY-MM-DD'`），因为取"今天"这件事只能在事件处理器里做。
 */
export function batchCostsInput(
  batchId: string,
  date: string,
  draft: BatchCostDraft,
): BatchCostsInput | null {
  if (batchCostDraftIssue(draft) !== null) return null
  return { batchId, date, ...draftToAmounts(draft) }
}

/**
 * 提交按钮上那句话：「将新增 19 笔 · ¥1,234」。
 *
 * 金额必须走 `formatMoney`（全仓唯一一处货币格式）：它是整数分就不写小数点。
 * **不要**为了凑成「¥1,234.00」去改它 —— 「¥1,234」与「¥1,234.00」是同一个数，
 * 改了会让「钱」页所有金额跟着变样。
 */
export function previewText(count: number, totalFen: Money): string {
  return `将新增 ${count} 笔 · ${formatMoney(totalFen)}`
}
