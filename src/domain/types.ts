/** 金额，单位：分，整数 */
export type Money = number

export type DogStatus = 'in_stock' | 'sold' | 'dead' | 'returned'
export type BatchStatus = 'active' | 'closed'
export type EntryType =
  | 'injection'      // 注资
  | 'expense'        // 支出
  | 'income'         // 收入
  | 'reimbursement'  // 报销垫付
  | 'distribution'   // 分红

export interface Partner {
  id: string
  name: string
  /** 0~1，所有合伙人之和必须为 1 */
  shareRatio: number
}

export interface CostItemDef {
  id: string
  name: string
  scope: 'batch' | 'dog'
  isBuiltin: boolean
}

export interface Settings {
  partners: Partner[]
  costItems: CostItemDef[]
  /** 目标毛利率，用于建议售价 */
  targetMarginRate: number
  /** 预估死亡率默认值，用于决策台 */
  expectedMortalityRate: number
  /** 每只狗的检疫费默认值（狂犬病免疫抗体检测 + 检疫申报跑腿），用于决策台预填 */
  quarantinePerDog: Money
  /** 每只病死犬的无害化处理费默认值，用于决策台预填 */
  disposalPerDog: Money
  /** 上次备份时间，ISO datetime；从未备份为 null */
  lastBackupAt: string | null
}

export interface Batch {
  id: string
  name: string
  date: string           // YYYY-MM-DD
  source: string
  note: string
  status: BatchStatus
}

export interface Dog {
  id: string
  batchId: string
  code: string
  breed: string
  sex: 'male' | 'female' | 'unknown'
  ageMonths: number | null
  status: DogStatus
  note: string
}

export interface LedgerEntry {
  id: string
  date: string                  // YYYY-MM-DD
  type: EntryType
  /** expense 时为 CostItemDef.id；income 用 'sale'；injection/reimbursement/distribution 用 'transfer' */
  category: string
  /** 恒为正整数（分），方向由 type 决定 */
  amount: Money
  /** 仅 expense 使用：'pool' 表示池子直付，否则是垫付的合伙人 id */
  paidBy: 'pool' | string
  /** 仅 reimbursement / distribution 使用：收款的合伙人 id */
  payee: string | null
  batchId: string | null
  dogId: string | null
  note: string
}

export interface AppData {
  version: 1
  settings: Settings
  batches: Batch[]
  dogs: Dog[]
  entries: LedgerEntry[]
}

export const BUILTIN_COST_ITEMS: CostItemDef[] = [
  { id: 'purchase', name: '收购价', scope: 'dog', isBuiltin: true },
  { id: 'transport', name: '运输+笼具', scope: 'batch', isBuiltin: true },
  { id: 'medical', name: '疫苗驱虫医疗', scope: 'dog', isBuiltin: true },
  // 检疫是法定前置：没有《动物检疫合格证明》就出售，按《动物防疫法》第二十九条、
  // 第九十七条处罚（没收 + 货值 15~30 倍罚款，货值不足一万的处 5 万~15 万，负责人 5 年禁业）。
  // 这不是「可选的合规开销」，是算保本价时必须计入的现金流出。
  { id: 'quarantine', name: '检疫（抗体检测+申报）', scope: 'dog', isBuiltin: true },
  // 病死犬必须无害化处理，不得买卖、加工、随意弃置（《动物防疫法》第五十七条第三款）。
  // 这是真金白银的额外支出，与「损耗摊薄」那种账面重分配性质不同。
  { id: 'disposal', name: '病死犬无害化处理', scope: 'batch', isBuiltin: true },
  { id: 'aftercare_refund', name: '售后退款', scope: 'dog', isBuiltin: true },
]

export const DEFAULT_SETTINGS: Settings = {
  partners: [
    { id: 'p1', name: '我', shareRatio: 0.5 },
    { id: 'p2', name: '伙伴', shareRatio: 0.5 },
  ],
  costItems: BUILTIN_COST_ITEMS,
  targetMarginRate: 0.3,
  expectedMortalityRate: 0.15,
  // 默认 0 = 「还不知道」。绝不许编一个看起来合理的数字：
  // 检疫费各地不同、抗体检测价格未知，填 0 至少是诚实的，编 50 元会让人以为算过了。
  quarantinePerDog: 0,
  disposalPerDog: 0,
  lastBackupAt: null,
}

export const DEFAULT_DATA: AppData = {
  version: 1,
  settings: DEFAULT_SETTINGS,
  batches: [],
  dogs: [],
  entries: [],
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}
