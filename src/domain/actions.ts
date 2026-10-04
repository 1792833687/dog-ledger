import type { AppData, Batch, ChannelId, CostItemDef, Dog, DogStatus, LedgerEntry, Money, Settings } from './types'
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
 * 把一只狗标成死亡。
 *
 * 守卫：能记死亡的 = **还站在我们笼子里的活狗**，即 `in_stock` **或 `returned`**。
 *
 * - `sold`：收入已经入账、狗已经不在我们账上，它的死不是我们的损失。实机走查抓到的
 *   账目污染就是这一格 —— 把 `sold` 覆盖成 `dead` 之后那笔 `income/sale` 流水留在账上
 *   一动不动，而购置成本却进了「死亡损耗」（`costing.ts:38`），批次盈亏直接算错。
 * - `dead`：不重复记。
 * - `returned`：**必须允许**。设计文档 :156 把退回的狗算进 `inStockCount`、:157 算进
 *   `aliveCount` —— 它又站在笼子里了，会病会死，一样要摊它的购置成本。早先按
 *   `!== 'in_stock'` 收口会把它一起堵死，与 156/157 的口径自相矛盾。
 *
 * 不符合条件的狗一律原样返回 `data`（同一引用）。要纠错（比如死亡记错了），
 * 走 `setDogStatus(data, dogId, 'in_stock')` —— 那个函数故意不设守卫。
 */
