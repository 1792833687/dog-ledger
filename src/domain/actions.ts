import type { AppData, Batch, DogStatus, LedgerEntry, Money } from './types'
import { newId } from './types'

/**
 * 记账动作层。
 *
 * 这里是界面能对台账做的全部改动，**全部是纯函数**：返回新对象，绝不修改传入的 `data`。
 * 所以它们能脱离浏览器测试，也让「撤销/重放」这类功能将来有地方落脚。
 *
 * 两条纪律，写新动作时照办：
 * - 不调用 `new Date()`：`today` 一律由调用方作为 `'YYYY-MM-DD'` 字符串传进来。
 *   否则同一天在东八区晚上 8 点前后会算出两个不同的日期，账目会对不上。
 * - 只依赖 `./types`。这里不碰 React、不碰 storage。
 */

export function createBatch(data: AppData, name: string, date: string): AppData {
  // plannedChannel 是必填字段（修订二）。这里建出来的批次还没定去向，先记 'undecided'；
  // 真正的去向在「算」页面一键建批次时给（Task 18），或之后在批次详情里改。
  const batch: Batch = {
    id: newId(), name, date, source: '', note: '', status: 'active',
    plannedChannel: 'undecided',
  }
  return { ...data, batches: [...data.batches, batch] }
}

export function addExpense(
  data: AppData,
  input: {
    batchId: string | null
    dogId: string | null
    category: string
    amount: Money
    paidBy: 'pool' | string
    date: string
    note: string
  },
): AppData {
  const entry: LedgerEntry = {
    id: newId(),
    date: input.date,
    type: 'expense',
    category: input.category,
    // 金额恒为正整数：界面传来的可能是小数（分），负数是没有意义的账。
    // 夹到 0 而不是报错，是因为「记一笔 0 元的支出」无害，而丢掉用户刚填的表单有害。
    amount: Math.max(0, Math.round(input.amount)),
    paidBy: input.paidBy,
    payee: null,
    batchId: input.batchId,
    dogId: input.dogId,
    note: input.note,
  }
  return { ...data, entries: [...data.entries, entry] }
}

export function setDogStatus(data: AppData, dogId: string, status: DogStatus): AppData {
  return {
    ...data,
    dogs: data.dogs.map(d => (d.id === dogId ? { ...d, status } : d)),
  }
}

/**
 * 把一只在库的狗标成死亡。
 *
 * 守卫（实机走查抓到的账目污染）：只有 `in_stock` 的狗能被标死亡。
 * 一只**已售**的狗如果被标成 death，那笔 `income/sale` 流水会留在账上一动不动，
 * 而它的购置成本从此计入「死亡损耗」—— 批次盈亏直接算错（见 `costing.ts:38` 的 `deadLoss`）。
 *
 * 所以这里对已售 / 已死 / 已退回的狗一律原样返回 `data`（同一引用），
 * 界面层也不会给这些状态渲染「死亡」按钮。要纠错（比如死亡记错了），
 * 走 `setDogStatus(data, dogId, 'in_stock')` —— 那个函数故意不设守卫。
 */
export function markDogDead(data: AppData, dogId: string): AppData {
  const dog = data.dogs.find(d => d.id === dogId)
  if (!dog || dog.status !== 'in_stock') return data
  return setDogStatus(data, dogId, 'dead')
}

/**
 * 卖出一只狗：把状态改成 sold，并写入一笔挂在该狗和该批次上的收入。
 * 已经卖过的狗再次调用会被忽略，避免重复计收入。
 * 不存在的 dogId 原样返回 `data`（同一个引用），不写无主流水。
 */
export function sellDog(data: AppData, dogId: string, price: Money, date: string): AppData {
  const dog = data.dogs.find(d => d.id === dogId)
  if (!dog || dog.status === 'sold') return data

  const entry: LedgerEntry = {
    id: newId(),
    date,
    type: 'income',
    category: 'sale',
    amount: Math.max(0, Math.round(price)),
    paidBy: 'pool',
    payee: null,
    batchId: dog.batchId,
    dogId: dog.id,
    note: '',
  }

  return {
    ...data,
    dogs: data.dogs.map(d => (d.id === dogId ? { ...d, status: 'sold' } : d)),
    entries: [...data.entries, entry],
  }
}
