import type { Dog, LedgerEntry } from '../domain/types'

/**
 * 「狗」页面的显示判定。抽出来是为了能单测：这里的两个判断都直接决定
 * 哪个按钮出现在哪只狗身上，判错会让用户点到一个不该有的动作（或点不到该有的动作）。
 *
 * 全部是纯函数，不 import React。
 */

/**
 * 这只狗还站在我们笼子里吗 —— 「卖出」与「死亡」两个按钮的显示条件。
 *
 * `returned`（退回）**算在册的活狗**：设计文档 :156 把它算进 `inStockCount`、
 * :157 算进 `aliveCount`（"退狗回到在库"）。它站在笼子里，会病会死，也要再卖一次，
 * 所以这两个动作都要给它。不这么算会同时堵死两条路：退回的狗卖不出去、死了也记不上。
 *
 * `sold` 的收入已入账、狗不在我们账上；`dead` 已经记过。两者都不给。
 */
export function isOnHand(dog: Dog): boolean {
  return dog.status === 'in_stock' || dog.status === 'returned'
}

/** 这只狗最近一次卖出在流水里的位置（没有卖出记录则 -1） */
export function lastSaleIndex(entries: LedgerEntry[], dogId: string): number {
  let idx = -1
  entries.forEach((e, i) => { if (e.type === 'income' && e.dogId === dogId) idx = i })
  return idx
}

/**
 * 这一次成交是否已经退过款：退款支出出现在**最近一次卖出之后**。
 *
 * 不能用「这只狗有没有退款记录」来判 —— 一只狗可以「卖了 → 退了款 → 又卖出去 → 又要退」，
 * 按狗判会把第二次的入口误收掉，而界面上只会显示「已记退款」，用户再也点不到。
 * 用**数组下标**而不是 `date` 比大小：`entries` 是追加写的，下标顺序就是记账顺序，
 * 同一天记两笔也能分清先后。
 */
export function refundedCurrentSale(entries: LedgerEntry[], dogId: string): boolean {
  const saleIdx = lastSaleIndex(entries, dogId)
  if (saleIdx < 0) return false
  return entries.some((e, i) =>
    i > saleIdx && e.type === 'expense' && e.category === 'aftercare_refund' && e.dogId === dogId,
  )
}