export function markDogDead(data: AppData, dogId: string): AppData {
  const dog = data.dogs.find(d => d.id === dogId)
  if (!dog || (dog.status !== 'in_stock' && dog.status !== 'returned')) return data
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

/**
 * 四种「钱在池子和人之间转」的流水的共同写法。
 *
 * 这些流水**不属于任何一批、任何一只狗**（`batchId` / `dogId` 恒为 null）：注资与分红
 * 是合伙人之间的钱，报销是还垫付，散收入（卖笼子之类）没有可归的批次。
 *
 * `category` 按 `types.ts:129` 的约定：只有 `income` 用 `'sale'`，其余转账类一律 `'transfer'`。
 */
function transferEntry(
  data: AppData,
  type: 'injection' | 'income' | 'reimbursement' | 'distribution',
  amount: Money,
  date: string,
  note: string,
  fields: { paidBy?: 'pool' | string; payee?: string | null },
): AppData {
  const entry: LedgerEntry = {
    id: newId(),
    date,
    type,
    category: type === 'income' ? 'sale' : 'transfer',
    // 与 addExpense / sellDog 同一口径：金额恒为正整数，小数取整到分、负数夹到 0。
    amount: Math.max(0, Math.round(amount)),
    paidBy: fields.paidBy ?? 'pool',
    payee: fields.payee ?? null,
    batchId: null,
    dogId: null,
    note,
  }
  return { ...data, entries: [...data.entries, entry] }
}

/** 合伙人往池子里打钱。注资本金算在这个人名下（`contributedCapital`），不算垫付。 */
export function addInjection(data: AppData, partnerId: string, amount: Money, date: string, note: string): AppData {
  return transferEntry(data, 'injection', amount, date, note, { paidBy: partnerId })
}

/** 不挂到具体某只狗的收入（如卖笼子、退款回收）。钱进池子，不归任何人之名。 */
export function addIncome(data: AppData, amount: Money, date: string, note: string): AppData {
  return transferEntry(data, 'income', amount, date, note, {})
}

/** 池子出钱报销某人的垫付。钱给谁记在 `payee`（`advanceBalance` 靠它冲账）。 */
export function addReimbursement(data: AppData, partnerId: string, amount: Money, date: string): AppData {
  return transferEntry(data, 'reimbursement', amount, date, '', { payee: partnerId })
}

/** 池子出钱给某合伙人分红。钱给谁记在 `payee`（`distributedTo` 靠它统计）。 */
export function addDistribution(data: AppData, partnerId: string, amount: Money, date: string): AppData {
  return transferEntry(data, 'distribution', amount, date, '', { payee: partnerId })
}

/** 只改这 6 个检疫字段。「没传」与「清空」是两件事，见 `setDogQuarantine` 的说明。 */
export interface DogQuarantinePatch {
  rabiesVaccinatedOn?: string | null
  antibodyTestedOn?: string | null
  antibodyReportNo?: string
  quarantineCertNo?: string
  quarantineCertIssuedOn?: string | null
  quarantineCertValidUntil?: string | null
}

/**
 * `patch` 里没传的键取原值。
 *
 * 不能写成 `{ ...dog, ...patch }`：`patch` 的键是可选的，而 TS 的可选属性允许显式传
 * `undefined`（`{ quarantineCertNo: undefined }` 是合法调用）。展开之后那个字段在运行时
 * 真的会变成 `undefined`，而它的静态类型仍是 `string` —— 于是 `quarantineStatus` 里那句
 * `dog.quarantineCertNo.trim()` 就会抛 `Cannot read properties of undefined`。
 * 更要紧的是账目语义：用户「什么都没改」不能等价于「把这格清空了」。
 */
function keepOrSet<T>(next: T | undefined, current: T): T {
  return next === undefined ? current : next
}

/**
 * 改某一只狗的检疫字段。**这是「检」页面唯一的写入口**（界面不许自己拼新 `AppData`）。
 *
 * 语义：①只改传进来的键（`undefined` ≠ 清空，清空要显式传 `null` 或 `''`）；
 * ②只改 `dogId` 那一只，别的狗连对象引用都不换；③找不到这只狗时返回**同一个引用**，
 * 不凭空造一只没批次的狗；④不碰 `entries` / `batches` / `settings`；⑤数组顺序不变。
 */
export function setDogQuarantine(data: AppData, dogId: string, patch: DogQuarantinePatch): AppData {
  const index = data.dogs.findIndex(d => d.id === dogId)
  if (index < 0) return data
  const dog = data.dogs[index]
  const next: Dog = {
    ...dog,
    rabiesVaccinatedOn: keepOrSet(patch.rabiesVaccinatedOn, dog.rabiesVaccinatedOn),
    antibodyTestedOn: keepOrSet(patch.antibodyTestedOn, dog.antibodyTestedOn),
    antibodyReportNo: keepOrSet(patch.antibodyReportNo, dog.antibodyReportNo),
    quarantineCertNo: keepOrSet(patch.quarantineCertNo, dog.quarantineCertNo),
    quarantineCertIssuedOn: keepOrSet(patch.quarantineCertIssuedOn, dog.quarantineCertIssuedOn),
    quarantineCertValidUntil: keepOrSet(patch.quarantineCertValidUntil, dog.quarantineCertValidUntil),
  }
  return { ...data, dogs: data.dogs.map(d => (d.id === dogId ? next : d)) }
}

/**
 * 改设置里的若干项（目标毛利率、预估死亡率、默认检疫费…）。
 *
 * `patch` 里没提到的键保持原值。**不校验**：校验是 `validateSettings` 的事，界面负责把
 * 错误提示出来。这里不做「非法就拒绝」，因为用户改「分成比例」时中间必然经过不合法的
 * 状态（48%+52% → 先改成 60% 的那一刻总和是 112%），一拒绝就没法操作了。
 */
export function updateSettings(data: AppData, patch: Partial<Settings>): AppData {
  return { ...data, settings: { ...data.settings, ...patch } }
}

/**
 * 改某个合伙人的名字。找不到这个人时原样返回**同一个引用**（不凭空造人）。
 */
export function renamePartner(data: AppData, partnerId: string, name: string): AppData {
  if (!data.settings.partners.some(p => p.id === partnerId)) return data
  return {
    ...data,
    settings: {
      ...data.settings,
      partners: data.settings.partners.map(p => (p.id === partnerId ? { ...p, name } : p)),
    },
  }
}

/**
 * 改某个合伙人的分成比例（0~1，所有人之和必须是 1，由 `validateSettings` 把关）。
 * 同样：找不到人时原样返回同一引用。改比例**不会动已经发生过的账**——
 * 每次分红都按当时的比例写进了流水，历史不会被追溯篡改。
 */
export function setPartnerRatio(data: AppData, partnerId: string, ratio: number): AppData {
  if (!data.settings.partners.some(p => p.id === partnerId)) return data
  return {
    ...data,
    settings: {
      ...data.settings,
      partners: data.settings.partners.map(p => (p.id === partnerId ? { ...p, shareRatio: ratio } : p)),
    },
  }
}

/**
 * 加一个自定义成本项。`isBuiltin: false` —— 内置项来自 `BUILTIN_COST_ITEMS`，
 * 用户自己加的不能冒充内置项（界面靠这个标记区分「能删」与「删了会让历史流水找不到名字」）。
 * `name` 原样保存，`trim` 是界面的事（域层不替用户改他输入的字符串）。
 */
export function addCostItem(data: AppData, name: string, scope: CostItemDef['scope']): AppData {
  const item: CostItemDef = { id: newId(), name, scope, isBuiltin: false }
  return {
    ...data,
    settings: { ...data.settings, costItems: [...data.settings.costItems, item] },
  }
}

/**
 * 改一个批次的「计划去向」。找不到这个批次时原样返回（同一引用）。
 * 只改这一个批次的这个字段，别的批次、狗、流水一律不动，数组顺序不变。
 *
 * **不校验** `channel` 是否在 `SALES_CHANNELS` 里：与 `addCostItem` 不给 `name` 做
 * `trim`/去重同一个道理 —— 域层保持宽松，合法值由界面负责给。旧备份或手改过的数据
 * 读进来的未知渠道会被原样存下，界面自己按「查不到就显示 id」处理（见 `channels.ts`）。
 */
export function setBatchChannel(data: AppData, batchId: string, channel: ChannelId): AppData {
  if (!data.batches.some(b => b.id === batchId)) return data
  return {
    ...data,
    batches: data.batches.map(b => (b.id === batchId ? { ...b, plannedChannel: channel } : b)),
  }
}

/**
 * 改某个批次的名字。只改那一批；找不到时原样返回（同一引用）。
 * 别的批次连对象引用都不换，`dogs` / `entries` / `settings` 一律不动。
 *
 * **为什么改批次名不追溯改狗号（这是刻意的，不是漏了）。**
 *
 * 每只狗的 `code` 在**建批次时**就一次性写死了：按只数一键建的批次走
 * `` `${batchName}-${i}` ``（`planning.ts:105`），手动补录的走
 * `` `${batch.name}-补${dogs.length + 1}` ``（`DogsPage.tsx:331`）。
 * 这个字符串是这批狗的**历史标识** —— 对账单、纸质清单、和客户/卖家的口头往来
 * 上已经按它写下来了。改批次名只让**以后**新建的批次好看，不是给旧狗重新编号：
 * 追溯改写已有 `code` 会让所有已经发出去的凭证对不上账，而账目能不能对上，
 * 比「名字看起来统一」重要得多。
 *
 * 所以：走查时看到「批次名改了、狗号还是旧名」是**预期行为**。
 * `actions.test.ts` 里有一组测试专门钉住它。
 *
 * 不做 `trim`、也不拦空名：与 `addCostItem` 不给 `name` 做 `trim` 同一道理 ——
 * 域层保持宽松，「不能是空的」由界面把关（它比域层更清楚用户看见了什么）。
 */
export function renameBatch(data: AppData, batchId: string, name: string): AppData {
  if (!data.batches.some(b => b.id === batchId)) return data
  return {
    ...data,
    batches: data.batches.map(b => (b.id === batchId ? { ...b, name } : b)),
  }
}
