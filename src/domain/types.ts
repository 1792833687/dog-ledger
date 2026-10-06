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

/**
 * 销售渠道。
 * 抖音小店（狗活体类目暂停招商）与「抖音引流到微信」（站外导流明文禁止、罚到永久封号）
 * 两条路都已堵死，所以这张清单只列线下与第三方平台 —— 见
 * docs/compliance/2026-10-02-犬只交易合规要点-平台篇.md 与 …-销售路径篇.md
 */
export type ChannelId =
  | 'undecided'
  | 'pet_shop'
  | 'dog_market'
  | 'rural_fair'
  | 'middleman'
  | 'individual'
  | 'meat'
  | 'kennel'
  | 'ecommerce'

export interface SalesChannelDef {
  id: ChannelId
  name: string
  /** 这条渠道特有的成本或风险，显示在渠道对照表里 */
  note: string
}

export const SALES_CHANNELS: SalesChannelDef[] = [
  { id: 'undecided', name: '未定', note: '还没决定这批走哪条路，任何渠道的保本价都只能当参考。' },
  { id: 'pet_shop', name: '宠物店 / 宠物医院', note: '卖断给店主，几乎无额外成本，但对方压价最狠。' },
  { id: 'dog_market', name: '犬只交易市场 / 花鸟市场', note: '摊位费按次摊；城区是否禁活体交易必须先本地核实。从市场转手时要能拿出原始检疫证明和完整进出场记录（《犬产地检疫规程》4.1.3）。' },
  { id: 'rural_fair', name: '农村大集 / 集市', note: '门槛最低、价格最低，受集期限制。' },
  { id: 'middleman', name: '狗贩子 / 中间商', note: '最省事、价格最低；申报义务仍在出售人身上。' },
  { id: 'individual', name: '直接卖给个人', note: '单价最高，但要承担退狗与售后。' },
  { id: 'meat', name: '餐饮 / 肉狗', note: '去化快但单价低；深圳、珠海等城市已立法禁食猫狗。' },
  { id: 'kennel', name: '繁育基地 / 犬舍', note: '出量大；也是将来申请平台活体类目时唯一被认可的货源背书。' },
  { id: 'ecommerce', name: '电商平台', note: '需包装、有轨迹物流与死亡赔付；活体类目资质门槛高。' },
]

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
  /**
   * 狂犬病免疫后要等多少天才可采血/申报检疫。默认 21。
   * ⚠️ **这个 21 不是法定天数。** 《犬产地检疫规程》原文只说「在有效保护期内」，
   * 《狂犬病防治技术规范》只说「每年加强免疫一次」，**两份官方原文里都没有「21 天」**。
   * 它更可能是抗体检测的实验室采样窗口要求。做成可配置而不是写死：
   * 问了给你做抗体检测的实验室和当地动物卫生监督机构之后，按他们的答复改这里。
   */
  rabiesWaitDays: number
  /** 申报检疫需提前几天。默认 3 ——《动物检疫管理办法》第八条第二款 +《犬产地检疫规程》4.1。 */
  quarantineLeadDays: number
  /**
   * 离约定去收的日子还有几天就开始提醒。
   * 默认 3 只是一开始的猜测，不是法定天数，设置里可以按自己的跑腿习惯改。
   */
  preOrderLeadDays: number
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
  /** 这批狗打算走哪条渠道。'undecided' = 还没定。决定保本价该按哪套成本结构算。 */
  plannedChannel: ChannelId
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
  // ——— 检疫流程台账 ———
  // 出售前必须取得《动物检疫合格证明》，否则按《动物防疫法》第二十九条、第九十七条处罚
  // （没收 + 货值 15~30 倍罚款，货值不足一万的处 5 万~15 万，负责人 5 年禁业）。
  // 一证多用（数量超出证明载明部分、种类不符、使用转让的证明）按「未经检疫」处理，
  // 直接落进 15~30 倍那一档（《动物检疫管理办法》第四十二条）。
  /** 狂犬病疫苗接种日期 YYYY-MM-DD；未接种为 null */
  rabiesVaccinatedOn: string | null
  /** 狂犬病免疫抗体检测日期 YYYY-MM-DD；未检测为 null */
  antibodyTestedOn: string | null
  /** 抗体检测报告编号，照抄报告上的原文；没有就留空字符串 */
  antibodyReportNo: string
  /** 《动物检疫合格证明》编号；没有就留空字符串 */
  quarantineCertNo: string
  /** 检疫证明签发日期 YYYY-MM-DD */
  quarantineCertIssuedOn: string | null
  /** 检疫证明有效期至 YYYY-MM-DD；过期即不可出售 */
  quarantineCertValidUntil: string | null
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

export type PreOrderStatus = 'reserved' | 'received' | 'cancelled'

/**
 * 预定单（口头约定去某家收几只狗）。
 * 记的就是「跟谁收、收几只、哪天去」这三样，其余都是备注。
 */
export interface PreOrder {
  id: string
  /** 卖家称呼。与 expectedCount、collectDate 一起是记一张预定单至少要有的三样 */
  sellerName: string
  /** 电话或微信，可留空 */
  sellerContact: string
  /** 约定去收的只数。与 sellerName、collectDate 一起是记一张预定单至少要有的三样 */
  expectedCount: number
  /** 约定去收的日子 YYYY-MM-DD。与 sellerName、expectedCount 一起是记一张预定单至少要有的三样 */
  collectDate: string
  /** 卖家说的特征（花色、大小、公母），用来到了现场对号 */
  traits: string
  note: string
  /** 建单时间，ISO datetime */
  createdAt: string
  /** 只能由「收货」与「取消」两个动作写入，界面不给直接编辑 */
  status: PreOrderStatus
  /** 实际收回来几只。只能由「收货」动作写入，界面不给直接编辑 */
  receivedCount: number
  /** 收货建出来的批次 id；没收货为 null。只能由「收货」动作写入，界面不给直接编辑 */
  receivedBatchId: string | null
  /** 取消原因，取消时填 */
  cancelReason: string
}

export interface AppData {
  version: 1
  settings: Settings
  batches: Batch[]
  dogs: Dog[]
  entries: LedgerEntry[]
  preOrders: PreOrder[]
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
  // scope 用 'dog'：单价是按「每只病死犬」计的，而且这笔钱实际是跟着某一具尸体发生的，
  // 记在那一只狗身上才算得清。写成 'batch' 会和 Settings.disposalPerDog 的「每只」语义打架。
  { id: 'disposal', name: '病死犬无害化处理', scope: 'dog', isBuiltin: true },
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
  // 21 天**查不到官方出处**（规程与技术规范原文都没有），只是实验室采样窗口的常见值 ——
  // 问了当地动物卫生监督机构或检测实验室之后改这里，别当法条用。
  rabiesWaitDays: 21,
  // 3 天是法定的：《动物检疫管理办法》第八条第二款 +《犬产地检疫规程》4.1。
  quarantineLeadDays: 3,
  // 3 天只是一开始的猜测：既不是法定天数，也没问过用户的跑腿习惯，设置里可改。
  preOrderLeadDays: 3,
  lastBackupAt: null,
}

export const DEFAULT_DATA: AppData = {
  version: 1,
  settings: DEFAULT_SETTINGS,
  batches: [],
  dogs: [],
  entries: [],
  preOrders: [],
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}
