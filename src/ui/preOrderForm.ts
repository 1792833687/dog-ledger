import type { AddPreOrderInput } from '../domain/actions'
import type { PreOrder } from '../domain/types'
import { parseAliveInput } from './channelView'

/**
 * 预定单表单的「字符串 ⇄ 域层入参」这一层。与 `planForm.ts` 同一个套路：
 * 纯函数、不碰 DOM、不碰存储、不调无参 `new Date()`（所以能脱离浏览器测）。
 *
 * 为什么要有这一层（而不是在 `DogsPage.tsx` 里现拼）：
 * 1. **「按钮亮着」与「会不会出红字」必须是同一个判定**。写成两份判断，迟早出现
 *    「按钮能点、点了弹红字」或者反过来「填对了按钮还是灰的」——前者最气人。
 *    `canSubmitPreOrder` 就是 `draftIssue(draft) === null` 这一句话。
 * 2. **只数的口径与「存活数」完全一致**（`parseAliveInput`，只认 `\d+`、空串 → `null`）。
 *    域层 `receivePreOrder` 的守卫是**原样返回同一引用**：只数不合法它什么都不做，
 *    界面上就是「点了确认但没反应」。所以「拦」必须发生在界面这一层，不能指望域层报错。
 * 3. **改单这条路域层不 trim**。`addPreOrder` 会把 `sellerName` / `collectDate` 存成
 *    trim 后的值，而 `updatePreOrder` 是照原样存 —— 它俩一个字段、两种存法。
 *    `sellerName` 与 `collectDate` 会被拿去排序和比日期，前后带空格的
 *    `' 2026-10-20 '` 会让字典序比较静默失效（「界面看着正常、提醒就是不来」）。
 *    于是 trim 放在这里做，新建与修改共用同一条路。
 */

/** 预定单表单在界面上是 6 个字符串（与 `PlanTextForm` 同一体例）。 */
export interface PreOrderDraft {
  sellerName: string
  sellerContact: string
  expectedCount: string
  collectDate: string
  traits: string
  note: string
}

/**
 * 一张空的草稿。**每次调用都返回新对象**：草稿是要被 `{ ...draft, 字段 }` 覆盖的，
 * 全仓共用一个常量对象迟早有人就地改它，那就成了「打开新表单带着上一张单子的内容」。
 */
export function emptyPreOrderDraft(): PreOrderDraft {
  return { sellerName: '', sellerContact: '', expectedCount: '', collectDate: '', traits: '', note: '' }
}

/**
 * 账上的单子 → 表单草稿。**「改」按钮每次都从这张单子现摊一份**，
 * 而不是把上一次的草稿留着再用 —— 草稿串台（打开 B 卡看到 A 的数据）就是这么来的。
 */
export function draftFromOrder(order: PreOrder): PreOrderDraft {
  return {
    sellerName: order.sellerName,
    sellerContact: order.sellerContact,
    expectedCount: String(order.expectedCount),
    collectDate: order.collectDate,
    traits: order.traits,
    note: order.note,
  }
}

/**
 * 「约几只」。口径与 `parseAliveInput` 一字不差：只认 `/^\d+$/`，空串 → `null`。
 *
 * 为什么空串是 `null` 而不是 0：空输入框不等于「0 只」，用户可能只是把原来的数字删掉重打；
 * 按 0 算的话域层 `expectedCount < 1` 会静默丢掉这张单子，用户点了「记下」却什么都没发生。
 * `'0'` 仍然是合法整数（解析得出来），拦不拦是 `draftIssue` 的事 —— 两件事分开，
 * 于是「解析」这件事不会自作主张。
 */
export function parseExpectedCount(raw: string): number | null {
  return parseAliveInput(raw)
}

/**
 * 草稿有什么问题 → 中文红字；`null` = 可以提交。
 *
 * 只查**少了就没法去收**的三样（与 `addPreOrder` 的三条守卫同一个集合）：卖家、约几只、哪天。
 * 联系方式 / 特征 / 备注留空是对的，不该拦。只查第一处、返回一条，
 * 因为界面上就是一行红字 —— 一次列六条没人看。
 */
export function draftIssue(draft: PreOrderDraft): string | null {
  if (draft.sellerName.trim() === '') return '卖家要填一个名字'
  const count = parseExpectedCount(draft.expectedCount)
  if (count === null) return '约几只要填一个整数'
  if (count < 1) return '约几只至少写 1 只，一只都不收就不用记这张单子'
  if (draft.collectDate.trim() === '') return '约好哪天去收，得挑个日子'
  return null
}

/** 能不能提交。**与 `draftIssue` 是同一个判定**（按钮的禁用状态就靠它）。 */
export function canSubmitPreOrder(draft: PreOrderDraft): boolean {
  return draftIssue(draft) === null
}

/**
 * 合法草稿 → `updatePreOrder` 的 patch。非法草稿 → `null`（界面据此不写库）。
 *
 * 卖家名 / 联系方式 / 日期去掉两边空格：理由见文件头第 3 条（修改这条路上域层不 trim）。
 * `traits` / `note` 是自由文本，用户打成什么样就存什么样，不做加工。
 */
export function preOrderPatch(draft: PreOrderDraft): Omit<AddPreOrderInput, 'createdAt'> | null {
  const count = parseExpectedCount(draft.expectedCount)
  if (!canSubmitPreOrder(draft) || count === null) return null
  return {
    sellerName: draft.sellerName.trim(),
    sellerContact: draft.sellerContact.trim(),
    expectedCount: count,
    collectDate: draft.collectDate.trim(),
    traits: draft.traits,
    note: draft.note,
  }
}

/**
 * 合法草稿 → `addPreOrder` 的入参。非法草稿 → `null`。
 * `createdAt` 由调用方传（ISO datetime），因为取「现在」这件事只能在事件处理器里做。
 */
export function preOrderInput(draft: PreOrderDraft, createdAt: string): AddPreOrderInput | null {
  const patch = preOrderPatch(draft)
  if (patch === null) return null
  return { ...patch, createdAt }
}
