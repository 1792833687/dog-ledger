import type { AppData, Dog, Money } from './types'

export function dogsOfBatch(data: AppData, batchId: string): Dog[] {
  return data.dogs.filter(d => d.batchId === batchId)
}

/** 单只狗的直接成本：所有 dogId 指向它的支出 */
export function dogOwnCost(data: AppData, dogId: string): Money {
  return data.entries
    .filter(e => e.type === 'expense' && e.dogId === dogId)
    .reduce((sum, e) => sum + e.amount, 0)
}

/** 批次总成本：所有 batchId 指向它的支出（含单只狗层面，因为那些流水同时写了 batchId） */
export function batchTotalCost(data: AppData, batchId: string): Money {
  return data.entries
    .filter(e => e.type === 'expense' && e.batchId === batchId)
    .reduce((sum, e) => sum + e.amount, 0)
}

export function batchIncome(data: AppData, batchId: string): Money {
  return data.entries
    .filter(e => e.type === 'income' && e.batchId === batchId)
    .reduce((sum, e) => sum + e.amount, 0)
}

export function inStockCount(data: AppData, batchId: string): number {
  // 退狗（returned）回到在库：它又站在笼子里了，还得再卖一次，所以进分母。
  return dogsOfBatch(data, batchId).filter(d => d.status === 'in_stock' || d.status === 'returned').length
}

/** 存活数：只有 dead 不算活着（sold 与 returned 都算） */
export function aliveCount(data: AppData, batchId: string): number {
  return dogsOfBatch(data, batchId).filter(d => d.status !== 'dead').length
}

/** 死亡总损耗 */
export function deadLoss(data: AppData, batchId: string): Money {
  return dogsOfBatch(data, batchId)
    .filter(d => d.status === 'dead')
    .reduce((sum, d) => sum + dogOwnCost(data, d.id), 0)
}

/**
 * ★ 指标 B：单只狗摊薄成本（单位：分，可能带小数）。
 * 把死狗的直接成本平摊到所有非死亡个体上。
 * 整批死光时退化为该狗自身直接成本，不会除零。
 */
export function dilutedCostFen(data: AppData, dogId: string): number {
  const own = dogOwnCost(data, dogId)
  const dog = data.dogs.find(d => d.id === dogId)
  if (!dog) return own
  const alive = aliveCount(data, dog.batchId)
  if (alive === 0) return own
  return batchTotalCost(data, dog.batchId) / alive
}

/** 挂到单只狗上的收入之和 */
export function dogIncome(data: AppData, dogId: string): Money {
  return data.entries
    .filter(e => e.type === 'income' && e.dogId === dogId)
    .reduce((sum, e) => sum + e.amount, 0)
}

/** 单只狗的事后盈亏（单位：分，可能带小数） */
export function dogProfitFen(data: AppData, dogId: string): number {
  return dogIncome(data, dogId) - dilutedCostFen(data, dogId)
}

/**
 * ★ 指标 A：批次剩余保本单价（单位：分，可能带小数）。
 * 回答「剩下的每只至少卖多少钱，整批才不亏」。没有在库狗时返回 null。
 */
export function remainingFloorPriceFen(data: AppData, batchId: string): number | null {
  const inStock = inStockCount(data, batchId)
  if (inStock === 0) return null
  const remaining = batchTotalCost(data, batchId) - batchIncome(data, batchId)
  return Math.max(0, remaining / inStock)
}

export interface BatchSummary {
  totalCost: Money
  income: Money
  inStock: number
  sold: number
  dead: number
  returned: number
  deadLoss: Money
  floorPriceFen: number | null
  /** 批次净利（单位：分，可能带小数） */
  netProfitFen: number
}

export function batchSummary(data: AppData, batchId: string): BatchSummary {
  const dogs = dogsOfBatch(data, batchId)
  const totalCost = batchTotalCost(data, batchId)
  const income = batchIncome(data, batchId)
  return {
    totalCost,
    income,
    inStock: inStockCount(data, batchId),
    sold: dogs.filter(d => d.status === 'sold').length,
    dead: dogs.filter(d => d.status === 'dead').length,
    returned: dogs.filter(d => d.status === 'returned').length,
    deadLoss: deadLoss(data, batchId),
    floorPriceFen: remainingFloorPriceFen(data, batchId),
    netProfitFen: income - totalCost,
  }
}
