# 犬只买卖台账工具（狗账）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 做一个手机端网页工具，让两位合伙人能在收狗之前算出保本价、按批次做损耗摊薄、并算清共同出资下的垫付与分账。

**Architecture:** 纯前端 PWA。所有业务规则（成本、摊薄、四本账、分账、决策模拟）实现为 `src/domain/` 下的纯函数并配单元测试；整个数据集（`AppData`）作为一个对象整体读写 IndexedDB，不做增量持久化；界面层是 React 组件，手机优先、底部五标签（算 / 狗 / 检 / 钱 / 报）。

**Tech Stack:** Vite + React 19 + TypeScript + Tailwind CSS v4 + Vitest。无后端、无账号、无网络请求、无 UI 组件库。

## Global Constraints

- 金额一律以**整数「分」**存储，类型别名 `Money`，字段名后缀不写单位时默认就是分。禁止用浮点「元」入库。
- 业务日期一律用 `'YYYY-MM-DD'` 字符串；时间戳用 ISO datetime 字符串。
- `src/domain/**` 必须是纯函数：**不得 import React、不得 import storage、不得读写全局状态、不得有副作用**。
- 不得引入后端、账号系统、网络请求、第三方 UI 组件库。
- 第一版**不存照片**（设计文档里的 `Dog.photoRef` 已移除，理由：备份体积与 YAGNI）。
- 界面文案用中文。
- **合规成本必须进成本模型**：`BUILTIN_COST_ITEMS` 含 `quarantine`（检疫）与 `disposal`（病死犬无害化处理）两项；`PlanInput` 含 `quarantinePerDog` 与 `disposalPerDog`。依据见 `docs/compliance/2026-10-02-犬只交易合规要点-法规篇.md`——检疫是出售的法定前置，没有检疫证明就是《动物防疫法》第二十九条的违法行为。任何把这笔钱排除在外的「保本价」都是错的。
- **渠道与检疫字段必须真正用上（修订二）**：`Batch.plannedChannel` 与 `Dog` 的 6 个检疫字段（`rabiesVaccinatedOn` / `antibodyTestedOn` / `antibodyReportNo` / `quarantineCertNo` / `quarantineCertIssuedOn` / `quarantineCertValidUntil`）都是**必填**。任何创建 `Batch` 的地方都要给 `plannedChannel` 赋值（默认 `'undecided'`）；任何创建 `Dog` 的地方都要带上这 6 个字段（未接种/未检测/无证明用 `null`，编号用 `''`）。**`tsc` 会因此报错——这是故意的，不要用 `as any` 或 `@ts-expect-error` 绕开。**
- **检疫证明是出售的硬门槛**：`isSellable()` 只在 `certified` 阶段返回 `true`。依据见 `docs/compliance/2026-10-02-犬只交易合规要点-法规篇.md`——一证多用（数量超出证载明部分、种类不符、使用转让的证明）按「未经检疫」处理，落进货值 15~30 倍罚款那一档，负责人 5 年禁业。
- **`domain/` 里任何函数都不得调用 `new Date()`**：需要"今天"时一律由调用方把 `today: string`（`'YYYY-MM-DD'`）作为参数传进来。这让检疫阶段推导可测试，也避免"过期"的判定在不同时区下静默漂移。
- **「还在我们账上的狗（在库）」= `status === 'in_stock' || status === 'returned'`，全仓统一用这个口径，不要只写 `in_stock`。** 设计文档 `:156-157` 明确 `inStockCount` 与 `aliveCount` 都把 `returned` 当成站在笼子里的活狗（退狗回到在库、已发生的医疗成本不冲销）。所以**能卖出的、能记死亡的、要进出栏前检查清单的、要进检疫阶段统计的，都是 `in_stock` 或 `returned`**：退回的狗还站在笼子里，它会病会死，也还得再卖一次。
  - 反例（Task 10 第一版真实踩过）：`markDogDead` 的守卫写成 `dog.status !== 'in_stock'`、界面按钮写成 `d.status === 'in_stock'`，合起来导致**退回的狗既卖不掉、也记不了死亡**，与 `costing.ts` 把它算进成本分母的口径自相矛盾。
  - 真正要挡住的是这两种：`sold`（已经卖掉、收入已入账、狗不在我们账上，它此后的死活不是我们的损失）与 `dead`（已经死了，不重复记）。
  - 「钱退了但狗没要回来」的状态**保持 `sold`**（设计文档 `:225`），不要在那种情况下改成 `returned`。
- **修订三的不变量：加字段就必须同时修两条读路径（D16）。** `AppData` 加顶层字段（本次是 `preOrders`）时，①本地读取路径 `src/state/persistence.ts` 的 `loadPersistedData` 里跑 `normalizeAppData()` 补齐；②导入路径 `src/storage/backup.ts` 的 `importBackup` 里那个**逐字重建的白名单对象**必须显式补上 `preOrders: data.preOrders ?? []`。**写成 `[]` 是错的**——`exportBackup` 原样序列化整个 `data`，所以那会造成「导出含预定单、导入就丢」，而只测旧格式导入的用例照样全绿。`version` 保持 `1`，不做破坏性迁移；用户手机上已有真实数据，**任何"打不开"都是本项目最严重的失败**。
- **修订三的不变量：动作函数一律纯函数、返回新对象；守卫不通过一律返回同一引用（`return data`），绝不抛错。** 全仓既有 16 个 `actions.ts` 导出都是这个口径（`actions.ts:80,91,197,225,273`），新增的 `receivePreOrder` / `receiveBatch` / `updatePreOrder` / `deletePreOrder` / `cancelPreOrder` / `updateEntry` / `deleteEntry` / `addBatchCosts` 全部照办。**唯一的例外是"必须让用户知道被拒了"的界面红字**，那由 UI 自己判断（例如 `count < 1` 时域层返回同一引用、界面按钮直接禁用）。
- **修订三的不变量：金额一律 `Math.max(0, Math.round(x))`，全仓一字不差。** 既有 `addExpense`(`actions.ts:26-53`)、`sellDog`(`:89-111`)、`transferEntry`(`:121-143`) 都是这样：0 是合法的，负数是**夹取**到 0，不是拒绝。所以**不要**在编辑路径上新立一条"金额必须 > 0"的规矩——那会造成"记得下、改不动"这种自相矛盾。界面负责拦"不是数字"。
- **修订三的不变量：`costing.ts` 是唯一算钱的地方。** 界面里不得出现 `base + extra + fixed / n` 这类自算式子，补账表也不得自己算成本（见 Task 25）。修订单项数据（批次去向、狗的检疫字段、预定单）时，任何**派生数字**（保本价、盈亏、余额、分账）都必须靠 `src/domain/costing.ts` / `ledger.ts` / `settlement.ts` 现算得到——上一版 22 个测试文件证明这些全是派生值，删改流水不会让它们算错。
- **UI 层要"今天"，用 `todayLocalIso(new Date())`（`src/ui/planForm.ts`），绝不要 `new Date().toISOString().slice(0, 10)`。** 后者是 UTC，东八区晚上 8 点后返回的是昨天——"今天卖的狗"会被记在昨天，检疫的"有效期到哪天"也会跟着错一天。页面里统一 `import { todayLocalIso } from '../planForm'`。
- **UI 层不能在渲染体里调 `new Date()`；实测唯一能过 lint 的写法是 `useState` 的惰性初始化。** 本仓门禁是 `npm run lint` 0 warning，而 `react(purity)` 会拦下渲染体里的 `new Date()`。四种写法已用 `npx oxlint`（116 rules）逐一实测：
  - ✗ `const today = todayLocalIso(new Date())` → `react(purity): Cannot call impure function during render`
  - ✗ `const today = useMemo(() => todayLocalIso(new Date()), [])` → 同一条规则，同样拦下
  - ✗ `useEffect(() => { setToday(todayLocalIso(new Date())) }, [])` → `react(set-state-in-effect): Calling setState synchronously within an effect`
  - ✓ **`const [today] = useState(() => todayLocalIso(new Date()))`** —— 只算一次，渲染期不调 `new Date()`
  如果"今天"只在事件处理器里用得到（Task 10 的建批次、Task 11 的记账、Task 12 的导出），也可以包成一个函数 `function todayIso() { return todayLocalIso(new Date()) }` 在处理器里调用（`src/ui/pages/DogsPage.tsx:30-34` 就是这么做的）。**关键是不要在渲染体里求值。**
- 数据模型以 `docs/superpowers/specs/2026-10-02-dog-trading-ledger-design.md` 为准。
- 单测命令：`npx vitest run`；单文件：`npx vitest run <文件路径>`。
- 测试环境为 `node`（领域层是纯函数，不需要 jsdom）。
- **测试文件必须显式写 `import { describe, it, expect } from 'vitest'`。** `vite.config.ts:9` 虽然写了 `globals: true`，但 `tsconfig.app.json:7` 的 `types` 只有 `["vite/client"]`、没有 `vitest/globals`，裸写 `describe` 会让 `npm run build` 里的 `tsc -b` 报 TS2593 / TS2304。**副作用要知道**：正因为 `globals: true`，漏掉这行 import 时 `npx vitest run` **仍然是绿的**——所以「vitest 跑绿了」不能当作「类型没问题」的证据，必须看 `npm run build`。
- **`tsconfig.app.json:21` 与 `tsconfig.node.json:18` 都开了 `noUnusedLocals: true`：多 import 一个没用到的符号会让 `npm run build` 直接失败。** 任务书 `**Interfaces:**` / `Consumes` 里列出的符号是**清单，不是抄写要求**——只 import 这个文件实际用到的。先例：Task 11 的页面声明 4 个 ledger 函数只 import 2 个是**对的**（见本文件 Task 11 的 blockquote）；Task 17b 把纯函数抽到 `src/ui/quarantineView.ts` 之后，`QuarantinePage.tsx` 就不能再 import `latestBatch`（它只在 `pickBatch` 内部被调用）。不要为了「和任务书对齐」而加一个没用到的 import。
- 每个任务结束必须提交一次 git。

---

### Task 1: 项目脚手架 + 领域类型

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `index.html`
- Create: `src/main.tsx`, `src/App.tsx`, `src/index.css`
- Create: `src/domain/types.ts`
- Test: `src/domain/types.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `Money`, `DogStatus`, `BatchStatus`, `EntryType`, `Partner`, `CostItemDef`, `Settings`, `Batch`, `Dog`, `LedgerEntry`, `AppData` 类型；常量 `BUILTIN_COST_ITEMS`、`DEFAULT_SETTINGS`、`DEFAULT_DATA`；函数 `newId(): string`。

- [ ] **Step 1: 搭脚手架**

```bash
npm create vite@latest . -- --template react-ts
npm install
npm install -D vitest tailwindcss @tailwindcss/vite
```

删除模板自带的 `src/App.css`、`src/assets/`。

- [ ] **Step 2: 配置 Vite + Tailwind + Vitest**

`vite.config.ts`：

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'node',
    globals: true,
  },
})
```

`src/index.css`（整个文件就一行）：

```css
@import "tailwindcss";
```

`package.json` 的 `scripts` 加上：

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: 写类型定义**

创建 `src/domain/types.ts`：

```ts
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
```

- [ ] **Step 4: 写测试**

创建 `src/domain/types.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { DEFAULT_SETTINGS, DEFAULT_DATA, BUILTIN_COST_ITEMS, newId } from './types'

describe('默认设置', () => {
  it('分成比例之和为 1', () => {
    const sum = DEFAULT_SETTINGS.partners.reduce((a, p) => a + p.shareRatio, 0)
    expect(sum).toBeCloseTo(1, 10)
  })

  it('内置成本项包含收购价与运输，且运输是批次级、收购价是单只级', () => {
    const purchase = BUILTIN_COST_ITEMS.find(c => c.id === 'purchase')!
    const transport = BUILTIN_COST_ITEMS.find(c => c.id === 'transport')!
    expect(purchase.scope).toBe('dog')
    expect(transport.scope).toBe('batch')
  })

  // 合规调研（docs/compliance/）查明：检疫是出售的法定前置，无害化处理是病死的强制支出。
  // 这两项必须在成本项里，否则「保本价」会把两块真金白银的支漏掉。
  it('内置成本项包含检疫与病死犬无害化处理', () => {
    const quarantine = BUILTIN_COST_ITEMS.find(c => c.id === 'quarantine')!
    const disposal = BUILTIN_COST_ITEMS.find(c => c.id === 'disposal')!
    expect(quarantine).toBeDefined()
    expect(quarantine.scope).toBe('dog')
    expect(disposal).toBeDefined()
    expect(disposal.scope).toBe('batch')
  })

  it('检疫与无害化处理的默认值都是 0，不许编造价格', () => {
    expect(DEFAULT_SETTINGS.quarantinePerDog).toBe(0)
    expect(DEFAULT_SETTINGS.disposalPerDog).toBe(0)
  })

  it('默认数据的三个集合都是空数组', () => {
    expect(DEFAULT_DATA.batches).toEqual([])
    expect(DEFAULT_DATA.dogs).toEqual([])
    expect(DEFAULT_DATA.entries).toEqual([])
  })

  it('newId 每次返回不同的值', () => {
    expect(newId()).not.toBe(newId())
  })
})
```

- [ ] **Step 5: 跑测试**

Run: `npx vitest run src/domain/types.test.ts`
Expected: 6 passed

- [ ] **Step 6: 让 App 能跑起来**

`src/main.tsx`：

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

`src/App.tsx`（临时版本，Task 8 会重写）：

```tsx
export default function App() {
  return <div className="p-4 text-lg">狗账</div>
}
```

Run: `npm run build`
Expected: 构建成功

- [ ] **Step 7: 提交**

```bash
git add -A
git add -f src package.json vite.config.ts tsconfig.json tsconfig.node.json index.html
git commit -m "chore: 脚手架 + 领域类型定义"
```

---

### Task 2: 金额工具

**Files:**
- Create: `src/domain/money.ts`
- Test: `src/domain/money.test.ts`

**Interfaces:**
- Consumes: `Money`（Task 1）
- Produces: `yuanToFen(yuan: number): Money`、`fenToYuan(fen: Money): number`、`formatMoney(fen: number): string`、`parseMoney(input: string): Money | null`

- [ ] **Step 1: 写失败的测试**

创建 `src/domain/money.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { yuanToFen, fenToYuan, formatMoney, parseMoney } from './money'

describe('yuanToFen', () => {
  it('元转分并四舍五入', () => {
    expect(yuanToFen(600)).toBe(60000)
    expect(yuanToFen(9.734)).toBe(973)
    expect(yuanToFen(9.736)).toBe(974)
  })
})

describe('fenToYuan', () => {
  it('分转元', () => {
    expect(fenToYuan(60000)).toBe(600)
  })
})

describe('formatMoney', () => {
  it('整数元不显示小数', () => {
    expect(formatMoney(60000)).toBe('¥600')
  })
  it('带角分时保留两位', () => {
    expect(formatMoney(97333)).toBe('¥973.33')
  })
  it('摊薄产生的无限小数被四舍五入到分', () => {
    // 5840 元 ÷ 6 = 973.3333... 元
    expect(formatMoney(584000 / 6)).toBe('¥973.33')
  })
  it('千位分隔', () => {
    expect(formatMoney(123456789)).toBe('¥1,234,567.89')
  })
  it('负数保留符号', () => {
    expect(formatMoney(-7300)).toBe('-¥73')
  })
})

describe('parseMoney', () => {
  it('解析纯数字', () => {
    expect(parseMoney('600')).toBe(60000)
  })
  it('容忍 ¥ 与千位逗号与空格', () => {
    expect(parseMoney(' ¥1,200.50 ')).toBe(120050)
  })
  it('空字符串返回 null', () => {
    expect(parseMoney('')).toBeNull()
    expect(parseMoney('   ')).toBeNull()
  })
  it('非数字返回 null', () => {
    expect(parseMoney('abc')).toBeNull()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/domain/money.test.ts`
Expected: FAIL，报 `Failed to resolve import "./money"`

- [ ] **Step 3: 实现**

创建 `src/domain/money.ts`：

```ts
import type { Money } from './types'

export function yuanToFen(yuan: number): Money {
  return Math.round(yuan * 100)
}

export function fenToYuan(fen: Money): number {
  return fen / 100
}

/** 把「分」格式化为可读金额。传入值允许是小数（摊薄除法的中间结果），显示时四舍五入到分。 */
export function formatMoney(fen: number): string {
  const negative = fen < 0
  const cents = Math.round(Math.abs(fen))
  const yuan = Math.floor(cents / 100)
  const rest = cents % 100
  const yuanStr = yuan.toLocaleString('en-US')
  const body = rest === 0
    ? `¥${yuanStr}`
    : `¥${yuanStr}.${String(rest).padStart(2, '0')}`
  return negative ? `-${body}` : body
}

/** 解析用户输入的金额文本为「分」。无法解析时返回 null（空输入也返回 null）。 */
export function parseMoney(input: string): Money | null {
  const cleaned = input.replace(/[¥,\s]/g, '')
  if (cleaned === '') return null
  if (!/^-?\d*\.?\d*$/.test(cleaned)) return null
  const value = Number(cleaned)
  if (!Number.isFinite(value)) return null
  return Math.round(value * 100)
}
```

注意 `formatMoney` 里用 `Math.floor` + 余数而不是 `toFixed`，是为了让「整元不显示小数」（`¥600` 而不是 `¥600.00`）。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/domain/money.test.ts`
Expected: 11 passed

- [ ] **Step 5: 提交**

```bash
git add src/domain/money.ts src/domain/money.test.ts
git commit -m "feat(domain): 金额工具（整数分存储）"
```

---

### Task 3: 成本核算与损耗摊薄

**Files:**
- Create: `src/domain/costing.ts`
- Test: `src/domain/costing.test.ts`

**Interfaces:**
- Consumes: `AppData`、`Dog`、`Money`、`Batch`（Task 1）；`formatMoney`（Task 2）
- Produces:
  - `dogsOfBatch(data: AppData, batchId: string): Dog[]`
  - `dogOwnCost(data: AppData, dogId: string): Money`
  - `batchTotalCost(data: AppData, batchId: string): Money`
  - `batchIncome(data: AppData, batchId: string): Money`
  - `inStockCount(data: AppData, batchId: string): number`
  - `aliveCount(data: AppData, batchId: string): number`
  - `deadLoss(data: AppData, batchId: string): Money`
  - `dilutedCostFen(data: AppData, dogId: string): number`
  - `dogIncome(data: AppData, dogId: string): Money`
  - `dogProfitFen(data: AppData, dogId: string): number`
  - `remainingFloorPriceFen(data: AppData, batchId: string): number | null`
  - `interface BatchSummary { totalCost, income, inStock, sold, dead, returned, deadLoss, floorPriceFen, netProfitFen }`
  - `batchSummary(data: AppData, batchId: string): BatchSummary`

- [ ] **Step 1: 写失败的测试**

创建 `src/domain/costing.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import type { AppData, Batch, Dog, LedgerEntry } from './types'
import { DEFAULT_DATA } from './types'
import {
  dogOwnCost, batchTotalCost, batchIncome, inStockCount, aliveCount,
  deadLoss, dilutedCostFen, dogIncome, dogProfitFen,
  remainingFloorPriceFen, batchSummary,
} from './costing'
import { formatMoney } from './money'

function makeBatch(over: Partial<Batch> = {}): Batch {
  return { id: 'b1', name: '10月3日一批', date: '2026-10-03', source: '农户', note: '', status: 'active', ...over }
}

function makeDog(id: string, status: Dog['status'], over: Partial<Dog> = {}): Dog {
  return { id, batchId: 'b1', code: id, breed: '', sex: 'unknown', ageMonths: null, status, note: '', ...over }
}

function entry(over: Partial<LedgerEntry>): LedgerEntry {
  return {
    id: `e-${Math.random()}`, date: '2026-10-03', type: 'expense', category: 'purchase',
    amount: 0, paidBy: 'pool', payee: null, batchId: 'b1', dogId: null, note: '', ...over,
  }
}

/** 设计文档 3.6 的关键案例：8 只 × 600 收购 + 400 运输 + 8 × 80 疫苗 = 5840 元，死 2 只 */
function scenarioData(): AppData {
  const dogs: Dog[] = []
  for (let i = 1; i <= 8; i++) dogs.push(makeDog(`d${i}`, i <= 2 ? 'dead' : 'in_stock'))
  const entries: LedgerEntry[] = [entry({ category: 'transport', amount: 40000 })]
  for (let i = 1; i <= 8; i++) {
    entries.push(entry({ category: 'purchase', amount: 60000, dogId: `d${i}` }))
    entries.push(entry({ category: 'medical', amount: 8000, dogId: `d${i}` }))
  }
  return { ...DEFAULT_DATA, batches: [makeBatch()], dogs, entries }
}

describe('批次成本', () => {
  it('批次总成本 = 所有关联该批次的支出，含单只狗层面的', () => {
    expect(batchTotalCost(scenarioData(), 'b1')).toBe(584000)
  })

  it('单只狗的直接成本只算挂到它自己的支出', () => {
    expect(dogOwnCost(scenarioData(), 'd3')).toBe(68000) // 600 + 80
  })

  it('批次收入只算挂到该批次的收入', () => {
    const data = scenarioData()
    data.entries.push(entry({ type: 'income', category: 'sale', amount: 90000, dogId: 'd3' }))
    expect(batchIncome(data, 'b1')).toBe(90000)
  })

  it('在库数与存活数：dead 既不在库也不存活', () => {
    const data = scenarioData()
    expect(inStockCount(data, 'b1')).toBe(6)
    expect(aliveCount(data, 'b1')).toBe(6)
  })

  it('退狗（returned）算在库也算存活', () => {
    const data = scenarioData()
    data.dogs.find(d => d.id === 'd3')!.status = 'returned'
    expect(inStockCount(data, 'b1')).toBe(6)
    expect(aliveCount(data, 'b1')).toBe(6)
  })

  it('已售出（sold）算存活但不在库', () => {
    const data = scenarioData()
    data.dogs.find(d => d.id === 'd3')!.status = 'sold'
    expect(inStockCount(data, 'b1')).toBe(5)
    expect(aliveCount(data, 'b1')).toBe(6)
  })

  it('死亡损耗 = 两只死狗的直接成本之和', () => {
    expect(deadLoss(scenarioData(), 'b1')).toBe(136000) // (600+80) × 2
  })
})

describe('★ 损耗摊薄（设计文档 3.6 案例）', () => {
  it('存活狗真实成本 = 批次总成本 ÷ 存活数', () => {
    const data = scenarioData()
    const cost = dilutedCostFen(data, 'd3')
    expect(formatMoney(cost)).toBe('¥973.33')
    expect(cost).toBeCloseTo(584000 / 6, 6)
  })

  it('按 900 元卖出是亏的，而当事人会以为赚了 300', () => {
    const data = scenarioData()
    data.dogs.find(d => d.id === 'd3')!.status = 'sold'
    data.entries.push(entry({ type: 'income', category: 'sale', amount: 90000, dogId: 'd3' }))
    expect(dogIncome(data, 'd3')).toBe(90000)
    expect(dogProfitFen(data, 'd3')).toBeCloseTo(90000 - 584000 / 6, 6)
    expect(formatMoney(dogProfitFen(data, 'd3'))).toBe('-¥73.33')
  })

  it('整批死光时不崩溃，且退化为该狗自身成本', () => {
    const data = scenarioData()
    data.dogs.forEach(d => { d.status = 'dead' })
    expect(aliveCount(data, 'b1')).toBe(0)
    expect(dilutedCostFen(data, 'd3')).toBe(68000)
  })
})

describe('★ 批次剩余保本单价（指标 A）', () => {
  it('未卖出任何一只时 = 总成本 ÷ 在库数', () => {
    const data = scenarioData()
    expect(formatMoney(remainingFloorPriceFen(data, 'b1')!)).toBe('¥973.33')
  })

  it('卖出后随收款额下降', () => {
    const data = scenarioData()
    data.dogs.find(d => d.id === 'd3')!.status = 'sold'
    data.entries.push(entry({ type: 'income', category: 'sale', amount: 200000, dogId: 'd3' }))
    // (584000 - 200000) ÷ 5 在库
    expect(remainingFloorPriceFen(data, 'b1')).toBeCloseTo(384000 / 5, 6)
  })

  it('已回本时返回 0，不是负数', () => {
    const data = scenarioData()
    data.entries.push(entry({ type: 'income', category: 'sale', amount: 999999, batchId: 'b1' }))
    expect(remainingFloorPriceFen(data, 'b1')).toBe(0)
  })

  it('没有在库狗时返回 null', () => {
    const data = scenarioData()
    data.dogs.forEach(d => { if (d.status === 'in_stock') d.status = 'sold' })
    expect(remainingFloorPriceFen(data, 'b1')).toBeNull()
  })
})

describe('batchSummary', () => {
  it('汇总各计数与金额', () => {
    const data = scenarioData()
    data.dogs.find(d => d.id === 'd3')!.status = 'sold'
    data.entries.push(entry({ type: 'income', category: 'sale', amount: 120000, dogId: 'd3' }))
    const s = batchSummary(data, 'b1')
    expect(s.totalCost).toBe(584000)
    expect(s.income).toBe(120000)
    expect(s.inStock).toBe(5)
    expect(s.sold).toBe(1)
    expect(s.dead).toBe(2)
    expect(s.returned).toBe(0)
    expect(s.netProfitFen).toBe(120000 - 584000)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/domain/costing.test.ts`
Expected: FAIL，报 `Failed to resolve import "./costing"`

- [ ] **Step 3: 实现**

创建 `src/domain/costing.ts`：

```ts
import type { AppData, Batch, Dog, Money } from './types'

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
 * 摊的是【整批的钱】÷【还活着的只数】，所以它也吃进运输、病死犬无害化处理
 * 这类批次层面的支出 —— 只把钱摊到"看得见的那只狗"身上，算出来的不是真实成本。
 * 这正是设计文档 3.6 案例给出的 5,840 ÷ 6 = 973.33 的定义。
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
```

`Batch` 在当前实现中被 import 但未直接使用 —— 如果 TS 报未使用，删掉 `Batch` 这个 import。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/domain/costing.test.ts`
Expected: 全 passed（共 15 个）

- [ ] **Step 5: 提交**

```bash
git add src/domain/costing.ts src/domain/costing.test.ts
git commit -m "feat(domain): 成本核算与损耗摊薄（含 5840/6 案例）"
```

---

### Task 4: 四本账（池子 / 垫付 / 注资 / 分红）

**Files:**
- Create: `src/domain/ledger.ts`
- Test: `src/domain/ledger.test.ts`

**Interfaces:**
- Consumes: `AppData`、`LedgerEntry`、`Money`（Task 1）
- Produces:
  - `totalIncome(data: AppData): Money`
  - `totalExpense(data: AppData): Money`
  - `poolBalance(data: AppData): Money`
  - `advanceBalance(data: AppData, partnerId: string): Money`
  - `contributedCapital(data: AppData, partnerId: string): Money`
  - `distributedTo(data: AppData, partnerId: string): Money`

- [ ] **Step 1: 写失败的测试**

创建 `src/domain/ledger.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import type { AppData, LedgerEntry } from './types'
import { DEFAULT_DATA } from './types'
import {
  totalIncome, totalExpense, poolBalance,
  advanceBalance, contributedCapital, distributedTo,
} from './ledger'

function withEntries(entries: Partial<LedgerEntry>[]): AppData {
  const full = entries.map((e, i) => ({
    id: `e${i}`, date: '2026-10-03', type: 'expense', category: 'purchase',
    amount: 0, paidBy: 'pool', payee: null, batchId: null, dogId: null, note: '',
    ...e,
  })) as LedgerEntry[]
  return { ...DEFAULT_DATA, entries: full }
}

describe('损益', () => {
  it('总收入 / 总支出', () => {
    const data = withEntries([
      { type: 'income', amount: 90000 },
      { type: 'income', amount: 10000 },
      { type: 'expense', amount: 30000 },
    ])
    expect(totalIncome(data)).toBe(100000)
    expect(totalExpense(data)).toBe(30000)
  })

  it('注资 / 报销 / 分红都不算收入也不算成本', () => {
    const data = withEntries([
      { type: 'injection', amount: 500000, paidBy: 'p1' },
      { type: 'reimbursement', amount: 20000, payee: 'p1' },
      { type: 'distribution', amount: 50000, payee: 'p2' },
    ])
    expect(totalIncome(data)).toBe(0)
    expect(totalExpense(data)).toBe(0)
  })
})

describe('池子现金', () => {
  it('注资 + 收入 − 池子直付支出 − 报销 − 分红', () => {
    const data = withEntries([
      { type: 'injection', amount: 500000, paidBy: 'p1' },
      { type: 'injection', amount: 500000, paidBy: 'p2' },
      { type: 'income', amount: 120000 },
      { type: 'expense', amount: 40000, paidBy: 'pool' },   // 池子直付
      { type: 'expense', amount: 60000, paidBy: 'p1' },     // p1 垫付：池子不动
      { type: 'reimbursement', amount: 60000, payee: 'p1' },
      { type: 'distribution', amount: 30000, payee: 'p1' },
    ])
    // 1000000 + 120000 - 40000 - 60000 - 30000
    expect(poolBalance(data)).toBe(990000)
  })
})

describe('垫付账', () => {
  it('某人垫付的支出之和，减去已报销给他的', () => {
    const data = withEntries([
      { type: 'expense', amount: 50000, paidBy: 'p1' },
      { type: 'expense', amount: 20000, paidBy: 'p1' },
      { type: 'expense', amount: 90000, paidBy: 'p2' },
      { type: 'reimbursement', amount: 30000, payee: 'p1' },
    ])
    expect(advanceBalance(data, 'p1')).toBe(40000)
    expect(advanceBalance(data, 'p2')).toBe(90000)
  })

  it('池子直付不产生垫付', () => {
    const data = withEntries([{ type: 'expense', amount: 50000, paidBy: 'pool' }])
    expect(advanceBalance(data, 'p1')).toBe(0)
  })
})

describe('注资本金与分红账', () => {
  it('注资按注入人累计', () => {
    const data = withEntries([
      { type: 'injection', amount: 500000, paidBy: 'p1' },
      { type: 'injection', amount: 300000, paidBy: 'p2' },
    ])
    expect(contributedCapital(data, 'p1')).toBe(500000)
    expect(contributedCapital(data, 'p2')).toBe(300000)
  })

  it('注资不计入分红账', () => {
    const data = withEntries([{ type: 'injection', amount: 500000, paidBy: 'p1' }])
    expect(distributedTo(data, 'p1')).toBe(0)
  })

  it('分红按收款人累计', () => {
    const data = withEntries([
      { type: 'distribution', amount: 30000, payee: 'p1' },
      { type: 'distribution', amount: 20000, payee: 'p1' },
    ])
    expect(distributedTo(data, 'p1')).toBe(50000)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/domain/ledger.test.ts`
Expected: FAIL，报 `Failed to resolve import "./ledger"`

- [ ] **Step 3: 实现**

创建 `src/domain/ledger.ts`：

```ts
import type { AppData, EntryType, Money } from './types'

function sumBy(data: AppData, type: EntryType, pick: (e: AppData['entries'][number]) => boolean): Money {
  return data.entries
    .filter(e => e.type === type && pick(e))
    .reduce((s, e) => s + e.amount, 0)
}

export function totalIncome(data: AppData): Money {
  return sumBy(data, 'income', () => true)
}

export function totalExpense(data: AppData): Money {
  return sumBy(data, 'expense', () => true)
}

/**
 * 池子现金余额。逐条对照设计文档 3.3 的四本账表格：
 * + 注资 + 收入 − 池子直付支出 − 报销 − 分红
 * （合伙人垫付的支出不动池子里的钱）
 */
export function poolBalance(data: AppData): Money {
  const injection = sumBy(data, 'injection', () => true)
  const income = totalIncome(data)
  const paidFromPool = sumBy(data, 'expense', e => e.paidBy === 'pool')
  const reimbursed = sumBy(data, 'reimbursement', () => true)
  const distributed = sumBy(data, 'distribution', () => true)
  return injection + income - paidFromPool - reimbursed - distributed
}

/** 某合伙人尚未被归还的垫付额 */
export function advanceBalance(data: AppData, partnerId: string): Money {
  const advanced = sumBy(data, 'expense', e => e.paidBy === partnerId)
  const reimbursed = sumBy(data, 'reimbursement', e => e.payee === partnerId)
  return advanced - reimbursed
}

/** 某合伙人的注资本金 */
export function contributedCapital(data: AppData, partnerId: string): Money {
  return sumBy(data, 'injection', e => e.paidBy === partnerId)
}

/** 某合伙人已领取的分红合计 */
export function distributedTo(data: AppData, partnerId: string): Money {
  return sumBy(data, 'distribution', e => e.payee === partnerId)
}
```

注意 `injection` 的收款/付款人复用 `paidBy` 字段存「注入人」（见 Task 1 的类型注释）。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/domain/ledger.test.ts`
Expected: 8 passed

- [ ] **Step 5: 提交**

```bash
git add src/domain/ledger.ts src/domain/ledger.test.ts
git commit -m "feat(domain): 四本账计算（池子/垫付/注资/分红）"
```

---

### Task 5: 结算与分账

**Files:**
- Create: `src/domain/settlement.ts`
- Test: `src/domain/settlement.test.ts`

**Interfaces:**
- Consumes: `AppData`、`Money`、`Partner`（Task 1）；`totalIncome`、`totalExpense`、`poolBalance`、`advanceBalance`、`contributedCapital`、`distributedTo`（Task 4）
- Produces: `interface PartnerSettlement`、`interface Settlement`、`settle(data: AppData): Settlement`、`validateSettings(settings: Settings): string | null`

- [ ] **Step 1: 写失败的测试**

创建 `src/domain/settlement.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import type { AppData, LedgerEntry, Settings } from './types'
import { DEFAULT_DATA, DEFAULT_SETTINGS } from './types'
import { settle, validateSettings } from './settlement'

function withEntries(entries: Partial<LedgerEntry>[]): AppData {
  const full = entries.map((e, i) => ({
    id: `e${i}`, date: '2026-10-03', type: 'expense', category: 'purchase',
    amount: 0, paidBy: 'pool', payee: null, batchId: null, dogId: null, note: '',
    ...e,
  })) as LedgerEntry[]
  return { ...DEFAULT_DATA, entries: full }
}

describe('settle', () => {
  it('净利 = 总收入 − 总支出；垫付与分红不计入损益', () => {
    const data = withEntries([
      { type: 'injection', amount: 1000000, paidBy: 'p1' },
      { type: 'expense', amount: 584000, paidBy: 'p1' },
      { type: 'income', amount: 720000 },
      { type: 'reimbursement', amount: 100000, payee: 'p1' },
      { type: 'distribution', amount: 50000, payee: 'p2' },
    ])
    const s = settle(data)
    expect(s.totalIncome).toBe(720000)
    expect(s.totalExpense).toBe(584000)
    expect(s.netProfit).toBe(136000)
  })

  it('两人各 50% 时应分未分 = 净利 × 0.5 − 已分红', () => {
    const data = withEntries([
      { type: 'expense', amount: 100000, paidBy: 'p1' },
      { type: 'income', amount: 300000 },
      { type: 'distribution', amount: 20000, payee: 'p2' },
    ])
    const s = settle(data)
    const p1 = s.partners.find(p => p.id === 'p1')!
    const p2 = s.partners.find(p => p.id === 'p2')!
    expect(p1.claimable).toBe(100000)   // 200000×0.5 − 0
    expect(p2.claimable).toBe(80000)    // 200000×0.5 − 20000
  })

  it('垫付余额按人分别统计', () => {
    const data = withEntries([
      { type: 'expense', amount: 70000, paidBy: 'p1' },
      { type: 'expense', amount: 40000, paidBy: 'p2' },
      { type: 'reimbursement', amount: 40000, payee: 'p2' },
      { type: 'income', amount: 500000 },
    ])
    const s = settle(data)
    expect(s.partners.find(p => p.id === 'p1')!.advance).toBe(70000)
    expect(s.partners.find(p => p.id === 'p2')!.advance).toBe(0)
  })

  it('池子现金与净利是两回事：净利留在池子里也可以不分红', () => {
    const data = withEntries([
      { type: 'injection', amount: 100000, paidBy: 'p1' },
      { type: 'income', amount: 50000 },
    ])
    const s = settle(data)
    expect(s.pool).toBe(150000)
    expect(s.netProfit).toBe(50000)
    expect(s.partners.find(p => p.id === 'p1')!.claimable).toBe(25000)
  })
})

describe('validateSettings', () => {
  it('比例之和为 1 时通过', () => {
    expect(validateSettings(DEFAULT_SETTINGS)).toBeNull()
  })

  it('比例之和不为 1 时返回错误信息', () => {
    const bad: Settings = {
      ...DEFAULT_SETTINGS,
      partners: [
        { id: 'p1', name: '我', shareRatio: 0.5 },
        { id: 'p2', name: '伙伴', shareRatio: 0.6 },
      ],
    }
    expect(validateSettings(bad)).toBe('分成比例之和必须等于 100%')
  })

  it('没有合伙人时报错', () => {
    expect(validateSettings({ ...DEFAULT_SETTINGS, partners: [] })).toBe('至少需要一个合伙人')
  })

  // 合规成本项（检疫 / 无害化处理）不许填负数——负数会让保本价被低估，是危险的方向。
  it('检疫费为负时报错', () => {
    expect(validateSettings({ ...DEFAULT_SETTINGS, quarantinePerDog: -1 })).toBe('检疫费不能为负')
  })

  it('病死犬处理费为负时报错', () => {
    expect(validateSettings({ ...DEFAULT_SETTINGS, disposalPerDog: -1 })).toBe('病死犬处理费不能为负')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/domain/settlement.test.ts`
Expected: FAIL，报 `Failed to resolve import "./settlement"`

- [ ] **Step 3: 实现**

创建 `src/domain/settlement.ts`：

```ts
import type { AppData, Money, Settings } from './types'
import {
  totalIncome, totalExpense, poolBalance,
  advanceBalance, contributedCapital, distributedTo,
} from './ledger'

export interface PartnerSettlement {
  id: string
  name: string
  shareRatio: number
  /** 尚未归还的垫付 */
  advance: Money
  /** 注资本金 */
  contributed: Money
  /** 已领分红 */
  distributed: Money
  /** 应分未分（可为负，表示已超额领取） */
  claimable: Money
}

export interface Settlement {
  totalIncome: Money
  totalExpense: Money
  netProfit: Money
  pool: Money
  partners: PartnerSettlement[]
}

export function settle(data: AppData): Settlement {
  const income = totalIncome(data)
  const expense = totalExpense(data)
  const netProfit = income - expense
  return {
    totalIncome: income,
    totalExpense: expense,
    netProfit,
    pool: poolBalance(data),
    partners: data.settings.partners.map(p => ({
      id: p.id,
      name: p.name,
      shareRatio: p.shareRatio,
      advance: advanceBalance(data, p.id),
      contributed: contributedCapital(data, p.id),
      distributed: distributedTo(data, p.id),
      claimable: Math.round(netProfit * p.shareRatio) - distributedTo(data, p.id),
    })),
  }
}

/** 校验设置合法性。返回 null 表示通过，否则返回给用户看的中文错误信息。 */
export function validateSettings(settings: Settings): string | null {
  if (settings.partners.length === 0) return '至少需要一个合伙人'
  const sum = settings.partners.reduce((a, p) => a + p.shareRatio, 0)
  if (Math.abs(sum - 1) > 1e-9) return '分成比例之和必须等于 100%'
  if (!(settings.targetMarginRate >= 0)) return '目标毛利率不能为负'
  if (!(settings.expectedMortalityRate >= 0 && settings.expectedMortalityRate < 1)) {
    return '预估死亡率必须在 0% 到 100% 之间'
  }
  if (!(settings.quarantinePerDog >= 0)) return '检疫费不能为负'
  if (!(settings.disposalPerDog >= 0)) return '病死犬处理费不能为负'
  return null
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/domain/settlement.test.ts`
Expected: 9 passed

- [ ] **Step 5: 提交**

```bash
git add src/domain/settlement.ts src/domain/settlement.test.ts
git commit -m "feat(domain): 结算与设置校验"
```

---

### Task 6: 决策台模拟与「一键建批次」

**Files:**
- Create: `src/domain/planning.ts`
- Test: `src/domain/planning.test.ts`

**Interfaces:**
- Consumes: `AppData`、`Money`、`Settings`、`Batch`、`Dog`、`LedgerEntry`、`newId`（Task 1）；`yuanToFen`（Task 2）
- Produces:
  - `interface PlanInput { n, purchasePrice, freight, medicalPerDog, quarantinePerDog, disposalPerDog, mortalityRate, targetPrice }`（金额字段均为 `Money`）
  - `interface PlanScenario { soldCount: number; revenue: Money; profitFen: number; perPartnerFen: number }`
  - `interface PlanResult { totalCost, expectedAlive, breakEvenPriceFen, suggestedPriceFen, scenarios }`
  - `plan(settings: Settings, input: PlanInput): PlanResult`
  - `createBatchFromPlan(data: AppData, input: PlanInput, batchName: string, date: string, plannedChannel?: ChannelId): AppData`（`plannedChannel` 省略时用 `'undecided'`）

> **修订二带来的必填字段（本任务必须处理）**：`Batch` 现在有必填的 `plannedChannel: ChannelId`（修订二 / 设计文档 D11）。`createBatchFromPlan` 创建的批次**必须带上它**——`tsc` 会因此报错，**这是故意的，不要用 `as any`、`as unknown as` 或 `@ts-expect-error` 绕开**。同样，它创建的每只 `Dog` 必须带上 6 个检疫字段（`rabiesVaccinatedOn` / `antibodyTestedOn` / `antibodyReportNo` / `quarantineCertNo` / `quarantineCertIssuedOn` / `quarantineCertValidUntil`）：刚买回来的狗还没接种、没检测、没证明，所以四个日期填 `null`，两个编号填 `''`。不要「顺手」填今天——那会让检疫阶段的推导从第一天起就是错的。

> **小数分的口径（`disposalPerDog`）**：`expectedDead = n × mortalityRate` 允许是小数，`disposalPerDog × expectedDead` 因此也是小数分。这是**期望值**——不是「要赔 0.45 具尸体」。不要把它四舍五入到整只狗：取整会让保本价随死亡率跳变，而且和同样是期望值的 `expectedAlive`（也是小数）口径不一致。四舍五入只发生在界面边界（`formatMoney`）。`createBatchFromPlan` 不记这笔支出——它是预估，不是已经花掉的钱；真死了一只狗、真付了处理费，那一刻才记一笔 `category: 'disposal'`（它的 cost item 是 `scope: 'dog'`，所以记在那一只狗身上）。

- [ ] **Step 1: 写失败的测试**

创建 `src/domain/planning.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { DEFAULT_DATA, DEFAULT_SETTINGS } from './types'
import { plan, createBatchFromPlan, type PlanInput } from './planning'
import { formatMoney } from './money'
import { batchTotalCost, batchSummary } from './costing'

/**
 * 设计文档 3.6 案例：8 只 × 600 + 油费 400 + 每只疫苗 80，预估死亡率 25%。
 * 这里刻意把检疫费与无害化处理费设为 0，好让「损耗摊薄」这个教学案例的数字
 * 与设计文档 3.6 节严格对得上。这两项由下面单独一组测试覆盖。
 */
const input: PlanInput = {
  n: 8,
  purchasePrice: 60000,
  freight: 40000,
  medicalPerDog: 8000,
  quarantinePerDog: 0,
  disposalPerDog: 0,
  mortalityRate: 0.25,
  targetPrice: 120000,
}

describe('plan', () => {
  it('预估总成本按买入的全部只数计算，不因预估死亡而减少', () => {
    expect(plan(DEFAULT_SETTINGS, input).totalCost).toBe(584000)
  })

  it('预估存活数 = 只数 × (1 − 死亡率)', () => {
    expect(plan(DEFAULT_SETTINGS, input).expectedAlive).toBeCloseTo(6, 10)
  })

  it('★ 保本价 = 总成本 ÷ 预估存活数', () => {
    const r = plan(DEFAULT_SETTINGS, input)
    expect(r.breakEvenPriceFen).toBeCloseTo(584000 / 6, 6)
    expect(formatMoney(r.breakEvenPriceFen)).toBe('¥973.33')
  })

  it('建议售价 = 保本价 × (1 + 目标毛利率)，默认 30%', () => {
    const r = plan(DEFAULT_SETTINGS, input)
    expect(r.suggestedPriceFen).toBeCloseTo((584000 / 6) * 1.3, 6)
  })

  it('死亡率 0 时保本价 = 总成本 ÷ 只数', () => {
    const r = plan(DEFAULT_SETTINGS, { ...input, mortalityRate: 0 })
    expect(r.breakEvenPriceFen).toBeCloseTo(584000 / 8, 6)
  })

  it('死亡率 100% 时不崩溃，保本价退化为总成本本身', () => {
    const r = plan(DEFAULT_SETTINGS, { ...input, mortalityRate: 1 })
    expect(Number.isFinite(r.breakEvenPriceFen)).toBe(true)
    expect(r.breakEvenPriceFen).toBe(584000)
  })

  it('只数 0 时不崩溃且保本价为 0', () => {
    const r = plan(DEFAULT_SETTINGS, { ...input, n: 0 })
    expect(r.totalCost).toBe(40000)
    expect(r.breakEvenPriceFen).toBe(0)
  })

  it('风险模拟给出 60% / 80% / 100% 三档，亏损按人头平摊', () => {
    const r = plan(DEFAULT_SETTINGS, input)
    expect(r.scenarios.map(s => s.soldCount)).toEqual([5, 6, 8])
    const s8 = r.scenarios.find(s => s.soldCount === 8)!
    expect(s8.revenue).toBe(960000)
    expect(s8.profitFen).toBe(960000 - 584000)
    expect(s8.perPartnerFen).toBe((960000 - 584000) / 2)
  })

  it('只卖掉大半时利润被摊得很薄', () => {
    const r = plan(DEFAULT_SETTINGS, input)
    const s5 = r.scenarios.find(s => s.soldCount === 5)!
    const s8 = r.scenarios.find(s => s.soldCount === 8)!
    expect(s5.profitFen).toBe(5 * 120000 - 584000)   // 16000 分 = ¥160
    expect(s5.perPartnerFen).toBe(8000)              // 每人 ¥80
    expect(s5.profitFen).toBeLessThan(s8.profitFen)
  })

  it('售价压到保本价以下时每人为负', () => {
    const r = plan(DEFAULT_SETTINGS, { ...input, targetPrice: 90000 })
    const s5 = r.scenarios.find(s => s.soldCount === 5)!
    expect(s5.profitFen).toBe(5 * 90000 - 584000)
    expect(s5.perPartnerFen).toBeLessThan(0)
  })
})

describe('plan 计入合规成本（检疫与无害化处理）', () => {
  // docs/compliance/ 查明的两项法定支出：检疫是出售的前置条件，
  // 病死犬无害化处理是强制支出。它们之前完全不在成本模型里，
  // 结果就是这个软件最值钱的那个数字——保本价——是偏低的。
  const compliance: PlanInput = {
    ...input,
    quarantinePerDog: 5000,   // 每只 ¥50
    disposalPerDog: 20000,    // 每只病死犬 ¥200
  }

  it('检疫费按买回来的全部只数计，包括后来会死掉的那两只', () => {
    const r = plan(DEFAULT_SETTINGS, { ...compliance, mortalityRate: 0, disposalPerDog: 0 })
    expect(r.totalCost).toBe(584000 + 8 * 5000)   // 5840 元 + 400 元
  })

  it('无害化处理费按预估死亡只数计，不是按买回来的只数计', () => {
    const r = plan(DEFAULT_SETTINGS, { ...compliance, quarantinePerDog: 0 })
    expect(r.totalCost).toBe(584000 + 2 * 20000)  // 8 × 25% = 2 只 × 200 元
  })

  it('★ 两项都算进去后，保本价从 ¥973 抬到 ¥1,106', () => {
    const r = plan(DEFAULT_SETTINGS, compliance)
    expect(r.totalCost).toBe(664000)              // 5840 + 400 + 400 = 6640 元
    expect(r.expectedAlive).toBeCloseTo(6, 10)
    expect(r.breakEvenPriceFen).toBeCloseTo(664000 / 6, 6)
    expect(formatMoney(r.breakEvenPriceFen)).toBe('¥1,106.67')
  })
})

describe('createBatchFromPlan', () => {
  it('按计划创建批次、N 只狗、以及运输与每只狗的收购+疫苗支出', () => {
    const next = createBatchFromPlan(DEFAULT_DATA, input, '10月3日一批', '2026-10-03')
    expect(next.batches).toHaveLength(1)
    expect(next.dogs).toHaveLength(8)
    const batchId = next.batches[0].id
    expect(batchTotalCost(next, batchId)).toBe(584000)
    // 1 笔运输 + 8 笔收购 + 8 笔疫苗
    expect(next.entries.filter(e => e.type === 'expense')).toHaveLength(17)
  })

  it('检疫费按每只狗记一笔支出，且在建批次时就记上', () => {
    const next = createBatchFromPlan(
      DEFAULT_DATA, { ...input, quarantinePerDog: 5000 }, '10月3日一批', '2026-10-03',
    )
    const batchId = next.batches[0].id
    // 原来的 5840 元 + 8 只 × 50 元
    expect(batchTotalCost(next, batchId)).toBe(584000 + 8 * 5000)
    expect(next.entries.filter(e => e.type === 'expense' && e.category === 'quarantine')).toHaveLength(8)
    // 无害化处理费是「预估会死几只」的假设，不是已发生的支出，所以建批次时一笔都不记
    expect(next.entries.filter(e => e.type === 'expense' && e.category === 'disposal')).toHaveLength(0)
  })

  it('每只狗的编号形如 批次名-序号，且初始状态为在库', () => {
    const next = createBatchFromPlan(DEFAULT_DATA, input, '10月3日一批', '2026-10-03')
    expect(next.dogs[0].code).toBe('10月3日一批-1')
    expect(next.dogs.every(d => d.status === 'in_stock')).toBe(true)
    expect(next.dogs.every(d => d.batchId === next.batches[0].id)).toBe(true)
  })

  it('新批次的在库保本价 = 总成本 ÷ 只数（此时还没死，所以低于决策台的保本价）', () => {
    const next = createBatchFromPlan(DEFAULT_DATA, input, '10月3日一批', '2026-10-03')
    const s = batchSummary(next, next.batches[0].id)
    expect(formatMoney(s.floorPriceFen!)).toBe('¥730')
  })

  it('不修改传入的 data（纯函数）', () => {
    const before = JSON.stringify(DEFAULT_DATA)
    createBatchFromPlan(DEFAULT_DATA, input, 'X', '2026-10-03')
    expect(JSON.stringify(DEFAULT_DATA)).toBe(before)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/domain/planning.test.ts`
Expected: FAIL，报 `Failed to resolve import "./planning"`

- [ ] **Step 3: 实现**

创建 `src/domain/planning.ts`：

```ts
import type { AppData, Batch, Dog, LedgerEntry, Money, Settings } from './types'
import { newId } from './types'

export interface PlanInput {
  /** 预计收到几只 */
  n: number
  /** 每只收购价（分） */
  purchasePrice: Money
  /** 这一趟的油费 + 笼具（分，整批） */
  freight: Money
  /** 每只疫苗医疗（分） */
  medicalPerDog: Money
  /** 每只狗的检疫费（分）：狂犬病免疫抗体检测 + 检疫申报跑腿。法定前置，填 0 会低估保本价 */
  quarantinePerDog: Money
  /** 每只病死犬的无害化处理费（分）。只按预估死亡只数计入，不是按买回来的只数 */
  disposalPerDog: Money
  /** 预估死亡率，0~1 */
  mortalityRate: number
  /** 打算卖多少钱一只（分） */
  targetPrice: Money
}

export interface PlanScenario {
  soldCount: number
  revenue: Money
  profitFen: number
  perPartnerFen: number
}

export interface PlanResult {
  totalCost: Money
  expectedAlive: number
  /** ★ 保本价（分，可能带小数）：低于这个价卖出就是亏 */
  breakEvenPriceFen: number
  suggestedPriceFen: number
  scenarios: PlanScenario[]
}

export function plan(settings: Settings, input: PlanInput): PlanResult {
  const n = Math.max(0, Math.floor(input.n))
  // 检疫费按买回来的【全部】只数交：狗死了检疫的钱也不会退。
  // 无害化处理费只对【预估死亡】的那部分发生——所以两者算法不同，不能一起乘 n。
  const expectedDead = n * input.mortalityRate
  const totalCost =
    n * input.purchasePrice +
    input.freight +
    n * input.medicalPerDog +
    n * input.quarantinePerDog +
    expectedDead * input.disposalPerDog

  // 预估存活数：至少为 1（全部死光时不能除零，保本价退化为总成本）
  const expectedAlive = Math.max(1, n * (1 - input.mortalityRate))
  // 一只都没收时不谈保本价
  const breakEvenPriceFen = n === 0 ? 0 : totalCost / expectedAlive
  const suggestedPriceFen = breakEvenPriceFen * (1 + settings.targetMarginRate)

  const partnerCount = Math.max(1, settings.partners.length)
  // 三档：收回来六成 / 八成 / 全部卖掉
  const soldCounts = n === 0
    ? []
    : Array.from(new Set([Math.round(n * 0.6), Math.round(n * 0.8), n])).sort((a, b) => a - b)

  const scenarios: PlanScenario[] = soldCounts.map(soldCount => {
    const revenue = soldCount * input.targetPrice
    const profitFen = revenue - totalCost
    return { soldCount, revenue, profitFen, perPartnerFen: profitFen / partnerCount }
  })

  return { totalCost, expectedAlive, breakEvenPriceFen, suggestedPriceFen, scenarios }
}

/**
 * 把一次决策直接变成可记账的批次：建批次 + N 只狗 + 运输支出 + 每只狗的收购与疫苗支出。
 * 纯函数，不修改传入的 data。所有支出默认由池子直付（paidBy: 'pool'）。
 */
export function createBatchFromPlan(
  data: AppData,
  input: PlanInput,
  batchName: string,
  date: string,
  plannedChannel: ChannelId = 'undecided',
): AppData {
  const batchId = newId()
  const batch: Batch = {
    id: batchId, name: batchName, date, source: '', note: '', status: 'active',
    plannedChannel,
  }

  const n = Math.max(0, Math.floor(input.n))
  const dogs: Dog[] = []
  const entries: LedgerEntry[] = []

  const baseEntry = {
    date, paidBy: 'pool' as const, payee: null, batchId, dogId: null as string | null, note: '',
  }

  if (input.freight > 0) {
    entries.push({ id: newId(), type: 'expense', category: 'transport', amount: input.freight, ...baseEntry })
  }

  for (let i = 1; i <= n; i++) {
    const dogId = newId()
    dogs.push({
      id: dogId, batchId, code: `${batchName}-${i}`, breed: '',
      sex: 'unknown', ageMonths: null, status: 'in_stock', note: '',
      rabiesVaccinatedOn: null, antibodyTestedOn: null,
      antibodyReportNo: '', quarantineCertNo: '',
      quarantineCertIssuedOn: null, quarantineCertValidUntil: null,
    })
    if (input.purchasePrice > 0) {
      entries.push({ id: newId(), type: 'expense', category: 'purchase', amount: input.purchasePrice, ...baseEntry, dogId })
    }
    if (input.medicalPerDog > 0) {
      entries.push({ id: newId(), type: 'expense', category: 'medical', amount: input.medicalPerDog, ...baseEntry, dogId })
    }
    // 检疫费在建批次时就记上：买回来就得开始检疫流程，而这笔钱必须在能出售之前付掉。
    // 注意：这里【不】记无害化处理费——那是「预估会死几只」的假设，不是已经发生的支出。
    if (input.quarantinePerDog > 0) {
      entries.push({ id: newId(), type: 'expense', category: 'quarantine', amount: input.quarantinePerDog, ...baseEntry, dogId })
    }
  }

  return {
    ...data,
    batches: [...data.batches, batch],
    dogs: [...data.dogs, ...dogs],
    entries: [...data.entries, ...entries],
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/domain/planning.test.ts`
Expected: 全部 passed（计划片段本身只有 18 个 `it`；实际写出来的是 24 个——多出的 6 个覆盖计划只写成散文、明确留给实施者的需求：`plannedChannel` 默认值、显式渠道透传、新建狗 6 个检疫字段全空、旧批次不被改动、`freight: 0` 不记运输、`n: 0` 建空批次。数量以覆盖面为准，不以下面这个数字为准）

- [ ] **Step 5: 跑全量测试**

Run: `npx vitest run`
Expected: 全部 passed（本任务实测 77 个；本任务新增 24 个。到 Task 9 做完时全仓是 **111 个 / 11 个文件**——Task 9 又自己加了 15 个 `planForm` 测试。剩下的任务还会加不少，**以实际覆盖面为准，不要为了凑某个数字增删测试**）

- [ ] **Step 6: 提交**

```bash
git add src/domain/planning.ts src/domain/planning.test.ts
git commit -m "feat(domain): 决策台模拟与一键建批次"
```

---

### Task 7: 存储层与备份文件

**Files:**
- Create: `src/storage/types.ts`, `src/storage/memory.ts`, `src/storage/indexeddb.ts`, `src/storage/backup.ts`
- Test: `src/storage/backup.test.ts`, `src/storage/memory.test.ts`

**Interfaces:**
- Consumes: `AppData`、`DEFAULT_DATA`（Task 1）
- Produces:
  - `interface Storage { load(): Promise<AppData | null>; save(data: AppData): Promise<void>; clear(): Promise<void> }`
  - `createMemoryStorage(): Storage`
  - `indexedDbStorage: Storage`
  - `requestPersistentStorage(): Promise<boolean>`
  - `exportBackup(data: AppData): string`
  - `importBackup(json: string): AppData`（失败抛 `Error`）

- [ ] **Step 1: 写失败的测试**

创建 `src/storage/memory.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { createMemoryStorage } from './memory'
import { DEFAULT_DATA, type AppData } from '../domain/types'

describe('createMemoryStorage', () => {
  it('没有数据时 load 返回 null', async () => {
    expect(await createMemoryStorage().load()).toBeNull()
  })

  it('保存后能原样读回', async () => {
    const s = createMemoryStorage()
    const data = { ...DEFAULT_DATA, batches: [{ id: 'b1', name: 'x', date: '2026-10-03', source: '', note: '', status: 'active' as const, plannedChannel: 'undecided' as const }] }
    await s.save(data)
    expect(await s.load()).toEqual(data)
  })

  it('clear 后 load 返回 null', async () => {
    const s = createMemoryStorage()
    await s.save(DEFAULT_DATA)
    await s.clear()
    expect(await s.load()).toBeNull()
  })

  it('存进来的对象是快照，之后修改原对象不影响已存数据', async () => {
    const s = createMemoryStorage()
    // 必须显式标注 AppData。`{ ...DEFAULT_DATA, batches: [] }` 会被推断成 `batches: never[]`，
    // 下一行 push 就报 TS2345 —— vitest 绿、`tsc -b` 红，正是本仓最容易踩的坑。
    const data: AppData = { ...DEFAULT_DATA, batches: [] }
    await s.save(data)
    data.batches.push({ id: 'b9', name: 'late', date: '2026-10-04', source: '', note: '', status: 'active', plannedChannel: 'undecided' })
    expect((await s.load())!.batches).toHaveLength(0)
  })
})
```

创建 `src/storage/backup.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { exportBackup, importBackup } from './backup'
import { DEFAULT_DATA } from '../domain/types'

describe('exportBackup / importBackup', () => {
  it('导出再导入得到等价数据', () => {
    const data = {
      ...DEFAULT_DATA,
      batches: [{ id: 'b1', name: '一批', date: '2026-10-03', source: '农户', note: '', status: 'active' as const, plannedChannel: 'undecided' as const }],
    }
    const json = exportBackup(data)
    expect(importBackup(json)).toEqual(data)
  })

  it('导出内容带应用标识和版本，防止导错文件', () => {
    const parsed = JSON.parse(exportBackup(DEFAULT_DATA))
    expect(parsed.app).toBe('dog-ledger')
    expect(parsed.version).toBe(1)
    expect(typeof parsed.exportedAt).toBe('string')
  })

  it('拒绝非本应用的文件', () => {
    expect(() => importBackup('{"app":"something-else","data":{}}')).toThrow('这不是狗账的备份文件')
  })

  it('拒绝非法 JSON', () => {
    expect(() => importBackup('not json')).toThrow('备份文件不是合法的 JSON')
  })

  it('拒绝缺少必要集合的文件', () => {
    const bad = JSON.stringify({ app: 'dog-ledger', version: 1, data: { settings: {} } })
    expect(() => importBackup(bad)).toThrow('备份文件结构不完整')
  })

  it('补全缺失的可选设置字段，避免旧备份炸掉新版本', () => {
    const partial = JSON.stringify({
      app: 'dog-ledger', version: 1, exportedAt: '2026-10-03T00:00:00.000Z',
      data: { settings: { partners: [{ id: 'p1', name: '我', shareRatio: 1 }] }, batches: [], dogs: [], entries: [] },
    })
    const restored = importBackup(partial)
    expect(restored.settings.targetMarginRate).toBe(0.3)
    expect(restored.settings.expectedMortalityRate).toBe(0.15)
    expect(restored.settings.costItems.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/storage`
Expected: FAIL，报 `Failed to resolve import "./memory"`

- [ ] **Step 3: 实现存储接口与内存实现**

创建 `src/storage/types.ts`：

```ts
import type { AppData } from '../domain/types'

export interface Storage {
  load(): Promise<AppData | null>
  save(data: AppData): Promise<void>
  clear(): Promise<void>
}
```

创建 `src/storage/memory.ts`：

```ts
import type { AppData } from '../domain/types'
import type { Storage } from './types'

/** 内存实现，只用于测试。存入时做深拷贝，模拟真实存储的隔离性。 */
export function createMemoryStorage(): Storage {
  let stored: AppData | null = null
  return {
    async load() {
      return stored === null ? null : structuredClone(stored)
    },
    async save(data) {
      stored = structuredClone(data)
    },
    async clear() {
      stored = null
    },
  }
}
```

- [ ] **Step 4: 实现 IndexedDB 存储**

创建 `src/storage/indexeddb.ts`：

```ts
import type { AppData } from '../domain/types'
import type { Storage } from './types'

const DB_NAME = 'dog-ledger'
const STORE = 'appdata'
const KEY = 'singleton'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(db => new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode)
    const req = run(t.objectStore(STORE))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    t.oncomplete = () => db.close()
  }))
}

/** 整个数据集作为一个对象整体读写。数据量在几百条以内，不做增量持久化。 */
export const indexedDbStorage: Storage = {
  async load() {
    const value = await tx<AppData | undefined>('readonly', s => s.get(KEY) as IDBRequest<AppData | undefined>)
    return value ?? null
  },
  async save(data) {
    await tx('readwrite', s => s.put(data, KEY))
  },
  async clear() {
    await tx('readwrite', s => s.delete(KEY))
  },
}

/** 请求浏览器把本站数据标记为持久化，降低被系统回收的概率。 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false
  try {
    if (await navigator.storage.persisted()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}
```

- [ ] **Step 5: 实现备份文件**

创建 `src/storage/backup.ts`：

```ts
import type { AppData } from '../domain/types'
import { DEFAULT_SETTINGS, BUILTIN_COST_ITEMS } from '../domain/types'

const APP_TAG = 'dog-ledger'
const CURRENT_VERSION = 1

export function exportBackup(data: AppData): string {
  return JSON.stringify({
    app: APP_TAG,
    version: CURRENT_VERSION,
    exportedAt: new Date().toISOString(),
    data,
  })
}

export function importBackup(json: string): AppData {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('备份文件不是合法的 JSON')
  }

  const file = parsed as { app?: unknown; data?: unknown }
  if (!file || typeof file !== 'object' || file.app !== APP_TAG) {
    throw new Error('这不是狗账的备份文件')
  }

  const data = file.data as Partial<AppData> | undefined
  if (!data || typeof data !== 'object'
    || !data.settings || !Array.isArray(data.batches)
    || !Array.isArray(data.dogs) || !Array.isArray(data.entries)) {
    throw new Error('备份文件结构不完整')
  }

  return {
    version: CURRENT_VERSION,
    settings: {
      ...DEFAULT_SETTINGS,
      ...data.settings,
      partners: data.settings.partners ?? DEFAULT_SETTINGS.partners,
      costItems: data.settings.costItems?.length ? data.settings.costItems : BUILTIN_COST_ITEMS,
    },
    batches: data.batches,
    dogs: data.dogs,
    entries: data.entries,
  }
}
```

- [ ] **Step 6: 跑测试确认通过**

Run: `npx vitest run src/storage`
Expected: 10 passed

- [ ] **Step 7: 提交**

```bash
git add src/storage
git commit -m "feat(storage): IndexedDB 存储与备份导入导出"
```

---

### Task 8: 应用骨架（状态容器 + 底部标签栏；先做算/狗/钱/报四个，「检」由 Task 17 接入）

> **【已完成，本节以下内容与实际代码有出入，后续任务以实际代码为准】**
> Task 8 实际落地时有两处与本节的代码片段不同（都已提交，见 `7fed6e9` 与 `1a137fd`）：
> 1. **`useAppData` 不在 `AppDataContext.tsx` 里**，而在 **`src/state/useAppData.ts`**（该文件还导出 `AppDataContext` 与 `AppDataContextValue`）。`src/state/AppDataContext.tsx` 只导出 `AppDataProvider`。原因：oxlint 的 `react(only-export-components)` 要求「只导出组件的文件」才有 Fast Refresh。**所有页面一律 `import { useAppData } from '../../state/useAppData'`。**
> 2. **标签注册表抽成了 `src/ui/tabs.ts`** 的单一数组（`TabKey` / `TabDef` / `TABS` / `DEFAULT_TAB`），`src/App.tsx` 用 `TABS.find(...)` 取当前页，不再有四个硬编码分支。加标签只改 `tabs.ts`。
> 另外多出两个本节没列的文件：`src/state/persistence.ts`（唯一存储访问出口）与它和 `tabs.ts` 的测试。

**Files:**
- Create: `src/state/AppDataContext.tsx`
- Create: `src/ui/TabBar.tsx`
- Modify: `src/App.tsx`（整体替换）
- Create: `src/ui/pages/CalculatePage.tsx`, `DogsPage.tsx`, `MoneyPage.tsx`, `ReportPage.tsx`（本任务先放占位内容，后续任务逐个替换）

**Interfaces:**
- Consumes: `AppData`、`DEFAULT_DATA`（Task 1）；`Storage`、`indexedDbStorage`、`requestPersistentStorage`（Task 7）
- Produces: `AppDataProvider`、`useAppData(): { data, ready, update, replaceAll }`、`TabBar`、以及四个页面组件：`CalculatePage`、`DogsPage`、`MoneyPage`、`ReportPage`（均为无 props 组件）

- [ ] **Step 1: 写状态容器**

创建 `src/state/AppDataContext.tsx`：

```tsx
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { AppData } from '../domain/types'
import { DEFAULT_DATA } from '../domain/types'
import type { Storage } from '../storage/types'
import { indexedDbStorage, requestPersistentStorage } from '../storage/indexeddb'

interface AppDataContextValue {
  data: AppData
  ready: boolean
  update: (fn: (d: AppData) => AppData) => void
  replaceAll: (d: AppData) => void
}

const AppDataContext = createContext<AppDataContextValue | null>(null)

export function AppDataProvider({
  children,
  storage = indexedDbStorage,
}: {
  children: ReactNode
  storage?: Storage
}) {
  // ★ 必须 structuredClone：DEFAULT_DATA 是模块级单例，而且 DEFAULT_SETTINGS.costItems
  // 与 BUILTIN_COST_ITEMS 是同一个数组对象。直接把它交给 useState 会让界面状态与那个
  // 常量共享引用——任何一处就地 push / 改字段都会永久污染常量，之后新建的数据与测试也
  // 会跟着变脏。克隆一次，界面状态就与常量彻底脱钩。
  // （Task 1 的审查已用探针证实过这个别名：push 之后 BUILTIN_COST_ITEMS.length 4→5。）
  const [data, setData] = useState<AppData>(() => structuredClone(DEFAULT_DATA))
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    void requestPersistentStorage()
    storage.load()
      .then(loaded => {
        if (cancelled) return
        if (loaded) setData(loaded)
        setReady(true)
      })
      .catch(() => { if (!cancelled) setReady(true) })
    return () => { cancelled = true }
  }, [storage])

  const update = useCallback((fn: (d: AppData) => AppData) => {
    setData(prev => {
      const next = fn(prev)
      void storage.save(next)
      return next
    })
  }, [storage])

  const replaceAll = useCallback((next: AppData) => {
    setData(next)
    void storage.save(next)
  }, [storage])

  return (
    <AppDataContext.Provider value={{ data, ready, update, replaceAll }}>
      {children}
    </AppDataContext.Provider>
  )
}

export function useAppData(): AppDataContextValue {
  const ctx = useContext(AppDataContext)
  if (!ctx) throw new Error('useAppData 必须在 AppDataProvider 内使用')
  return ctx
}
```

- [ ] **Step 2: 写底部标签栏**

创建 `src/ui/TabBar.tsx`：

```tsx
export type TabKey = 'calc' | 'dogs' | 'money' | 'report'

const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: 'calc', label: '算', icon: '🧮' },
  { key: 'dogs', label: '狗', icon: '🐕' },
  { key: 'money', label: '钱', icon: '💰' },
  { key: 'report', label: '报', icon: '📊' },
]

export function TabBar({ active, onChange }: { active: TabKey; onChange: (k: TabKey) => void }) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-20 flex border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)]">
      {TABS.map(t => (
        <button
          key={t.key}
          type="button"
          onClick={() => onChange(t.key)}
          className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-xs ${
            active === t.key ? 'text-emerald-600 font-semibold' : 'text-gray-500'
          }`}
        >
          <span className="text-lg leading-none">{t.icon}</span>
          {t.label}
        </button>
      ))}
    </nav>
  )
}
```

- [ ] **Step 3: 写四个占位页面**

`src/ui/pages/CalculatePage.tsx`：

```tsx
export function CalculatePage() {
  return <div className="p-4 text-gray-400">算：待实现（Task 9）</div>
}
```

`src/ui/pages/DogsPage.tsx`：

```tsx
export function DogsPage() {
  return <div className="p-4 text-gray-400">狗：待实现（Task 10）</div>
}
```

`src/ui/pages/MoneyPage.tsx`：

```tsx
export function MoneyPage() {
  return <div className="p-4 text-gray-400">钱：待实现（Task 11）</div>
}
```

`src/ui/pages/ReportPage.tsx`：

```tsx
export function ReportPage() {
  return <div className="p-4 text-gray-400">报：待实现（Task 12）</div>
}
```

- [ ] **Step 4: 重写 App**

`src/App.tsx`：

```tsx
import { useState } from 'react'
import { AppDataProvider, useAppData } from './state/AppDataContext'
import { TabBar, type TabKey } from './ui/TabBar'
import { CalculatePage } from './ui/pages/CalculatePage'
import { DogsPage } from './ui/pages/DogsPage'
import { MoneyPage } from './ui/pages/MoneyPage'
import { ReportPage } from './ui/pages/ReportPage'

function Shell() {
  const { ready } = useAppData()
  const [tab, setTab] = useState<TabKey>('calc')

  if (!ready) {
    return <div className="flex h-dvh items-center justify-center text-gray-400">正在载入…</div>
  }

  return (
    <div className="min-h-dvh bg-gray-50 pb-16">
      <main className="mx-auto max-w-lg">
        {tab === 'calc' && <CalculatePage />}
        {tab === 'dogs' && <DogsPage />}
        {tab === 'money' && <MoneyPage />}
        {tab === 'report' && <ReportPage />}
      </main>
      <TabBar active={tab} onChange={setTab} />
    </div>
  )
}

export default function App() {
  return (
    <AppDataProvider>
      <Shell />
    </AppDataProvider>
  )
}
```

`index.html` 的 `<title>` 改成 `狗账`，并在 `<head>` 里加：

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="theme-color" content="#059669" />
```

- [ ] **Step 5: 验证构建与运行**

Run: `npm run build`
Expected: 构建成功，无 TS 错误

Run: `npm run dev`，浏览器打开开发者工具的手机模式，确认底部四个标签能切换、无报错。

- [ ] **Step 6: 提交**

```bash
git add src index.html
git commit -m "feat(ui): 应用骨架与底部四标签"
```

---

### Task 9: 「算」页面（决策台）

> **【已完成，见提交 `2f57cd3`；下面几处与实际代码不同，后续任务以实际代码为准】**
> 1. **多出 `src/ui/planForm.ts` + `src/ui/planForm.test.ts`（15 个测试）**：把「表单文本 → `PlanInput`」抽成纯函数。计划原片段用 `parseMoney(x) ?? 0`，会让**非空但解析不了**的输入（`600元`、全角 `６00`、`-100`）静默变成 0，然后照常显示一个看着正常的保本价 —— 那是错的数字，比没有数字危险。现在：空 = 0；解析不了 = 中文错误 + **整块绿色保本价卡片换成提示文案，不给数字**。
> 2. **`Field` 多了可选 `error?: string`**，有值时输入框标红并在下方显示中文错误。
> 3. **百分比不再 clamp**：计划片段的 `Math.min(0.99, Math.max(0, ...))` 会把 120% 悄悄夹成 99%，现在 >99 直接报「死亡率要填 0 到 99 之间的数字」。
> 4. **建批次日期用 `todayLocalIso(new Date())`（本机时区），不用 `toISOString()`**（那是 UTC，东八区晚上 8 点后是昨天）。
> 页面默认值、`plan()` 算式、`createBatchFromPlan` 签名都未改；domain 层一行未动。

**Files:**
- Modify: `src/ui/pages/CalculatePage.tsx`（整体替换）
- Create: `src/ui/components/Field.tsx`
- Modify: `src/domain/planning.ts`（若发现接口不足才改，本任务预计不需要）

**Interfaces:**
- Consumes: `useAppData`（Task 8）；`plan`、`createBatchFromPlan`、`PlanInput`（Task 6）；`formatMoney`、`parseMoney`（Task 2）
- Produces: `Field` 组件（`{ label, value, onChange, suffix?, inputMode? }`）

- [ ] **Step 1: 写通用输入组件**

创建 `src/ui/components/Field.tsx`：

```tsx
export function Field({
  label, value, onChange, suffix, inputMode = 'decimal',
}: {
  label: string
  value: string
  onChange: (v: string) => void
  suffix?: string
  inputMode?: 'decimal' | 'numeric' | 'text'
}) {
  return (
    <label className="flex items-center justify-between gap-3 border-b border-gray-100 py-3">
      <span className="text-sm text-gray-600">{label}</span>
      <span className="flex items-center gap-1">
        <input
          className="w-28 rounded-md bg-gray-100 px-2 py-1.5 text-right text-base outline-none focus:bg-white focus:ring-2 focus:ring-emerald-500"
          value={value}
          inputMode={inputMode}
          onChange={e => onChange(e.target.value)}
        />
        {suffix && <span className="text-xs text-gray-400">{suffix}</span>}
      </span>
    </label>
  )
}
```

- [ ] **Step 2: 实现页面**

`src/ui/pages/CalculatePage.tsx`：

```tsx
import { useMemo, useState } from 'react'
import { useAppData } from '../../state/useAppData'
import { plan, createBatchFromPlan, type PlanInput } from '../../domain/planning'
import { formatMoney, fenToYuan, parseMoney } from '../../domain/money'
import { Field } from '../components/Field'

export function CalculatePage() {
  const { data, update } = useAppData()
  const [n, setN] = useState('8')
  const [purchase, setPurchase] = useState('600')
  const [freight, setFreight] = useState('400')
  const [medical, setMedical] = useState('80')
  const [quarantine, setQuarantine] = useState(String(fenToYuan(data.settings.quarantinePerDog)))
  const [disposal, setDisposal] = useState(String(fenToYuan(data.settings.disposalPerDog)))
  const [mortality, setMortality] = useState(String(Math.round(data.settings.expectedMortalityRate * 100)))
  const [target, setTarget] = useState('1200')
  const [created, setCreated] = useState<string | null>(null)

  const input: PlanInput = useMemo(() => ({
    n: Number(n) || 0,
    purchasePrice: parseMoney(purchase) ?? 0,
    freight: parseMoney(freight) ?? 0,
    medicalPerDog: parseMoney(medical) ?? 0,
    quarantinePerDog: parseMoney(quarantine) ?? 0,
    disposalPerDog: parseMoney(disposal) ?? 0,
    mortalityRate: Math.min(0.99, Math.max(0, (Number(mortality) || 0) / 100)),
    targetPrice: parseMoney(target) ?? 0,
  }), [n, purchase, freight, medical, quarantine, disposal, mortality, target])

  const result = plan(data.settings, input)

  function handleCreateBatch() {
    const name = `收狗 ${input.n} 只`
    void update(d => createBatchFromPlan(d, input, name, todayLocalIso(new Date())))
    setCreated(name)
  }

  return (
    <div className="px-4 pb-6 pt-6">
      <h1 className="text-xl font-bold">收狗前的账</h1>
      <p className="mt-1 text-xs text-gray-500">先算清楚最多出多少钱，再出门。</p>

      <section className="mt-4 rounded-xl bg-white p-4 shadow-sm">
        <Field label="预计收几只" value={n} onChange={setN} suffix="只" inputMode="numeric" />
        <Field label="每只收购价" value={purchase} onChange={setPurchase} suffix="元" />
        <Field label="这趟油费 + 笼具" value={freight} onChange={setFreight} suffix="元" />
        <Field label="每只疫苗医疗" value={medical} onChange={setMedical} suffix="元" />
        <Field label="每只检疫费" value={quarantine} onChange={setQuarantine} suffix="元" />
        <Field label="每只病死犬处理费" value={disposal} onChange={setDisposal} suffix="元" />
        <Field label="预估死亡率" value={mortality} onChange={setMortality} suffix="%" inputMode="numeric" />
        <Field label="打算卖多少钱一只" value={target} onChange={setTarget} suffix="元" />
        <p className="mt-2 text-xs text-gray-400">
          检疫是法定前置：没有《动物检疫合格证明》就出售，按《动物防疫法》第九十七条最高可处货值 15~30 倍罚款，
          货值不足一万元的处 5 万~15 万，负责人 5 年内不得从事相关活动。这一栏填 0，上面的「低于这个价别卖」就偏低。
        </p>
      </section>

      <section className="mt-4 rounded-xl bg-emerald-600 p-4 text-white shadow-sm">
        <div className="text-xs opacity-80">低于这个价别卖</div>
        <div className="mt-1 text-3xl font-bold">{formatMoney(result.breakEvenPriceFen)}</div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
          <div>
            <div className="opacity-80">预估总成本</div>
            <div className="mt-0.5 text-sm font-semibold">{formatMoney(result.totalCost)}</div>
          </div>
          <div>
            <div className="opacity-80">预估存活</div>
            <div className="mt-0.5 text-sm font-semibold">{result.expectedAlive.toFixed(1)} 只</div>
          </div>
          <div>
            <div className="opacity-80">建议售价</div>
            <div className="mt-0.5 text-sm font-semibold">{formatMoney(result.suggestedPriceFen)}</div>
          </div>
        </div>
      </section>

      {result.scenarios.length > 0 && (
        <section className="mt-4 rounded-xl bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-700">卖不掉怎么办</h2>
          <table className="mt-2 w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-400">
                <th className="text-left font-normal">只卖掉</th>
                <th className="text-right font-normal">收入</th>
                <th className="text-right font-normal">盈亏</th>
                <th className="text-right font-normal">每人承担</th>
              </tr>
            </thead>
            <tbody>
              {result.scenarios.map(s => (
                <tr key={s.soldCount} className="border-t border-gray-100">
                  <td className="py-2">{s.soldCount} 只</td>
                  <td className="py-2 text-right">{formatMoney(s.revenue)}</td>
                  <td className={`py-2 text-right font-semibold ${s.profitFen >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                    {formatMoney(s.profitFen)}
                  </td>
                  <td className={`py-2 text-right ${s.perPartnerFen >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                    {formatMoney(s.perPartnerFen)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <button
        type="button"
        onClick={handleCreateBatch}
        disabled={input.n <= 0}
        className="mt-4 w-full rounded-xl bg-gray-900 py-3 text-sm font-semibold text-white disabled:opacity-40"
      >
        就按这个收 —— 一键建批次开始记账
      </button>

      {created && (
        <p className="mt-2 text-center text-xs text-emerald-600">
          已建批次「{created}」，到「狗」标签页记账。
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 3: 验证构建**

Run: `npm run build`
Expected: 构建成功，无 TS 错误

- [ ] **Step 4: 手动验证**

Run: `npm run dev`，在手机模式浏览器里。**注意表单有 8 栏**，下面这 6 个数之外，「每只检疫费」与「每只病死犬处理费」要保持在默认值 **0** 不动（它们是「还不知道」，不是「不要钱」）：

| 栏位 | 填 |
| --- | --- |
| 预计收几只 | 8 |
| 每只收购价 | 600 |
| 这趟油费 + 笼具 | 400 |
| 每只疫苗医疗 | 80 |
| 每只检疫费 | **0（默认，不要改）** |
| 每只病死犬处理费 | **0（默认，不要改）** |
| 预估死亡率 | 25 |
| 打算卖多少钱一只 | 1200 |

- 预期「低于这个价别卖」显示 **`¥973.33`**（= 584000 分 ÷ 6.0 只，即设计文档 §3.6 的 5,840 ÷ 6）。
- 预期上方三个指标是：预估总成本 `¥5,840`、预估存活 `6.0 只`、建议售价 `¥1,265.33`。
- 预期「卖不掉怎么办」三行分别为 5、6、8 只，收入 ¥6,000 / ¥7,200 / ¥9,600。
- **刚打开页面的默认值不是这一组**：死亡率预填的是设置里的 `expectedMortalityRate`（默认 15%），所以首屏显示 `¥858.82`（总成本 ¥5,840、存活 6.8 只、建议售价 ¥1,116.47）。那是 15% 而不是 25% 的结果，不是 bug。
- 点「一键建批次」，切到「狗」标签（此时还是占位），刷新页面后切回「算」，确认没报错。

- [ ] **Step 5: 提交**

```bash
git add src/ui
git commit -m "feat(ui): 决策台页面"
```

---

### Task 10: 「狗」页面（批次台账）

> **【控制器在派发前核对过一遍，下面两处已修，另有几条务必遵守】**
> 1. `createBatch` 里那个 `Batch` 字面量**必须带 `plannedChannel: 'undecided'`**（`types.ts:94` 是必填，修订二加的）。原片段漏了，照抄会在 `tsc -b` 报错——**不要用 `as any` 绕过**。
> 2. **不要用 `new Date().toISOString().slice(0, 10)` 取今天**：那是 UTC，东八区晚上 8 点后返回的是昨天。用 Task 9 已经写好并测过的 `todayLocalIso(new Date())`（`src/ui/planForm.ts:47`，从页面里 `import { todayLocalIso } from '../planForm'`）。
> 3. 补录狗时新 `Dog` 的 6 个检疫字段填 `null`/`''`（照片段即可）；**不许顺手填今天**——一只还没打疫苗的狗被记成"今天已接种"会让检疫页给出错误的可卖判断。
> 4. `paidBy: 'pool'` 是故意的：批次页只记池子直付，合伙人垫付去「钱」页面（Task 11）。别在这里加垫付下拉。
> 5. 今天这个仓库的测试文件必须显式 `import { describe, it, expect } from 'vitest'`，否则 `tsc -b` 报 TS2593 而 vitest 仍是绿的。

> **【控制器实机走查结果（CDP + 真实 IndexedDB）：Task 10 返工清单】**
> 第一版实现（`2a7cb1f`）的**基本流程是通的**——实机走完：建批次 → 批次详情显示「去向：未定」→ 补录 3 只狗 → 记一笔 ¥400 支出（总成本 ¥400）→ 卖出一只 ¥1200（已收款 ¥1,200、显示「售价 ¥1,200 · 赚 ¥1,066.67」）→ 刷新后数据都在、不卡在「正在载入」。非法金额（`abc`、`1200元`）会显示中文错误并让提交按钮变灰，且**点下去确实没写账**（流水数不变）。但实机点出下面四条：
> 1. **已售的狗还能被标成死亡（账目被污染）** —— `DogsPage.tsx:200` 的条件是 `d.status !== 'dead'`，所以「已售」的卡上同时出现「死亡」和「退狗」。实测点「死亡」把 `sold` 覆盖成 `dead`，而那笔 `income/sale` 流水留在账上一动不动 → 那只狗的购置成本从此计入「死亡损耗」，收入却还挂着，**批次盈亏直接是错的**。又因为 `dead` 的卡上一个按钮都没有，**点错了在界面里再也改不回来**。
>    修法（两处都要）：`src/domain/actions.ts` 的 `markDogDead` 守卫改成 `const dog = data.dogs.find(d => d.id === dogId); if (!dog || (dog.status !== 'in_stock' && dog.status !== 'returned')) return data`（能记死亡的 = 还在我们账上的活狗；`sold` 的收入已入账、狗已不在我们账上，其死不是我们的损失）；界面「死亡」按钮的条件改成 `d.status === 'in_stock' || d.status === 'returned'`。**「卖出」按钮必须用同一个条件**——只写 `=== 'in_stock'` 会让退回的狗再也卖不出去（设计文档 `:156` 的「退狗回到在库」就是要它能再卖一次）。在 `actions.test.ts` 里补：对已售的狗调 `markDogDead` 返回原数据不变；对退回的狗调它能变 `dead`；退回的狗能被再次卖出。
>    另见 `## Global Constraints` 里「还在我们账上的狗（在库）」那一条。
> 2. **退狗没有记退款支出（违反设计文档）** —— 设计文档 §3.4 第 225 行与 §6 第 362 行都写明：`returned` 的记账 = 狗回到在库（计入 `inStockCount` 与 `aliveCount`）+ 已发生的医疗成本不冲销 + **另记一笔 `expense`（类别「售后退款」，金额 = 退回给客户的款）关联到该狗**。而 `DogsPage.tsx:213` 只调了 `setDogStatus(x, d.id, 'returned')`，**退回给客户的那笔钱根本没进账**，账上会显示一笔根本没赚到的利润。
>    修法：点「退狗」弹 Modal 问「退回给客户多少钱」→ 确认后同时 `setDogStatus(..., 'returned')` **和** `addExpense({ batchId, dogId: d.id, category: 'aftercare_refund', amount, paidBy: 'pool', date: todayIso(), note })`（`aftercare_refund`「售后退款」是 `src/domain/types.ts:163` 的内置项）。设计文档还要第二种情况——**钱退了但狗没要回来** → 状态保持 `sold`、只记退款支出，所以再加一个按钮「钱退了，狗没回来」走同一个 Modal 但只记支出、不改状态。
> 3. **死亡 / 退回的狗要有纠错入口** —— 设计文档 §4 第 308 行写的是「状态点一下即改」，现在 `dead` 是单向陷阱（一个按钮都不剩），不符合这条。给 `dead` 加「记错了，改回在库」→ `setDogStatus(..., 'in_stock')`；给 `returned` 加「狗又要回来了」→ 改回 `in_stock`。
> 4. **`new Date()` 不许出现在渲染体里** —— 实测照抄原 Step 6 会让 `npm run lint` 变红：`react(purity): Cannot call impure function during render`（`src/ui/pages/DogsPage.tsx`）。第一版的做法是对的、**后续任务照抄**：包成 `todayIso()`（`DogsPage.tsx:30-34`），只在 onClick / 事件处理器里调用。（`CalculatePage.tsx:45` 里同一句不报错，因为它在 `handleCreateBatch()` 里。**这是过不过门禁的问题，不是风格问题。**）
>    **本任务的 Step 6 片段已按此改写**：`const [today] = useState(() => todayLocalIso(new Date()))`。四种写法的实测对比见 `## Global Constraints` 最后那条——`useMemo` 和 `useEffect` 都会被 lint 拦下，**只有 `useState` 惰性初始化能过**。

**Files:**
- Modify: `src/ui/pages/DogsPage.tsx`（整体替换）
- Create: `src/ui/components/Modal.tsx`
- Create: `src/domain/actions.ts`
- Test: `src/domain/actions.test.ts`

**Interfaces:**
- Consumes: `useAppData`（Task 8）；`batchSummary`、`dogsOfBatch`、`dogProfitFen`、`dilutedCostFen`、`dogIncome`（Task 3）；`formatMoney`、`parseMoney`（Task 2）；`newId`（Task 1）
- Produces（`src/domain/actions.ts`，全部为纯函数）：
  - `setDogStatus(data: AppData, dogId: string, status: DogStatus): AppData`
  - `sellDog(data: AppData, dogId: string, price: Money, date: string): AppData`
  - `markDogDead(data: AppData, dogId: string): AppData`
  - `addExpense(data: AppData, input: { batchId: string | null; dogId: string | null; category: string; amount: Money; paidBy: 'pool' | string; date: string; note: string }): AppData`
  - `createBatch(data: AppData, name: string, date: string): AppData`

- [ ] **Step 1: 写失败的测试**

创建 `src/domain/actions.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { DEFAULT_DATA } from './types'
import { setDogStatus, sellDog, markDogDead, addExpense, createBatch } from './actions'
import { batchSummary, dogIncome, batchTotalCost } from './costing'

/** 建一个批次，并记一笔运输费 */
function seed() {
  const data = createBatch(DEFAULT_DATA, '一批', '2026-10-03')
  const batchId = data.batches[0].id
  return addExpense(data, {
    batchId, dogId: null, category: 'transport',
    amount: 40000, paidBy: 'pool', date: '2026-10-03', note: '',
  })
}

describe('createBatch', () => {
  it('新增一个批次', () => {
    const data = createBatch(DEFAULT_DATA, '一批', '2026-10-03')
    expect(data.batches).toHaveLength(1)
    expect(data.batches[0].name).toBe('一批')
  })
  it('不修改原数据', () => {
    createBatch(DEFAULT_DATA, '一批', '2026-10-03')
    expect(DEFAULT_DATA.batches).toHaveLength(0)
  })
})

describe('addExpense', () => {
  it('写入一笔支出，同时带 batchId 与 dogId', () => {
    const data = seed()
    const batchId = data.batches[0].id
    const next = addExpense(data, { batchId, dogId: null, category: 'purchase', amount: 60000, paidBy: 'pool', date: '2026-10-03', note: '' })
    expect(batchTotalCost(next, batchId)).toBe(100000)
  })
  it('可以记成某人垫付', () => {
    const data = seed()
    const batchId = data.batches[0].id
    const next = addExpense(data, { batchId, dogId: null, category: 'purchase', amount: 60000, paidBy: 'p1', date: '2026-10-03', note: '' })
    expect(next.entries.some(e => e.paidBy === 'p1')).toBe(true)
  })
})

describe('setDogStatus / markDogDead', () => {
  it('死亡会把状态改成 dead', () => {
    const data = sellSeed()
    const dogId = data.dogs[0].id
    const next = markDogDead(data, dogId)
    expect(next.dogs.find(d => d.id === dogId)!.status).toBe('dead')
  })
  it('setDogStatus 可以改回在库（退狗）', () => {
    const data = sellSeed()
    const dogId = data.dogs[0].id
    const sold = sellDog(data, dogId, 120000, '2026-10-05')
    const back = setDogStatus(sold, dogId, 'returned')
    expect(back.dogs.find(d => d.id === dogId)!.status).toBe('returned')
  })
})

describe('sellDog', () => {
  it('把狗标为已售，并写入一笔收入', () => {
    const data = sellSeed()
    const dogId = data.dogs[0].id
    const next = sellDog(data, dogId, 120000, '2026-10-05')
    expect(next.dogs.find(d => d.id === dogId)!.status).toBe('sold')
    expect(dogIncome(next, dogId)).toBe(120000)
  })
  it('收入流水同时挂上批次，才能进批次收入', () => {
    const data = sellSeed()
    const batchId = data.batches[0].id
    const next = sellDog(data, data.dogs[0].id, 120000, '2026-10-05')
    expect(batchSummary(next, batchId).income).toBe(120000)
  })
  it('重复对同一只狗收款不会累加（已售则忽略）', () => {
    const data = sellSeed()
    const dogId = data.dogs[0].id
    const once = sellDog(data, dogId, 120000, '2026-10-05')
    const twice = sellDog(once, dogId, 120000, '2026-10-06')
    expect(dogIncome(twice, dogId)).toBe(120000)
  })
})

/** 建一批 3 只狗、每只 600 + 80，用于售出/死亡测试 */
function sellSeed() {
  let data = createBatch(DEFAULT_DATA, '测试批', '2026-10-03')
  const batchId = data.batches[0].id
  for (let i = 1; i <= 3; i++) {
    const dogId = `d${i}`
    data = {
      ...data,
      dogs: [...data.dogs, {
        id: dogId, batchId, code: `${i}`, breed: '', sex: 'unknown',
        ageMonths: null, status: 'in_stock', note: '',
        // 刚买回来的狗：没接种、没检测、没证明（修订二新增的 6 个必填字段）
        rabiesVaccinatedOn: null, antibodyTestedOn: null,
        antibodyReportNo: '', quarantineCertNo: '',
        quarantineCertIssuedOn: null, quarantineCertValidUntil: null,
      }],
    }
    data = addExpense(data, { batchId, dogId, category: 'purchase', amount: 60000, paidBy: 'pool', date: '2026-10-03', note: '' })
    data = addExpense(data, { batchId, dogId, category: 'medical', amount: 8000, paidBy: 'pool', date: '2026-10-03', note: '' })
  }
  return data
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/domain/actions.test.ts`
Expected: FAIL，报 `Failed to resolve import "./actions"`

- [ ] **Step 3: 实现**

创建 `src/domain/actions.ts`：

```ts
import type { AppData, Batch, DogStatus, LedgerEntry, Money } from './types'
import { newId } from './types'

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

export function markDogDead(data: AppData, dogId: string): AppData {
  return setDogStatus(data, dogId, 'dead')
}

/**
 * 卖出一只狗：把状态改成 sold，并写入一笔挂在该狗和该批次上的收入。
 * 已经卖过的狗再次调用会被忽略，避免重复计收入。
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/domain/actions.test.ts`
Expected: 全部 passed

- [ ] **Step 5: 写弹窗组件**

创建 `src/ui/components/Modal.tsx`：

```tsx
import type { ReactNode } from 'react'

export function Modal({
  open, title, onClose, children,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-t-2xl bg-white p-4 pb-8"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="mb-3 text-base font-semibold">{title}</h2>
        {children}
      </div>
    </div>
  )
}
```

- [ ] **Step 6: 实现「狗」页面**

`src/ui/pages/DogsPage.tsx`：

```tsx
import { useState } from 'react'
import { useAppData } from '../../state/useAppData'
import { batchSummary, dogsOfBatch, dilutedCostFen, dogIncome, dogProfitFen } from '../../domain/costing'
import { sellDog, markDogDead, setDogStatus, createBatch, addExpense } from '../../domain/actions'
import { formatMoney, parseMoney } from '../../domain/money'
import { Modal } from '../components/Modal'
import { newId } from '../../domain/types'
import { todayLocalIso } from '../planForm'

const STATUS_LABEL: Record<string, string> = {
  in_stock: '在库', sold: '已售', dead: '死亡', returned: '退回',
}

export function DogsPage() {
  const { data, update } = useAppData()
  const [openBatchId, setOpenBatchId] = useState<string | null>(null)
  const [sellingDogId, setSellingDogId] = useState<string | null>(null)
  const [priceInput, setPriceInput] = useState('')
  const [expenseOpen, setExpenseOpen] = useState(false)
  const [expenseAmount, setExpenseAmount] = useState('')
  const [expenseCategory, setExpenseCategory] = useState('medical')
  const [expenseNote, setExpenseNote] = useState('')
  const [newBatchName, setNewBatchName] = useState('')

  // 本机时区的今天。不要用 toISOString()——那是 UTC，东八区晚上 8 点后返回昨天。
  const [today] = useState(() => todayLocalIso(new Date()))

  if (!openBatchId) {
    return (
      <div className="px-4 pb-6 pt-6">
        <h1 className="text-xl font-bold">批次</h1>

        <div className="mt-4 flex gap-2">
          <input
            className="flex-1 rounded-lg bg-white px-3 py-2 text-sm shadow-sm outline-none"
            placeholder="新批次名称，如 10月3日李村"
            value={newBatchName}
            onChange={e => setNewBatchName(e.target.value)}
          />
          <button
            type="button"
            className="rounded-lg bg-gray-900 px-4 text-sm font-semibold text-white disabled:opacity-40"
            disabled={!newBatchName.trim()}
            onClick={() => {
              void update(d => createBatch(d, newBatchName.trim(), today))
              setNewBatchName('')
            }}
          >
            新建
          </button>
        </div>

        <ul className="mt-4 space-y-2">
          {data.batches.map(b => {
            const s = batchSummary(data, b.id)
            return (
              <li key={b.id}>
                <button
                  type="button"
                  onClick={() => setOpenBatchId(b.id)}
                  className="w-full rounded-xl bg-white p-3 text-left shadow-sm"
                >
                  <div className="flex items-baseline justify-between">
                    <span className="font-semibold">{b.name}</span>
                    <span className={`text-sm font-semibold ${s.netProfitFen >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                      {formatMoney(s.netProfitFen)}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    {b.date} · 在库 {s.inStock} · 已售 {s.sold} · 死亡 {s.dead}
                    {s.floorPriceFen !== null && ` · 剩余保本 ${formatMoney(s.floorPriceFen)}`}
                  </div>
                </button>
              </li>
            )
          })}
          {data.batches.length === 0 && (
            <li className="rounded-xl bg-white p-6 text-center text-sm text-gray-400">
              还没有批次。去「算」标签页一键建一个。
            </li>
          )}
        </ul>
      </div>
    )
  }

  const batch = data.batches.find(b => b.id === openBatchId)!
  const summary = batchSummary(data, batch.id)
  const dogs = dogsOfBatch(data, batch.id)

  return (
    <div className="px-4 pb-6 pt-6">
      <button type="button" className="text-sm text-gray-500" onClick={() => setOpenBatchId(null)}>
        ← 所有批次
      </button>
      <h1 className="mt-2 text-xl font-bold">{batch.name}</h1>

      <div className="mt-3 rounded-xl bg-white p-4 shadow-sm">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div><span className="text-gray-500">总成本</span> <b>{formatMoney(summary.totalCost)}</b></div>
          <div><span className="text-gray-500">已收款</span> <b>{formatMoney(summary.income)}</b></div>
          <div><span className="text-gray-500">死亡损耗</span> <b className="text-red-500">{formatMoney(summary.deadLoss)}</b></div>
          <div>
            <span className="text-gray-500">盈亏</span>{' '}
            <b className={summary.netProfitFen >= 0 ? 'text-emerald-600' : 'text-red-500'}>
              {formatMoney(summary.netProfitFen)}
            </b>
          </div>
        </div>
        {summary.floorPriceFen !== null && (
          <div className="mt-3 rounded-lg bg-emerald-50 p-3">
            <div className="text-xs text-emerald-700">剩下的每只至少卖</div>
            <div className="text-2xl font-bold text-emerald-700">{formatMoney(summary.floorPriceFen)}</div>
            <div className="text-xs text-emerald-600">整批才不亏</div>
          </div>
        )}
      </div>

      <ul className="mt-4 space-y-2">
        {dogs.map(d => {
          const income = dogIncome(data, d.id)
          const cost = dilutedCostFen(data, d.id)
          const profit = dogProfitFen(data, d.id)
          return (
            <li key={d.id} className="rounded-xl bg-white p-3 shadow-sm">
              <div className="flex items-baseline justify-between">
                <span className="font-semibold">{d.code}</span>
                <span className="text-xs text-gray-500">{STATUS_LABEL[d.status]}</span>
              </div>
              <div className="mt-1 text-xs text-gray-500">
                摊薄成本 {formatMoney(cost)}
                {d.status === 'sold' && (
                  <> · 售价 {formatMoney(income)} ·{' '}
                    <span className={profit >= 0 ? 'text-emerald-600' : 'text-red-500'}>
                      {profit >= 0 ? '赚' : '亏'} {formatMoney(Math.abs(profit))}
                    </span>
                  </>
                )}
              </div>
              <div className="mt-2 flex gap-2 text-xs">
                {d.status !== 'sold' && (
                  <button
                    type="button"
                    className="rounded-md bg-emerald-600 px-3 py-1 text-white"
                    onClick={() => { setSellingDogId(d.id); setPriceInput('') }}
                  >
                    卖出
                  </button>
                )}
                {d.status !== 'dead' && (
                  <button
                    type="button"
                    className="rounded-md bg-gray-100 px-3 py-1 text-gray-600"
                    onClick={() => void update(x => markDogDead(x, d.id))}
                  >
                    死亡
                  </button>
                )}
                {d.status === 'sold' && (
                  <button
                    type="button"
                    className="rounded-md bg-gray-100 px-3 py-1 text-gray-600"
                    onClick={() => void update(x => setDogStatus(x, d.id, 'returned'))}
                  >
                    退狗
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      <button
        type="button"
        className="mt-4 w-full rounded-xl border border-gray-300 py-3 text-sm font-semibold text-gray-700"
        onClick={() => {
          const dogId = newId()
          void update(d => ({
            ...d,
            dogs: [...d.dogs, {
              id: dogId, batchId: batch.id, code: `${batch.name}-补${dogs.length + 1}`,
              breed: '', sex: 'unknown', ageMonths: null, status: 'in_stock', note: '',
              // 修订二新增的 6 个必填字段：补录的狗同样没接种、没检测、没证明
              rabiesVaccinatedOn: null, antibodyTestedOn: null,
              antibodyReportNo: '', quarantineCertNo: '',
              quarantineCertIssuedOn: null, quarantineCertValidUntil: null,
            }],
          }))
        }}
      >
        + 补录一只狗
      </button>

      <button
        type="button"
        className="mt-2 w-full rounded-xl border border-gray-300 py-3 text-sm font-semibold text-gray-700"
        onClick={() => {
          setExpenseAmount('')
          setExpenseCategory('medical')
          setExpenseNote('')
          setExpenseOpen(true)
        }}
      >
        + 记一笔批次支出
      </button>

      <Modal
        open={sellingDogId !== null}
        title="卖出了多少钱？"
        onClose={() => setSellingDogId(null)}
      >
        <input
          autoFocus
          className="w-full rounded-lg bg-gray-100 px-3 py-2 text-lg outline-none"
          inputMode="decimal"
          placeholder="售价（元）"
          value={priceInput}
          onChange={e => setPriceInput(e.target.value)}
        />
        <button
          type="button"
          className="mt-3 w-full rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white disabled:opacity-40"
          disabled={parseMoney(priceInput) === null}
          onClick={() => {
            const price = parseMoney(priceInput)!
            const dogId = sellingDogId!
            void update(d => sellDog(d, dogId, price, today))
            setSellingDogId(null)
          }}
        >
          确认卖出
        </button>
      </Modal>

      <Modal open={expenseOpen} title="记一笔批次支出" onClose={() => setExpenseOpen(false)}>
        <input
          autoFocus
          className="w-full rounded-lg bg-gray-100 px-3 py-2 text-lg outline-none"
          inputMode="decimal"
          placeholder="金额（元）"
          value={expenseAmount}
          onChange={e => setExpenseAmount(e.target.value)}
        />

        <select
          className="mt-2 w-full rounded-lg bg-gray-100 px-3 py-2 text-sm"
          value={expenseCategory}
          onChange={e => setExpenseCategory(e.target.value)}
        >
          {data.settings.costItems.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>

        <input
          className="mt-2 w-full rounded-lg bg-gray-100 px-3 py-2 text-sm outline-none"
          placeholder="备注（可留空）"
          value={expenseNote}
          onChange={e => setExpenseNote(e.target.value)}
        />

        <button
          type="button"
          className="mt-3 w-full rounded-xl bg-gray-900 py-3 text-sm font-semibold text-white disabled:opacity-40"
          disabled={parseMoney(expenseAmount) === null}
          onClick={() => {
            const amount = parseMoney(expenseAmount)!
            void update(d => addExpense(d, {
              batchId: batch.id, dogId: null, category: expenseCategory, amount,
              paidBy: 'pool', date: today, note: expenseNote,
            }))
            setExpenseOpen(false)
          }}
        >
          记下
        </button>
      </Modal>
    </div>
  )
}
```

「+ 记一笔批次支出」和「卖出」都用同一个 `Modal` + 中文表单，**不用 `window.prompt`**。原因：记账是这个软件最高频的动作，弹三个系统框、还要用户手打英文成本项（`purchase`/`transport`/`medical`），第二天就不会有人再记了——这同时违反 Global Constraints 的「界面文案中文」和设计文档的成功标准「录一笔支出不超过 3 次点击」。成本项下拉直接读 `data.settings.costItems`，和 Task 11「钱」页面的记账弹窗保持同一套选项。

注意：这个按钮固定记 `paidBy: 'pool'`（池子直付）。**合伙人先垫付的支出要去「钱」页面记**（Task 11 的记账弹窗里有「XX 先垫付」下拉）。这是有意的取舍——垫付是将来要从池子还给人家的钱，值得多走一步确认，不适合混进批次页的随手记账。

- [ ] **Step 7: 验证**

Run: `npx vitest run` → 全部通过
Run: `npm run build` → 无 TS 错误
Run: `npm run dev` → 手动走一遍：建批次 → 补录狗 → 记支出 → 卖出 → 死亡，确认批次详情的「剩余保本」随收款下降

- [ ] **Step 8: 提交**

```bash
git add src
git commit -m "feat: 批次台账页面与领域动作"
```

---

### Task 11: 「钱」页面（资金流水与池子）

> **【控制器审计后已就地修好的三处，照现在的片段写】**
> 1. **分类名不要硬编码。** 原片段有一张写死的 `CATEGORY_LABEL`（只列了 purchase/transport/medical/aftercare_refund/sale/transfer）。它有两个毛病：漏掉 `quarantine` 与 `disposal` 两个内置成本项，且与「成本项可由用户在设置页自定义」的架构冲突——用户自己加的成本项会以英文 id 直接显示在流水列表里，违反 `## Global Constraints` 的「界面文案用中文」。**现在改成 `NON_COST_CATEGORY` + 一个查设置表的 `catLabel`**，用 `data.settings.costItems.find(c => c.id === id)?.name` 兜底。**不要在实现里退回硬编码表。**
> 2. **`submit()` 里加了 `partnerId` 空值守卫。** `data.settings.partners` 为空数组时 `partnerId` 初值是 `''`，注资 / 报销 / 分红会记出一笔没有归属的钱。这三种类型在 `partnerId` 为空时直接 return。
> 3. `const today = todayLocalIso(new Date())` 已改成 **`const [today] = useState(() => todayLocalIso(new Date()))`** —— 渲染体里调 `new Date()` 会被 `react(purity)` 拦下，`useMemo` / `useEffect` 也都不行（见 `## Global Constraints` 最后那条的实测对比）。

> **另外：本任务 Interfaces 的 `Consumes` 声明了 4 个 ledger 函数，而页面只 import 2 个——这不是缺陷**（测试文件确实用到全部 4 个）。不要为了「对齐」去改页面的 import。

> **【实现后回填：实际落地与计划有 9 处偏离，全部经控制器接受（`8b52182`，浏览器验证 45/45 PASS）】**
> 1. **多出 `src/ui/moneyBook.ts` + `moneyBook.test.ts`（纯函数，不 import React）。** 理由与 Task 10 的 `dogLedger.ts` 相同：`react/only-export-components` 是 warn 而本仓门禁是 0 warning，组件文件只该导出组件；而且分类中文名与按钮可用性**判错就直接记错账**，必须能单测。**改动 `MoneyPage.tsx` 的判定时，先改 `moneyBook.ts` 并补它的测试。**
> 2. **`canSubmit(dialog, amount, partnerId)` 同时驱动 `disabled` 与 `submit()` 守卫**（计划是 `disabled={parseMoney(amount) === null}` 一个条件、守卫在 `submit()` 里另写两条 `if`）。两边各写一遍迟早出现「按钮亮着但点了没反应」。
> 3. **流水行标题 `entryLabel` 会去重**：分类名与类型名相同就只显示一个（否则卖狗收入显示成「收入 · 收入」），`category === 'transfer'` 时只显示类型名（注资/报销/分红，不显示「· 转账」）。
> 4. **两处计划没有的空状态提示**：`partners` 为空时不显示垫付卡片、改成琥珀色「还没有合伙人。注资、报销、分红都要指明是谁的钱，先去「设置」页把人加上。」；Modal 内「需要归属人但没人可选」时提示「这笔钱要记在某个合伙人名下，先去「设置」页添加合伙人。」。计划只加了 `submit()` 的静默 return，而静默 return 在界面上表现为「按钮灰着、没解释」。
> 5. 非法金额的红字提示改成与 `canSubmit` **共用同一份判定**，并加了一致性测试「`amountInvalid` 与 `canSubmit` 不会同时为真」。
> 6. 去掉 Modal 标题的恒等三元 `TYPE_LABEL[dialog === 'expense' ? 'expense' : dialog]` → `dialog === null ? '' : TYPE_LABEL[dialog]`。
> 7. **`submit()` 的 `switch (type)` 没有 `default`**，靠 `BookDialog` 联合类型的穷尽性——将来多一种弹窗，`tsc -b` 会报「函数可能不返回 `AppData`」而不是静默少记一笔账。
> 8. 最近流水的第二行**加了注资人**（`e.type === 'injection'` 时补 `· <合伙人名> 注入`）。注资的 `paidBy` 就是注入人，不显示出来，这一页就答不了它自己要答的问题（「这些钱是谁的」）。
> 9. `NON_COST_CATEGORY` 的值类型写成 **`Record<string, string | undefined>`** 而不是 `Record<string, string>`。`tsconfig.app.json` 没开 `noUncheckedIndexedAccess`，写成 `string` 会让 `?? '其他'` 在类型上成为死代码。
>
> **`LedgerEntry` 的字段语义（写代码和写测试时都容易搞错，控制器自己就踩了）**：`paidBy: 'pool' | string` **只对 `expense` 有意义**（'pool' = 池子直付，否则是垫付的合伙人 id）。**`reimbursement` / `distribution` 用 `payee: string | null` 表示收款的合伙人 id，同时 `paidBy` 保持 `'pool'`**（`src/domain/types.ts:133-136`）。对报销/分红断言 `paidBy` 等于某个合伙人是错的。

> **【Task 11b — 报销额不得超过垫付额（控制器裁定：在 UI 层拦，域层保持宽松）】**
> `addReimbursement` 不设上限，超报会把 `advanceBalance`（`src/domain/ledger.ts:32` 是纯减法）压成负数，同时池子被多扣一笔。计划 Step 6 的走查只覆盖了「恰好报完」这一种情况。
> - **域层不加会拒绝历史/导入数据的硬校验**（已存在的 entries 里本来就可能超报，加载时必须还能正确算账）。
> - **UI 层**：报销弹窗算出该合伙人**当前**的垫付余额，金额超过它时给出中文红字提示（必须把那个数说出来）、「记下」`disabled`、点下去不产生任何流水。
> - **边界**：`amount === advanceBalance` **必须放行**（报完归零是正常操作）；多 1 分就要拦。
> - `disabled` 与 `submit()` 守卫必须由**同一个谓词**决定；判定写进 `src/ui/moneyBook.ts` 并配单测。
> - `parseMoney` 返回 `null` 时不得先变成 `0` 再参与「0 > 余额」的比较——那种情况由既有的「金额只能填数字」提示负责，两条提示不许同时出现。
> - 其它四种弹窗（支出/收入/注资/分红）行为不变。

**Files:**
- Modify: `src/ui/pages/MoneyPage.tsx`（整体替换）
- Modify: `src/domain/actions.ts`（新增 `addInjection`、`addIncome`、`addReimbursement`、`addDistribution`）
- Modify: `src/domain/actions.test.ts`（补充上述函数的测试）

**Interfaces:**
- Consumes: `poolBalance`、`advanceBalance`、`contributedCapital`、`distributedTo`（Task 4）；`newId`（Task 1）
- Produces（追加到 `src/domain/actions.ts`）：
  - `addInjection(data: AppData, partnerId: string, amount: Money, date: string, note: string): AppData`
  - `addIncome(data: AppData, amount: Money, date: string, note: string): AppData`
  - `addReimbursement(data: AppData, partnerId: string, amount: Money, date: string): AppData`
  - `addDistribution(data: AppData, partnerId: string, amount: Money, date: string): AppData`

- [ ] **Step 1: 写失败的测试**

追加到 `src/domain/actions.test.ts`：

```ts
// 把 addInjection / addIncome / addReimbursement / addDistribution 追加到文件顶部已有的 './actions' import 里，
// 再补上这一行：
import { poolBalance, advanceBalance, contributedCapital, distributedTo } from './ledger'

describe('资金类流水', () => {
  it('注资让池子变多，并记在注入人名下', () => {
    const next = addInjection(DEFAULT_DATA, 'p1', 500000, '2026-10-03', '')
    expect(poolBalance(next)).toBe(500000)
    expect(contributedCapital(next, 'p1')).toBe(500000)
    expect(contributedCapital(next, 'p2')).toBe(0)
  })

  it('收入让池子变多', () => {
    const next = addIncome(DEFAULT_DATA, 120000, '2026-10-05', '')
    expect(poolBalance(next)).toBe(120000)
  })

  it('报销让池子变少、垫付余额变少', () => {
    const withAdvance = addExpense(DEFAULT_DATA, {
      batchId: null, dogId: null, category: 'purchase',
      amount: 70000, paidBy: 'p1', date: '2026-10-03', note: '',
    })
    const injected = addInjection(withAdvance, 'p1', 500000, '2026-10-03', '')
    const done = addReimbursement(injected, 'p1', 70000, '2026-10-04')
    expect(advanceBalance(done, 'p1')).toBe(0)
    expect(poolBalance(done)).toBe(430000)
  })

  it('分红让池子变少、已分红变多，且不影响损益', () => {
    const withMoney = addIncome(DEFAULT_DATA, 200000, '2026-10-05', '')
    const done = addDistribution(withMoney, 'p1', 50000, '2026-10-06')
    expect(poolBalance(done)).toBe(150000)
    expect(distributedTo(done, 'p1')).toBe(50000)
  })

  it('金额为负时被夹到 0', () => {
    const next = addIncome(DEFAULT_DATA, -100, '2026-10-05', '')
    expect(poolBalance(next)).toBe(0)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/domain/actions.test.ts`
Expected: FAIL，报 `addInjection is not a function`

- [ ] **Step 3: 实现**

追加到 `src/domain/actions.ts`：

```ts
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
    amount: Math.max(0, Math.round(amount)),
    paidBy: fields.paidBy ?? 'pool',
    payee: fields.payee ?? null,
    batchId: null,
    dogId: null,
    note,
  }
  return { ...data, entries: [...data.entries, entry] }
}

/** 合伙人往池子里打钱 */
export function addInjection(data: AppData, partnerId: string, amount: Money, date: string, note: string): AppData {
  return transferEntry(data, 'injection', amount, date, note, { paidBy: partnerId })
}

/** 不挂到具体某只狗的收入（如卖笼子、退款回收） */
export function addIncome(data: AppData, amount: Money, date: string, note: string): AppData {
  return transferEntry(data, 'income', amount, date, note, {})
}

/** 池子出钱报销某人的垫付 */
export function addReimbursement(data: AppData, partnerId: string, amount: Money, date: string): AppData {
  return transferEntry(data, 'reimbursement', amount, date, '', { payee: partnerId })
}

/** 池子出钱给某合伙人分红 */
export function addDistribution(data: AppData, partnerId: string, amount: Money, date: string): AppData {
  return transferEntry(data, 'distribution', amount, date, '', { payee: partnerId })
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/domain/actions.test.ts`
Expected: 全部 passed

- [ ] **Step 5: 实现页面**

`src/ui/pages/MoneyPage.tsx`：

```tsx
import { useState } from 'react'
import { useAppData } from '../../state/useAppData'
import { poolBalance, advanceBalance } from '../../domain/ledger'
import { addExpense, addInjection, addIncome, addReimbursement, addDistribution } from '../../domain/actions'
import { formatMoney, parseMoney } from '../../domain/money'
import { Modal } from '../components/Modal'
import { todayLocalIso } from '../planForm'

const NON_COST_CATEGORY: Record<string, string> = {
  sale: '收入', transfer: '转账',
}
const TYPE_LABEL: Record<string, string> = {
  injection: '注资', expense: '支出', income: '收入',
  reimbursement: '报销', distribution: '分红',
}

export function MoneyPage() {
  const { data, update } = useAppData()
  const [dialog, setDialog] = useState<null | 'expense' | 'injection' | 'income' | 'reimbursement' | 'distribution'>(null)
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [category, setCategory] = useState('medical')
  const [partnerId, setPartnerId] = useState(data.settings.partners[0]?.id ?? '')
  const [paidBy, setPaidBy] = useState<'pool' | string>('pool')

  // 本机时区的今天（不要用 toISOString()，那是 UTC，东八区晚上会差一天）
  const [today] = useState(() => todayLocalIso(new Date()))
  const pool = poolBalance(data)
  const recent = [...data.entries].reverse().slice(0, 60)

  // 成本项的名字从设置里查——用户能在设置页自己加成本项，硬编码一张表会漏掉它们，
  // 也会把 quarantine / disposal 这两个内置项的英文 id 直接显示出来（违反「界面文案用中文」）。
  const catLabel = (id: string) =>
    NON_COST_CATEGORY[id] ?? data.settings.costItems.find(c => c.id === id)?.name ?? '其他'

  function close() {
    setDialog(null); setAmount(''); setNote('')
  }

  function submit() {
    const fen = parseMoney(amount)
    if (fen === null) return
    // 注资 / 报销 / 分红这三种必须指明是谁的钱。partners 为空时 partnerId 是 ''，
    // 放任下去会记出一笔无主的钱。
    if ((dialog === 'injection' || dialog === 'reimbursement' || dialog === 'distribution') && !partnerId) return
    void update(d => {
      switch (dialog) {
        case 'expense': return addExpense(d, { batchId: null, dogId: null, category, amount: fen, paidBy, date: today, note })
        case 'injection': return addInjection(d, partnerId, fen, today, note)
        case 'income': return addIncome(d, fen, today, note)
        case 'reimbursement': return addReimbursement(d, partnerId, fen, today)
        case 'distribution': return addDistribution(d, partnerId, fen, today)
        default: return d
      }
    })
    close()
  }

  return (
    <div className="px-4 pb-6 pt-6">
      <div className="rounded-xl bg-gray-900 p-5 text-white shadow-sm">
        <div className="text-xs opacity-70">池子里的现金</div>
        <div className="mt-1 text-3xl font-bold">{formatMoney(pool)}</div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        {data.settings.partners.map(p => {
          const adv = advanceBalance(data, p.id)
          return (
            <div key={p.id} className="rounded-xl bg-white p-3 shadow-sm">
              <div className="text-xs text-gray-500">{p.name} 垫付未还</div>
              <div className={`mt-0.5 text-lg font-semibold ${adv > 0 ? 'text-amber-600' : 'text-gray-400'}`}>
                {formatMoney(adv)}
              </div>
            </div>
          )
        })}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
        <button type="button" className="rounded-xl bg-white py-3 font-semibold shadow-sm" onClick={() => setDialog('expense')}>+ 支出</button>
        <button type="button" className="rounded-xl bg-white py-3 font-semibold shadow-sm" onClick={() => setDialog('income')}>+ 收入</button>
        <button type="button" className="rounded-xl bg-white py-3 font-semibold shadow-sm" onClick={() => setDialog('injection')}>+ 注资</button>
        <button type="button" className="rounded-xl bg-white py-3 text-xs font-semibold shadow-sm" onClick={() => setDialog('reimbursement')}>报销垫付</button>
        <button type="button" className="rounded-xl bg-white py-3 text-xs font-semibold shadow-sm" onClick={() => setDialog('distribution')}>分红</button>
      </div>

      <h2 className="mt-6 text-sm font-semibold text-gray-700">最近流水</h2>
      <ul className="mt-2 divide-y divide-gray-100 rounded-xl bg-white shadow-sm">
        {recent.map(e => (
          <li key={e.id} className="flex items-center justify-between px-3 py-2 text-sm">
            <div>
              <div>{TYPE_LABEL[e.type]} · {catLabel(e.category)}</div>
              <div className="text-xs text-gray-400">
                {e.date}
                {e.type === 'expense' && e.paidBy !== 'pool'
                  && ` · ${data.settings.partners.find(p => p.id === e.paidBy)?.name ?? e.paidBy} 垫付`}
                {e.payee && ` · 给 ${data.settings.partners.find(p => p.id === e.payee)?.name ?? e.payee}`}
                {e.note && ` · ${e.note}`}
              </div>
            </div>
            <div className={e.type === 'expense' ? 'text-red-500' : e.type === 'income' ? 'text-emerald-600' : 'text-gray-700'}>
              {e.type === 'expense' ? '-' : '+'}{formatMoney(e.amount)}
            </div>
          </li>
        ))}
        {recent.length === 0 && (
          <li className="px-3 py-6 text-center text-sm text-gray-400">还没有任何流水</li>
        )}
      </ul>

      <Modal open={dialog !== null} title={`记账：${dialog ? TYPE_LABEL[dialog === 'expense' ? 'expense' : dialog] : ''}`} onClose={close}>
        <input
          autoFocus
          className="w-full rounded-lg bg-gray-100 px-3 py-2 text-lg outline-none"
          inputMode="decimal"
          placeholder="金额（元）"
          value={amount}
          onChange={e => setAmount(e.target.value)}
        />

        {dialog === 'expense' && (
          <>
            <select
              className="mt-2 w-full rounded-lg bg-gray-100 px-3 py-2 text-sm"
              value={category}
              onChange={e => setCategory(e.target.value)}
            >
              {data.settings.costItems.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select
              className="mt-2 w-full rounded-lg bg-gray-100 px-3 py-2 text-sm"
              value={paidBy}
              onChange={e => setPaidBy(e.target.value)}
            >
              <option value="pool">从池子里出</option>
              {data.settings.partners.map(p => (
                <option key={p.id} value={p.id}>{p.name} 先垫付</option>
              ))}
            </select>
          </>
        )}

        {(dialog === 'injection' || dialog === 'reimbursement' || dialog === 'distribution') && (
          <select
            className="mt-2 w-full rounded-lg bg-gray-100 px-3 py-2 text-sm"
            value={partnerId}
            onChange={e => setPartnerId(e.target.value)}
          >
            {data.settings.partners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}

        <input
          className="mt-2 w-full rounded-lg bg-gray-100 px-3 py-2 text-sm outline-none"
          placeholder="备注（可留空）"
          value={note}
          onChange={e => setNote(e.target.value)}
        />

        <button
          type="button"
          className="mt-3 w-full rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white disabled:opacity-40"
          disabled={parseMoney(amount) === null}
          onClick={submit}
        >
          记下
        </button>
      </Modal>
    </div>
  )
}
```

- [ ] **Step 6: 验证**

Run: `npx vitest run` → 全部通过
Run: `npm run build` → 无 TS 错误
Run: `npm run dev` → 手动：注资 5000 → 记一笔「A 先垫付」的支出 → 确认垫付卡片出现在 A 名下 → 报销 → 确认归零

- [ ] **Step 7: 提交**

```bash
git add src
git commit -m "feat(ui): 资金流水页面与转账类动作"
```

---

### Task 12: 「报」页面（分账 + 一键对账单图片）

> **【控制器审计后已就地修好的三处，照现在的片段写】**
> 1. **下载回退抽成了 `downloadBlob`**，修了两个坑：`<a>` 必须 `document.body.appendChild` 之后才会被某些浏览器真正触发（原来没 append）；`URL.revokeObjectURL` 不能在 `a.click()` 后立刻调（会在下载真正开始前把 blob 释放掉），现在推到 `setTimeout(…, 0)`。
> 2. **`navigator.share` 的 `NotAllowedError` 单独兜住了。** iOS Safari 的 transient user activation 会被前面的 `await receiptToBlob(...)` 消耗掉，`nav.share` 会抛 `NotAllowedError`——这不是「生成失败」，而是应该退回下载并提示「已保存图片，请手动分享到微信」。用户自己关掉分享面板抛的 `AbortError` 则静默处理，不显示任何错误。
> 3. `drawReceipt` 原来只设了 `canvas.style.width`、**没设 `style.height`**，导出图在版面里会被压扁。已补 `canvas.style.height = `${height}px``。`const today = …` 同样改成 `useState` 惰性初始化。

> **本任务不含「成本结构」与「死亡率趋势」**——设计文档 §4 的「报」页确实列了这两项，它们由 **Task 20** 实现（`src/domain/stats.ts` + 接进本页）。不要以为自己漏抄了。

**Files:**
- Modify: `src/ui/pages/ReportPage.tsx`（整体替换）
- Create: `src/ui/receipt.ts`
- Test: `src/ui/receipt.test.ts`

**Interfaces:**
- Consumes: `settle`（Task 5）；`batchSummary`（Task 3）；`formatMoney`（Task 2）
- Produces:
  - `interface ReceiptRow { label: string; value: string; emphasis?: boolean }`
  - `buildReceiptRows(data: AppData): ReceiptRow[]`（纯函数，可测）
  - `drawReceipt(canvas: HTMLCanvasElement, title: string, subtitle: string, rows: ReceiptRow[]): void`
  - `receiptToBlob(rows: ReceiptRow[], title: string, subtitle: string): Promise<Blob>`

- [ ] **Step 1: 写失败的测试**

创建 `src/ui/receipt.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { buildReceiptRows } from './receipt'
import { DEFAULT_DATA } from '../domain/types'
import type { AppData, LedgerEntry } from '../domain/types'

function withEntries(entries: Partial<LedgerEntry>[]): AppData {
  const full = entries.map((e, i) => ({
    id: `e${i}`, date: '2026-10-03', type: 'expense', category: 'purchase',
    amount: 0, paidBy: 'pool', payee: null, batchId: null, dogId: null, note: '',
    ...e,
  })) as LedgerEntry[]
  return { ...DEFAULT_DATA, entries: full }
}

describe('buildReceiptRows', () => {
  it('包含收支、净利、池子与每位合伙人的三项数字', () => {
    const data = withEntries([
      { type: 'injection', amount: 500000, paidBy: 'p1' },
      { type: 'expense', amount: 584000, paidBy: 'p1' },
      { type: 'income', amount: 720000 },
    ])
    const rows = buildReceiptRows(data)
    const labels = rows.map(r => r.label)
    expect(labels).toContain('总收入')
    expect(labels).toContain('总支出')
    expect(labels).toContain('净利')
    expect(labels).toContain('池子余额')
    expect(labels).toContain('我 · 应分')
    expect(labels).toContain('我 · 垫付未还')
    expect(labels).toContain('伙伴 · 应分')
  })

  it('净利数字正确', () => {
    const data = withEntries([
      { type: 'expense', amount: 584000, paidBy: 'p1' },
      { type: 'income', amount: 720000 },
    ])
    expect(buildReceiptRows(data).find(r => r.label === '净利')!.value).toBe('¥1,360')
  })

  it('没有批次和流水时也能生成（不崩）', () => {
    const rows = buildReceiptRows(DEFAULT_DATA)
    expect(rows.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/ui/receipt.test.ts`
Expected: FAIL，报 `Failed to resolve import "./receipt"`

- [ ] **Step 3: 实现**

创建 `src/ui/receipt.ts`：

```ts
import type { AppData } from '../domain/types'
import { settle } from '../domain/settlement'
import { batchSummary } from '../domain/costing'
import { formatMoney } from '../domain/money'

export interface ReceiptRow {
  label: string
  value: string
  emphasis?: boolean
}

/** 纯函数：把当前数据整理成对账单上的行。 */
export function buildReceiptRows(data: AppData): ReceiptRow[] {
  const s = settle(data)
  const rows: ReceiptRow[] = [
    { label: '总收入', value: formatMoney(s.totalIncome) },
    { label: '总支出', value: formatMoney(s.totalExpense) },
    { label: '净利', value: formatMoney(s.netProfit), emphasis: true },
    { label: '池子余额', value: formatMoney(s.pool) },
  ]

  for (const p of s.partners) {
    rows.push({ label: `${p.name} · 应分`, value: formatMoney(p.claimable) })
    rows.push({ label: `${p.name} · 垫付未还`, value: formatMoney(p.advance) })
    rows.push({ label: `${p.name} · 已注资`, value: formatMoney(p.contributed) })
  }

  const batches = data.batches
  for (const b of batches) {
    const bs = batchSummary(data, b.id)
    rows.push({
      label: `批次 ${b.name}`,
      value: `在库 ${bs.inStock} / 已售 ${bs.sold} / 死亡 ${bs.dead} · ${formatMoney(bs.netProfitFen)}`,
    })
  }

  return rows
}

/** 用 canvas 手绘一张竖版对账单。零依赖，微信里能直接发。 */
export function drawReceipt(
  canvas: HTMLCanvasElement,
  title: string,
  subtitle: string,
  rows: ReceiptRow[],
): void {
  const DPR = 2
  const width = 720
  const rowHeight = 64
  const headerHeight = 190
  const height = headerHeight + rows.length * rowHeight + 60

  canvas.width = width * DPR
  canvas.height = height * DPR
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`

  const ctx = canvas.getContext('2d')!
  ctx.scale(DPR, DPR)

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)

  ctx.fillStyle = '#065f46'
  ctx.fillRect(0, 0, width, 120)
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 40px system-ui, sans-serif'
  ctx.fillText(title, 40, 66)
  ctx.font = '24px system-ui, sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  ctx.fillText(subtitle, 40, 100)

  let y = headerHeight
  for (const row of rows) {
    if (row.emphasis) {
      ctx.fillStyle = '#ecfdf5'
      ctx.fillRect(24, y - 40, width - 48, 56)
    }
    ctx.fillStyle = row.emphasis ? '#065f46' : '#374151'
    ctx.font = row.emphasis ? 'bold 30px system-ui, sans-serif' : '28px system-ui, sans-serif'
    ctx.fillText(row.label, 40, y)
    ctx.textAlign = 'right'
    ctx.font = row.emphasis ? 'bold 32px system-ui, sans-serif' : '28px system-ui, sans-serif'
    ctx.fillText(row.value, width - 40, y)
    ctx.textAlign = 'left'
    y += rowHeight
  }

  ctx.fillStyle = '#9ca3af'
  ctx.font = '22px system-ui, sans-serif'
  ctx.fillText('由「狗账」生成 · 数据以记录人手机为准', 40, height - 30)
}

export async function receiptToBlob(
  rows: ReceiptRow[],
  title: string,
  subtitle: string,
): Promise<Blob> {
  const canvas = document.createElement('canvas')
  drawReceipt(canvas, title, subtitle, rows)
  return new Promise((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('生成图片失败'))), 'image/png')
  })
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/ui/receipt.test.ts`
Expected: 全部 passed（任务书原稿下面只给了 3 条用例，**实际实施写了 14 条**——多出来的钉在「只有净利那一行高亮」「每位合伙人恰好 3 行且用名字不用 id」「批次行在库含退回」「25 行也装得下」「长标签要截断」这类**只能看图才发现**的版面上。3 是下限，不是上限。）

- [ ] **Step 5: 实现页面**

`src/ui/pages/ReportPage.tsx`：

```tsx
import { useMemo, useState } from 'react'
import { useAppData } from '../../state/useAppData'
import { settle } from '../../domain/settlement'
import { batchSummary } from '../../domain/costing'
import { formatMoney } from '../../domain/money'
import { todayLocalIso } from '../planForm'
import { buildReceiptRows, receiptToBlob } from '../receipt'

export function ReportPage() {
  const { data } = useAppData()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const s = settle(data)
  // 本机时区的今天（不要用 toISOString()，那是 UTC，东八区晚上会差一天）
  const [today] = useState(() => todayLocalIso(new Date()))

  const ranking = useMemo(
    () => data.batches
      .map(b => ({ batch: b, summary: batchSummary(data, b.id) }))
      .sort((a, b) => b.summary.netProfitFen - a.summary.netProfitFen),
    [data],
  )

  // 下载回退。两个坑：①<a> 要先进 document 才会被某些浏览器真正触发；
  // ②立刻 revokeObjectURL 会在下载真正开始前把 blob 释放掉，所以推到下一个 tick。
  function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  async function shareReceipt() {
    setBusy(true)
    setMessage('')
    try {
      const blob = await receiptToBlob(buildReceiptRows(data), '狗账对账单', `截至 ${today}`)
      const file = new File([blob], `狗账对账单-${today}.png`, { type: 'image/png' })
      const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean }
      if (nav.share && nav.canShare?.({ files: [file] })) {
        try {
          await nav.share({ files: [file], title: '狗账对账单' })
        } catch (err) {
          if (err instanceof Error && err.name === 'AbortError') {
            // 用户自己把分享面板关了，什么都不用做
          } else if (err instanceof Error && err.name === 'NotAllowedError') {
            // iOS 上上面的 await receiptToBlob(...) 已经把 transient user activation 用掉了，
            // navigator.share 会抛 NotAllowedError。这不是生成失败——退回下载，让用户手动分享。
            downloadBlob(blob, file.name)
            setMessage('已保存图片，请手动分享到微信')
          } else {
            throw err
          }
        }
      } else {
        downloadBlob(blob, file.name)
        setMessage('图片已保存，去相册里发微信')
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '生成失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="px-4 pb-6 pt-6">
      <h1 className="text-xl font-bold">对账</h1>

      <button
        type="button"
        onClick={shareReceipt}
        disabled={busy}
        className="mt-4 w-full rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white disabled:opacity-40"
      >
        {busy ? '生成中…' : '生成对账单图片，发给伙伴'}
      </button>
      {message && <p className="mt-2 text-center text-xs text-gray-500">{message}</p>}

      <section className="mt-4 rounded-xl bg-white p-4 shadow-sm">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div><span className="text-gray-500">总收入</span> <b>{formatMoney(s.totalIncome)}</b></div>
          <div><span className="text-gray-500">总支出</span> <b>{formatMoney(s.totalExpense)}</b></div>
          <div>
            <span className="text-gray-500">净利</span>{' '}
            <b className={s.netProfit >= 0 ? 'text-emerald-600' : 'text-red-500'}>{formatMoney(s.netProfit)}</b>
          </div>
          <div><span className="text-gray-500">池子余额</span> <b>{formatMoney(s.pool)}</b></div>
        </div>
      </section>

      <section className="mt-4 rounded-xl bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-700">分账</h2>
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-400">
              <th className="text-left font-normal">合伙人</th>
              <th className="text-right font-normal">应分</th>
              <th className="text-right font-normal">已分红</th>
              <th className="text-right font-normal">垫付未还</th>
            </tr>
          </thead>
          <tbody>
            {s.partners.map(p => (
              <tr key={p.id} className="border-t border-gray-100">
                <td className="py-2">{p.name}（{(p.shareRatio * 100).toFixed(0)}%）</td>
                <td className="py-2 text-right font-semibold">{formatMoney(p.claimable)}</td>
                <td className="py-2 text-right text-gray-500">{formatMoney(p.distributed)}</td>
                <td className={`py-2 text-right ${p.advance > 0 ? 'text-amber-600' : 'text-gray-400'}`}>
                  {formatMoney(p.advance)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-gray-400">
          「应分」是账上算出来的权益，不点「分红」钱就一直留在池子里周转。
        </p>
      </section>

      {ranking.length > 0 && (
        <section className="mt-4 rounded-xl bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-700">批次盈亏排行</h2>
          <ul className="mt-2 space-y-2">
            {ranking.map(({ batch, summary }) => {
              // 死亡率的分母只数一遍：`inStock` 里已经含了退回的狗（见 src/domain/costing.ts:27-30 的 inStockCount），
              // 再加 `returned` 会把退回的狗算两次，让死亡率偏低。
              const total = summary.sold + summary.dead + summary.inStock
              return (
                <li key={batch.id} className="flex items-center justify-between text-sm">
                  <span>{batch.name}</span>
                  <span className={summary.netProfitFen >= 0 ? 'text-emerald-600' : 'text-red-500'}>
                    {formatMoney(summary.netProfitFen)}
                    <span className="ml-2 text-xs text-gray-400">
                      {total > 0 && `死亡率 ${((summary.dead / total) * 100).toFixed(1)}%`}
                    </span>
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      )}

> **死亡率分母的坑（2026-10-03 实施者发现、控制器确认）**：上面这段原来写的是 `dead / (dead + sold + inStock + returned)`，**这是错的**——`src/domain/costing.ts:27-30` 的 `inStockCount` 已经把 `returned` 算进在库了（注释：「退狗（returned）回到在库：它又站在笼子里了，还得再卖一次，所以进分母」）。把 `returned` 再加一次，退回的狗就被数了两遍，分母虚高、死亡率偏低。实例：一批 10 只（4 售出、2 死亡、4 在库其中 2 只是退回的）→ 错公式给 4/16 = 25%，正确是 2/10 = **20%**。**退狗越多，这个偏差越大**，而死亡率正是用来判断「这批狗是不是死太多了」的指标，偏低的死亡率会让人放心得太早。
    </div>
  )
}
```

- [ ] **Step 6: 验证**

Run: `npx vitest run` → 全部通过
Run: `npm run build` → 无 TS 错误
Run: `npm run dev` → 点「生成对账单图片」，确认能下载到一张带数字的 PNG；如果有真实数据，确认数字与「钱」页面一致

- [ ] **Step 7: 提交**

```bash
git add src/ui/pages/ReportPage.tsx src/ui/receipt.ts src/ui/receipt.test.ts
git commit -m "feat(ui): 对账页面与一键对账单图片"
```

> **`git add` 的路径必须逐字列出。** 这个仓库里同时可能有人在改别的文件，`git add src` 会把别人写了一半的工作扫进你的提交（已经发生过一次，见本计划的 controller incident 记录）。

> **Task 12 实施记录（2026-10-03）**
> - 实际提交 **`6f64a95773255a636be04476fe90564e9ecc7328`**（父 `18b754f`，3 files / +522 / −1）：`src/ui/receipt.ts`(176)、`src/ui/receipt.test.ts`(167 / **14 个 `it`**)、`src/ui/pages/ReportPage.tsx`(181，整体替换掉 3 行占位)。全仓 **334 → 348 passed / 17 files**；build ✓ 42 modules / 269.50 kB；lint 0/0 on 49 files；`git status --short` 空。TDD 红态是 `Error: Cannot find module './receipt'`。
> - **实施者发现并修正了本节的一处真错误**：死亡率分母见上面那段警告块。这是数字会算错的缺陷，不是措辞问题，已把本节代码片段改成正确版本。
> - 另外三处实施者的加法（控制器接受）：①新增导出 `receiptSize(rowCount)` 与 `interface TextMeasurer`——让「画布够不够高」与「文字放不放得下」可测，真 `CanvasRenderingContext2D` 结构上就满足 `TextMeasurer`，所以测试里可以用假尺子而不用 cast；②新增导出 `fitText(measurer, text, maxWidth)`——本节原来按 `width / 2 - 40` 给标签留**写死**的宽度，而批次那行的值（`在库 3 / 已售 1 / 死亡 1 · ¥1,000`）本身就能长到约 420px，用户把批次名取长一点两段文字就会叠在一起；改成按 `measureText(row.value).width` 反推标签可用宽度，超宽加 `…`。**这张图是发给合伙人看的，叠一行等于少一行信息**；③`canvas.getContext('2d')` 不用 `!` 断言，改成 `if (ctx === null) throw new Error('这个浏览器拿不到 canvas 绘图上下文，生成不了对账单图片')`——中文错误会顺着 `shareReceipt` 的 catch 显示给用户，比静默的 `TypeError` 强。
> - 实施者自己踩的坑：`expect(size.height).toBe(190 + 0 * 64 + 60)` 被 oxlint 判 `erasing-op`（门禁要 0 warning），改成 `toBe(250)` 并把行高增量单独用一条测试钉住。
> - **单测覆盖不到的部分**：`drawReceipt` / `receiptToBlob` / `downloadBlob` / `shareReceipt` 需要真 canvas 与真 `navigator`，本仓没有 jsdom，只能靠控制器的真实浏览器探针。
> - 控制器复核：四条门禁独立重跑，数字与实施者报告一致（348 passed / 17 files、42 modules、269.50 kB、lint 0/0 on 49 files）。
>
> **控制器真实浏览器走查（2026-10-03）：38/38 PASS、0 条 `Runtime.exceptionThrown`、0 条 `console.error`。** 探针 `C:\Users\17928\AppData\Local\Temp\dogledger-t12.mjs`（可复跑），沿用既有模式：CDP + `--headless=new` + **真实时间 + 真实 IndexedDB + 真实 canvas**，`spawn(EDGE, [...], { stdio: 'ignore' })`（管道 stdio 在沙箱下 EPERM）。**本任务的可测点与「检」页不同**：`drawReceipt` 的文字画在 canvas 上、DOM 里读不到，所以探针在页面注入前钩住 `CanvasRenderingContext2D.prototype.fillText`（记录每段文字的 `{text, x, y, w: this.measureText(text).width}`）、`HTMLCanvasElement.prototype.toBlob`（记录画布宽高与 blob 大小/类型）、`HTMLAnchorElement.prototype.click`（记录 `a.download`）——**用「画了什么」而不是「像素长什么样」来验证图片内容**，不需要 PNG 解码器。走通的：空数据（无批次无流水）生成一张正文 10 行（4 个全局数字 + 2 位合伙人 × 3 行）、尺寸 1440×1780（= 720 宽 × DPR 2、高 = 2×(190 + 10×64 + 60)）、无批次行、页脚 `由「狗账」生成 · 数据以记录人手机为准` 且是图上最靠下的一行、每行标签右边界都没压到值左边界；不支持分享时走下载分支、文件名 `对账单-<今天>.png`、提示 `图片已保存，去相册里发微信`；生成中按钮变 `生成中…` 且 disabled、连点只产生 1 张图；`AbortError` 静默（无提示、无下载）；`NotAllowedError` 退回下载并提示 `已保存图片，请手动分享到微信`；造 10 只（4 售出 / 2 死亡 / 2 在库 / 2 退回，让 `inStock` = 4）后页面显示 `死亡率 20.0%`（**20.0% 而不是 25%，证明上面那段分母修正真的生效**）、`共 10 只 · 死亡 2 只`、支出 > 收入时净利显示红色负数、图上「净利」的值以 `-` 开头、批次行 `在库 4 / 已售 4 / 死亡 2 · -¥4,000`；**超长批次名（`十月一车从山东拉回来的那批土狗`）被截断成以 `…` 结尾且没有压到右边的值**（这条正是 `fitText` 存在的理由，只有看图才能验）；**时区改成 `Pacific/Honolulu` 后文件名变成 `对账单-2026-10-02.png`（当天 UTC 是 10-03）**——证明用的是本地日期而不是 `toISOString()`。
> - 本轮 4 条失败**全部是探针自己的 bug，没有产品缺陷**（这类错误第 4 次发生）：①按钮文字实际是 **`生成对账单图片，发给伙伴`**（本节第 3419 行原文就是这个，控制器凭记忆写成了短的），所以辅助函数改成按前缀 `startsWith` 找按钮；②③按 y 分组统计「正文行数」时阈值写成 `y > 190`，而第一行的 y **正好是 190**，被切掉了一行（画布高 1780 已经独立证明是 10 行）——阈值改成 `y > 130`；④批次行的值期望写成 `· -¥4,000.00`，实际 `formatMoney` 对整数分不补小数位，是 `· -¥4,000`。**教训（重复第 4 次）：断言失败时先核探针自己的文字/边界/期望值，再考虑给实现开缺陷。**
> - 未覆盖：iOS 真机上「`await receiptToBlob` 消耗掉用户手势导致 `NotAllowedError`」那条路没有真机可验；`canvas.toBlob` 在内存紧张时返回 `null`（会显示「生成图片失败」）也没有办法稳定复现。

---

### Task 13: 设置（合伙人 / 分成比例 / 目标毛利率 / 自定义成本项）

没有这页，`DEFAULT_SETTINGS` 里写死的「我 / 伙伴 / 各 50% / 毛利率 30% / 死亡率 15%」就只能改代码才能变，用户第一次打开就不对。

**Files:**
- Create: `src/ui/pages/SettingsPanel.tsx`
- Modify: `src/ui/pages/ReportPage.tsx`（底部挂上设置面板）
- Modify: `src/domain/actions.ts`（新增四个设置类动作，并给类型 import 补上 `Settings`、`CostItemDef`）
- Modify: `src/domain/actions.test.ts`（补充测试）

**Interfaces:**
- Consumes: `validateSettings`（Task 5）；`newId`、`Settings`、`CostItemDef`（Task 1）
- Produces（追加到 `src/domain/actions.ts`）：
  - `updateSettings(data: AppData, patch: Partial<Settings>): AppData`
  - `renamePartner(data: AppData, partnerId: string, name: string): AppData`
  - `setPartnerRatio(data: AppData, partnerId: string, ratio: number): AppData`
  - `addCostItem(data: AppData, name: string, scope: 'batch' | 'dog'): AppData`

- [ ] **Step 1: 写失败的测试**

追加到 `src/domain/actions.test.ts`：

```ts
// 把 updateSettings / renamePartner / setPartnerRatio / addCostItem
// 追加到文件顶部已有的 './actions' import 里
import { validateSettings } from './settlement'

describe('设置类动作', () => {
  it('updateSettings 只动 settings，不动流水', () => {
    const next = updateSettings(DEFAULT_DATA, { targetMarginRate: 0.5 })
    expect(next.settings.targetMarginRate).toBe(0.5)
    expect(next.entries).toEqual(DEFAULT_DATA.entries)
    expect(next.dogs).toEqual(DEFAULT_DATA.dogs)
  })

  it('不修改原数据', () => {
    updateSettings(DEFAULT_DATA, { targetMarginRate: 0.9 })
    expect(DEFAULT_DATA.settings.targetMarginRate).toBe(0.3)
  })

  it('renamePartner 只改名字', () => {
    const next = renamePartner(DEFAULT_DATA, 'p1', '阿强')
    expect(next.settings.partners.find(p => p.id === 'p1')!.name).toBe('阿强')
    expect(next.settings.partners.find(p => p.id === 'p2')!.name).toBe('伙伴')
  })

  it('setPartnerRatio 改比例后，校验能挡住不是 100% 的组合', () => {
    const next = setPartnerRatio(DEFAULT_DATA, 'p1', 0.6)
    expect(validateSettings(next.settings)).toBe('分成比例之和必须等于 100%')
    const fixed = setPartnerRatio(next, 'p2', 0.4)
    expect(validateSettings(fixed.settings)).toBeNull()
  })

  it('addCostItem 追加一个自定义成本项，且不是内置项', () => {
    const next = addCostItem(DEFAULT_DATA, '狗粮', 'batch')
    const item = next.settings.costItems.find(c => c.name === '狗粮')!
    expect(item.scope).toBe('batch')
    expect(item.isBuiltin).toBe(false)
    expect(next.settings.costItems).toHaveLength(DEFAULT_DATA.settings.costItems.length + 1)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/domain/actions.test.ts`
Expected: FAIL，报 `updateSettings is not a function`

- [ ] **Step 3: 实现**

把 `src/domain/actions.ts` **第 1 行**改成：

```ts
import type { AppData, Batch, CostItemDef, DogStatus, LedgerEntry, Money, Settings } from './types'
```

> **注意：`actions.ts` 第 2 行是独立的值导入 `import { newId } from './types'`，必须原样留着。** 在 `verbatimModuleSyntax` 下它不能并进 `import type` 那一行（`newId` 是值）。`createBatch` 与本任务新增的 `addCostItem` 都要用它。合并或删掉会让 `tsc -b` 报 `TS2304: Cannot find name 'newId'`。

追加到 `src/domain/actions.ts` 末尾：

```ts
export function updateSettings(data: AppData, patch: Partial<Settings>): AppData {
  return { ...data, settings: { ...data.settings, ...patch } }
}

export function renamePartner(data: AppData, partnerId: string, name: string): AppData {
  return {
    ...data,
    settings: {
      ...data.settings,
      partners: data.settings.partners.map(p => (p.id === partnerId ? { ...p, name } : p)),
    },
  }
}

export function setPartnerRatio(data: AppData, partnerId: string, ratio: number): AppData {
  return {
    ...data,
    settings: {
      ...data.settings,
      partners: data.settings.partners.map(p => (p.id === partnerId ? { ...p, shareRatio: ratio } : p)),
    },
  }
}

export function addCostItem(data: AppData, name: string, scope: 'batch' | 'dog'): AppData {
  const item: CostItemDef = { id: newId(), name, scope, isBuiltin: false }
  return {
    ...data,
    settings: { ...data.settings, costItems: [...data.settings.costItems, item] },
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/domain/actions.test.ts`
Expected: 全部 passed

- [ ] **Step 5: 写设置面板**

创建 `src/ui/pages/SettingsPanel.tsx`：

```tsx
import { useState } from 'react'
import { useAppData } from '../../state/useAppData'
import { updateSettings, renamePartner, setPartnerRatio, addCostItem } from '../../domain/actions'
import { validateSettings } from '../../domain/settlement'
import { parseMoney } from '../../domain/money'
import { fenToTextInput } from '../planForm'
import { Field } from '../components/Field'

export function SettingsPanel() {
  const { data, update } = useAppData()
  const [newItemName, setNewItemName] = useState('')
  const [newItemScope, setNewItemScope] = useState<'batch' | 'dog'>('dog')

  const s = data.settings
  const error = validateSettings(s)

  return (
    <details className="mt-4 rounded-xl bg-white p-4 shadow-sm">
      <summary className="cursor-pointer text-sm font-semibold text-gray-700">
        设置（合伙人 / 分成 / 目标毛利）
      </summary>

      <h3 className="mt-3 text-xs font-semibold text-gray-500">合伙人</h3>
      {s.partners.map(p => (
        <div key={p.id} className="mt-1 flex items-center gap-2">
          <input
            className="flex-1 rounded-md bg-gray-100 px-2 py-1.5 text-sm outline-none"
            value={p.name}
            onChange={e => void update(d => renamePartner(d, p.id, e.target.value))}
          />
          <input
            className="w-20 rounded-md bg-gray-100 px-2 py-1.5 text-right text-sm outline-none"
            inputMode="decimal"
            value={String(Math.round(p.shareRatio * 100))}
            onChange={e => {
              const pct = Number(e.target.value)
              // Number('') === 0，不先拦空串的话，清空输入框会把比例悄悄写成 0
              if (e.target.value.trim() === '') return
              if (!Number.isFinite(pct)) return
              void update(d => setPartnerRatio(d, p.id, pct / 100))
            }}
          />
          <span className="text-xs text-gray-400">%</span>
        </div>
      ))}
      {error && <p className="mt-2 text-xs text-red-500">{error}</p>}

      <h3 className="mt-4 text-xs font-semibold text-gray-500">目标与预估</h3>
      <Field
        label="目标毛利率"
        value={String(Math.round(s.targetMarginRate * 100))}
        suffix="%"
        inputMode="numeric"
        onChange={v => {
          const pct = Number(v)
          // Number('') === 0，不先拦空串的话，清空输入框会把这一项悄悄写成 0
          if (v.trim() === '') return
          if (!Number.isFinite(pct)) return
          void update(d => updateSettings(d, { targetMarginRate: pct / 100 }))
        }}
      />
      <Field
        label="默认预估死亡率"
        value={String(Math.round(s.expectedMortalityRate * 100))}
        suffix="%"
        inputMode="numeric"
        onChange={v => {
          const pct = Number(v)
          // Number('') === 0，不先拦空串的话，清空输入框会把这一项悄悄写成 0
          if (v.trim() === '') return
          if (!Number.isFinite(pct)) return
          void update(d => updateSettings(d, { expectedMortalityRate: Math.min(99, Math.max(0, pct)) / 100 }))
        }}
      />
      <Field
        label="默认每只检疫费"
        value={fenToTextInput(s.quarantinePerDog)}
        suffix="元"
        onChange={v => {
          if (v.trim() === '') return
          const fen = parseMoney(v)
          if (fen === null) return
          void update(d => updateSettings(d, { quarantinePerDog: fen }))
        }}
      />
      <Field
        label="默认每只病死犬处理费"
        value={fenToTextInput(s.disposalPerDog)}
        suffix="元"
        onChange={v => {
          if (v.trim() === '') return
          const fen = parseMoney(v)
          if (fen === null) return
          void update(d => updateSettings(d, { disposalPerDog: fen }))
        }}
      />
      <p className="mt-1 text-xs text-gray-400">
        这两项会预填到「算」页面。填 0 表示还不知道——检疫费与抗体检测价格请先向当地动物卫生监督机构问清。
      </p>

      <h3 className="mt-4 text-xs font-semibold text-gray-500">成本项</h3>
      <ul className="mt-1 text-xs text-gray-500">
        {s.costItems.map(c => (
          <li key={c.id} className="flex justify-between border-b border-gray-50 py-1">
            <span>{c.name}</span>
            <span className="text-gray-400">{c.scope === 'batch' ? '整批' : '单只'}{c.isBuiltin ? ' · 内置' : ''}</span>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex gap-2">
        <input
          className="flex-1 rounded-md bg-gray-100 px-2 py-1.5 text-sm outline-none"
          placeholder="新增成本项，如 狗粮"
          value={newItemName}
          onChange={e => setNewItemName(e.target.value)}
        />
        <select
          className="rounded-md bg-gray-100 px-2 py-1.5 text-sm"
          value={newItemScope}
          onChange={e => setNewItemScope(e.target.value as 'batch' | 'dog')}
        >
          <option value="dog">单只</option>
          <option value="batch">整批</option>
        </select>
        <button
          type="button"
          className="rounded-md bg-gray-900 px-3 text-sm font-semibold text-white disabled:opacity-40"
          disabled={!newItemName.trim()}
          onClick={() => {
            void update(d => addCostItem(d, newItemName.trim(), newItemScope))
            setNewItemName('')
          }}
        >
          加
        </button>
      </div>

      <p className="mt-3 text-xs text-gray-400">
        分成比例之和必须是 100%，否则不让你保存。改比例不会动已经发生过的账。
      </p>
    </details>
  )
}
```

- [ ] **Step 6: 接线**

在 `src/ui/pages/ReportPage.tsx` 的最外层 `<div>` 末尾加入（即在**所有** `<section>` 之后、最后那个 `</div>` 之前）。注意本页排行榜那一段写的是 `{ranking.length > 0 && (<section>…</section>)}`——`</section>` 在 JSX 表达式**内部**，所以落点是紧跟它的 `)}` 之后，不要去 `</section>` 前面插：

```tsx
      <SettingsPanel />
```

并在文件顶部的 import 区加入：

```tsx
import { SettingsPanel } from './SettingsPanel'
```

- [ ] **Step 7: 验证**

Run: `npx vitest run` → 全部通过
Run: `npm run build` → 无 TS 错误
Run: `npm run dev` → 手动：展开设置 → 把「我」改成真名 → 把分成改成 60% / 40%，确认中间会先报「必须是 100%」→ 加一个「狗粮」成本项 → 去「钱」页面记支出，确认下拉里出现「狗粮」

- [ ] **Step 8: 提交**

```bash
git add src/ui/pages/SettingsPanel.tsx src/ui/pages/ReportPage.tsx src/domain/actions.ts src/domain/actions.test.ts
git commit -m "feat(ui): 设置页（合伙人 / 分成 / 目标毛利 / 自定义成本项）"
```

> **`git add` 的路径必须逐字列出。** 这个仓库里同时可能有人在改别的文件，`git add src` 会把别人写了一半的工作扫进你的提交（已经发生过一次，见本计划的 controller incident 记录）。

> **Task 13 派发前审计（2026-10-03，控制器核对过实际代码）**
> - `useAppData()`（`src/state/useAppData.ts:21`）确实提供 `{ data, ready, update, replaceAll }`，Step 5 的 `const { data, update } = useAppData()` 可用。
> - `Field`（`src/ui/components/Field.tsx:1-16`）的 props 是 `{ label, value, onChange, suffix?, inputMode?: 'decimal' | 'numeric' | 'text', error? }`——Step 5 里传 `suffix` 与 `inputMode="numeric"` 都合法。`error` 是 Task 13 之后才被别处用到的东西，本任务不用。
> - `fenToTextInput` 在 `src/ui/planForm.ts:55`，`todayLocalIso` 在 `src/ui/planForm.ts:47`。
> - `src/domain/actions.ts` 当前第 1 行是 `import type { AppData, Batch, Dog, DogStatus, LedgerEntry, Money } from './types'`（**没有 `Settings`，也没有 `CostItemDef`**），第 2 行是 `import { newId } from './types'`，必须原样保留。追加本任务的四个动作时，把第 1 行补齐成 Step 3 给的那行。
> - 追加位置：文件**末尾**（现在是 `setDogQuarantine`，第 195 行之后），既有的 9 个导出函数一字不动。

> **Task 13 实施记录（2026-10-03）**
> - 实施者提交 `39e5b29 feat(ui): 设置页（合伙人 / 分成 / 目标毛利 / 自定义成本项）`（6 files / +633 / −2；父提交 `8a590e2`）。门禁：`Tests 386 passed (386)` / `Test Files 18 passed (18)`（基线 348 / 17）；`tsc -b` 无输出、`✓ 44 modules transformed`、`dist/assets/index-B90Jeqe_.js 275.59 kB / gzip 83.90 kB`、exit 0；`Found 0 warnings and 0 errors.`（52 files）；`git status --short` 空。
> - **多出两个文件**：`src/ui/settingsForm.ts`（90 行）+ `src/ui/settingsForm.test.ts`（157 行 / 22 个 `it`）。理由与 `dogLedger.ts` / `moneyBook.ts` / `receipt.ts` 一致——这几个输入框的规则**直接决定一条设置会不会被悄悄写坏**，必须能单测。所以实际 `git add` 是 6 个显式路径。域层 `actions.test.ts` 新增 16 个 `it`（计划的 5 条是下限），合计 +38。
> - **关键偏离（已接受，且必须保留）**：计划 Step 5 把输入框 `value` 直接派生自 `data.settings`（每次击键写库 + 重渲）。实测后果是 —— 检疫费想填 `1200.50`，敲到 `1200.` 时 `parseMoney('1200.') = 120000`、`fenToTextInput(120000) = '1200'`，**小数点被重渲吃掉**，接着敲 `5` 就写成 `12005`（差 10 倍）；毛利率想填 `60.5` 会静默存成 `605%`（`validateSettings` 只拦负数，不会响）。实施者按本仓已有先例（`src/ui/pages/CalculatePage.tsx:24` 表单放本地 state、`:37-41` 只改本地、`:27-35` 由表单推 `input`/`errors`）给 6 个输入框全部改成**本地草稿**：显示草稿、只有解析成功才写账、解析不了只报红字且一个字都不写。`settingsForm.ts` 的两个「10 倍陷阱」测试就是钉这条的。
> - 其余已接受的偏离：`renamePartner` / `setPartnerRatio` 加 ghost id 守卫（与 `setDogStatus` 同风格，找不到返回同一引用）；合伙人名字清空**不写库**（`validateSettings` 不检查名字，存下空名会让「钱」页出现没有主语的垫付卡片）；金额负数**不写库并报红字**（`parseMoney('-5') = -500` 是合法的，而 `validateSettings` 不看这两项 ⇒ 照抄会静默把检疫费存成负的）；`formatPercent` 保留两位小数（`Math.round` 会把 60.5% 显示成「61」，看到的与存的对不上）；`inputError` 走 `Field` 的 `error` prop 而不是页面底部一行。
> - 走查发现一处口径不一致，已裁定并派 Task 13b 修正：**死亡率的越界处理「设置」页与「算」页必须一致——拒绝，不夹取。** 详见 Task 13b。
> - **控制器真实浏览器走查（含 Task 13b 落地后的最终状态）：`92/92 PASS`、`Runtime.exceptionThrown: 0`、`console.error: 0`。** 探针 `C:\Users\17928\AppData\Local\Temp\dogledger-t13.mjs`（可复跑；`PORT = 9345`、`--headless=new`、真实时间 + 真实 IndexedDB、`spawn(EDGE, [...], { stdio: 'ignore' })`——管道 stdio 在沙箱下 EPERM）。前置：`npm run build`（`✓ 44 modules`、`dist/assets/index-BHpv-rAG.js 275.52 kB / gzip 83.87 kB`、`✓ built in 224ms`）→ `npx vite preview --port 5199 --strictPort` 作后台作业 → 跑探针 → 验完 kill 掉作业。
>   - 走通的主要链路：底部 5 标签；「报」页底部 `设置（合伙人 / 分成 / 目标毛利）` 折叠块**初始收起**（收起时 innerText 里看不到「目标与预估」/「成本项」，展开后 9 个输入框）；默认值 我/伙伴 · 50/50 · 30 · 15 · 0/0 · 6 条内置成本项（含 `检疫（抗体检测+申报） · 单只 · 内置` 与 `病死犬无害化处理 · 单只 · 内置`）。
>   - **改名**：写库、「报」页分账表那行同步变成 `老王50%`；**清空名字不写库**（库里仍是老王），重新输入照常写。
>   - **比例**：`60`+`50` → 底部红字 `分成比例之和必须等于 100%`，改 `40` 后消失；`abc` → 行内红字 `填一个数字，例如 30 或 30.5` 且账不动；**敲到 `12.` 时框里仍是 `12.`（小数点没被重渲吃掉）**，继续敲成 `12.5` → 库 0.125。
>   - **死亡率（Task 13b 的核心）**：`125`/`99.5`/`abc` 全部**拒绝**——框里原样保留输入、下方红字 `死亡率要填 0 到 99 之间的数字`、input 标红 `bg-red-50`、**库里一个字都没写**；`99` 合法 → 0.99；`12.` 不写账且闪红字；`12.5` → 0.125 且红字立刻消失。**「算」页对同一个 `125`/`12.` 给出逐字相同的红字**，非法时不再展示「低于这个价别卖 ¥金额」而换成「上面有填错的地方，改好才能算保本价。」，填成 `12.5` 后金额立刻回来。
>   - **金额**：检疫费敲到 `1200.` 时框里保持 `1200.`，继续敲成 `1200.50` → 库 **120050 分**（不是差 10 倍的 12005）；`-5` → 红字 `金额不能是负数，还不知道就填 0` 且账不变；`abc` → 红字 `金额只能填数字，例如 1200 或 1200.50` 且账不变。目标毛利率 `60.5` → 库 0.605（不是 605%）。
>   - **新增成本项**：「加」按钮空名禁用、有名可点；点一次列表多一条 `狗粮 · 单只`（无「内置」）、库 `isBuiltin:false`、输入框清空；切「整批」再加得到 `运费补贴 · 整批`，库共 8 条。**「钱」页「+ 支出」弹窗的成本项下拉里真的出现了 `狗粮` 与 `检疫（抗体检测+申报）`**，垫付下拉用的是改名后的 `老王 先垫付`。
>   - **设置被别处用上**：「算」页的「每只检疫费」被预填成 `1200.5`、「每只病死犬处理费」`200`、「预估死亡率」`15`。
>   - **切换标签与 reload**：`src/App.tsx:17-23` 是 `<Current />` 单组件渲染 ⇒ 切标签会卸载设置页、**草稿随之消失**，回来看到的是账上的值（`15` / `1200.5` / `200`），不会留下一条早已不成立的假红字。reload 后名字/比例/四个数字/8 条成本项全在、库里数值一字不差、不卡在「正在载入」。
>   - **6 条首轮失败全是探针自己的期望写错，没有产品缺陷**（同类第 5 次）：①「报」页分账表那行真实文本是 `老王50%`（表格列 `合伙人/应分/已分红/垫付未还`），**不存在 `老王 · 应分` 这种串**——是控制器凭记忆编的；②**`fenToTextInput(120050)` 是 `'1200.5'` 而不是 `'1200.50'`**（`src/ui/planForm.ts:56` 是 `String(fen / 100)`，不补尾零），设置页只在**草稿还在时**显示 `1200.50`，草稿一消失（切标签/reload）就回到 `1200.5`，两者是同一个数；③保本价那块的标题是「**低于这个价别卖**」而不是「保本价」；④**「低于这个价别卖」这句话在脚注里也出现**（「这一栏填 0，上面的「低于这个价别卖」就偏低。」），所以按子串否定判断会假红，必须用 `'低于这个价别卖\n¥'` 当标记；⑤首轮 `readSettings()` 返回 `null` 抛 `TypeError: Cannot read properties of null (reading 'partners')`——因为**首次改动前 IndexedDB 里还没有记录**（`src/state/AppDataContext.tsx` 只在 `update`/`replaceAll` 里调 `persistData`），已改成先断言 `hasRecord() === false`。
>   - 未覆盖：`<details>` 的展开状态不持久化（计划未要求，切页即收起）；`targetMarginRate > 100%` 无上界（`planning.ts:55` 的加成在数学上合法）。

---

### Task 13b: 死亡率越界口径统一（拒绝，不夹取）

**为什么有这一项**：Task 13 实施者发现同一个输入在两个页面得到两种结果，并在报告里主动提出。（`39e5b29` 的状态是 `DONE_WITH_CONCERNS`，concern 就是这一条。）

- `src/ui/planForm.ts:100-110` 的 `parseMortalityPercent` 对 `125` 返回 `null`，注释写明理由：**「上界 99%…与其把它 clamp 成一个用户没输入的数，不如让用户看见自己填错了。」** 「算」页因此对 `125` 报红字 `死亡率要填 0 到 99 之间的数字`，并且**不展示保本价**。
- `src/ui/settingsForm.ts:48-53` 的 `applyMortalityInput` 对同样的 `125` **夹成 99 并写进账里**，框里显示 `99`、没有红字。

**裁定：跟着「算」页走 —— 拒绝 + 红字，不夹取。** 三条理由：

1. 同一件事在两个页面有两种结果，用户没法建立任何可靠预期。更糟的是「设置」页那条路是**静默**的：填 `125` 的人以为设在 125%（他可能真的是想写 125 或者手抖多打了一位），账里却是 99%，而这个数字直接决定决策台预估死几只、进而决定保本价。**错的数字比没有数字危险得多**——这句话就是 `src/ui/planForm.ts:9-11` 那段注释的核心，本条只是把它贯彻到底。
2. 夹取把「我打错了」这个信息**抹掉**了。夹完之后框里是 99，用户没有任何线索知道自己刚才打的是 125。
3. 成本几乎为零，而且顺带**消掉了一个重复的规则**：改成复用 `parseMortalityPercent` 之后，全仓「死亡率怎么解析」只有一个函数、一条文案。

**Files:**
- Modify: `src/ui/settingsForm.ts`
- Modify: `src/ui/settingsForm.test.ts`
- Modify: `src/ui/pages/SettingsPanel.tsx`（只改 `:112-119` 那段解释夹取的注释；行为不用改，因为面板已经是「`ratio === null` 就不写账」）

**必须满足的行为：**

1. `applyMortalityInput(raw)` **去掉 `Math.min(99, Math.max(0, percent))`**，改成直接复用 `parseMortalityPercent`：
   ```ts
   import { parseMortalityPercent } from './planForm'

   export function applyMortalityInput(raw: string): { draft: string; ratio: number | null } {
     const rate = parseMortalityPercent(raw)
     if (rate === null) return { draft: raw, ratio: null }
     return { draft: raw, ratio: rate }
   }
   ```
   注意 **`parseMortalityPercent` 返回的已经是比率（`percent / 100`），不要再除 100**。
2. **草稿永远原样保留**（`draft: raw`）。这样 `12.` 这种「打到一半」的文本不会被改写，`12.5` 能顺利填完。
3. `inputError('mortality', raw)` 改成用同一个函数、同一句文案：
   ```ts
   case 'mortality':
     return parseMortalityPercent(text) === null ? '死亡率要填 0 到 99 之间的数字' : undefined
   ```
   **文案必须与 `src/ui/planForm.ts:142` 逐字相同。**
4. 不要再留任何夹取逻辑，也不要留「越界不算输入错误」的说法——`settingsForm.ts` 与 `SettingsPanel.tsx` 里解释夹取的注释要一并删掉/改写，否则下一个人会照着注释把夹取加回来。
5. 界面行为：填 `125` → 框里仍是 `125`、下面出红字、**账不变**；填 `99.5` → 同样报红字（上界是 99）；填 `99` → 合法；填 `abc` → 报红字、账不变；填 `12.` → **会报红字**（`parseMortalityPercent` 的正则 `/^\d+(\.\d+)?$/` 本来就拒绝尾点，`src/ui/planForm.ts:103`）且不写账，接着打出 `5` 成 `12.5` → 红字立刻消失、写账 0.125。
   - **这一条原先写的是「填 `12.` 不报红字」，与同节第 3 条给的实现片段自相矛盾**（第 3 条要求 `inputError` 用同一个 `parseMortalityPercent`，而那个函数拒绝尾点）。实施者按第 3 条字面实现并报了上来（Task 13b 报告 §⑥1）。**控制器裁定：接受现状，红字闪一下**。理由：要满足原第 5 条就得给死亡率配第二套「尾点容忍」规则，那正是本条要消掉的东西；而 `src/ui/pages/CalculatePage.tsx:27-30` 的 `useMemo(() => parsePlanText(...))` + `:82` 把 `errors.mortalityPercent` 交给 `Field`，**「算」页对 `12.` 现在就是实时红字**，两个页面对同一个输入给出同一个结论才是本条的真正目的。
   - 已验证：「两个数字框对'打到一半'的处理不同」——`applyPercentInput('12.')`（分组比例 / 目标毛利率）会**立刻写账 0.12**（`parseNumber` 收尾点），`applyMortalityInput('12.')` 不写账且报红。这是既有设计（比例的越界交给页面底部 `validateSettings` 的红字说），本次**故意不动**，留作后续单独任务。

**测试要求**（`src/ui/settingsForm.test.ts`，必须显式 `import { describe, it, expect } from 'vitest'`）：把原来两条钉夹取的用例改成钉拒绝，并至少覆盖 —— `applyMortalityInput('125')` → `{ draft: '125', ratio: null }`；`applyMortalityInput('99.5')` → `ratio: null`；`applyMortalityInput('99')` → `ratio: 0.99`；`applyMortalityInput('-1')` → `ratio: null`；`applyMortalityInput('12.')` → `draft` 仍是 `'12.'` 且 `ratio: null`；`inputError('mortality', '125')` 逐字等于 `'死亡率要填 0 到 99 之间的数字'`；`inputError('mortality', '99')` 是 `undefined`；**一条一致性用例**证明「设置」页与「算」页对同一个输入给出同一个结论（例如断言 `inputError('mortality', '125') !== undefined` 与 `parseMortalityPercent('125') === null` 同时成立）。

**Steps:**
- [ ] **Step 1**：先改测试（TDD），跑一次看它失败。
- [ ] **Step 2**：改 `settingsForm.ts`，让测试通过。
- [ ] **Step 3**：清理 `SettingsPanel.tsx` 与 `settingsForm.ts` 里解释夹取的注释。
- [ ] **Step 4**：`npx vitest run` / `npm run build` / `npm run lint` / `git status --short`。
- [ ] **Step 5**：提交（**显式路径**）：
  ```bash
  git add src/ui/settingsForm.ts src/ui/settingsForm.test.ts src/ui/pages/SettingsPanel.tsx
  git commit -m "fix(ui): 死亡率越界改为拒绝而非夹取，与算页口径统一"
  ```

> **Task 13b 实施记录（2026-10-03）**
> - 实施者提交 `343df16 fix(ui): 死亡率越界改为拒绝而非夹取，与算页口径统一`（3 files / +69 / −24；父提交 `5ee6cfa`）。门禁：`Tests 390 passed (390)` / `Test Files 18 passed (18)`（基线 386，净 +4）；`tsc -b` 无输出、`✓ 44 modules transformed`、`✓ built in 230ms`；`Found 0 warnings and 0 errors.`（52 files）；提交后 `git status --short` 空。
> - TDD 红态 `Tests 7 failed | 19 passed (26)`，失败原文含 `AssertionError: expected { draft: '12.', ratio: 0.12 } to deeply equal { draft: '12.', ratio: null }`、`expected 0.99 to be null`（`'125'` 与 `'99.5'`）、`expected undefined to be '死亡率要填 0 到 99 之间的数字'`。
> - 落地：`src/ui/settingsForm.ts:5` 新增 `import { parseMortalityPercent } from './planForm'`（planForm 不反向 import，无循环）；`:56-60` 删掉 `Math.min(99, Math.max(0, percent))`、改成 `const rate = parseMortalityPercent(raw)` 且**没有再除 100**；`:92-93` 的 `case 'mortality'` 用同一个函数、文案与 `src/ui/planForm.ts:142` 逐字相同；`:74-81` 的注释从「数字但越界不算错误」改写为「越界算错误」。`SettingsPanel.tsx:112-119` 只改注释，`onChange` 逻辑一行未动（面板本来就是 `ratio === null` 就不写账）。
> - 测试从 26 条增到 30 条（`settingsForm.test.ts`）：拒绝组含 `'12.'`/`'125'`/`'-3'`/`'100'`/`'99'`(→0.99)/`'99.5'`；越界红字组逐字断言三条；新增**一致性 describe**（12 个样本，含 `''`、`'  '`、`'12.'`、`'25%'`）钉住「`ratio === null` ⇔ `parseMortalityPercent === null` ⇔ 有红字（空串除外）」。
> - 实施者报的三个遗留（控制器均接受）：①`applyPercentInput('12.')` 立刻写账而 `applyMortalityInput('12.')` 不写（见行为 5 的第二条，故意不动）；②死亡率的输入路径现在最多只能产出 `<1` 的值，`validateSettings` 对 `expectedMortalityRate` 的范围检查已不可能从这条路径触发（保留作兜底）；③「填 125 后直接切页离开，草稿是否还在」取决于 `SettingsPanel` 的挂载方式——`src/App.tsx:17-23` 是 `<Current />` 单组件渲染，**切标签会卸载页面、草稿随组件一起消失**，下次进来看到的是账上的值。这不产生错误数据，属可接受行为。

---

### Task 15: 检疫纯函数（`src/domain/quarantine.ts`）

**Goal:** 把设计文档 §3.7 的检疫阶段推导写成纯函数，让界面能回答「这只狗现在能不能卖」。

**为什么有这一组任务（Task 15–19）**：它们来自用户批准的**修订二**。原来「检疫流程台账」被排在第二期，前提是"货源可能转为与繁育基地签约"；现在前提变了——无论走哪条渠道，检疫证明都是每一单出售的法定前置，且一证多用按货值 15~30 倍处罚、负责人 5 年禁业。**没地方记证明编号与有效期，就只能靠脑子记，这正是最贵的那类遗忘。** 同时「批次计划去向 + 渠道对照」来自 D11：线下成交是唯一走得通的路径，而各渠道成本结构差别极大。

**顺序**：15 与 16 是纯函数（`domain/`，有单测）；17–19 是界面接线。19 依赖 17 的页面存在，18 依赖 16。

> **⚠️ 实施顺序变更（2026-10-03，用户拍板）**：用户决定**先把「检」页面这一组做完**，再回头做 Task 12 / 13 / 20 / 14。所以实际执行顺序是 **15 → 17 → 12 → 13 → 19 → 16 → 18 → 20 → 21 → 14**，本文档里的任务编号不变（编号是身份，不是顺序）。
>
> 理由（用户原话的意图）：不管最后走宠物店、犬市还是别的渠道，**检疫证明都是每一单出售的法定前置**，所以检疫台账是「所有路线都需要的地基」，先把地基打完再谈别的。
>
> **顺序修正（2026-10-03，控制器自查发现两处依赖倒置）**：初版顺序是 `15 → 17 → 19 → 16 → 18 → 12 → 13 → 20 → 14`，有两处写不出来——
> 1. **Task 19 要往 `src/ui/pages/SettingsPanel.tsx` 里加两个输入框，而这个文件是 Task 13 的产物**（Task 19 自己的 Consumes 也写着「Task 13 已有的表单组件 `Field`」）；
> 2. **Task 13 要把 `SettingsPanel` 挂到 `src/ui/pages/ReportPage.tsx` 底下，而这个文件由 Task 12 整体替换**（Task 13 的 Files 写着 Modify ReportPage；Task 12 的 Files 写着 Modify ReportPage「整体替换」）。
> 所以 Task 12 与 Task 13 都必须排在 Task 19 之前。现顺序把 12 → 13 → 19 连在一起，检疫这一组（15 / 17 / 12 / 13 / 19）做完再进渠道对照（16 / 18）。Task 18 依赖的批次详情页来自早已完成的 Task 10，不受影响。
>
> **Task 21（批次改名）是实机走查后新加的**，排在 Task 20 之后、Task 14（上线）之前——它是可用性修补，不该挡住上线，但必须在声称「做完了」之前修掉：同一天建两个只数相同的批次时，下拉里会出现两条一模一样的选项。
>
> 用户同时裁定：**30 天隔离与资金占用成本先不进模型**（《狂犬病防治技术规范》5.3 的「引进后应至少隔离观察 30 天」是否适用于纯转卖中间商，官方无明确解释，须先向当地动物卫生监督机构核实）。核实结果回来之前，**不许**在 `PlanInput` 或决策台里凭空加一个「压货天数」参数。

**Files:**
- Create: `src/domain/quarantine.ts`
- Create: `src/domain/quarantine.test.ts`

**Consumes:** `AppData` / `Dog` / `Settings`（`src/domain/types.ts`，Task 1）；`dogsOfBatch`（`src/domain/costing.ts`，Task 3）。

**Interfaces（必须逐字一致）:**

```ts
import type { AppData, Dog, Settings } from './types'

export type QuarantineStage =
  | 'unvaccinated'
  | 'waiting_antibody'
  | 'ready_to_test'
  | 'waiting_cert'
  | 'certified'
  | 'cert_expired'

export interface QuarantineStatus {
  stage: QuarantineStage
  label: string                   // 中文标签，直接给界面用
  nextAction: string              // 中文：下一步该做什么
  daysUntilTestable: number | null  // 仅 waiting_antibody 时有值；其余 null
  isSellable: boolean
}

export function addDays(isoDate: string, days: number): string
export function daysBetween(fromIso: string, toIso: string): number
export function quarantineStatus(dog: Dog, settings: Settings, today: string): QuarantineStatus
export function isSellable(dog: Dog, settings: Settings, today: string): boolean
export function certExpiresIn(dog: Dog, today: string): number | null

export interface SaleCheckEntry {
  dog: Dog
  status: QuarantineStatus
}

export interface PreSaleChecklist {
  sellable: Dog[]
  blocked: SaleCheckEntry[]
}

export function preSaleChecklist(data: AppData, batchId: string, today: string): PreSaleChecklist
export function quarantineSummary(data: AppData, batchId: string, today: string): Record<QuarantineStage, number>
```

**必须满足的行为:**

1. **阶段判定严格按 §3.7 的表，且判定顺序就是下面这个顺序**（第一个匹配的即为结果）：
   - `cert_expired`：`quarantineCertNo.trim() !== ''` 且 `quarantineCertValidUntil !== null` 且 `quarantineCertValidUntil < today`
   - `certified`：`quarantineCertNo.trim() !== ''` 且 `quarantineCertValidUntil !== null` 且 `quarantineCertValidUntil >= today`
   - `unvaccinated`：`dog.rabiesVaccinatedOn === null`
   - `waiting_cert`：`dog.antibodyTestedOn !== null`（且没有有效证明）
   - `ready_to_test`：`daysBetween(dog.rabiesVaccinatedOn, today) >= settings.rabiesWaitDays`
   - `waiting_antibody`：以上都不满足（已接种，但还没等够）

   > ⚠️ **次序已按 2026-10-03 的裁定修订：两个「有证明」分支必须排在 `unvaccinated` 之前。**
   > 原任务书把 `unvaccinated` 排在第一位，实施者按原样实现并把这个口径缝报了上来，裁定结果**反过来**。
   > 理由：①《动物防疫法》第二十九条禁止的是「未附有检疫证明」而出售，而《犬产地检疫规程》3.3 规定**拿到证明的前提就是免疫在有效保护期内 + 抗体检测合格**——证明是下游产物，它存在就蕴含上游满足，`rabiesVaccinatedOn` 只是给自己看的便利记录，**不是出售的前置条件**；②反过来排会对「证随狗走、接种日期不详」的狗说「先带去接种狂犬疫苗」并挡住出售，**给出与事实相反的行动指令**；③反过来排会把「证明已过期但接种日期没填」的狗误判成 `unvaccinated`（从没打过疫苗）而不是 `cert_expired`（必须重新申报），丢掉真正有用的下一步。
   > **「先判过期再判有效」仍然必须保持**——写反了过期证会被当成有效证。这一条与本次改动无关，别一起改掉。
2. **边界（必须有测试）**：
   - `daysBetween(rabiesVaccinatedOn, today) === settings.rabiesWaitDays` → `ready_to_test`（满当天即可送检）
   - `quarantineCertValidUntil === today` → `certified`（有效期末尾那天仍可售）
   - `quarantineCertValidUntil < today` → `cert_expired`，且 `isSellable === false`
   - `quarantineCertNo === '   '`（全空格）→ 视为无证明
   - **`rabiesVaccinatedOn === null` 但 `quarantineCertNo` 与 `quarantineCertValidUntil` 都齐且未过期 → `certified` + `isSellable === true`**（本次裁定的核心用例）
   - **同上但 `quarantineCertValidUntil < today` → `cert_expired` + `isSellable === false`**（不得掉进 `unvaccinated`）
   - `quarantineCertNo !== ''` 但 `quarantineCertValidUntil === null` → **不算有证明**，继续往下判
3. `isSellable(dog, settings, today)` **只有** `stage === 'certified'` 时为 `true`，实现上直接返回 `quarantineStatus(...).isSellable`——**不得另写一套判定**。
4. `daysUntilTestable`：仅在 `waiting_antibody` 时 = `settings.rabiesWaitDays - daysBetween(dog.rabiesVaccinatedOn, today)`（正数）；其余阶段为 `null`。
5. `certExpiresIn(dog, today)`：`quarantineCertValidUntil` 非 `null` 时返回 `daysBetween(today, quarantineCertValidUntil)`（可能为负，表示已过期），否则 `null`。
6. `preSaleChecklist`：**遍历该批次里「还在我们账上」的狗**——即 `status` 为 `in_stock` 或 `returned`（见 `## Global Constraints` 里「还在我们账上的狗（在库）」那一条；`returned` 是退回来的狗，它还站在笼子里，也要出栏）。`sellable` 收 `isSellable === true` 的，`blocked` 收这些狗里其余的并带上完整 `status`（死狗与已售狗**不在**这个清单里——它们根本不在笼子里，把它们算成「不能卖」会让「N 只里有 M 只不能卖」这句话失去意义；界面文案因此是「在库 N 只里有 M 只不能卖」）。
7. `quarantineSummary` 返回的 `Record<QuarantineStage, number>` **6 个 key 必须全部存在**（没有的填 0），这样界面可以直接遍历。**它也只统计在库的狗**（`in_stock` / `returned`）——检疫阶段是"这只狗现在能不能卖"的状态，已经卖掉或已经死掉的狗没有当下阶段可言。
8. **日期算术不得依赖本地时区**。实现照这个写：
   ```ts
   export function addDays(isoDate: string, days: number): string {
     const [y, m, d] = isoDate.split('-').map(Number)
     const base = new Date(Date.UTC(y, m - 1, d))
     base.setUTCDate(base.getUTCDate() + days)
     return base.toISOString().slice(0, 10)
   }
   ```
   `daysBetween(fromIso, toIso)` 同样用 `Date.UTC` 解析两侧，相减后除以 `86400000`，返回整数。**不要用 `new Date(isoDate)` 配本地时区方法**——那样晚上会差一天。
9. 本文件**不得出现无参 `new Date()`**（"今天"一律由调用方传入），不得 import React / storage。今天用 `today` 参数比较时，`'YYYY-MM-DD'` 字符串直接比大小即可（字典序=时间序）。
10. `label` / `nextAction` 是直接显示给用户的中文，建议取值：
    - `unvaccinated` → 「未接种狂犬疫苗」/「先带去接种狂犬疫苗」
    - `waiting_antibody` → 「等待抗体检测期」/「再等 N 天才能采血送检」
    - `ready_to_test` → 「可以送检」/「去采血做免疫抗体检测」
    - `waiting_cert` → 「待申报检疫」/「提前 3 天向当地动物卫生监督机构申报」
    - `certified` → 「可出售」/「已具备检疫证明，可以出售」
    - `cert_expired` → 「检疫证明已过期」/「必须重新申报检疫，不能用旧证出售」

**测试要求**：`src/domain/quarantine.test.ts` 至少覆盖 6 个阶段各一例；上面第 2 条的 4 个边界；`preSaleChecklist` 的「8 只里 3 只没有有效证明」案例（断言 `blocked.length === 3` 且正是那 3 只）；**`preSaleChecklist` 与 `quarantineSummary` 都只统计在库的狗**——造一个「1 只已售 + 1 只已死 + 2 只在库」的批次，断言清单里只有那 2 只、`quarantineSummary` 6 个 key 之和 = 2；**`returned` 的狗必须出现在 `preSaleChecklist` 里**（它是退回来的活狗，还要再卖一次）；`quarantineSummary` 的 6 个 key 齐全；`certExpiresIn` 对无证明返回 `null`。测试一律显式 `import { describe, it, expect } from 'vitest'`（仓库没有 `vitest/globals` 类型，裸写会让 `tsc -b` 报 TS2593/TS2304）。

**Steps:**
- [ ] **Step 0**：`git log --oneline -3` 确认工作区干净；read `src/domain/types.ts`（拿到 `Dog` / `Settings` 的确切字段名）与 `src/domain/costing.ts`（`dogsOfBatch` 签名）。字段名以代码为准，本任务书里的名字若与代码不符，**以代码为准并报告差异**。
- [ ] **Step 1**：先写测试（TDD）。`npx vitest run src/domain/quarantine.test.ts` → 预期失败于 `Cannot find module './quarantine'`。
- [ ] **Step 2**：写实现，直到单文件全绿。
- [ ] **Step 3**：`npx vitest run` → 全仓通过。
- [ ] **Step 4**：`npm run build` → 无 TS 错误。
- [ ] **Step 5**：`npm run lint` → 0 warnings 0 errors。
- [ ] **Step 6**：提交（只 add 这两个文件，**不要用 `git add -A`**）：
  ```bash
  git add src/domain/quarantine.ts src/domain/quarantine.test.ts
  git commit -m "feat(domain): 检疫阶段推导与出栏前检查清单"
  ```

---

### Task 16: 渠道对照纯函数（`src/domain/channels.ts` + `costing.ts` 小重构）

**Goal:** 让「同一批狗走不同渠道」能各自算出保本单价与每只利润，且**与决策台共用同一套摊薄算法**。

**Files:**
- Modify: `src/domain/costing.ts`（抽出唯一的摊薄入口）
- Create: `src/domain/channels.ts`
- Create: `src/domain/channels.test.ts`

**Consumes:** `ChannelId` / `SALES_CHANNELS` / `Money` / `AppData`（`src/domain/types.ts`）；**`batchPerDogCostFen`**（本任务在 `src/domain/costing.ts` 里新增，`channels.ts` 从它取批次摊薄成本）与 `aliveCount`（`src/domain/costing.ts:33`）。

> `channels.ts` **不要** import `batchTotalCost`：批次总成本只能经 `batchPerDogCostFen` 取（见行为 1）。

**Interfaces（必须逐字一致）:**

先在 `src/domain/costing.ts` 新增这个函数：

```ts
/**
 * 一批狗的「每只存活狗真实成本」（分，可能带小数）= 批次总成本 ÷ 存活数。
 * 这是全仓唯一的摊薄算法：dilutedCostFen 与渠道对照都走这里。
 * 整批死光时返回 0，调用方自行决定退化行为。
 */
export function batchPerDogCostFen(data: AppData, batchId: string): number {
  const alive = aliveCount(data, batchId)
  if (alive === 0) return 0
  return batchTotalCost(data, batchId) / alive
}
```

并把已有的 `dilutedCostFen`（`src/domain/costing.ts:49-56`）最后一行（`src/domain/costing.ts:55`）由 `return batchTotalCost(data, dog.batchId) / alive` 改为 `return batchPerDogCostFen(data, dog.batchId)`。**注意两个提前返回并不相邻**：`src/domain/costing.ts:52` 是 `if (!dog) return own`，`src/domain/costing.ts:53` 是 `const alive = aliveCount(data, dog.batchId)`，`src/domain/costing.ts:54` 才是 `if (alive === 0) return own`。**这三行全部保持原样**，只改第 55 行；可观测行为完全不变——已有的 15 个 `costing.test.ts` 测试必须**一字不改地继续通过**。

再新建 `src/domain/channels.ts`：

```ts
import type { AppData, ChannelId, Money } from './types'

export interface ChannelInput {
  channelId: ChannelId
  unitPriceFen: Money      // 你打算在这个渠道卖多少钱
  extraPerDogFen: Money    // 该渠道每只额外成本（包装、代卖抽成、送笼…）
  fixedCostFen: Money      // 该渠道专属固定成本（摊位费、进场费、一次性起送费…）
}

export interface ChannelBreakdown {
  channelId: ChannelId
  name: string                   // 取自 SALES_CHANNELS
  basePerDogCostFen: number      // 每只存活狗真实成本（含检疫）
  extraPerDogFen: Money
  fixedPerDogFen: number         // fixedCostFen ÷ 存活数
  breakEvenUnitPriceFen: number  // 保本单价 = base + extra + fixedPerDog
  perDogProfitFen: number        // unitPriceFen − breakEvenUnitPriceFen（负 = 亏）
  isLoss: boolean
}

export function compareChannels(data: AppData, batchId: string, inputs: ChannelInput[]): ChannelBreakdown[]
```

**必须满足的行为:**

1. `basePerDogCostFen` 必须来自 `batchPerDogCostFen(data, batchId)`——**批次总成本只能经 `batchPerDogCostFen` 取，存活数只能经 `aliveCount` 取**，本文件不得再写一遍 `batchTotalCost` 求和或自己数狗（行为 2 要调 `aliveCount`，两者不矛盾：禁止的是"自己算"，不是"调用"）。
2. `fixedPerDogFen = aliveCount(data, batchId) === 0 ? 0 : fixedCostFen / aliveCount(data, batchId)`。存活数为 0 时不除零、不抛错。
3. `breakEvenUnitPriceFen = basePerDogCostFen + extraPerDogFen + fixedPerDogFen`。
4. `perDogProfitFen = unitPriceFen - breakEvenUnitPriceFen`；`isLoss = perDogProfitFen < 0`（**等于 0 不算亏**）。
5. 返回数组**顺序与 `inputs` 一致**，不要排序（界面按此顺序渲染）。
6. `name` 从 `SALES_CHANNELS` 按 `channelId` 查找；查不到时回退为该 `channelId` 字符串本身，**不要抛错**（渠道清单将来会变）。
7. `channelId === 'undecided'` 且两个成本都是 0 时，`breakEvenUnitPriceFen` 必须**精确等于** `batchPerDogCostFen(data, batchId)`。这是"与决策台共用同一套算法"的回归测试，必须有断言。
8. 允许小数分（与 `dilutedCostFen` 一致），**不要在这里四舍五入**——四舍五入只发生在界面边界（`formatMoney`）。
9. 纯函数：不 import React / storage，不调用 `new Date()`。

**测试要求**：`src/domain/channels.test.ts` 至少覆盖：`undecided` 基准值（两个成本填 0，断言与 `batchPerDogCostFen` 精确相等）；两条渠道在同样 `unitPriceFen` 下一个赚一个亏；`fixedCostFen` 正确摊到存活数上（断言 `fixedPerDogFen === fixedCostFen / alive`）；`aliveCount === 0` 的批次不崩溃且 `fixedPerDogFen === 0`；返回顺序与输入一致；未知 `channelId` 回落为字符串。测试一律显式 `import { describe, it, expect } from 'vitest'`。

**Steps:**
- [ ] **Step 0**：read `src/domain/costing.ts` 与 `src/domain/costing.test.ts`，确认 `dilutedCostFen` 现有行为与那 15 个测试的内容。
- [ ] **Step 1**：先做 `costing.ts` 重构 → `npx vitest run src/domain/costing.test.ts` 必须仍是 **15 passed 且测试文件一字未改**。
- [ ] **Step 2**：TDD 写 `channels.test.ts` → 失败于 `Cannot find module './channels'`。
- [ ] **Step 3**：写 `channels.ts`，直到全绿。
- [ ] **Step 4**：`npx vitest run` → 全仓通过。
- [ ] **Step 5**：`npm run build` / `npm run lint`。
- [ ] **Step 6**：提交：
  ```bash
  git add src/domain/costing.ts src/domain/channels.ts src/domain/channels.test.ts
  git commit -m "feat(domain): 渠道对照（与决策台共用摊薄算法）"
  ```

> **Task 16 实施记录（2026-10-03，实施者 `afd57a0c-1165-4507-91a9-70ed3df3bfcc`，提交 `28f69a0`，`DONE`）**
> 3 files / +260 / −1。门禁：`Test Files 19 passed (19)` / `Tests 417 passed (417)`（基线 18/402，+1 文件 / +15 测试，**无计划外文件**）、`tsc -b` 无输出 + `✓ 44 modules transformed`、`dist/assets/index-CgNq0k06.js 277.30 kB / gzip 84.42 kB`、`Found 0 warnings and 0 errors.`（54 files / 116 rules）、提交后 `git status --short` 空。TDD 红态逐字为 `Error: Cannot find module './channels' imported from .../src/domain/channels.test.ts`（`1 failed (1)` / `no tests`），与任务书预期一致。
> 额外证据：`npx vitest run src/domain/costing.test.ts` → `15 passed (15)`，且 `git diff --stat -- src/domain/costing.test.ts` **输出为空**（重构后那 15 个测试一字未改，正是 Step 1 的要求）。
> 落点（**行号整体 +10**，因为 `batchPerDogCostFen` 插在 `deadLoss` 与 `dilutedCostFen` 之间）：`src/domain/costing.ts:44-53` 新增 `batchPerDogCostFen`（`:50 alive = aliveCount(...)`、`:51 if (alive === 0) return 0`、`:52 return batchTotalCost(data, batchId) / alive`）；`src/domain/costing.ts:66` 改一行；`dilutedCostFen` 其余行（`:63 if (!dog) return own`、`:64 const alive = aliveCount(...)`、`:65 if (alive === 0) return own`）原样未动。**任务书里写的 `costing.ts:49-56` 现为 `costing.ts:60-67`，`:55` 现为 `:66`。** `src/domain/channels.ts` 49 行，`src/domain/channels.test.ts` 199 行 / 15 个 `it` / 3 个 `describe`。
> 裁定 1 —— **测试里用 `runtimeInputs(json): ChannelInput[] { return JSON.parse(json) }`（`channels.test.ts:60-63`）造未知 `channelId`，接受。** 理由不是「绕开类型系统情有可原」，而是**它模拟的正是产品里真实存在的那条路径**：`src/storage/backup.ts:16` 的 `importBackup(json: string): AppData` 就是 `JSON.parse` 之后直接把 `data.batches`/`data.dogs`/`data.entries` 交给应用（`backup.ts:44-46`），**结构校验只查 `settings`/`batches`/`dogs`/`entries` 是不是对的类型，不查 `channelId` 取值**。所以旧备份或手改过的备份里出现 `taobao_live` 这种字符串是**真会发生的事**，行为 6 的回落逻辑是为它写的。备选写法（`as ChannelId`）正好被 brief 禁止，此写法更贴近现实。
> 裁定 2 —— **`ChannelBreakdown` 不回显 `unitPriceFen`，保持逐字 interface，不加字段。** Task 18 渲染时输入数组 `inputs` 与结果数组按下标一一对应（行为 5 已把「顺序与 `inputs` 一致、不排序」钉成测试），界面拿得到两边，不需要回显。**但这是一处真实的耦合**：将来若有人给 `compareChannels` 加上排序或过滤，按下标配对就会错——所以「顺序与输入一致」这条测试必须一直在。若 Task 18 实施时发现按下标配对确实别扭，**那时再单独开一次接口改动**，不预先加字段。
> 观察（无需处理）：`dilutedCostFen` 里 `:64` 的 `const alive` 现在只服务 `:65` 的 0 判断，整批死光时 `aliveCount` 被调用两次；行为不变、开销可忽略（brief 明令只改第 55 行）。
> 遗留（控制器已核实，属设计选择非缺陷）：`channelId` 在类型上是 `ChannelId` 联合，但 **`Money = number` 且 `paidBy`/`category` 一样没有字面量保护**——运行期未知值只能靠回落分支兜住，不靠类型。
> **后续（同日）：Task 18 派发前审计发现 `compareChannels` 在「还没有真实批次」的场景下取不到数（存活数为 0 ⇒ 底价与固定成本摊薄双双退化成 0），因此紧接着开了 → Task 16b**：把渠道算法拆成核心 `compareChannelCosts(basePerDogCostFen, aliveDogCount, inputs)` + 三行包装 `compareChannels`。**本任务的 15 个测试在 16b 里一字不改地继续通过**，本任务的所有行为与结论保持有效；16b 只是给了同一个算法第二种取数方式。`ChannelBreakdown` 仍然不加字段。

---

### Task 16b: 渠道算法的唯一入口 + 批次「计划去向」动作

**Goal:** 让「算」页面能在**还没有真实批次**的情况下用同一套渠道算法，并且让批次详情能改计划去向。

**为什么有这一组任务（Task 18 派发前审计发现的三处缺口，控制器 2026-10-03 补）**

Task 18 要在「算」页面上做渠道对照，可是那时候**一只狗都还没买**。Task 16 交给的 `compareChannels(data, batchId, inputs)` 是从账本里现取两个数：存活数 `aliveCount(data, batchId)` 与每只成本 `batchPerDogCostFen(data, batchId)`。**「算」页面上这两个数都取不出来**：

- 还没有真实批次 → 存活数是 0 → `batchPerDogCostFen` 的 `alive === 0` 分支直接 `return 0`（`src/domain/costing.ts:51`），**每只底价算成 0**；
- 就算现造一个临时批次，账本里也没有支出流水 → `batchTotalCost` 是 0 → 底价还是 0。

于是 Task 18 的任务书原来写的那套「造一个临时 `AppData`、里面塞一条金额 = 每只成本 × N 的支出流水、再调 `compareChannels`」**根本算不出正确的数**：临时批次里没有狗，`aliveCount` 是 0，`fixedPerDogFen` 恒为 0、底价恒为 0——**用户填的固定成本（摊位费）会静默不起作用**，而这不报错、不标红，是最坏的一类错。而且那种写法还会逼着界面自己算 `每只成本 × N`，正是 Task 18 行为 5 明令不许出现的第二套成本公式。

真正的模型是：**「预估能活几只」是这次计划的一个输入，不是能从数据库里查出来的事实。** 所以把渠道算法拆成「核心」+「从账本取数的薄包装」两层，核心显式接收这两个数。「算」页面直接传 `plan()` 已经算好的数；批次详情以后要按真实批次对照时，仍走 `compareChannels` 包装层。**算法仍然只有一处**（`compareChannelCosts`），这条不变。

另外两个缺口：`src/domain/actions.ts` 里**没有任何能改 `Batch` 字段的动作**（只有 `createBatch` 与狗的增删改、钱的动作、设置的动作），所以 Task 18 行为 7 的「计划去向可改」写不出来；`channelName`（渠道 id → 中文名）目前也不存在，`src/ui/pages/DogsPage.tsx:171` 正在把英文 id 直接显示给用户（`去向：pet_shop`）——**这是现存缺陷**，本任务给动作，Task 18 修显示。

**Files:**
- Modify: `src/domain/channels.ts`
- Modify: `src/domain/channels.test.ts`
- Modify: `src/domain/actions.ts`（**只在文件末尾追加**，已有 15 个导出函数一字不动；第 2 行 `import { newId } from './types'` 必须留着）
- Modify: `src/domain/actions.test.ts`

**Consumes:** `aliveCount` / `batchPerDogCostFen`（`src/domain/costing.ts`）；`SALES_CHANNELS` / `ChannelId` / `AppData`（`src/domain/types.ts`）。

**Interfaces（逐字）:**

```ts
/**
 * 渠道对照的核心：给定「每只存活狗的底价」与「存活只数」，算各渠道的保本单价与每只利润。
 * 这是全仓唯一的渠道成本算法 —— compareChannels 只是从账本里取出这两个数再调它。
 * 「算」页面还没有真实批次时直接调它，不要造临时 AppData、不要造假狗。
 */
export function compareChannelCosts(
  basePerDogCostFen: number,
  aliveDogCount: number,
  inputs: readonly ChannelInput[],
): ChannelBreakdown[]

/** 从账本取数后调 compareChannelCosts。真实批次（已有狗、已有支出）走这条。 */
export function compareChannels(data: AppData, batchId: string, inputs: ChannelInput[]): ChannelBreakdown[]

/**
 * 改一个批次的「计划去向」。找不到这个批次时原样返回（同一引用）。
 * 只改这一个批次的这个字段，别的批次、狗、流水一律不动，数组顺序不变。
 */
export function setBatchChannel(data: AppData, batchId: string, channel: ChannelId): AppData
```

**必须满足的行为:**

1. `compareChannels(data, batchId, inputs)` 的返回值必须**与 `compareChannelCosts(batchPerDogCostFen(data, batchId), aliveCount(data, batchId), inputs)` 深度相等**——这是「包装层没有第二套算法」的回归断言，必须有测试。
2. `compareChannels` 现有 15 个测试**一字不改地**全部通过（它们测的是外部行为，重构不该动它们）。
3. `compareChannelCosts` 用 `aliveDogCount` 摊固定成本：`fixedPerDogFen = aliveDogCount === 0 ? 0 : fixedCostFen / aliveDogCount`（0 不除零、不抛错）。
4. `basePerDogCostFen` **原样透传**，不做任何再加工、不与 `aliveDogCount` 相乘或相除。
5. `breakEvenUnitPriceFen = basePerDogCostFen + extraPerDogFen + fixedPerDogFen`；`perDogProfitFen = unitPriceFen - breakEvenUnitPriceFen`；`isLoss = perDogProfitFen < 0`（等于 0 不算亏）——与 Task 16 完全一致，**这三条算式全仓只能出现在 `compareChannelCosts` 里**。
6. 返回顺序与 `inputs` 一致（不排序）；`name` 从 `SALES_CHANNELS` 查、查不到回落为 `channelId` 字符串本身。
7. `aliveDogCount` **允许是小数**（`plan()` 的 `expectedAlive` 就是小数，`planning.ts:52`），不要取整、不要夹取。
8. `setBatchChannel`：批次存在 → 返回新的 `AppData`，只有那一个 `batch.plannedChannel` 变，`batches` 数组顺序与其余元素引用不变；批次不存在 → 返回**同一引用**；`dogs`/`entries`/`settings` 一律不动。
9. `setBatchChannel` **不校验 `channel` 是否在 `SALES_CHANNELS` 里**（与 `addCostItem` 不 trim、不去重同一风格：宽松的域层，界面负责给合法值）——但要在注释里写明这一点，因为将来从旧备份/手改数据读进来的未知值会被原样存下。
10. 两个文件都不许 import React / storage；不许 `new Date()`。

**测试要求**：`src/domain/channels.test.ts` 新增（旧 15 条不动）：`compareChannels` 与 `compareChannelCosts` 同参同结果（深度相等）；`compareChannelCosts` 的底价原样透传（传一个奇怪的值如 `12345.678` 也照用）；`aliveDogCount` 传小数时 `fixedPerDogFen === fixedCostFen / 小数`；`aliveDogCount === 0` 时不崩且 `fixedPerDogFen === 0`（此时保本价 = 底价 + extra）。`src/domain/actions.test.ts` 新增 `setBatchChannel`：改一个批次后 `plannedChannel` 变了；其余批次对象引用**不变**（`toBe`）；`dogs`/`entries`/`settings` 引用不变；批次不存在时返回同一引用；改两次不同批次互不影响；传入的 `data` 对象本身未被修改。**测试数会从 417 涨到 417 + 新增条数（约 +11）。** 测试一律显式 `import { describe, it, expect } from 'vitest'`。

**Steps:**
- [ ] **Step 0**：read `src/domain/channels.ts` 与 `src/domain/channels.test.ts` 全文，确认 15 个 `it` 的内容与现有的 `scenarioData()` / `roundData()` / `input()` / `runtimeInputs()` 夹具可复用。
- [ ] **Step 1**：TDD——先在 `channels.test.ts` 里加「`compareChannels` 与 `compareChannelCosts` 深度相等」与新核心函数的边界测试 → 失败于 `compareChannelCosts is not a function`（或 `Cannot find module`，取决于你怎样引入）。
- [ ] **Step 2**：重构 `channels.ts`，让 `compareChannels` 变成三行包装，直到 `npx vitest run src/domain/channels.test.ts` 全绿**且旧 15 条一字未改**。
- [ ] **Step 3**：TDD——`actions.test.ts` 加 `setBatchChannel` 测试 → 失败于 `setBatchChannel is not a function`。
- [ ] **Step 4**：在 `actions.ts` **末尾追加** `setBatchChannel`（别动已有函数、别动第 1/2 行 import 区之外的东西；需要 `ChannelId` 就用 `import type`）。
- [ ] **Step 5**：`npx vitest run` → 全仓通过；`npm run build` / `npm run lint`。
- [ ] **Step 6**：一次提交（域层重构与新增动作同属「补齐 Task 18 要用的接口」）：
  ```bash
  git add src/domain/channels.ts src/domain/channels.test.ts src/domain/actions.ts src/domain/actions.test.ts
  git commit -m "refactor(domain): 渠道算法唯一入口 compareChannelCosts + 批次计划去向动作"
  ```

> **Task 16b 实施记录（2026-10-04）**
> - 实际提交 **`67c5fb4`**（4 files / +153 / −10）。门禁：`Test Files 19 passed (19)` / `Tests 430 passed (430)`（基线 417 → +13：`channels.test.ts` 15 → 22、`actions.test.ts` 87 → 93）、`tsc -b` 无输出 + `✓ 44 modules transformed`（产物 `index-CgNq0k06.js` 277.30 kB / gzip 84.42 kB）、`Found 0 warnings and 0 errors.`（54 files）、`git status --short` 空。
> - 落点：核心函数在 **`src/domain/channels.ts:31-54`**（`:37` `fixedPerDogFen`、`:38` `breakEvenUnitPriceFen`、`:39` `perDogProfitFen`、`:50` `isLoss`、`:41-44` 未知渠道回落 id），JSDoc 在 `:24-30`；`compareChannels` 缩成 `:55-58` 的**一行包装**；`setBatchChannel` 在 **`src/domain/actions.ts:265-279`**（`:274` 守卫 `if (!data.batches.some(b => b.id === batchId)) return data`，`:276-278` 只换那一个批次对象）。`actions.ts` 第 1 行 `import type` 名单加了 `ChannelId`，第 2 行 `import { newId } from './types'` 原样保留。
> - TDD 红态两段都留了证据：Step 1 `TypeError: compareChannelCosts is not a function` ×2 + `Tests 7 failed | 15 passed (22)`——**旧 15 条在新函数还不存在时已经全绿**，这本身就是「新函数与旧行为解耦」的证明；Step 3 `TypeError: setBatchChannel is not a function` ×6 + `Tests 6 failed | 87 passed (93)`。
> - 「旧 15 条一字未改」有三重证据：`git diff -U0` 只有 `@@ -5 +5 @@`（import 行）与 `@@ -199,0 +200,63 @@`（纯插入，`0` 表示删除侧为空）两个 hunk，旧测试所在的 `:67-198` 无 hunk；`--stat` 只有 1 个 deletion（就是那行 import）；红态时旧 15 条已全绿。
> - **唯一偏离**：行为 1 要求「包装层与核心深度相等」，这条测试必须同时 import 两个函数，因此 `channels.test.ts:6` 的 import 行必须改。同性质的还有 `actions.ts:1` 与 `actions.test.ts:6`——三处都是 import 行，不是新增文件、不是改测试体。
> - 实施者自检（已核）：全仓 grep `fixedCostFen / `、`breakEvenUnitPriceFen =`、`perDogProfitFen =`、`isLoss: perDogProfitFen` 只命中 `channels.ts:37/38/39/50`，坐实三条算式只存在于核心函数内。
> - **保留的两处不一致（控制器裁定：不动）**：①核心函数收 `readonly ChannelInput[]`、包装层收 `ChannelInput[]`——核心更宽容是好事，且任务书就是这么写的；将来若 Task 18 从常量数组传进包装层不顺手，再单独改包装层签名。②`compareChannels` 里 `aliveCount` 会被调用两次（包装层一次、`batchPerDogCostFen` 内部一次）——纯函数无副作用，改它要碰 `costing.ts`，属 Task 16 的既成事实，不动。
> - **Task 18 的接线红线（由此任务的 JSDoc 钉住）**：「算」页面的渠道对照必须调 `compareChannelCosts`，**不得再造临时 `AppData`、不得造假狗**。若它被 import 了却仍走 `compareChannels`，空批次下 `aliveCount` 为 0 ⇒ `batchPerDogCostFen` 返回 0 ⇒ 保本价与固定成本静默变 0，用户的摊位费一分钱不起作用且不报错。review 时直接 grep 这个调用即可确认。

---

### Task 17: 「检」页面 + 底部导航接线

**Goal:** 让用户在一屏内看到「这批狗谁能卖、谁不能卖、为什么」。

**Files:**
- Create: `src/ui/pages/QuarantinePage.tsx`
- Modify: `src/ui/tabs.ts`（在 `TABS` 数组的「狗」与「钱」之间插入第 5 项「检」，`key: 'quarantine'`）
  - 注意：**不要改 `src/App.tsx`**。Task 8 实际实现时把标签注册表抽成了单一数组 `src/ui/tabs.ts`，`App.tsx` 从 `TABS` 里取当前页，加标签只动这一处。
  - `TabKey` 联合类型也要同步加上 `'quarantine'`，否则 `tabs.ts` 自己编译不过。
  - `src/ui/tabs.test.ts` 里断言标签数量/顺序的用例会因此变红，**改它**（新顺序：算 / 狗 / 检 / 钱 / 报）。
- **Modify: `src/domain/actions.ts`（只允许在文件末尾追加，已有函数一字不许动）+ `src/domain/actions.test.ts`**
  - **这是任务书原来漏掉的**：这一页要能改 6 个检疫字段，而全仓改 `AppData` 的唯一入口是 `src/domain/actions.ts`（界面不许自己拼新对象）。所以必须补一个 action，签名逐字如下：
    ```ts
    export interface DogQuarantinePatch {
      rabiesVaccinatedOn?: string | null
      antibodyTestedOn?: string | null
      antibodyReportNo?: string
      quarantineCertNo?: string
      quarantineCertIssuedOn?: string | null
      quarantineCertValidUntil?: string | null
    }

    /** 改某一只狗的检疫字段。只改传进来的键，其余字段与别的狗一律不动。找不到这只狗时原样返回。 */
    export function setDogQuarantine(data: AppData, dogId: string, patch: DogQuarantinePatch): AppData
    ```
  - 语义要求：①`patch` 里**没传的键**保持原值（`undefined` 不等于「清空」——清空要显式传 `null` 或 `''`）；②只改 `dogId` 那一只；③狗不存在时返回**同一个引用**（与 `markDogDead` 的守卫风格一致）；④不碰 `entries`、不碰 `batches`；⑤数组顺序不变。
  - 追加时保留第 2 行的 `import { newId } from './types'`（若本 action 用不到 `newId`，**不要**为了「看起来整洁」去删这一行——它是别的函数在用的）。
- 需要的子组件自行决定（例如 `src/ui/components/DogQuarantineCard.tsx`）

**Consumes:** `quarantineStatus` / `isSellable` / `preSaleChecklist` / `addDays`（`src/domain/quarantine.ts`，Task 15）；**`setDogQuarantine` / `DogQuarantinePatch`（`src/domain/actions.ts`，本任务自己补）**；`AppData` / `SALES_CHANNELS`（types.ts）；Task 8 建立的状态容器与保存入口。

**必须满足的行为:**

1. 页面顶部是批次选择器，默认选中**最近创建的批次**（`createdAt` 最大者）。没有批次时显示空状态：「先去「算」页面建一个批次。」
2. **每只在库的狗（`in_stock` / `returned`）一张卡片**（见 `## Global Constraints` 里「还在我们账上的狗（在库）」那一条）——已售与已死的狗不出现在这一页，它们没有当下阶段可言，摆在上面只会把「还要准备什么」这件事搅浑。卡片显示：编号、`status.label`、`status.nextAction`、`waiting_antibody` 时的「还要等 N 天」（用 `daysUntilTestable`）、检疫证明编号、证明有效期、以及 `certExpiresIn` 的天数（负值显示「已过期 N 天」）。`returned` 的狗额外打一个「退回」标记，让人知道它为什么又回到清单上。
   - **额外一条中性提示**（2026-10-03 裁定后的新增场景）：当 `dog.rabiesVaccinatedOn === null` **且** `status.stage === 'certified'` 时，卡上再显示一行灰字「接种日期未记录（不影响出售，但能补就补上）」。这只狗确实可以卖（证明就够了），提示只是让你知道台账少了一格。**判据写在界面侧，不要给 `QuarantineStatus` 加字段、不要改它的形状。**
3. 卡片默认**折叠**，只露出阶段标签 + 一个快捷动作按钮；展开后是 6 个字段的编辑表单：
   - `rabiesVaccinatedOn` / `antibodyTestedOn` / `quarantineCertIssuedOn` / `quarantineCertValidUntil`：`<input type="date">`
   - `antibodyReportNo` / `quarantineCertNo`：文本输入
   - 改动立刻写入 `AppData` 并走**已有的保存流程**（不要另建保存机制）
4. 快捷动作按钮按阶段给最省事的那个：
   - `unvaccinated` → 「今天已接种」：把 `rabiesVaccinatedOn` 设成今天
   - `ready_to_test` → 「今天已送检」：把 `antibodyTestedOn` 设成今天
   - `waiting_cert` → 「已有证明」：展开表单并聚焦 `quarantineCertNo`
   - 其余阶段不给快捷按钮
5. 页面底部是 `preSaleChecklist` 的结果。**清单与统计都只覆盖在库的狗（`in_stock` / `returned`），文案里要写明「在库」**，不要把已售/已死的狗算进分母：
   - 全部可卖 → 绿色确认块：「这批在库的 N 只全部具备有效检疫证明，可以出售。」
   - 有 blocked → 醒目警告块，标题「在库 N 只里有 M 只不能卖」，逐条列出狗编号 + 阶段原因，并固定附一句：「检疫证明与狗不一致（数量超出证明载明部分、种类不符、使用别人的证明）会被按『未经检疫』处理，罚款是货值的 15~30 倍。」
   - 在库一只都没有 → 「这一批目前没有在库的狗。」
6. **「今天」从哪来**：页面内部取一次当天并格式化成 `'YYYY-MM-DD'`。**这是 UI 层，允许用 `new Date()`；`domain/` 里不允许**（见 Global Constraints）。用已经写好并测过的 `todayLocalIso`（`src/ui/planForm.ts:47`，内部就是按本机时区拼的），**不要用 `toISOString()`**（按 UTC 算，晚上会差一天）。但这个页面**渲染时就需要 today**（每只狗的阶段判定要用），所以不能用「包成函数、只在处理器里调」的办法——`react(purity)` 会拦下渲染体里的 `new Date()` 和 `useMemo`，`useEffect` + `setToday` 又会被 `react(set-state-in-effect)` 拦下。**实测唯一能过门禁的写法是 `useState` 的惰性初始化**：
   ```ts
   import { useState } from 'react'
   import { todayLocalIso } from '../planForm'

   // 惰性初始化：只算一次，渲染期不调 new Date()。改成 useMemo 或 useEffect 都会让 lint 变红。
   const [today] = useState(() => todayLocalIso(new Date()))
   ```
7. 底部导航变成 **5 项：算 / 狗 / 检 / 钱 / 报**，顺序与设计文档 §4 的表一致。
8. 界面文案全中文。

**Steps:**
- [ ] **Step 0**：read `src/App.tsx` 与 Task 8/10 产出的页面，确认导航与状态容器的写法；read `src/domain/quarantine.ts` 确认实际签名。
- [ ] **Step 1**：实现页面与导航。
- [ ] **Step 2**：`npx vitest run`（`setDogQuarantine` 要有测试，所以**不再**是「不加测试」；其余应仍全绿）、`npm run build`、`npm run lint`。
- [ ] **Step 3**：`npm run dev` 手动验证（这是本任务的主要验收方式）：建一个批次 → 收 3 只狗 → 「检」页面应显示 3 只未接种 → 点「今天已接种」→ 变「等待抗体检测期」并显示还要等 N 天 → **把接种日期直接改成 30 天前**（注意：此时还没有设置面板——`SettingsPanel` 是 Task 13、设置校验是 Task 19，都在本任务之后。所以**不要**按原来的写法去「把设置里的等待天数改成 0」，界面上根本没有这个入口，去 IndexedDB 里改设置属于绕路）→ 变「可以送检」→ 点「今天已送检」→ 变「待申报检疫」→ 填证明编号与有效期 → 变「可出售」，底部变绿色确认块 → 把有效期改成昨天 → 变「检疫证明已过期」，底部警告块列出它。
      - 顺带验一条 2026-10-03 裁定后的行为：**把某只狗的接种日期清空、只留证明编号与未来的有效期** → 它应当**仍是「可出售」**，而不是跳回「未接种狂犬疫苗」（见「必须满足的行为」第 1 条的次序裁定）。
- [ ] **Step 4**：提交（**只能用显式路径**，禁止 `git add src` / `-A` / `.`）：
  ```bash
  git add src/ui/pages/QuarantinePage.tsx src/ui/tabs.ts src/ui/tabs.test.ts src/domain/actions.ts src/domain/actions.test.ts
  git commit -m "feat(ui): 检疫页面与出栏前检查清单"
  ```

> **Task 17 实施与验收记录（2026-10-03）**
> - 实际提交 **`d0de0a6`**（5 files / +482 / −3）。任务书里「默认选 `createdAt` 最大的批次」有误——`Batch` 上**没有 `createdAt` 字段**（`src/domain/types.ts:88-97`），实际实现为 `latestBatch(batches) = batches[batches.length - 1]`（`createBatch` 尾追写入）。**不按 `date` 排**：`date` 是这批狗的业务日期，同一天可建多批、也可给新批次填过去的日期，按它排会把刚建的批次藏起来。`src/ui/tabs.test.ts` 原本没有任何顺序断言（「检」插哪都全绿），已补 `expect(TABS.map(t => t.key)).toEqual(['calc','dogs','quarantine','money','report'])`。
> - 「默认折叠」的口径定为：**只折叠编辑表单；只读信息（证明编号、有效期、到期天数、中性提示）全部露出来**——否则「已过期 N 天」这种最该被看见的信息要展开才看得到。
> - 控制器用真实 Edge + CDP 走查 **59/59 PASS**（真实时间 + 真实 IndexedDB，0 条未捕获异常、0 条 `console.error`），除任务书 Step 3 外还覆盖：有效期**正好是今天**判「可出售」（边界是 `<` 不是 `<=`）、清空有效期后按「有无接种日期」分别回到「待申报检疫」/「未接种狂犬疫苗」、`sold` 的狗从页面消失且分母变「在库 2 只里有」、`returned` 的狗保留并带「· 退回的狗」且计入分母、切换批次互不串味、重载后不卡在「正在载入」。探针在 `C:\Users\17928\AppData\Local\Temp\dogledger-t17.mjs`，可复跑（注意它给的断言失败先怀疑探针自己）。
> - **Task 17b（提交 `3210afb`）**：把本任务留在页面里、没有单测的纯函数抽到 **`src/ui/quarantineView.ts`**（与 `src/ui/dogLedger.ts` / `src/ui/moneyBook.ts` 同一套路），新增 `src/ui/quarantineView.test.ts` 25 个用例（309 → 334 passed），页面改为 import。导出：`latestBatch(batches)`、`pickBatch(batches, selectedId)`（按 id 找，找不到或为 `null` 回落 `latestBatch`）、`interface QuickAction { text: string; patch?: DogQuarantinePatch; focusCert?: boolean }`、`quickAction(stage, today)`（六阶段穷尽 `switch`，**无 `default`**）、`expiresText(days)`、`needsVaccinationDateHint(dog, stage)`。抽完**重跑同一份探针仍 59/59 PASS**，证明渲染层零变化。
> - **待办（不是缺陷，交给 Task 12 / Task 20 的批次管理）**：批次名自动生成的永远是 `收狗 N 只`，狗号是 `` `${batchName}-${i}` ``（`src/domain/planning.ts:105`），所以同一天建两个**只数相同**的批次，会在批次下拉里显示成**两条一模一样的选项**（名字与日期都相同，id 不同），狗号也会跨批次重名。身份是安全的（`id` 唯一），「检」页按批次分开显示，当前算不出错账；但 Task 12/20 应当允许用户改批次名，或让自动名带上唯一成分。

---

### Task 18: 渠道对照接进「算」页面与批次详情

**Goal:** 出门看狗之前能顺便回答「这批走哪条路更划算」。

**Files:**
- Create: `src/ui/channelView.ts`（渠道 id → 中文名、存活数默认值等纯函数）
- Create: `src/ui/channelView.test.ts`
- Modify: `src/ui/pages/CalculatePage.tsx`（加渠道对照区块 + 「存为批次」写入选中渠道）
- Modify: `src/ui/pages/DogsPage.tsx`（批次详情：把英文 id 改成中文名 + 可改的下拉）

**前提：Task 16b 必须先做完并提交。** 本任务要用到它的 `compareChannelCosts` 与 `setBatchChannel`；没有这两个函数，行为 5 与行为 7 都写不出来（而且按原来的写法会算出错的数——见下面的审计第 6 条）。

> **Task 18 派发前审计（2026-10-03，控制器核对了实际代码）**——**七处**计划书与实际不符（第 5–7 条是同日的二次审计补的，其中第 7 条**推翻了原来的行为 5**），动手时以实际代码为准：
> 1. **本仓没有单独的「批次详情页」**。`src/ui/pages/` 下只有 `CalculatePage.tsx` / `DogsPage.tsx` / `MoneyPage.tsx` / `QuarantinePage.tsx` / `ReportPage.tsx`；批次列表与批次详情是 `src/ui/pages/DogsPage.tsx`（475 行）同一个文件里的两个视图（它有内部状态在列表与详情之间切换，`DogsPage.tsx:145` 附近有「批次被删掉时退回列表」的处理）。所以「批次详情页」= `src/ui/pages/DogsPage.tsx`。
> 2. **`plannedChannel` 已经在批次详情里显示了，但显示的是英文 id**：`src/ui/pages/DogsPage.tsx:171` 是 `{batch.date} · 去向：{batch.plannedChannel === 'undecided' ? '未定' : batch.plannedChannel}`——用户会看到 `去向：pet_shop`。**这是现存缺陷，本任务必须顺手修掉**：改走 `SALES_CHANNELS` 查中文名（`undecided` 仍显示「未定」），并把它做成可改的下拉（本任务行为 7）。
> 3. **原来行为 5 里那个临时 `AppData` 的字面量字段名是错的，但整条写法现已作废**（理由见第 7 条）——`AppData` 的形状是 `{ version: 1, settings: Settings, batches: Batch[], dogs: Dog[], entries: LedgerEntry[] }`（`src/domain/types.ts`），**没有 `ledger` 字段**。这条留着只为记住这个形状；本任务**不要**构造临时 `AppData`。
> 4. 「一键建批次」的调用处就在 `src/ui/pages/CalculatePage.tsx` 里（`handleCreateBatch`），不是第三个文件。`createBatchFromPlan` 的签名是 `createBatchFromPlan(data: AppData, input: PlanInput, batchName: string, date: string, plannedChannel?: ChannelId): AppData`（`src/domain/planning.ts:83` 起，省略时用 `'undecided'`）。
> 5. **`SALES_CHANNELS` 目前完全不在生产包里——本任务会是第一个真正 import 它的应用代码。** 控制器实测（提交 `71a0b49` 后 `npm run build`）：`dist/assets/index-CgNq0k06.js` 里搜不到 `犬只交易市场`、搜不到 `宠物店`、搜不到 `compareChannels`；唯一命中的是 `未定`（来自别处的 `plannedChannel` 文案）。原因不是打包器丢字段，而是**全仓没有任何应用代码引用它**（`channels.ts:2` 只有 `channels.test.ts` 这条测试链引用，`types.test.ts` 也是测试），所以整份常量被 tree-shake 掉了。**后果**：接线之后**必须重新 build 并在真实浏览器里确认 8 条渠道的中文名与 `note` 真的显示出来了**——单测跑的是源码，能过；生产包里是不是真有这些字符串，只有看构建产物或真机才知道。这也是为什么 Task 18 的走查不能只跑 `npx vitest run`。**给自己留一条证据**：接线后跑 `Select-String -Path dist/assets/*.js -Pattern '犬只交易市场' -SimpleMatch`，应当能搜到；报告里贴出来。
> 6. **`src/domain/actions.ts` 里没有任何能改 `Batch` 字段的动作，`channelName` 也不存在**——这两样由 **Task 16b** 提供（`setBatchChannel`）和本任务提供（`src/ui/channelView.ts`）。**本任务不要自己去 `actions.ts` 里加动作**（Task 16b 已经加了，重复加会撞车）。
> 7. **⚠️ 上面行为 5 原来写的「造一个临时 `AppData` 再调 `compareChannels`」是错的，已作废，不要照做。** 临时批次里没有狗 ⇒ `aliveCount` 为 0 ⇒ `batchPerDogCostFen` 走 `alive === 0` 分支返回 0（`src/domain/costing.ts:51`）⇒ 底价恒为 0、`fixedPerDogFen` 恒为 0，**摊位费填多少都不影响结果且不报错**。正确的做法见下面重写后的行为 5。

> **📌 犬市「进出场记录」——已拍板（2026-10-03 用户决定，同日已实现，提交 `71a0b49`）**
> 规程 **4．1．3** 逐字：「已经取得产地检疫证明的犬，从**专门经营动物的集贸市场**继续出售或运输的，或者展示、演出、比赛后需要继续运输的，提供检疫申报单、**原始检疫证明和完整进出场记录**。」
> **含义**：走犬市这条路，狗只要是在集贸市场里转手的，就**必须能拿出「进出场记录」**——不是只有一张证明的照片。本工具的批次模型里**没有放「进出场记录」的地方**（`Batch` 只有 `id`/`name`/`date`/`source`/`note`/`status`/`plannedChannel`，`Dog` 的检疫字段只有 6 个证明类字段）。
> **用户的选择（三个选项里的第一个）**：**只在渠道说明里补一句**，不动数据结构、不加字段。理由是不值得为一个还没决定要不要走的渠道先加一个空字段。
> **已实现**：`src/domain/types.ts:40` 的 `dog_market` 那条 `note` 由「摊位费按次摊；城区是否禁活体交易必须先本地核实。」改为「摊位费按次摊；城区是否禁活体交易必须先本地核实。**从市场转手时要能拿出原始检疫证明和完整进出场记录（《犬产地检疫规程》4.1.3）。**」`SalesChannelDef.note` 的注释本来就是「这条渠道特有的成本或风险，显示在渠道对照表里」，语义对得上。`types.test.ts:58` 的 `expect(c.note.length).toBeGreaterThan(0)` 仍然通过。
> **仍然没有做的事**：没有给 `Dog`/`Batch` 加「进出场记录编号」字段，没有在用户选「犬市」时弹提示。**若将来真走犬市**，`Batch.note` 是唯一能写的地方（自由文本，软件不会提醒）——那时再开新任务加字段。
> 依据：`docs/compliance/2026-10-02-犬只交易合规要点-法规篇.md` §2.9 的逐字原文。

**Consumes:** `compareChannelCosts` / `ChannelInput` / `ChannelBreakdown`（`src/domain/channels.ts`，**Task 16b**）；`setBatchChannel`（`src/domain/actions.ts`，**Task 16b**）；`plan` / `PlanResult`（`src/domain/planning.ts`，`plan()` 返回的 `totalCost` / `expectedAlive` / `breakEvenPriceFen` 就是渠道对照要用的「每只存活成本」与「存活只数」）；`SALES_CHANNELS` / `ChannelId`（types.ts）；`formatMoney` / `fenToYuan` / `parseMoney`（`src/domain/money.ts`）；`Field`（`src/ui/components/Field.tsx`）。

**必须满足的行为:**

1. 「算」页面在保本价结果**下方**加一个**默认折叠**的「渠道对照」区块，标题旁一句：「同一批狗，走不同的路，最低可卖价不一样。」
2. 展开后，对 `SALES_CHANNELS` 里除 `undecided` 外的 **8 条渠道**各一行，每行三个输入：**预期单价** / **每只额外成本** / **该渠道固定成本**（都走 `parseMoney`，留空按 0），并**每行一个单选**用来选「这批走哪条路」。另外在表格上方单独给一个 **`未定` 单选并默认选中**（`undecided` 不在那 8 行里，但行为 6 需要一个「还没定」的选项），旁边写明：「还没定就选这个，存批次时去向记『未定』。」
3. 每行实时显示 **保本单价** 与 **每只利润**。`isLoss` 为 true 的行标红并写「亏」，否则标绿。
4. 区块顶部有**存活数**输入，**默认值取自 `plan()` 结果的 `expectedAlive` 向上取整**（`Math.ceil(result.expectedAlive)`，`plan()` 里它已经是 `Math.max(1, n × (1 − mortalityRate))`，见 `src/domain/planning.ts:52`），这个数字要能手动改，因为它决定固定成本摊到几只上。**不要再写一遍 `count × (1 − mortalityRate)`**——那个式子已经在 `plan()` 里，界面里出现第二遍就是第二套公式。存活数输入**允许小数**吗？**不允许**——它是「几只狗」，用整数输入并在界面上取整；但传给 `compareChannelCosts` 的值就是用户填的那个数，**界面不要替它做任何额外的取整或夹取**（`compareChannelCosts` 允许小数，见 Task 16b 行为 7）。
5. 渠道对照**必须调用 `compareChannelCosts`**：
   ```ts
   compareChannelCosts(result.breakEvenPriceFen, aliveInput, channelInputs)
   ```
   第一条参数用 `plan()` 已经算好的保本价——**它就是「每只存活狗的底价」**（`planning.ts:54`：`breakEvenPriceFen = totalCost / expectedAlive`），与决策台显示的那个数是同一个数，**不许再算一遍**。界面里不得出现 `base + extra + fixed / n` 这类自己算的式子，也不得自己去数狗、不得造临时 `AppData`、不得造假狗。**成本只能有一处算法。**
6. 「一键存为批次」时，把用户在渠道对照里**选中的那一条**（默认 `undecided`）作为第 5 个参数传给 `createBatchFromPlan(data, input, batchName, date, plannedChannel)`（签名见 `src/domain/planning.ts:78-84`，第 5 参可选、省略时用 `'undecided'`）。
7. 批次详情里把 `去向：{...}` 改成中文名 + 可改的下拉：**现在 `src/ui/pages/DogsPage.tsx:171` 显示的是英文 id**（`{batch.plannedChannel === 'undecided' ? '未定' : batch.plannedChannel}` ⇒ 用户看到 `去向：pet_shop`），**这是现存缺陷，本任务必须修掉**。下拉选项来自 `SALES_CHANNELS`（含 `undecided`），中文名经 `src/ui/channelView.ts` 的 `channelName()` 取，改完立刻 `setBatchChannel(data, batch.id, 选中的值)` 保存。
8. 金额显示一律走 `formatMoney`（只在界面边界四舍五入）。
9. 界面文案全中文。
10. `src/ui/channelView.ts` 只放纯函数、**不 import React**，至少两个：
    ```ts
    /** 渠道 id → 中文名。查不到时原样返回 id 本身（旧备份里可能有未知渠道）。 */
    export function channelName(id: string): string
    /** 渠道对照里「存活数」输入框的默认值：预估存活数向上取整，至少 1。 */
    export function defaultAliveInput(expectedAlive: number): number
    ```
    `channelName('undecided')` 必须是 `'未定'`，`channelName('pet_shop')` 必须是 `'宠物店 / 宠物医院'`，`channelName('taobao_live')` 必须回落成 `'taobao_live'`（不抛错、不空白）。`defaultAliveInput(6.8)` → `7`、`defaultAliveInput(0.4)` → `1`、`defaultAliveInput(0)` → `1`。

**测试要求**：`src/ui/channelView.test.ts` 覆盖行为 10 列出的每一个断言（含未知渠道回落与 `Math.ceil` 的边界）。渠道对照与批次详情的**界面行为**由控制器的真实浏览器走查负责，本任务不要求为页面写组件测试（仓里没有测试库，也不引入）。测试一律显式 `import { describe, it, expect } from 'vitest'`。

**Steps:**
- [ ] **Step 0**：read `src/ui/pages/CalculatePage.tsx`（165 行）与 `src/ui/pages/DogsPage.tsx`（475 行，批次详情在详情视图里，`:171` 是要改的那行），确认现有 `input` useMemo、`result`（`plan()` 的返回值）与 `handleCreateBatch` 的调用链；read `src/domain/channels.ts` 确认 Task 16b 之后的 `compareChannelCosts` 签名。
- [ ] **Step 1**：先写 `src/ui/channelView.ts` + `channelView.test.ts`（TDD：先测试后实现）。
- [ ] **Step 2**：实现「算」页面的渠道对照区块（行为 1–6）。
- [ ] **Step 3**：改批次详情（行为 7）。
- [ ] **Step 4**：`npx vitest run` / `npm run build` / `npm run lint`，然后**额外跑一次**：`Select-String -Path dist/assets/*.js -Pattern '犬只交易市场' -SimpleMatch` 与 `-Pattern '宠物店'`，把结果贴进报告（见审计第 5 条）。
- [ ] **Step 5**：（不用 `npm run dev`；控制器的真实浏览器走查会验界面。）
- [ ] **Step 6**：提交：
  ```bash
  git add src/ui/channelView.ts src/ui/channelView.test.ts src/ui/pages/CalculatePage.tsx src/ui/pages/DogsPage.tsx
  git commit -m "feat(ui): 渠道对照与批次计划去向"
  ```
  （**不许写 `git add src`**——这个仓里同时可能有人在改别的文件，已经因此误提交过一次。）

> **Task 18 实施记录（2026-10-03，控制器复核）**
> 提交 `9cf9ebbe5dc8708da37fc2f5c7872e44db80b0e5 feat(ui): 渠道对照与批次计划去向`，4 files / +575 / −8：新建 `src/ui/channelView.ts`(136) + `channelView.test.ts`(225)，`src/ui/pages/CalculatePage.tsx` 165 → **354** 行、`src/ui/pages/DogsPage.tsx` 475 → **492** 行。门禁：`Test Files 20 passed (20)` / `Tests 462 passed (462)`（+32，其余 19 个文件一个没变）、`✓ 46 modules`（原 44）、`index-3hsx8LGw.js` 284.94 kB（原 277.30，+7.64 kB 就是 9 条渠道 name+note）、lint 0/0 on 56 files。TDD 红态 `Cannot find module './channelView'`。
> **tree-shaking 取证成立**：接线前 `SALES_CHANNELS` **完全不在生产包里**（改 `types.ts` 的 note 后产物字节不变），接线后两条 `Select-String` 都命中 `index-3hsx8LGw.js:9` —— 单测跑源码能过，生产包却可能是空白的，这个坑只有 grep 产物才能发现。
> 接受 11 处偏离（3 列表格、标签缩短、「没填过」= 全 0、`channelOptions` 补未知渠道第 10 项、`parseChannelRow` 区分「留空」与「填错」、多导出 7 个都有测试的纯函数、存活数不取整、`bg-red-50` 只给亏损行、区块位置紧贴建批次按钮、`<p>` 换 `<div>`、两条 grep 真跑了）。
> 控制器裁定 5 条（原报告第 7 节）：`parseAliveInput('')` **必须**返回 `null` 而不是 0（见 Task 18b）；折叠标题行**必须**常显已选去向；未知渠道可选可改**保持**；负数判 `invalid` **保持**；「8 行全 0 看起来像真的」**暂不加提示**（脚注已写明底价与摊薄方式）。
> ⚠️ 本节上面那些「475 行 / 165 行 / `:171`」是**派发时**的状态，Task 18 自己把它们改掉了；回读这一段时不要拿旧行号去对现在的文件。

> **Task 18b 实施记录（2026-10-03，控制器派发的两条必改）**
> 提交 `d4ae9527c9f7b4ce95b640ff5626936478477181 fix(ui): 清空存活数不再静默按 0 算；折叠时也显示已选去向`，3 files / +24 / −7。
> 1. `src/ui/channelView.ts:137` `parseAliveInput` 的空串分支 `return 0` → `return null`（`'0'` 仍是合法整数）。**理由**：用户清空输入框可能只是想重打一个字，按「0 只存活」算会让 `fixedPerDogFen = 0` ⇒ 保本价偏低且不报错不标红，正是 Task 16b 拆出这一层要消灭的那类静默错数；「空输入框」不等于「0 只存活」。
> 2. `src/ui/pages/CalculatePage.tsx:226-228` 折叠标题行右侧常显 `去向：{channelName(selectedChannel)}`（在折叠 `<button>` 内部，两种状态都在）——否则那个按钮会带着用户看不见的去向建批次。
> 门禁：`Test Files 20 passed (20)` / `Tests 464 passed (464)`（基线 462，+2）、`✓ 46 modules`、`index-Bk4Oy2cJ.js` 285.08 kB、lint 0/0 on 56 files、两条 `Select-String` 仍命中。TDD 红态 `expected +0 to be null` ×2。
> **控制器真实浏览器走查：`64/64 PASS`、`Runtime.exceptionThrown: 0`、`console.error: 0`**（探针 `C:\Users\17928\AppData\Local\Temp\dogledger-t18.mjs`，`--remote-debugging-port=9349`、`--headless=new`、真实时间 + 真实 IndexedDB，`vite preview --port 5199`）。关键几条：全新账本上**给犬市那行填 300 元摊位费 → 保本价 ¥905.88 → ¥948.74、固定成本每只摊 ¥42.86、该行标红写「亏」，而宠物店那行纹丝不动 ¥905.88**（这就是「摊位费必须真的影响结果」的硬断言，也正是 Task 16b 要修的那条静默失效路）；存活数 1 → 每只摊 ¥300.00、保本 ¥1,205.88；★清空存活数 → 红字 + 表格消失 + **不再有任何保本价数字**；填 0 → 合法、每只摊 ¥0、保本回 ¥905.88；`6.8` → 拒绝；`abc`/负数/全角 → 该行「这不像数字」+「—」而其它行照常；`1,200` 认成 ¥1,200.00；折叠标题行显示 `去向：宠物店 / 宠物医院`；建成批次后 `plannedChannel === 'pet_shop'`、成功文案用中文名；「狗」页详情下拉显示中文、9 项、**不再把 `pet_shop` 这种英文 id 当显示文本**；改成 `dog_market` 立刻写库、刷新后仍在；用旧备份造未知渠道 `taobao_live` → 原样保留 + 显示「taobao_live（未知渠道）」+ 补成第 10 项。
> 首轮 61/64 的 3 条失败全是**探针自己写错**（同类第 7 次）：`await ev('window.__T.chSelect()')` 把 DOM 节点按值返回触发 CDP `Object reference chain is too long`；`formatMoney(30000)` 是 `¥300` 不是 `¥300.00`（会去掉尾零）；`nav()` 没剥掉标签里的 emoji，真实文本是 `🧮算`。**教训不变：断言失败先核探针自己的取值方式与字符串。**
> Task 18b 报的两点留作 parked（**不是缺陷**）：存活数非法时整张表连同已填的渠道金额一起消失（数据在 state 里没丢，红字说明了原因，改成「只置灰不算数」要动表格渲染结构）；金额格的空格 = 0、存活数格的空格 = 报错（语义相反但各自正确：成本可以是 0，「0 只存活」是另一回事）。另：`selectedChannel` 与渠道金额在切标签后不保留（「算」页本来就是草稿纸，持久化的正是「一键存为批次」）。
> **一致性佐证**：改完之后 `parseAliveInput` 的空串处理与 `src/ui/planForm.ts:102` 的 `parseMortalityPercent` 完全相同 ⇒「空 = null（界面报错）」本来就是本仓「只数 / 比例」字段的既有约定，`parseAliveInput` 之前是这条约定里的例外。**日后新加数值字段照 `planForm.ts` 这两条写。**

---

### Task 19: 设置面板补两个检疫天数 + 校验

**Goal:** `rabiesWaitDays` 与 `quarantineLeadDays` 必须能在界面上改——后者的默认 3 是法定的；**前者的默认 21 查不到官方出处，只是一个占位值**，本地实际要求不同时必须能改。

**Files:**
- Modify: `src/domain/settlement.ts`（`validateSettings` 加两个字段的校验）
- Modify: `src/domain/settlement.test.ts`（加对应测试）
- Modify: `src/ui/settingsForm.ts`（新增 `'days'` 这一种输入）
- Modify: `src/ui/settingsForm.test.ts`
- Modify: `src/ui/pages/SettingsPanel.tsx`（两个输入框）

**Consumes:** `Settings` / `DEFAULT_SETTINGS`（types.ts）；`validateSettings`（`src/domain/settlement.ts`，Task 5）；Task 13 已有的表单组件 `Field`。

**必须满足的行为:**

1. `validateSettings` 新增两条：
   ```ts
   if (!(settings.rabiesWaitDays >= 0)) return '狂犬免疫后等待天数不能为负'
   if (!(settings.quarantineLeadDays >= 0)) return '检疫申报提前天数不能为负'
   ```
   两条都要能拦住 `-1` **与 `NaN`**。注意现有校验的写法风格是 `!(x >= 0)` 而不是 `x < 0`（`NaN` 会被前者拦下）——**保持一致**。
2. 设置面板加两个数字输入：「狂犬免疫后等待天数」（默认 21）、「申报检疫提前天数」（默认 3）。**位置：放在「默认每只病死犬处理费」之后、`<h3>成本项</h3>` 之前**（都在「目标与预估」那一组里）。各自下面一句说明：
   - 天数一：「免疫后要满这个天数才能采血/申报。**默认 21 不是法定天数**——查过《犬产地检疫规程》与《狂犬病防治技术规范》两份原文，都只写『在有效保护期内』『每年加强免疫一次』，没有具体天数。**以给你做抗体检测的实验室和当地动物卫生监督机构的答复为准**，问清了就改成真值。」
   - 天数二：「出售前要提前这么多天申报检疫（《动物检疫管理办法》第八条第二款是三天，《犬产地检疫规程》4.1 也是三天）。」
3. 两个输入留空或非法时**不得写入 `AppData`**（走已有输入组件的"解析失败即不保存"模式），并给一句提示。
4. 改完保存后，「检」页面的阶段判定立刻反映新值（不需要重启）。
5. 界面文案全中文。

**Steps:**
- [ ] **Step 0**：read `src/domain/settlement.ts` 与 `src/domain/settlement.test.ts`，确认 `validateSettings` 现有条目与测试风格；read `src/ui/pages/SettingsPanel.tsx`。
- [ ] **Step 1**：先给 `settlement.test.ts` 加两个负数用例（TDD）→ 运行应失败。
- [ ] **Step 2**：改 `validateSettings` 直到通过 → `npx vitest run src/domain/settlement.test.ts`。
- [ ] **Step 3**：改设置面板。
- [ ] **Step 4**：`npx vitest run` / `npm run build` / `npm run lint` / `git status --short`。
- [ ] **Step 5**：（不用 `npm run dev`；控制器的真实浏览器走查会验行为 4。）
- [ ] **Step 6**：提交：
  ```bash
  git add src/domain/settlement.ts src/domain/settlement.test.ts src/ui/settingsForm.ts src/ui/settingsForm.test.ts src/ui/pages/SettingsPanel.tsx
  git commit -m "feat(ui): 设置面板补检疫天数并校验"
  ```
  （**不许写 `git add src`**——这个仓里同时可能有人在改别的文件。）

> **Task 19 派发前审计（2026-10-03，控制器核对了实际代码；2026-10-03 二次修订，因为 Task 13 改了面板的写法）**
> - `validateSettings`（`src/domain/settlement.ts:51-62`）**已经**有 `quarantinePerDog` 与 `disposalPerDog` 两条（第 59、60 行，合规修订时加的），所以本任务只追加两条新的是对的，**不要去改那两条**。现有 6 条的写法与顺序：合伙人非空 → 分成和 = 1 → `targetMarginRate` → `expectedMortalityRate`（注意它是 `>= 0 && < 1`，不是 `>= 0`）→ `quarantinePerDog` → `disposalPerDog`。新两条追加在**末尾**。
> - **这个函数是「遇到第一个错就 return」**，所以两条新校验排在末尾意味着：分成比例填错时用户看不到「天数不能是负数」的提示。这是既有风格，本任务**不要**改成收集全部错误——那会连带改动 Task 5 已验收的行为与它的 9 个测试。
> - **⚠️ 原审计里那条「照抄 `targetMarginRate` / `expectedMortalityRate` 的 `if (v.trim() === '') return` 写法」已经过期。** Task 13 把「设置」面板的 6 个输入框全部改成了**本地草稿**制（见 Task 13 实施记录），现在 `目标毛利率` 那一段是 `setMarginDraft(v)` + `applyPercentInput(v)` + `ratio === null` 就不写账。两个新输入框**必须沿用同一套**：往 `src/ui/settingsForm.ts` 里加第三种（第四种）输入类型 `'days'`——
>   ```ts
>   /** 天数的解析与显示。空串、非数字、负数、非整数都不收。 */
>   export function applyDaysInput(raw: string): { draft: string; days: number | null }
>   ```
>   规则：trim 后空串 → `{ draft: raw, days: null }`；不是有限数 → 同上；负数 → 同上；**不是整数（如 `21.5`）→ 同上**（理由：`addDays`/`setUTCDate` 收小数日的行为不直观，第 21.5 天没有意义，与其悄悄截断不如让人看见自己填错了；这条与 Task 13b 确立的「拒绝，不夹取」一致）；否则 `{ draft: raw, days: n }`。**`draft` 永远原样保留**（这样打 `2` 再打 `1` 的中间态不会被改写）。
>   `inputError` 加一个 `case 'days'`：非数字 → `'天数要填一个数字，例如 21'`；负数 → `'天数不能是负数'`；非整数 → `'天数要填整数，例如 21'`；空串 → `undefined`。
> - **两个天数各自独立一份草稿**（`rabiesWaitDaysDraft` / `quarantineLeadDaysDraft`），和 Task 13 那六个一样用 `useState<string | null>(null)`，`null` 表示没碰过、显示账上值。
> - **`Number('') === 0` 这个坑现在由 `applyDaysInput` 的结构挡掉**（空串直接返回 `days: null`），但**必须有一条测试钉住它**：`applyDaysInput('')` → `{ draft: '', days: null }`。用户在「狂犬免疫后等待天数」里把 `21` 清空时，如果空串被当成 0，等待天数会被**静默写成 0**，后果是「检」页面立刻把刚接种的狗判成「可以送检」——**用户会拿着还没到免疫期的狗去申报检疫**。
> - 行为 4（「改完保存后「检」页面的阶段判定立刻反映新值」）**不需要额外订阅或刷新代码**：`useAppData` 的 `update` 写进同一个 context，两个页面读的是同一份 `data.settings`。控制器的浏览器走查会验它。
> - **不要碰 `src/App.tsx`、`src/domain/quarantine.ts`、`src/domain/types.ts`。** `validateSettings` 的返回类型是 `string | null`，两条新校验的文案必须**逐字**是 `'狂犬免疫后等待天数不能为负'` 与 `'检疫申报提前天数不能为负'`。
> - 提交用 5 个显式路径（见 Step 6）。

> **Task 19 实施记录（2026-10-04，实施者 `600058ed`，`DONE`）**
> - 提交 **`dca0b39 feat(ui): 设置面板补检疫天数并校验`**，5 files / +151 / −5，父提交 `b1df13b`。门禁：`Test Files 18 passed (18)` / `Tests 402 passed (402)`（基线 390，净 +12：settlement +4、settingsForm +8）；`tsc -b` 无输出 + `✓ 44 modules transformed`（277.27 kB / gzip 84.41 kB）；`Found 0 warnings and 0 errors.`（52 files / 116 rules）；`git status --short` 空。
> - TDD 红态：`src/domain/settlement.test.ts` 先 `Tests 3 failed | 10 passed (13)` 全部 `expected null to be '狂犬免疫后等待天数不能为负'`；`src/ui/settingsForm.test.ts` 先 `Tests 8 failed | 26 passed (34)`（`TypeError: applyDaysInput is not a function` ×6）。
> - 落点：`src/domain/settlement.ts:63-64`（第 62 行 `return null` 之前，现有 6 条一字未动）；`src/domain/settlement.test.ts:99-118`（两个 −1、两个 `NaN`、0 合法）；`src/ui/settingsForm.ts:18`（`InputKind` 加 `'days'`）、`:74-78`（`applyDaysInput`）、`:102-108`（穷尽 `case 'days'`）；`src/ui/settingsForm.test.ts:117-152` + `:167-181`；`src/ui/pages/SettingsPanel.tsx:7` / `:32-33`（两份独立草稿）/ `:155-192`（`<h3>检疫天数</h3>` 一组，位于「默认每只病死犬处理费」之后、`<h3>成本项</h3>` 之前）。
> - **唯一偏离已裁定：`inputError('days', '-1')` 的文案用 `'天数不能是负数'`（本审计 blockquote 的版本），不是派发 brief 正文里的 `'天数不能为负'`。** 实施者按「整段 blockquote 是硬性要求」选择，且它与既有 `'金额不能是负数，还不知道就填 0'` 风格一致 —— **保留 `'天数不能是负数'`**，本文档第 4307 行原先那处引用也已同步改掉。
> - **`applyDaysInput('2.')` → `{ draft: '2.', days: 2 }`（写账 2），这是文档化行为不是缺陷**：`Number('2.')` 就是有限整数 2，整数字段不存在「小数点没打完」这个中间态（与 Task 13b 里 `12.` 对**百分比**字段的处理不同——那里是合法的中间态）。`21.5` / `0.5` / `-1` / `''` / `abc` / `1e999` 全部被拒且不写账。实施者最初把 `'2.'` 当成「打到一半」写进测试并跑红，核对后**改的是测试不是实现**，理由写在 `src/ui/settingsForm.test.ts:145-148` 的注释里。
> - **Task 19 真实浏览器走查：`72/72 PASS`、`Runtime.exceptionThrown: 0`、`console.error: 0`。** 探针 `C:\Users\17928\AppData\Local\Temp\dogledger-t19.mjs`（`PORT = 9347`、`--headless=new`、真实时间 + 真实 IndexedDB；沿用既有模式 `spawn(EDGE, [...], { stdio: 'ignore' })`）。本轮**新增「播种」手法**（对写页面流程不便到达的状态很有用）：全新 profile 下启动 → 断言 `hasRecord() === false` → 直接用 `indexedDB.open('dog-ledger', 1)` 往 `appdata`/`singleton` 写一份完整 `AppData`（1 个批次 + 3 只狗：`d1` 今天接种、`d2` 21 天前接种且今天已检测、`d3` 有证明有效期 +30 天）→ `Page.reload` → 走查。
> - 走通：设置块的小节恰好是 `['目标与预估','检疫天数','成本项']`；两个新框 `inputMode="numeric"`、后缀 `天`、值 `21`/`3`，**DOM 顺序夹在「默认每只病死犬处理费」与「成本项」之间**；等待天数说明含「默认 21 不是法定天数」与《犬产地检疫规程》，提前天数说明含《动物检疫管理办法》第八条第二款 +《犬产地检疫规程》4.1；「检」页基线 `d1` 等待抗体检测期 + 还要等 21 天、`d2` 待申报检疫 + 提前 3 天、`d3` 可出售、清单「在库 3 只里有 2 只不能卖」；**等待天数改 `0` → `d1` 立刻变「可以送检」且不再显示「还要等 N 天」**（不刷新不重启）；改回 21 恢复；**清空 → 框里空串、无红字、框不标红底、库里 `rabiesWaitDays` 仍是 21**（★ 本任务要防的那个坑，实测没被写成 0），「检」页仍是「还要等 21 天」；`abc`/`21.5`/`-1`/`0.5` 四种各出专属红字 + 标红底 + **框里原样保留** + **库里一字未写**；`2.` 无红字并按 2 写账；清空提前天数**不影响等待天数那个框**（独立草稿），且不写账；提前天数改 5 → **「检」页 `d2` 立刻变成「提前 5 天向当地动物卫生监督机构申报」**（行为 4 的实时联动成立），改回 3 后阶段标签不受影响；reload 后两个天数、3 只狗、1 个批次全在，不卡「正在载入」。
> - 本轮唯一 FAIL 又是**探针自己的断言位置写错**（同类第 6 次）：把「框里原样保留 abc」的断言写在了 `for` 循环**外面**，那时循环最后一轮已把框设成 `0.5`，所以拿到的是 `"0.5"` 而不是 `"abc"`。改成在循环内逐次断言后 `72/72`。**教训同前：探针断言失败时先核探针自己的过滤条件、取值时机与算术。**
> - 遗留（接受，均非缺陷）：`applyPercentInput('12.')` 会立刻写账 0.12 而 `applyDaysInput('2.')` 会立刻写账 2，两者对**尾点**的处理不同——百分比字段的 `12.` 是合法中间态（Task 13b 已裁定接受红字闪一下），整数字段没有这个状态，**故意不动**。

---

### Task 20: 「报」页的成本结构与死亡率趋势

**为什么有这一组任务**：设计文档 §4 的「报」页明确列了「成本结构」与「死亡率趋势」，但 Task 12 只做了分账、对账单图片、批次盈亏排行榜与备份导出。这两项本来就该在「报」页——用户要回答的是「钱到底花在哪了」和「我这批狗是不是死太多了」。控制器在派发前审计时发现**全计划没有任何任务实现它们**，所以补上。**不要把它们塞进 Task 12**，那个任务已经够大。

**Files:**
- Create: `src/domain/stats.ts`
- Test: `src/domain/stats.test.ts`
- Modify: `src/ui/pages/ReportPage.tsx`（**插在排行块的 `)}`（`src/ui/pages/ReportPage.tsx:179`）与 `<SettingsPanel />`（`:181`）之间**；Task 14 把备份面板接在 `<SettingsPanel />` 之后，两处不冲突。注意行为 6 是**两节**）

**Interfaces:**
- Consumes: `AppData`、`LedgerEntry`、`Money`（`src/domain/types.ts`）；`dogsOfBatch`（`src/domain/costing.ts`）
- Produces（`src/domain/stats.ts`，全部为纯函数）：
  - `interface CostShare { category: string; name: string; totalFen: Money; share: number }`
  - `costBreakdown(data: AppData): CostShare[]`
  - `interface MortalityPoint { batchId: string; name: string; date: string; rate: number; dead: number; total: number; deltaFromPrevious: number | null }`
  - `mortalityTrend(data: AppData): MortalityPoint[]`

**必须满足的行为：**
1. `costBreakdown` **只统计 `type === 'expense'` 的流水**（不要把 `income` 算进去），按 `category` 汇总，返回数组按 `totalFen` **降序**；`share = totalFen / 所有支出之和`；**支出总额为 0 时所有 `share` 都是 0，绝不许出现 NaN**。
2. `name` 从 `data.settings.costItems.find(c => c.id === category)?.name` 解析，**解析不到时回落 `'其他'`**。**不要在 `stats.ts` 里另抄一张硬编码的分类表**——Task 11 的「钱」页与 Task 13 的设置页共用同一套可自定义成本项，多抄一张表就会漂移。**说明两件事**：(a) 这个回落**必须保留**，但**不要**把它说成「用户在设置页删掉了成本项」——设置页只加不删（`src/ui/pages/SettingsPanel.tsx:205-231` 只有「加」）；真正会走到兜底的是**备份 JSON 被外部编辑或导入后 `costItems` 里没有该 id**。(b) `src/ui/moneyBook.ts:51-53` 已经有一份同逻辑的 `catLabel`，但 `stats.ts` 在 `src/domain/`、按 `## Global Constraints` 不许 import `src/ui/*` ⇒ **这是有意重复一份解析，不是漏了 DRY**，请在注释里写明，免得下一个人为了 DRY 把 ui 依赖引进 domain。
3. `mortalityTrend` 每个批次一条，按 `date` **升序**（老的在前，才看得出趋势；同一天多批次时保持 `data.batches` 里的原顺序即可，JS 的 `sort` 是稳定的，不要为此另加排序键）；`total` = 该批次**全部**狗数（含在库/已售/死亡/退回），`dead` = `status === 'dead'` 的只数；`rate = total === 0 ? 0 : dead / total`；`deltaFromPrevious` = 本批 `rate` 减去**排序后前一批**的 `rate`，**第一批是 `null`**（不是 0——「首批」与「与上一批持平」是两件事）。
4. 空数据（没有批次 / 没有流水）返回 `[]`，不抛错、不产生 NaN。
5. 纯函数：不 import React、不 import storage、**不调用无参 `new Date()`**、不得修改入参。
6. 界面：在「报」页排行榜之后追加两节——
   - 标题「**钱花在哪了**」：成本结构（分类名 + 金额 + 占比条）。
   - 标题「**死亡率趋势**」（**不要叫「死亡率」，也不要与现存的「批次盈亏排行」重名**）：各批次按日期升序，每行 `日期 · 批次名 · N 只里死了 M 只（X%）`，**再补一个只有这一节才有的信息**——与上一批相比的百分点增减。文案：`deltaFromPrevious === null` → `首批`；`=== 0` → `与上一批持平`；升 → `` `比上一批 +${(delta * 100).toFixed(1)} 个百分点` `` 且标红；降 → `` `比上一批 -${(Math.abs(delta) * 100).toFixed(1)} 个百分点` `` 且标绿。**只换排序不算趋势视角**：排行块（`src/ui/pages/ReportPage.tsx:167-168`）已经显示了同样的三个数，所以这一节要么给出方向（增减），要么就没有存在的必要。
   - 两节都无数据时各显示一句「还没有数据」。两节**只读、不接受任何输入**。如果这一节不需要 today，就**不要**去取今天（渲染期不得调 `new Date()`，见 `## Global Constraints` 最后那条）。**不要顺手删或搬动 `src/ui/pages/ReportPage.tsx:25` 那行已有的 `const [today] = useState(() => todayLocalIso(new Date()))`**（Task 12 的图片文件名在用）。

**测试要求**（`src/domain/stats.test.ts`，**新建文件，必须显式 `import { describe, it, expect } from 'vitest'`**）：至少覆盖 —— 两类支出各自汇总正确且按金额降序；只有收入没有支出时 `share` 全为 0 且不出 NaN；自定义成本项的名字能被解析出来、`costItems` 里没有那个 id 时回落成「其他」；`mortalityTrend` 按日期升序且 `rate` 数值正确（含 `total === 0` 的分支）；`deltaFromPrevious` 第一批为 `null`、第二批等于两批 `rate` 之差、第三批只看紧邻的前一批；空数据返回 `[]`；函数不修改入参。
**测试数量期望**：本任务之前是 `Test Files 20 passed (20)` / `Tests 464 passed (464)`；做完应为 **21 files**，`Tests` 至少 **464 + 12**。门禁逐条贴原文。

> **Task 20 派发前审计（2026-10-03，控制器核对了实际代码）**
> - `LedgerEntry.category` 是**自由字符串**（`addExpense` 的入参就是 `category: string`，`src/domain/actions.ts:26-36`），所以行为 2 的「解析不到回落 `其他`」不是防御性代码，是**真的会走到**。别假设 `category` 一定是某个成本项 id。
> - ⚠️ **别拿 `aftercare_refund` 当「解析不到」的例子**：它是内置成本项（`src/domain/types.ts:165`，name `售后退款`，`isBuiltin: true`），`DEFAULT_SETTINGS.costItems = BUILTIN_COST_ITEMS`（`:173`）⇒ **它一定解析得出名字**。本仓目前写入的每个 `category` 都是内置项 id。真正会走到兜底的是备份被外部改过、`costItems` 与流水不一致时。
> - **`mortalityTrend` 的分母必须和 Task 12 的死亡率分母是同一个数。** Task 12 的排行块用 `summary.sold + summary.dead + summary.inStock`，而你这里的 `total` 是「该批次全部狗数含在库/已售/死亡/退回」——两者**应当恒等**（`src/domain/costing.ts:27-30` 的 `inStockCount` 已含 `returned`，所以 `sold + dead + inStock` 就是全部狗）。加一条测试钉住这件事：一批 10 只（4 售出 / 2 死亡 / 2 在库 / 2 退回）时 `total === 10` 且 `rate === 0.2`。**如果哪天这两页给出不同的死亡率，用户会不知道该信哪个。**
> - 「报」页里 Task 12 已有一节叫「批次盈亏排行」（`src/ui/pages/ReportPage.tsx:154-179`，每批 `共 N 只 · 死亡 M 只 · 死亡率 X%`）。你要加的两节按行为 6 命名，**「死亡率趋势」不要与它重名**，并且**必须给出排行块没有的信息（百分点增减）**。**不要删掉 Task 12 已经做过并验收过的 UI**。
> - Step 4 的 `git status --short` **此刻不会为空**（本任务新建的两个文件要到 Step 5 才提交）：判据是**除 `src/domain/stats.ts`、`src/domain/stats.test.ts`、`src/ui/pages/ReportPage.tsx` 外不得出现任何别的路径**。
> - `react/only-export-components` 是 `warn`（`.oxlintrc.json:6`）而门禁要 `0 warnings`：**两节写成不导出的局部 JSX**，别在 `ReportPage.tsx` 里新增导出。另 `noUnusedLocals: true`：`costBreakdown` 用不到 `dogsOfBatch`，多 import 一个未使用的符号会让 `npm run build` 失败。

**Steps:**
- [ ] **Step 1**：写 `src/domain/stats.test.ts`（TDD，先跑一次看它失败）。
- [ ] **Step 2**：实现 `src/domain/stats.ts`，让测试通过。
- [ ] **Step 3**：接进 `src/ui/pages/ReportPage.tsx`。
- [ ] **Step 4**：`npx vitest run`、`npm run build`、`npm run lint`（必须 `Found 0 warnings and 0 errors.`）、`git status --short`（必须为空）。
- [ ] **Step 5**：提交：`git add src/domain/stats.ts src/domain/stats.test.ts src/ui/pages/ReportPage.tsx && git commit -m "feat(domain): 成本结构与死亡率趋势"`

> **Task 20 实施记录（2026-10-03）**
> - **提交 `17507c0 feat(domain): 成本结构与死亡率趋势`**（3 files / +531 / −0）：新建 `src/domain/stats.ts`(132) + `src/domain/stats.test.ts`(325)，`src/ui/pages/ReportPage.tsx` +74。**全是新增，Task 12 已验收的 UI 一个字符没删。**
> - 门禁：`Test Files 21 passed (21)` / `Tests 489 passed (489)`（基线 20 / 464，+25 全在 `stats.test.ts`）、`npm run build` ✓ 47 modules（46→47）`index-DJ3vBXml.js 287.81 kB / gzip 87.47 kB`、`npm run lint` `Found 0 warnings and 0 errors.`（58 files）、`git status --short` 空。TDD 红态 `Error: Cannot find module './stats' imported from .../src/domain/stats.test.ts` / `Tests no tests`（实现一次跑绿，无断言级失败——本仓 TDD 常态）。
> - 落点（**行号是 Task 20 后的状态**）：`src/domain/stats.ts` `:31-53 costBreakdown`、`:71-73 costItemName`（私有）、`:102-131 mortalityTrend`；`src/ui/pages/ReportPage.tsx` 新增 `<h2>钱花在哪了` `:208-232`、`<h2>死亡率趋势` `:234-253`，插在排行块的 `)}`（`:206`）与 `<SettingsPanel />`（现 `:255`）之间；页面 `h2` 顺序现为 `分账`(`:146`) → `批次盈亏排行`(`:183`) → `钱花在哪了` → `死亡率趋势`；新增三个**未导出**模块级函数 `percentText`(`:11-14`)、`trendDeltaText`(`:16-27`)、`trendDeltaClass`(`:29-33`)。
> - **实施者 6 处偏离，全部接受**：①趋势行排成三行（批次名 / `日期 · N 只里死了 M 只（X%）` / 百分点文案）而不是任务书的一行——与紧挨着的排行块对齐；②空态沿用本页既有白底卡片 `还没有数据`；③占比除进度条外另给一个 `w-12` 右对齐百分比数字；④界面层**没有**断言趋势死亡率与排行块死亡率恒等（域层 `stats.test.ts:241-249` 已钉住 `total === summary.sold + dead + inStock`）；⑤**退回的狗计进 `total` 分母**（沿用 `inStockCount` 口径，代价是退狗会稀释死亡率——口径统一优先）；⑥测试写了 25 条（要求 ≥12）。
> - **控制器五处裁定**：①**「两个解析不出名字的分类各占一行、都叫『其他』」保持现状，不改**。这条路径只有**手工编辑过的备份 JSON** 才走得到（设置页只加不删、界面写入的 `category` 恒为 `CostItemDef.id`），`costBreakdown` 按 `category` 汇总是有文档记载的契约，为一个人工构造的场景改契约不划算；金额各自正确、合计不受影响。②实施者报的「Step 4 时 `git status --short` 一度出现 `M docs/...` 但 `git diff -- docs/` 为空」＝ **index 陈旧 stat 缓存**（控制器当时正在改任务书），与它无关。③`trendDeltaText` 的 `0` →「与上一批持平」正确。④三行排布接受。⑤接受 `rate` 与 `isSellable` 无关、不依赖 today。
> - **控制器复核**：`git log -1` = `17507c0`；`git show --stat` 与报告一致；独立复跑 `npx vitest run` 21/489、`npm run lint` 0/0。
> - **实机走查 21/21 PASS**（探针 `.superpowers/sdd/2026-10-02-dog-ledger/probes/dogledger-t20.mjs`，`PORT = 9351`、`--headless=new`、真实时间 + 真实 IndexedDB、`npx vite preview --port 5199 --strictPort`）。先空库断言两节都是 `还没有数据` 且排行块整块不渲染（`h2` 只有 `分账`/`钱花在哪了`/`死亡率趋势`），再用直接写 IDB（`dog-ledger`/`appdata`/`singleton`）的精确 fixture 重载：三个批次 30.0% / 10.0%（`比上一批 -20.0 个百分点`，`text-emerald-600`）/ 20.0%（`比上一批 +10.0 个百分点`，`text-red-500`），第一批是 `首批`（`text-gray-400`）；七笔支出 = ¥7,200，降序 `收购价 ¥5,000 69.0%` / `疫苗驱虫医疗 ¥800 11.0%` / `运输+笼具 ¥600 8.3%` / `检疫（抗体检测+申报） ¥500 6.9%` / `狗粮 ¥200 2.8%` / `其他 ¥100 1.4%` / `其他 ¥50 0.7%`（**两条「其他」正是裁定①要钉住的行为**）；同 fixture 里的 `income`/`sale` 与 `injection`/`transfer` 断言**不出现**；成本行的宽度样式实测是 `69%` / `11%`（`share × 100` 直接拼字符串、不去尾零）而旁边文字是 `69.0%`（走 `percentText`）——**同一行两个百分比写法不同，属外观不一致不是缺陷，没改**；排行块 3 行仍在、`<SettingsPanel />` 仍在、`Page.reload` 后两节不变；0 条 `Runtime.exceptionThrown` / 0 条 `console.error`。首轮 18/21 的 3 条失败**又全是探针自己的期望写错**（`tabTexts` 把底部标签的 emoji 算进长度导致只匹配到设置面板的「加」按钮；`width` 期望 `'69.0%'` 实为 `'69%'`）——**同类第 8 次**。
> - **parked（留给用户拍板，不擅自开工）**：①趋势行改成与 `settings.expectedMortalityRate`（默认 0.15）比「比预期好/差」——实施者没顺手加的理由正确（那会给该设置第二重语义），但本文档末尾「## 完成之后」第 3 条写着「首批狗的死亡率与预估差多少 —— 这个差值本身就是最有价值的数据」，**最终交付时一并向用户提出**（设计文档 D10：改已批准设计须先经用户同意）；②`costBreakdown` 只有全账本口径，没有按批次/时间窗维度（将来要做得改成 `costBreakdown(data, filter?)`）；③「报」页现在四节都不折叠，Task 14 还要再加备份面板，手机上会很长（折叠会动 Task 12 的容器结构）。

---

### Task 21: 批次改名（消掉两条一模一样的下拉选项）

**为什么有这一项**：Task 17 的实机走查发现——批次名由 `src/ui/pages/CalculatePage.tsx:109` 自动生成为 `` `收狗 ${input.n} 只` ``（`handleCreateBatch` 在 `:108`），狗号又是 `` `${batchName}-${i}` ``（`src/domain/planning.ts:105`）。用户同一天建两个**只数相同**的批次（很常见：上午收 2 只、下午又收 2 只），批次选择器里就会出现**两条读起来完全一样的选项**，狗号也会跨批次重名。账算不错（`id` 唯一、「检」页按批次分开显示），但用户没法在界面上分辨这两个批次，迟早会记错账。这是可用性缺陷，不是数据缺陷。
（手动「新建」批次本来就能自己起名（`src/ui/pages/DogsPage.tsx:96-108`，`:103` 调 `createBatch(d, name, todayIso())`），所以这条只对**从决策台一键建**的批次成立。）

> **行号基准**：本节所有 `CalculatePage.tsx` / `DogsPage.tsx` 行号以 Task 18 的提交 **`9cf9ebb`** 为准（`CalculatePage.tsx` 354 行、`DogsPage.tsx` 492 行）。若当前 HEAD 更新，**先重新核一遍再动手**——Task 18 把这两个文件都重写过（上一版行号已全部过期）。

> **实际撞在一起的是「检」页那个 `<select>`**（`src/ui/pages/QuarantinePage.tsx:82-90`，选项文本是 `{b.name}（{b.date}）`，同名同日就分不出来）。「狗」页的批次选择器是**按钮列表**（`src/ui/pages/DogsPage.tsx:111-140`），不是下拉。

**Files:**
- Modify: `src/domain/actions.ts`（**末尾追加**一个动作）
- Modify: `src/domain/actions.test.ts`（补测试）
- Modify: `src/ui/pages/DogsPage.tsx`（批次名可改）
- Modify: `src/ui/pages/CalculatePage.tsx`（默认批次名带上时间，让新建的批次默认就不重名）
- Modify: `src/ui/planForm.ts`（新增 `localTimeHm`）
- Modify: `src/ui/planForm.test.ts`（补 `localTimeHm` 的测试）

**Interfaces:**
- Produces（追加到 `src/domain/actions.ts` 末尾）：
  ```ts
  /** 改某个批次的名字。只改那一批；找不到时原样返回（同一引用）。 */
  export function renameBatch(data: AppData, batchId: string, name: string): AppData
  ```
- Produces（加到 `src/ui/planForm.ts`，紧挨着已有的 `todayLocalIso`）：
  ```ts
  /**
   * 本机时区的「时:分」，24 小时制、两位补零，例如 "14:07"。
   * 和 `todayLocalIso` 一样不能用 toISOString()——那是 UTC，东八区会差 8 小时。
   */
  export function localTimeHm(now: Date): string
  ```

> **为什么必须显式指定这个函数**：任务书要求默认批次名带 `${HH}:${MM}`，而仓库里**只有 `todayLocalIso(now: Date): string`（`src/ui/planForm.ts:47`，只返回 `YYYY-MM-DD`），没有任何分钟级的格式化助手**。不指定它叫什么、放哪里，实现者只能自己发明一个，将来就没法统一。放在 `planForm.ts` 里是因为日期与时间的本地化格式化已经都在这个模块。

**必须满足的行为：**

1. `renameBatch` 只改 `data.batches` 里那一批的 `name`；不碰 `dogs`、不碰 `entries`；`batches` 数组顺序不变；`batchId` 不存在时**返回传入的同一个对象引用**（与 `src/domain/actions.ts` 里既有动作保持一致）。
2. **`renameBatch` 不得追溯修改狗号。** 每只狗的 `code` 在**建批次时**就写死了：批量按 `` `${batchName}-${i}` ``（`src/domain/planning.ts:105`），手动补录的狗按 `` `${batch.name}-补${dogs.length + 1}` ``（`src/ui/pages/DogsPage.tsx:331`）。它是这批狗的历史标识（对账单、清单、纸质记录上已经这么写了）。改批次名只让**以后**新建的批次好看，不改已有狗号——**这一点必须在代码注释里写清**，否则下一个人会以为是漏了。走查时「批次名改了、狗号还是旧名」**是刻意的，不是 bug**。
3. 「狗」页的**批次详情**里批次名要能就地改：点一下名字进入编辑态（`<h1>` 换成 `<input>`），提交（回车或失焦）时走 `update(d => renameBatch(d, batch.id, name))`，**Esc 取消**。具体落点与结构：
   - **只做详情视图。** 列表视图里整张批次卡片是 `<button>`（`src/ui/pages/DogsPage.tsx:116-131`），名字在 `:122` 且位于 button 内部，塞不进 `<input>`；列表里也没有消息位。
   - 详情视图的 `<h1>{batch.name}</h1>` 在 `src/ui/pages/DogsPage.tsx:170`，紧跟其后的 `:171-189` 是 Task 18 刚加的「去向」下拉，**那一段一个字都不要动**。详情视图里的批次变量叫 `batch`（不是 `b`）。
   - 结构要合法：`<h1>` 里放 `<button>` 是合法的（`button` 属于 phrasing content）；Tailwind 的 preflight 已经把 button 的边框与背景清掉了，不用另外写样式。
   - **留空或只含空白时不写库**（保留原名），并在该视图内渲染一句红字提示（例如「批次名不能是空的」），不要让用户以为改成功了。
   - 输入框绑**本地草稿**，`string | null`（`null` = 没在改），与 `src/ui/pages/SettingsPanel.tsx` 的草稿约定一致；**不要**把输入框直接绑到 `data` 上每个击键写库——重渲会把用户没打完的输入吃掉（Task 13 已经踩过这个坑）。
4. `CalculatePage` 建批次时的默认名从 `` `收狗 ${input.n} 只` `` 改成 **`` `收狗 ${input.n} 只 ${localTimeHm(now)}` ``**（例如 `收狗 2 只 14:07`）。改法逐字如下——**必须复用同一个 `Date` 对象，不许新增第二个 `new Date()`，也不许把 `const now` 提到组件体（渲染期）**，提到渲染期会让 `npm run lint` 变红 `react(purity)`（见 `## Global Constraints`）：
   ```ts
   function handleCreateBatch() {                          // 现在在 :108
     const now = new Date()                                // 新增。必须留在事件处理器里
     const name = `收狗 ${input.n} 只 ${localTimeHm(now)}`   // 现在 :109，只加 ${localTimeHm(now)}
     const date = todayLocalIso(now)                        // 现在 :110，原来写的是 todayLocalIso(new Date())
     void update(d => createBatchFromPlan(d, input, name, date, selectedChannel))
     setCreated({ name, channel: selectedChannel })
   }
   ```
   同一分钟内建两个同只数批次仍会重名，这是可接受的——第 3 条让用户能自己改。
5. 界面文案全中文。

**测试要求**（`src/domain/actions.test.ts`，**必须显式 `import { describe, it, expect } from 'vitest'`**）：至少覆盖 —— 改名只影响那一批；不修改原数据；`batchId` 不存在时返回同一引用；`dogs` 与 `entries` 一字未动；**改批次名之后已有狗的 `code` 不变**（这条是给第 2 条钉桩的）。

**测试要求**（`src/ui/planForm.test.ts`，同样必须显式 import）：`localTimeHm` 至少覆盖 —— 个位数的小时与分钟都补零（`new Date(2026, 9, 3, 9, 7)` → `'09:07'`）；下午用 24 小时制（`new Date(2026, 9, 3, 14, 7)` → `'14:07'`）；**`new Date(2026, 9, 3, 0, 0)` → `'00:00'`**（午夜不被当成 12 或 24）。

**Steps:**
- [ ] **Step 1**：先给 `src/domain/actions.test.ts` 加测试（TDD），跑一次看它失败。
- [ ] **Step 2**：实现 `renameBatch`，让测试通过。
- [ ] **Step 3**：给 `src/ui/planForm.test.ts` 加 `localTimeHm` 的测试（TDD），再在 `src/ui/planForm.ts` 里实现它。
- [ ] **Step 4**：改「狗」页面的批次名入口与 `CalculatePage` 的默认名。
- [ ] **Step 5**：`npx vitest run` / `npm run build` / `npm run lint` / `git status --short`。
- [ ] **Step 6**：提交（**显式路径，不要 `git add src`**）：
  ```bash
  git add src/domain/actions.ts src/domain/actions.test.ts src/ui/pages/DogsPage.tsx src/ui/pages/CalculatePage.tsx src/ui/planForm.ts src/ui/planForm.test.ts
  git commit -m "feat(ui): 批次改名与默认批次名去重"
  ```

> **Task 21 实施记录（2026-10-03）**
>
> - 提交 `ff1e8cb feat(ui): 批次改名与默认批次名去重`（6 files / +213 / −5）：`src/domain/actions.ts` +28（`renameBatch` 在 `:281-307`）、`src/domain/actions.test.ts` +92（7 条新增，93→100）、`src/ui/planForm.ts` +14（`localTimeHm` 在 `:54-66`）、`src/ui/planForm.test.ts` +23（3 条新增，15→18）、`src/ui/pages/DogsPage.tsx` +49、`src/ui/pages/CalculatePage.tsx` +12。
> - 门禁：`Test Files 21 passed (21)` / `Tests 499 passed (499)`（基线 489）、`✓ 47 modules` / `index-DHbmsN7R.js` 288.58 kB / gzip 87.71 kB、`Found 0 warnings and 0 errors.`（58 files）、`git status --short` 空。TDD 红态：7 × `TypeError: renameBatch is not a function`、3 × `TypeError: localTimeHm is not a function`。
> - 落点核对：`CalculatePage.tsx:108-118` 逐字就是上面那个代码块，`const now = new Date()` 在 `:112`，一个 `now` 同时喂给批次名与日期。
> - **`commitBatchName` 必须是箭头函数常量，不能写成 `function` 声明**：`batch` 靠更上面的提前 `return` 收窄，函数声明会被提升、收窄在它体内不成立，`tsc` 立刻报 `error TS18048: 'batch' is possibly 'undefined.'`。谁把它改回函数声明都会编译失败。
> - `renameBatch` 刻意**不追溯改已有狗的 `code`**（`code` 在建批次时一次写死，是历史标识——对账单与纸质清单已经按它写了；追溯改写会让已发出的凭证对不上账）。上面测试要求里那条「改批次名之后已有狗的 `code` 不变」正是钉这条的。
> - 偏离（全部已接受或已 parked）：没有「点名字可改」的可见提示（parked——默认名现在带时分，重名已很少见，逃生口不必自我宣传）；改成同名仍写一次库（无害）；**空白提交停在编辑态**并出红字（刻意，静默退出会掩盖「这次编辑被拒了」）；无界面层测试（本仓没有组件测试基建）；「检」页下拉里同名同日期批次仍不可分辨（parked，本任务只做详情视图）。
> - 真实浏览器走查 45 条断言 **45/45 PASS**（0 `Runtime.exceptionThrown`、0 `console.error`），探针 `.superpowers/sdd/2026-10-02-dog-ledger/probes/dogledger-t21.mjs`。走查抓到**一个真实缺陷**（见下），Task 21b 修掉后复跑 45/45。
> - **缺陷与修复（Task 21b，提交 `dfaa46a fix(ui): 批次名编辑草稿不跨批次残留`，1 file / +30 / −3）**：`setBatchNameDraft(null)` 原来只在提交成功与按 Escape 两处发生，而改 `openBatchId` 的**三处**（列表里打开批次、批次失效 fallback 里的退回按钮、详情视图顶部的「← 所有批次」）都没重置草稿。点「返回」时输入框先失焦 ⇒ 非空草稿会被**提交**（所以打字后返回不会泄漏），但**空白分支提前 `return`、走不到清草稿** ⇒ 空草稿跨到下一个批次：那个批次一进详情就是空的编辑框，外加一句属于上一个批次的红字「批次名不能是空的」。**库里一个字都没改**，纯粹是界面状态串台，但用户会以为第二个批次的名字坏了。修法：三处改 `openBatchId` 时同时 `setBatchNameDraft(null)`，并在 `batchNameDraft` 的状态注释里写清理由（草稿只属于它所属的那个批次）。另发现 fallback 里那句按钮文案是「← 回所有批次」（详情视图顶部才是「← 所有批次」）。
> - 教训：**给实施者点名的行号会过期。** 上面第 3 条里「`:171-189` 是去向下拉，一个字都不要动」在 Task 21 落地后已经偏到 `commitBatchName` 的注释与函数体上（真正的去向 `<select>` 现在是 `:216-229`），实施者为此专门请示。往后写 brief 要写清**哪一段语义**，行号只当参考。

---

### Task 22–30：修订三（预定单 / 先做后补账 / 流水纠错）

> **这一组任务的由来。** 第一版（Task 1–21）已上线并在真机上用起来了。用户用了一段时间后提了三件事（原话）：「我们找到的狗还没有合适的年龄段就预定了……等长到两个月大我们会去收，**等于是有一批预定单**」「我希望是我们**先做后才生成账目表再记录**的」「还有些功能细节也帮我完善（＝**流水能改能删**）」。设计已按 `docs/superpowers/specs/2026-10-02-dog-trading-ledger-design.md` 的**修订三**（D13–D16、§3.9/§3.10/§3.11）写定，并经一轮只读审查改定（提交 `a2f830b` → `c169327`）。**任务书里凡是与代码冲突的断言，都以那轮审查的复核结论为准**——尤其：`refundedCurrentSale` **不改**、金额**不新立"必须 > 0"**、`createBatchFromPlan` **删除而不是保留**。
>
> **顺序（任务编号是身份，不是执行顺序）**：`22 → 23 → 23b → 24 → 25 → 26 → 27 → 27b → 28 → 29 → 30`（**23b** 与 **27b** 是控制器在复核 Task 23 / 派发 Task 27 时发现的两个缺口：前者是 `leadDays` 为负或 `NaN` 时 `addDays` 会抛 `RangeError`，后者是 `preOrderLeadDays` 根本没有界面能改——都已写成独立任务，见各自小节）。前五个是纯域层（每一步都能独立跑测试），20 号之后才碰界面，因为界面依赖的签名必须先生效。**Task 30 是收尾与重新上线**：`### Task 14` 的内容（备份安全网、PWA、DEPLOY.md、README）**已在第一版落地并上线**，本组任务不再重做它，改完之后按 Task 30 重新构建与推送即可。
>
> **这一组的头号风险是数据，不是功能。** 用户手机上有真实数据，线上站址已在使用。所以 Task 22 排在第一位、并且是**唯一**允许碰 `AppData` 形状的任务；它必须做到：老数据照常打开、老备份照常恢复、**新备份（含预定单）能原样还原**。

---

### Task 22: 数据层——预定单类型、`preOrderLeadDays`、老数据兼容

**Goal:** 让 `AppData` 多出 `preOrders`、`Settings` 多出 `preOrderLeadDays`，并保证**用户手机上已有的数据与已有的备份文件都照常工作**。这一步之后界面上还看不到任何变化（预定单区在 Task 27），但类型与读路径已经就位。

**Files:**
- Modify: `src/domain/types.ts`（新增 `PreOrderStatus` / `PreOrder`；`AppData.preOrders`；`Settings.preOrderLeadDays`；`DEFAULT_SETTINGS` 与 `DEFAULT_DATA` 补默认值）
- Modify: `src/domain/types.test.ts`
- Create: `src/domain/normalize.ts`（纯函数 `normalizeAppData`）
- Create: `src/domain/normalize.test.ts`
- Modify: `src/state/persistence.ts`（`loadPersistedData` 里接上 `normalizeAppData`）
- Modify: `src/state/persistence.test.ts`
- Modify: `src/storage/backup.ts`（`importBackup` 的白名单对象补 `preOrders`）
- Modify: `src/storage/backup.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_DATA` / `DEFAULT_SETTINGS` / `AppData`（`src/domain/types.ts:144-199`）、`loadPersistedData`（`src/state/persistence.ts:12-18`）、`importBackup`（`src/storage/backup.ts:16`，白名单对象在 `:36-47`）
- Produces:
  ```ts
  export type PreOrderStatus = 'reserved' | 'received' | 'cancelled'
  export interface PreOrder {
    id: string
    sellerName: string
    sellerContact: string
    expectedCount: number
    collectDate: string        // 'YYYY-MM-DD'
    traits: string
    note: string
    createdAt: string          // ISO datetime
    status: PreOrderStatus
    receivedCount: number
    receivedBatchId: string | null
    cancelReason: string
  }
  // AppData 新增 preOrders: PreOrder[]；Settings 新增 preOrderLeadDays: number（默认 3）
  export function normalizeAppData(raw: unknown): AppData   // src/domain/normalize.ts
  ```

**必须满足的行为**
- `AppData` 加 `preOrders: PreOrder[]`；`Settings` 加 `preOrderLeadDays: number`（默认 **3**）；`DEFAULT_DATA` 补 `preOrders: []`。**注意别名陷阱**：`DEFAULT_DATA.settings` 与 `DEFAULT_SETTINGS` 是同一个对象（`types.ts:196-199` 附近），所以 `preOrderLeadDays: 3` 只写在 `DEFAULT_SETTINGS` 里一份；`preOrders: []` 写在 `DEFAULT_DATA` 里。
- `normalizeAppData(raw: unknown): AppData` 是**纯函数**（只依赖 `./types`，不得 import React / storage）：① `raw` 不是对象（`null` / 数组 / 字符串 / 数字）→ 返回 `structuredClone(DEFAULT_DATA)`；② `settings` = `{ ...DEFAULT_SETTINGS, ...(rawSettings 是对象 ? rawSettings : {}) }`，其中 `partners` / `costItems` 不是数组时回落默认值（与 `importBackup` 的既有写法同口径）；③ `batches` / `dogs` / `entries` / `preOrders` 不是数组时取 `[]`；④ `version` 一律写成 `1`；⑤ **不得就地修改 `raw`**。
- `src/state/persistence.ts` 的 `loadPersistedData`：把 `return await storage.load()` 改成「拿回来是 `null` 就返回 `null`，否则 `return normalizeAppData(raw)`」。**try/catch → 返回 `null` 的既有行为一字不改**（它绝不允许 reject，否则界面永远停在「正在载入…」）。
- `src/storage/backup.ts` 的 `importBackup`：白名单对象里**显式**补 `preOrders: data.preOrders ?? []`。**`preOrders: []` 是错的**——`exportBackup` 是原样序列化整个 `data`，写成 `[]` 会造成「导出含预定单、导入就丢」，而只测旧格式导入的用例照样全绿。

**测试要求**
- `src/domain/normalize.test.ts`
  - 缺 `preOrders`、缺 `preOrderLeadDays` 的旧对象 → 补齐为 `[]` 和 `3`，**其余字段逐字不变**（`toEqual` 对着一个手工写全的期望对象比，不要只比长度）。
  - 已完整的数据 → 语义不变（`toEqual(data)`），且**输入对象没被改**（改前 `structuredClone` 一份做快照，事后 `toEqual` 快照）。
  - `preOrders: null`、`preOrders: {}` → `[]`；`entries` 不是数组 → `[]`。
  - `normalizeAppData(null)` / `('abc')` / `([])` → 与 `DEFAULT_DATA` 等值，且 `DEFAULT_DATA` 自己**没有被污染**（返回值的 `preOrders` push 一下，再断言 `DEFAULT_DATA.preOrders` 仍是 `[]`）。
- `src/domain/types.test.ts`：`DEFAULT_SETTINGS.preOrderLeadDays === 3`；`DEFAULT_DATA.preOrders` 是空数组；构造一个字面量 `PreOrder` 并逐字断言（钉住 12 个字段名）。
- `src/state/persistence.test.ts`：存储里塞一个**不含 `preOrders` 的旧对象** → `loadPersistedData` 返回的对象有 `preOrders: []` 与 `preOrderLeadDays: 3`；`storage.load()` 抛错时**仍然返回 `null`**（既有用例必须继续通过）。
- `src/storage/backup.test.ts`：**导出 → 导入后 `preOrders` 逐条还原**（塞 2 张预定单，其中一张 `status: 'received'` 且带 `receivedBatchId`，断言逐字相等）；以及「导入不含 `preOrders` 的旧 JSON → `preOrders: []`」这条**单独用 `toEqual([])` 断一次**（不要只依赖 `not.toThrow`）。

**Steps**
- [ ] **Step 1**：先写 `normalize.test.ts` 与新增的 `backup.test.ts` 用例（红态：`Cannot find module './normalize'`；`preOrders` 为 `undefined`）。
- [ ] **Step 2**：改 `src/domain/types.ts`、新建 `src/domain/normalize.ts`、改 `src/state/persistence.ts`、改 `src/storage/backup.ts`。
- [ ] **Step 3**：`npx vitest run` 全绿；`npm run build`（`tsc -b` 会把所有缺 `preOrders` 的对象字面量报出来——**这就是这一步的主要工作量，不许用 `as any` 或 `@ts-expect-error` 绕开**）；`npm run lint` 0 warning。
- [ ] **Step 4**：`git add` 显式路径后提交：
  ```bash
  git add src/domain/types.ts src/domain/types.test.ts src/domain/normalize.ts src/domain/normalize.test.ts src/state/persistence.ts src/state/persistence.test.ts src/storage/backup.ts src/storage/backup.test.ts
  git commit -m "feat(domain): 预定单类型与老数据补齐（修订三 D16）"
  ```

> **Task 22 实施记录（2026-10-06）。** 提交 `f5959f8 feat(domain): 预定单类型与老数据补齐（修订三 D16）`（9 files / +268 / −1）+ 补正提交 `694a2e1 fix(domain): 成本项空数组回落内置项；老数据用例去掉类型断言`（3 files / +31 / −8）。
> - 门禁：`Test Files 23 passed (23)` / `Tests 520 passed (520)`、`✓ 52 modules transformed` + `✓ built in 226ms`、`npm run lint` 0 warnings 0 errors（**经 pwsh 管道捕获时不打印统计行，是 oxlint 的 TTY 检测，不是失败**）、`git status --short` 空。
> - 落点：`src/domain/types.ts:88`（`Settings.preOrderLeadDays`）、`:186`（`AppData.preOrders`）、`:223`（默认 3）、`:233`（`preOrders: []`）；新建 `src/domain/normalize.ts`（`normalizeAppData`）；`src/state/persistence.ts:13-18` 改走 `normalizeAppData`；`src/storage/backup.ts:50` 白名单补 `preOrders: data.preOrders ?? []`。
> - **第 9 个被迫改的文件**：`src/ui/planForm.test.ts:14` 是手写全字段的 `Settings` 字面量，`tsc -b` 报 `error TS2741: Property 'preOrderLeadDays' is missing ... but required in type 'Settings'`，照实补字段。**以后给 `Settings`/`AppData` 加必填字段，所有"完全手写字面量"（不是展开写法）都会在 `tsc -b` 处报 TS2741。**
> - 控制器两处裁定（都已办）：①`costItems` 空数组回落内置项 —— 本仓**没有任何删除成本项的入口**，空数组只可能来自手改或坏数据，透传会让「钱」「狗」两页的支出类别下拉变成零个选项；与 `importBackup` 白名单逐字同口径，而 `partners` 空数组是真实状态要保留（两条区别各有断言）。②老数据用例改成从 `DEFAULT_DATA` 克隆后 `Reflect.deleteProperty` 删键，去掉 `as unknown as`。
> - 留下的硬提醒：`status` / `receivedCount` / `receivedBatchId` 是**只读三件套**，只能由收货与取消两个 action 写；`normalizeAppData`（读本机存储）与 `importBackup` 白名单（导入备份）是**两条独立补齐路径，导入不经过 normalize**，以后加字段必须同时改两处 + 两处测试。

---

### Task 23: 预定单纯函数（阶段推导、提醒计数、排序）与增删改动作

**Goal:** 把「预定单现在处于哪一步」变成一个**纯函数**，并把新增 / 修改 / 取消 / 删除四个动作写进 `actions.ts`（与既有 16 个导出同风格）。界面在 Task 27 才接。

**Files:**
- Create: `src/domain/preOrders.ts`
- Create: `src/domain/preOrders.test.ts`
- Modify: `src/domain/actions.ts`（**只在文件末尾追加**，已有 16 个导出一字不动）
- Modify: `src/domain/actions.test.ts`

**Interfaces:**
- Consumes: `AppData` / `PreOrder` / `PreOrderStatus`（Task 22）、`newId`（`src/domain/types.ts:196-199`）、`Money`
- Produces:
  ```ts
  export type PreOrderStage = 'upcoming' | 'due_soon' | 'overdue' | 'received' | 'cancelled'
  export function preOrderStage(order: PreOrder, today: string, leadDays: number): PreOrderStage
  export function duePreOrderCount(data: AppData, today: string): number
  export function preOrderList(data: AppData, today: string): { order: PreOrder; stage: PreOrderStage }[]

  // src/domain/actions.ts 追加
  export function addPreOrder(data: AppData, input: {
    sellerName: string; sellerContact: string; expectedCount: number
    collectDate: string; traits: string; note: string; createdAt: string
  }): AppData
  export function updatePreOrder(data: AppData, preOrderId: string, patch: {
    sellerName?: string; sellerContact?: string; expectedCount?: number
    collectDate?: string; traits?: string; note?: string
  }): AppData
  export function cancelPreOrder(data: AppData, preOrderId: string, reason: string): AppData
  export function deletePreOrder(data: AppData, preOrderId: string): AppData
  ```

**必须满足的行为**
- `preOrderStage` **判定顺序固定**（先命中先返回）：`status === 'cancelled'` → `'cancelled'`；`status === 'received'` → `'received'`；`today > collectDate` → `'overdue'`；`today >= （collectDate 往前推 leadDays 天）` → `'due_soon'`；其余 → `'upcoming'`。
  - **全用 `'YYYY-MM-DD'` 字符串比较**（同型同长度，字典序就是日期序），**不得把 `collectDate` 塞进 `new Date()`**——那就又回到时区问题。往前推天数自己写一个 `shiftDate(iso, -leadDays)`（`src/domain/quarantine.ts` 里已有同样口径的 `addDays(isoDate: string, days: number): string`，**直接复用那个**，不要新写一份）。
  - **到日子那天算 `due_soon`（"今天去收"），只有过了那天才算 `overdue`**；`leadDays <= 0` 时只有当天算 `due_soon`。
  - `collectDate` 不合法（空串、`'不是日期'`）→ 返回 `'upcoming'`，**不许抛错**。
- `duePreOrderCount` = `due_soon` 与 `overdue` **两态合起来的个数**（设计 §3.9 + §4：界面上两者都显示成「该去收了」）。
- `preOrderList` 的排序固定：先 `due_soon` / `overdue`（两者合在一起按 `collectDate` 升序），再 `upcoming`（按 `collectDate` 升序），最后 `received` / `cancelled`（按 `createdAt` 降序）。**同一输入两次调用结果必须一致**（相同 `collectDate` 时用 `id` 兜底比较，保证稳定）。
- `addPreOrder`：`sellerName.trim() === ''`、`expectedCount < 1`、`collectDate.trim() === ''` 任一成立 → **返回同一引用**；否则追加一条 `{ id: newId(), status: 'reserved', receivedCount: 0, receivedBatchId: null, cancelReason: '' }` + 传入字段（`sellerName` 存 `trim()` 后的值）。
- `updatePreOrder`：找不到 id → 同一引用；`status === 'received'` 时**只有 `patch.note` 生效**，其余键一律忽略（这是白名单，见设计 §3.9 G4——否则用户能把已收货改回「预定中」、绕过守卫再收一次）；`status === 'cancelled'` 时可以改内容但不能改 `status`（`status` 根本不在 patch 类型里）。
- `cancelPreOrder`：`status !== 'reserved'` → 同一引用；否则写 `status: 'cancelled'` + `cancelReason: reason`（`reason` 为空就存 `''`，界面负责提示）。
- `deletePreOrder`：找不到 id → 同一引用；`status === 'received'` → 同一引用（它连着批次）；其余物理删除那条。
- **四个动作全部返回新对象、守卫一律 `return data`（同一引用）、绝不抛错**（Global Constraints）。

**测试要求**（`preOrders.test.ts`）
- 三个日期边界各一条：`today === collectDate` → `'due_soon'`（不是 `overdue`）；`today === collectDate - leadDays` → `'due_soon'`；`today === collectDate - leadDays - 1` → `'upcoming'`。
- `today > collectDate` → `'overdue'`；`cancelled` / `received` 优先于日期（哪怕 `collectDate` 早得离谱）。
- `leadDays = 0`：当天 `due_soon`、昨天 `overdue`。
- `collectDate: ''` → `'upcoming'` 且不抛。
- `duePreOrderCount`：一张 `overdue` + 一张 `due_soon` + 一张 `upcoming` → `2`。
- `preOrderList` 顺序：造 5 张覆盖五种阶段，断言顺序数组（不要用 `expect(...).toEqual(expect.arrayContaining(...))` 这种对顺序无感的写法）。
- 动作守卫：`expect(addPreOrder(data, 非法)).toBe(data)`（`toBe`，不是 `toEqual`——**钉住"同一引用"这个约定**）；`updatePreOrder` 对已收货只改 `note`（改 `expectedCount` 被忽略）；`cancelPreOrder` 对已收货返回同一引用；`deletePreOrder` 对已收货返回同一引用、对 `reserved` 真的删掉。

**Steps**
- [ ] **Step 1**：写失败测试（红态：`Cannot find module './preOrders'`、`TypeError: addPreOrder is not a function`）。
- [ ] **Step 2**：实现 `src/domain/preOrders.ts` 与 `actions.ts` 末尾四个导出。
- [ ] **Step 3**：`npx vitest run` / `npm run build` / `npm run lint`。
- [ ] **Step 4**：提交（显式路径）：
  ```bash
  git add src/domain/preOrders.ts src/domain/preOrders.test.ts src/domain/actions.ts src/domain/actions.test.ts
  git commit -m "feat(domain): 预定单阶段推导与增删改动作"
  ```

> **Task 23 实施记录（2026-10-06）。** 提交 `b1f4fd2 feat(domain): 预定单阶段推导与增删改动作`（4 files / +652 / −2）。
> - 门禁：`Test Files 24 passed (24)` / `Tests 563 passed (563)`（+43：`preOrders.test.ts` 19 条、`actions.test.ts` 24 条）、`✓ 52 modules transformed`（**与 Task 22 同数、chunk 哈希也一样 —— `preOrders.ts` 还没有界面 import，进不了 bundle，Task 27 接上后应变 53；如果那时还是 52，说明界面没真的引用上**）、lint 0/0（66 files）、树干净。
> - 落点：`src/domain/preOrders.ts:19/22/36/47/63/77`（类型、`DATE_SHAPE`、`preOrderStage`、`duePreOrderCount`、`groupOf`、`preOrderList`）；`src/domain/actions.ts:313/338/370/385/410/428`（`AddPreOrderInput`、四个动作，追加在 `renameBatch` 之后，既有 16 个导出一字未动）。
> - **形状校验放在 `addDays` 之前**（`:40`）——`addDays` 对空串/`'不是日期'` 会抛 `RangeError: Invalid time value`，坏数据不能把界面搞白屏。这条是控制器派发时补进去的，任务书原文没有。
> - 三处偏离全部保留：`AddPreOrderInput` 抽成具名 `interface`（与 `DogQuarantinePatch` 同体例，测试里要能引用）；已收货 + `patch.note === undefined` 时返回**同一引用**（与全仓「没改动就返回同一引用」一致）；未收货走既有泛型助手 `keepOrSet`（`actions.ts:184`，与 `setDogQuarantine` 同口径）。
> - 三处请示裁定：①`leadDays` 为负或 `NaN` → **要修**，见 Task 23b；②`overdue`/`due_soon` 合组后**不按状态再排**（同一天不可能既是 overdue 又是 due_soon，组内不需要状态优先级）；③`'2026-02-30'` 这类"形状对、日历上不存在"的串**刻意不校验**（真实录入走 `<input type="date">`，手改数据最坏是"日子挪几天"，不值得写闰年逻辑）。
> - 留给 Task 27 的风险：`deletePreOrder` 对已收货返回同一引用，**界面必须自己按 `status` 决定显示哪些按钮**（否则点了没反应也没提示）；`preOrderList` 返回的 `.order` 是原对象引用，界面只能读不能就地改；`updatePreOrder` 的白名单是按 `status` 手写分支的，将来 `PreOrder` 加可修改字段必须同时改两处。

---

### Task 23b: `preOrderStage` 挡掉负数与 `NaN` 的提前天数

**Goal:** 封住 Task 23 留下的两个坏格子。`preOrderStage` 里 `addDays(order.collectDate, -leadDays)` 的 `leadDays` 直接来自 `data.settings.preOrderLeadDays`（老数据手改、或将来某个入口写脏都可能给出非法值）：
- **`NaN`**：`-NaN` 传给 `addDays` → `base.setUTCDate(NaN)` → `toISOString()` 抛 `RangeError: Invalid time value`。
- **负数**（如 -1）：不会抛，但语义反了 —— `-(-1) = 1`，提醒窗口被推到**收狗日之后一天**，于是 `collectDate === today` 当天返回 `'upcoming'`（**当天不提醒**），只有第二天才变 `'overdue'`。

**Files:**
- Modify: `src/domain/preOrders.ts`
- Modify: `src/domain/preOrders.test.ts`

**必须满足的行为**
- `preOrderStage` 里把提前量先归一化再用：
  ```ts
  // Number.isFinite 一起挡掉 NaN：Math.max(0, NaN) 仍然是 NaN，加了它等于没加。
  const lead = Number.isFinite(leadDays) && leadDays > 0 ? leadDays : 0
  ```
  之后用 `lead` 代替 `leadDays`。语义：负数与 `NaN` 都当 0（只有当天算 `due_soon`），因为「提前几天提醒」是提前量，-1 没有意义。
- 任务书 4731「`leadDays <= 0` 时只有当天算 `due_soon`」**从此在实现上成立**；4729 的判定顺序按「合法的 `leadDays`」理解。

**测试要求**
- `leadDays = -1` + `collectDate === today` → `'due_soon'`（**不是 `overdue`**）。
- `leadDays = NaN` + `collectDate === today` → `'due_soon'` 且**不抛**。
- 既有 19 条一条不改。

**Steps**
- [ ] **Step 1**：先写两条失败测试（红态：`RangeError: Invalid time value`）。
- [ ] **Step 2**：改 `src/domain/preOrders.ts`。
- [ ] **Step 3**：四条门禁。
- [ ] **Step 4**：`git add src/domain/preOrders.ts src/domain/preOrders.test.ts` + `git commit -m "fix(domain): 预定单提醒天数挡掉负数与 NaN"`。

> **Task 23b 实施记录（2026-10-06）。** 提交 `3bef499 fix(domain): 预定单提醒天数挡掉负数与 NaN`（2 files / +32 / −1）。
> - 落点：`src/domain/preOrders.ts:47` `const lead = Number.isFinite(leadDays) && leadDays > 0 ? leadDays : 0`（放在 `cancelled`/`received` 之后、形状校验之前），`:51` 改用它。JSDoc 写明了**为什么不能写 `Math.max(0, leadDays)`**（`Math.max(0, NaN)` 还是 `NaN`）。
> - 门禁：24 files / `Tests 565 passed (565)`（+2）、`✓ 52 modules`、lint 0/0 on 66 files、树干净（除控制器自己的计划书改动）。
> - 红态实测：`leadDays = -1` + 当天 → `AssertionError: expected 'upcoming' to be 'due_soon'`；`leadDays = NaN` + 当天 → `RangeError: Invalid time value`。**这正是控制器更正后的事实**（负数不抛，只有 `NaN` 抛）。
> - 顺带落实的三条注释：`overdue`/`due_soon` 合组不排状态优先级（`today > collectDate` 与 `today === collectDate` 互斥）、`'2026-02-30'` 刻意不做日历校验、判定顺序以「合法 `leadDays`」为前提。

---

### Task 24: 收货（`addBatchWithDogs` / `receiveBatch` / `receivePreOrder`）+「算」页按钮改成收货

**Goal:** 建立**全仓唯一的"建批次 + 建狗"实现**，让「预定单收货」与「算页直接收货」走同一条路；同时把「按估算一次性写全部成本」的旧入口删掉（修订三之后没有界面路径需要它）。

**Files:**
- Modify: `src/domain/planning.ts`（**删除** `createBatchFromPlan`，新增 `addBatchWithDogs` / `receiveBatch`；`plan` / `PlanInput` / 保本价 / 渠道相关的函数**一个字节都不动**）
- Modify: `src/domain/planning.test.ts`（`describe('createBatchFromPlan')` 的 **10 条**整体改写成新函数的等价用例 —— 原文写的「12 条」是控制器的数错了，实施时以实际代码为准）
- Modify: `src/domain/actions.ts`（追加 `receivePreOrder`）
- Modify: `src/domain/actions.test.ts`
- Modify: `src/ui/pages/CalculatePage.tsx`（底部按钮改为「收货」，弹窗只问两个数）
- Modify: `src/ui/planForm.ts`（仅 `:135` 那句注释里的 `createBatchFromPlan()` —— 函数删了，注释不能指向不存在的东西）

**Interfaces:**
- Consumes: `newId`、`Dog` / `Batch` 的必填字段（修订二那 6 个检疫字段与 `plannedChannel`）、`ChannelId`
- Produces:
  ```ts
  // src/domain/planning.ts
  export function addBatchWithDogs(data: AppData, input: {
    name: string; date: string; count: number; unitPriceFen: Money
    channel: ChannelId; source: string; note: string
  }): { data: AppData; batchId: string | null }
  export function receiveBatch(data: AppData, input: {
    name: string; date: string; count: number; unitPriceFen: Money; channel: ChannelId
  }): AppData
  // src/domain/actions.ts
  export function receivePreOrder(data: AppData, preOrderId: string, input: {
    name: string; date: string; receivedCount: number; unitPriceFen: Money
  }): AppData
  ```
- 删除：`createBatchFromPlan`（`src/domain/planning.ts:78-134`）、`CalculatePage.tsx:117` 的调用。

**必须满足的行为**
- `addBatchWithDogs` 是**建批次与狗号的唯一实现**：`count < 1` → `{ data, batchId: null }`（**同一引用**，不建任何东西）；否则新建 1 个 `Batch`（`id: newId()`、`status: 'active'`、`plannedChannel: input.channel`、`source`、`note`）与 `count` 只 `Dog`：`id: newId()`、`code: \`${input.name}-${序号}\``（**序号从 1 开始**，与既有 `planning.ts:105` 逐字一致）、`batchId`、`status: 'in_stock'`、6 个检疫字段 `null / null / '' / '' / null / null`。
- **收购款只在单价 > 0 时写**（与既有 `planning.ts:116-118` 的 `if (input.purchasePrice > 0)` 同口径）：每只狗一笔 `type: 'expense'`、`category: 'purchase'`、`amount: Math.max(0, Math.round(input.unitPriceFen))`、`paidBy: 'pool'`、`batchId`、`dogId`、`date`。**单价 0 就一笔都不写**（不是写 0 元流水）。
- `addBatchWithDogs` **只写收购款那一类流水**：运输 / 疫苗 / 检疫 / 处理费**一概不在这里写**（那是 Task 25 的 `addBatchCosts`）。这一条是本任务的中心——「先做后补账」（D14）就落在这里。
- `receiveBatch` = 用 `source: ''`、`note: ''` 调 `addBatchWithDogs` 并取 `.data`。
- `receivePreOrder` 一次 update 原子做完四件事（**必须是同一次 `update`，不许分成两次**）：
  1. 调 `addBatchWithDogs` 建批次与狗、记收购款（`name` / `date` 由调用方传入，`channel: 'undecided'`）；
  2. **把卖家与留痕写进批次**：`source: order.sellerName`；`note: \`来自预定单：${order.sellerName}\``，并在 `receivedCount !== expectedCount` 时追加 `；比约定的${少|多} ${差额} 只`（差额 = `Math.abs(expectedCount - receivedCount)`）；
  3. 预定单写 `status: 'received'`、`receivedCount`、`receivedBatchId`；
  4. 其余数据不动。
- `receivePreOrder` 守卫：找不到 id、`status !== 'reserved'`、`receivedCount < 1` 任一成立 → **返回同一引用**。
- **`domain/` 里不许出现无参 `new Date()`**：`name`（形如 `收狗 6 只 14:30`）与 `date` 都由界面算好传进来（`localTimeHm(new Date())` 在 `src/ui/planForm.ts:54-66`、`todayLocalIso(new Date())` 在 `:47`）。
- `CalculatePage.tsx`：底部按钮文案从「就按这个收」改成「**收货**」；点了之后弹一个**只有两个字段**的弹窗——实收只数（默认表单里的 `n`）与每只收购价（默认表单里的值）——确认后调 `receiveBatch`（`name` 用 `收狗 N 只 HH:MM`，`N` 是**实收只数**，`date` 用 `todayLocalIso(new Date())`（`src/ui/planForm.ts:47`；任务书原文写的 `todayIso()` 这个函数名不存在），`channel: selectedChannel`）。`new Date()` 必须留在事件处理器里（Task 21 的 `handleCreateBatch` 已经这么做，`CalculatePage.tsx:112`）。成功文案里保留去向（Task 18b 加的那行）。**估算出来的运输 / 疫苗 / 检疫 / 处理费一个字都不要写进账**——它们只是保本价的输入。

**测试要求**
- `planning.test.ts`：把 `describe('createBatchFromPlan')` 的 **10 条**改写成 `addBatchWithDogs` / `receiveBatch` 的等价用例，其中**必须保留**这几条语义：只数 0 → 不建批次（`batchId === null`）、狗号逐字形如 `收狗 3 只 09:10-1`、每只狗一笔 purchase、单价 0 一笔都不写、6 个检疫字段都是空值、`plannedChannel` 落对。原来钉「17 笔」「8 笔 quarantine」「只数 0 只记运输」的那三条**由 Task 25 的 `addBatchCosts` 测试重新承担**（Task 24 实施时按"行为已变更"删除而非搬迁，笔数口径必须在 Task 25 重建）。
- `actions.test.ts` 的 `receivePreOrder`：
  - 收货原子性：一次调用后 `batches.length +1`、`dogs.length + receivedCount`、该批 `purchase` 流水恰好 `receivedCount` 笔、预定单 `status === 'received'` 且 `receivedBatchId` 指向新批次、`receivedCount` 落对。
  - 留痕逐字：`expectedCount: 4 / receivedCount: 2` → `note === '来自预定单：老李家；比约定的少 2 只'`；相等时**不出现**「比约定」字样；多收时写「多」。
  - 守卫：非 `reserved`（`received` 与 `cancelled` 各一条）、`receivedCount: 0`、不存在的 id → 全部 `toBe(data)`。
  - 收货**不改**该批次以外的任何数据（`dogs` 里其他批次狗的 `batchId` 逐字不变）。

**Steps**
- [ ] **Step 1**：先改 `planning.test.ts`（红态：`createBatchFromPlan is not a function` / `addBatchWithDogs is not a function`）。
- [ ] **Step 2**：改 `src/domain/planning.ts`、`src/domain/actions.ts`、`src/ui/pages/CalculatePage.tsx`。
- [ ] **Step 3**：`npx vitest run` / `npm run build` / `npm run lint` / `git status --short`。
- [ ] **Step 4**：提交：
  ```bash
  git add src/domain/planning.ts src/domain/planning.test.ts src/domain/actions.ts src/domain/actions.test.ts src/ui/pages/CalculatePage.tsx
  git commit -m "feat: 收货只记收购款（先做后补账，修订三 D14）"
  ```

> **Task 24 实施记录（2026-10-06）—— 提交 `2109b84`**（6 files / +483 / −110）
>
> **门禁**：`Test Files 24 passed (24)` / `Tests 583 passed (583)`（基线 565，**+18**）、`tsc -b` 0 error + `✓ 52 modules transformed` / `✓ built in 241ms`（模块数不变符合预期：`planning.ts` 本就在 bundle 里）、`npx oxlint` `Found 0 warnings and 0 errors.`（66 files）、`git status --short` 空。控制器独立复跑门禁一致。
>
> **落点**：`src/domain/planning.ts` 删旧 `:72-134` 的 `createBatchFromPlan`，新增 `:81 addBatchWithDogs`、`:143 receiveBatch`（`plan`/`PlanInput`/`PlanResult` 一字未动）；`src/domain/actions.ts:452 receivePreOrder`（`:3` 新增 `import { addBatchWithDogs } from './planning'`，文件头纪律注释写明这是唯一例外及理由）；`src/ui/pages/CalculatePage.tsx` 按钮改「收货」+ 两字段弹窗（`openReceive` `:129`、`handleReceive` `:135`、校验 `:100-111`、弹窗 `:400-420`）；`src/ui/planForm.ts:135` 注释去掉 `createBatchFromPlan()`。
>
> **红态**：`Test Files 2 failed | 22 passed (24)` / `Tests 29 failed | 554 passed (583)`，全部 `TypeError: addBatchWithDogs is not a function`（`planning.test.ts:260:19`）、`TypeError: receiveBatch is not a function`（`:277:18`）、`TypeError: receivePreOrder is not a function`。
>
> **五处偏离（全部接受）**：①任务书写的「12 条」实为 **10 条**（本节原文已改）；②旧「只数 0 建空批次」是**行为变更**而非等价改写——新版只数 0/负数/NaN/Infinity 一律返回同一引用且 `batchId === null`，什么都不建；③三种成本流水的旧断言（17 笔 / 8 笔 quarantine / 运输为 0 不写）**删除而非搬迁**，由 Task 25 重建（本节测试要求已注明）；④`src/ui/planForm.ts` 是控制器追加的第 6 个文件；⑤成功文案「已建批次」→「已收货」，弹窗里另加一句灰色提示「只记收购款。运输、疫苗、检疫与病死犬处理费都还没付，等真付了钱去『狗』标签页补账。」（控制器认可：这正是「先做后补账」的中心，不做提示用户会以为漏记）。
>
> **控制器裁定（实施者第 6 节的 7 处判断，全部保留）**：①守卫用 `!Number.isFinite(count) || count < 1`（`Math.floor(NaN)` 是 NaN、`Math.floor(Infinity)` 是 Infinity，只判 `< 1` 挡不住），比任务书更严，采纳；②`receivedCount: 0.5` → `floor` 后 0 → 返回同一引用（"当没收到"，不建空批次）；③`receivePreOrder` 先取 `const batchId = created.batchId` 再判空（TS 对属性访问不保留收窄），属防御性返回且返回的是**原 data**；④`preOrders` 用 `map` 只换命中的那一条，未命中的返回原对象引用（有 `toBe(other)` 钉着）；⑤**先查后建**——找不到 id 或状态不对直接 return，绝不先建批次再丢弃，所以 `batchId === null` 那条分支实际不可达；⑥弹窗「每只收购价」空串/纯空格当 0（`parseMoney('')` 返回 `null`，必须先 trim 判空），负数按非法处理（`parseMoney('-1')` = −100 是合法数字但语义非法）；⑦只数走 `parseAliveInput`（`/^\d+$/`），`'2.5'`/`'-1'`/`'1e3'` 都是红字。
>
> **留给 Task 25 的现场风险（必须在 Task 25 的 UI 接线之前解决，否则界面会给出偏低的价格）**：`batchTotalCost`（`src/domain/costing.ts:15`）现在收到的是**不完整的成本**——收货只写了收购款。如果任何界面在补账之前用 `floorPriceFen`/`batchPerDogCostFen` 显示「低于这个价别卖」，那个数字会偏低。Task 25 的 `batchCostsIncomplete` 就是为这条准备的，Task 28 负责在界面上把橙字提示挂出来；**在那之前不许新增任何展示保本价的批次视图**。实机走查时也要按"先收货、不补账、看批次详情"的顺序确认橙字确实出现。
>
> **其他现场事实**：`git grep createBatchFromPlan -- src` 无命中；`handleCreateBatch` 在 `src/` 下已无引用（`docs/` 里的历史引用未碰）；预定单收货后 `plannedChannel` 恒为 `'undecided'`（任务书要求），真正的去向在批次详情里改；`planning.test.ts` 现在有 `floorPriceFen(data, batchId)` 助手（`batchSummary` 的 `floorPriceFen` 为 null 就 throw），它那两条 `¥600` 断言在 Task 25 加成本后需要复核。

---

### Task 25: 补账表纯函数（`addBatchCosts` / `previewBatchCosts` / `batchCostsIncomplete`）

**Goal:** 把「回来之后把这一批的成本一次补进去」变成三个纯函数。**成本算法仍然只有 `costing.ts` 一处**——这里只负责"按只数生成几笔流水"。

**Files:**
- Create: `src/domain/batchCosts.ts`
- Create: `src/domain/batchCosts.test.ts`

**Interfaces:**
- Consumes: `dogsOfBatch`（`src/domain/costing.ts:3-5`）、`batchTotalCost`（`:15-19`，**只按 `type === 'expense' && batchId` 过滤、含收购款**）、`newId`、`Money`
- Produces:
  ```ts
  export function batchCostsIncomplete(data: AppData, batchId: string): boolean
  export function addBatchCosts(data: AppData, input: {
    batchId: string; date: string; transportFen: Money
    medicalPerDogFen: Money; quarantinePerDogFen: Money; disposalPerDogFen: Money
  }): AppData
  export function previewBatchCosts(data: AppData, input: {
    batchId: string; transportFen: Money
    medicalPerDogFen: Money; quarantinePerDogFen: Money; disposalPerDogFen: Money
  }): { count: number; totalFen: Money }
  ```

**必须满足的行为**
- `batchCostsIncomplete(data, batchId)` = `!data.entries.some(e => e.type === 'expense' && e.batchId === batchId && e.category !== 'purchase')`。**不能**用 `batchTotalCost(data, batchId) === 0` 代替（那个含收购款，新建批次刚收完货就 > 0，永远判不出"还没补成本"）。
- `addBatchCosts` 一次 update 追加四类流水，**一律 `type: 'expense'`、`paidBy: 'pool'`、`batchId`、`date: input.date`**：
  | 类别 | 笔数 | `dogId` |
  |---|---|---|
  | `transport`（运输 + 笼具） | **1 笔**（整批） | `null` |
  | `medical`（疫苗驱虫医疗） | **这一批全部狗**，每只一笔 | 各狗 `id` |
  | `quarantine`（检疫（抗体检测 + 申报）） | **这一批全部狗**，每只一笔 | 各狗 `id` |
  | `disposal`（病死犬无害化处理） | **点击那一刻已标死亡（`status === 'dead'`）的只数**，每只一笔 | 各死狗 `id` |
  - "全部狗"用 `dogsOfBatch(data, batchId)` **不过滤状态**（卖掉的、退回的、死了的都算打过疫苗——这是用户口径，设计 §3.10）。
  - **填 0 的那一行一笔都不写**（与 `planning.ts:98/116/119/123` 的既有约定一致）。四行全 0 → 什么都不追加，返回**新对象**（无变化就返回同一引用也可以，但**必须**保证不产生任何流水）。
  - **只新增，不替换**：不得删除或改写任何既有流水（要与既有手记的支出共存——这条要有测试）。
  - 找不到 `batchId` → 返回同一引用。
- `previewBatchCosts`：`count` 与 `totalFen` **只算这一次要新增的四行**（不含已记成本、不含收购款），逻辑与 `addBatchCosts` 的笔数口径**逐字一致**（实现上让 `addBatchCosts` 调它来做校验或共用同一个内部函数，避免两套笔数算法）。**`totalFen` 是四行金额按各自笔数相乘后的和**：`transportFen + 全部狗数 × medicalPerDogFen + 全部狗数 × quarantinePerDogFen + 死狗数 × disposalPerDogFen`。

**测试要求**（`batchCosts.test.ts`）
- 8 只狗 2 只死：`addBatchCosts` 传入四个正数 → 追加 **1 + 8 + 8 + 2 = 19 笔**；逐类按 `category` 数一遍（不要只数总数——总数 19 在"medical 8 + quarantine 8 + 别的 3"这种错法下也可能成立）。
- 只填运输 → 只 1 笔；四行全 0 → 一笔都不新增。
- **与手记的支出共存**：先在 `data.entries` 里放一笔用户自己记的该批 `expense`（`category: 'other'`），补完账后那笔**逐字还在**，且总笔数只多不少。
- `disposal` 按"点击那一刻"取快照，**且不按 `dogId` 去重**：补账后把一只狗标 `dead` 再补一次 `disposal` → 这一次会为**当时所有死亡犬**各记一笔（原例里是 3 笔，总计 5 笔），旧的两笔**连引用都不换**。**"不自动追溯、也不去重"是刻意的**（设计 §3.10 `:411` 与 §7 验收 `:547`：同一张表连点两次必须得到**两倍**流水）——真正拦住重复记账的是表下常显的「这一批已记成本 ¥X · 共 N 笔」与提交前的「将新增 N 笔」确认，不是静默去重。（本行原文写「只新增 1 笔」，与设计冲突，是控制器的笔误，已按设计改正。）
- `batchCostsIncomplete`：新建批次（只有 `purchase` 流水）→ `true`；补一笔 `transport` → `false`；只有一笔手记的非 purchase 支出 → `false`（用户记了账就不再挂橙字）。
- `previewBatchCosts` 的 `count` / `totalFen` 与 `addBatchCosts` 实际新增的笔数与金额**逐字相等**（同一条 fixture 跑两遍对比）。
- 找不到 `batchId` → `toBe(data)`。

**Steps**
- [ ] **Step 1**：写失败测试（红态：`Cannot find module './batchCosts'`）。
- [ ] **Step 2**：实现 `src/domain/batchCosts.ts`。
- [ ] **Step 3**：`npx vitest run` / `npm run build` / `npm run lint`。
- [ ] **Step 4**：提交：
  ```bash
  git add src/domain/batchCosts.ts src/domain/batchCosts.test.ts
  git commit -m "feat(domain): 补账表（只新增不替换）"
  ```

> **Task 25 实施记录（2026-10-06）—— 提交 `9922e6f`**（2 files / +500 / −0，只新增 `src/domain/batchCosts.ts` 129 行与 `src/domain/batchCosts.test.ts` 371 行 / 27 条，既有文件一个字节没动）
>
> **门禁**：`Test Files 25 passed (25)` / `Tests 610 passed (610)`（基线 24 / 583，**+27**）、`tsc -b` 无输出 + `✓ 52 modules transformed` / `✓ built in 215ms`、`npx oxlint` `Found 0 warnings and 0 errors.`（68 files）、`git status --short` 空。控制器独立复跑一致。红态：`Error: Cannot find module './batchCosts' imported from ...batchCosts.test.ts`。
>
> **落点**：`batchCosts.ts:20 BatchCostsInput`（导出接口，替代任务书的行内对象——两函数入参逐字相同，抽一处防分叉，与 `AddPreOrderInput`/`DogQuarantinePatch` 同体例）、`:39 safeMoney`（`!Number.isFinite → 0` **再** `Math.max(0, Math.round())`）、`:51 plannedCostEntries`（**不导出，笔数口径唯一实现**）、`:104 batchCostsIncomplete`、`:110 addBatchCosts`、`:121 previewBatchCosts`（只 `count = entries.length` + `totalFen = entries.reduce((s,e)=>s+e.amount,0)`，**没有第二套乘法公式**）。
>
> **控制器裁定（唯一需要裁定的一条）**：任务书 `:4938` 那句「补第二次 `disposal` 只新增 1 笔」**是控制器的笔误，按设计改正**——设计 §3.10 `:411`（"只新增、不替换……因此同一张表点两次会记两遍"）与 §7 验收 `:547`（"同一张表连点两次必须得到**两倍**流水（这是刻意行为，不是 bug）"）都要求**不去重**；brief 里写的也只是"disposal 只覆盖点击那一刻 `status === 'dead'` 的狗"。实施者按不去重实现（第二次为当时 3 只死狗各记一笔、总计 5 笔，旧两笔连引用都不换）并额外写了一条测试把"补账不幂等"钉死——**采纳**。本任务书那一行已改写。**拦住重复记账的办法是表下常显「这一批已记成本 ¥X · 共 N 笔（含收购款）」+ 提交前「将新增 N 笔流水，共 ¥X」的确认，不是静默去重**（口径见设计 §3.10）。
>
> **其余判断（全部保留）**：①`previewBatchCosts` 复用 `plannedCostEntries` 会白生成 19 次 `crypto.randomUUID()` 随即丢弃——接受，换来笔数口径真的只有一处；②`batchCostsIncomplete` 对不存在的批次 id 返回 `true`（按任务书公式自然如此，UI 不会问），不额外加守卫；③`type: 'expense' as const` / `paidBy: 'pool' as const` 是收窄字面量的常规手段，不是静音手段；④`base` 在循环外建一次被展开共享，字段全是原始值，不存在共享可变引用；⑤四行全 0 返回**同一引用**（与"找不到批次"同一判据）。
>
> **额外建的测试（任务书没点名但值得留着）**：数学上的 `safeMoney` 边界（`0.6 → 1 分`、`0.4 → 什么都不产生`；负数/NaN/Infinity 静默不产生且 `entries.every(e => Number.isFinite(e.amount))`）；`previewBatchCosts` 批次不存在 → `{0,0}` 且不改动 data；三条旧口径在**「收货 → 补账」完整链路**上重建（`receivedEightDogs()` 先 `addBatchWithDogs` 建 8 只再补账）：17 笔 = 8 收购 + 1 运输 + 8 疫苗且 `batchTotalCost === 8*60000 + 40000 + 8*8000`、8 笔 quarantine、运输为 0 不写而 medical 仍 8 笔。
>
> **交给 Task 26/27/28 的三条硬约束**：①补账不幂等是刻意的，界面必须常显已记成本合计与笔数、并在提交前用 `previewBatchCosts` 弹「将新增 N 笔流水，共 ¥X」；②`disposal` 的"点击那一刻"要求 UI **在提交时**读当时的 `dogs[].status`，**不许**在弹窗打开时缓存死狗名单；③`floorPriceFen`/`batchPerDogCostFen` 在补账前仍偏低，`batchCostsIncomplete` 的橙字提醒不能让用户少看到。

---

### Task 26: 流水纠错纯函数（`updateEntry` / `deleteEntry`）

**Goal:** 让用户能改一笔账、删一笔账。**这是第一次让 `entries` 不再只能追加**，所以连带规则必须由测试钉死。

**Files:**
- Modify: `src/domain/actions.ts`（末尾追加两个导出）
- Modify: `src/domain/actions.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function updateEntry(data: AppData, entryId: string, patch: {
    amount?: Money; date?: string; note?: string
    paidBy?: 'pool' | string; category?: string
  }): AppData
  export function deleteEntry(data: AppData, entryId: string): AppData
  ```
- **刻意不提供**的键：`type` / `id` / `batchId` / `dogId`（类型上就不给，用户改不了"这笔账属于谁"）。

**必须满足的行为**
- `updateEntry`：找不到 id → 同一引用。`amount` 有值时 `Math.max(0, Math.round(patch.amount))`（**0 合法、负数夹到 0**，与 `addExpense` / `sellDog` / `transferEntry` 一字不差）。`category` **只对 `type === 'expense'` 生效**：非 `expense` 的流水即使 patch 里带了 `category` 也**原样不动**（`income` 的 `'sale'`、转账类的 `'transfer'` 不能被改成别的）。`patch` 里的每个字段**只有真正不同**才写进去；**没有任何字段实际变化时返回同一引用**（界面上"什么都没改就点保存"不该产生一次写库）。
- `deleteEntry`：找不到 id → 同一引用；否则物理删除那一笔，并且**在同一次更新里**处理连带：
  - 被删的是 `type === 'income'` 且 `dogId` 非空，**并且它是该狗数组里最后一条 `income`**（用与 `src/ui/dogLedger.ts:24-28` 相同的"数组下标扫描"口径判定：该狗所有 `income` 中下标最大的那条就是这个 id）→ 把该狗 `status` 改回 `'in_stock'`，**但该狗当前已经是 `dead` 时一个字节都不动**（可达路径：卖出 → 退款退回 `returned` → 又标了 `dead`；狗死了是另一个事实，无害化处理费与死亡率都按它算过，删一笔收入不能把狗复活成在库）。
  - **改回 `in_stock` 时按目标状态再判一次**：`status === 'sold' || status === 'returned'` 才改，其余（`dead`、本来就在库）原样不动。
  - **不是最后一条**（可达路径：卖 → 退款把狗变 `returned` → `isOnHand` 让「卖出」按钮重现 → 又卖一次，同一 dogId 两条 `income`）→ **狗的状态一个字节都不许动**。
  - 删任何其他流水（支出、退款、注资、分红、报销、散收入）→ **不改任何狗状态**（退款流水不是"狗在哪"的决定者）。
- `src/ui/dogLedger.ts` 的 `lastSaleIndex` / `refundedCurrentSale` **不要动**：它们的数组下标口径在物理删除下依然正确（删掉退款那笔，`some(i > saleIdx)` 自然变 `false`），而**改成按 `date` 会打挂 `dogLedger.test.ts:62-68`** 那条「卖 → 退款 → 又卖出（同日）」的既有回归。这是那轮审查的复核结论，不要再"顺手改好"。

**测试要求**
- 改金额：改成 0 合法、负数夹到 0；改完之后 `poolBalance` / `batchSummary` 这些派生值跟着变（用 `src/domain/ledger.ts` 的 `poolBalance` 与 `costing.ts` 的 `batchTotalCost` 断言一次，证明"余额是现算的"）。
- 改 `date` / `note` / `paidBy`；改 `expense` 的 `category` 生效；**`income` 带 `category` 被忽略**（逐字断言 `category` 仍是 `'sale'`）。
- `type` / `id` / `batchId` / `dogId` 在 `updateEntry` 之后**逐字不变**。
- 无变化的 patch → `toBe(data)`。
- 删销售流水（该狗只有这一条 `income`）→ 狗回 `'in_stock'`，其余狗状态不变。
- **狗已经 `dead` 时删它那条（最后的）销售流水 → 狗状态仍是 `dead`，一个字节都不动**（控制器派发前补的裁定：卖 → 退款退回 → 又标死亡，这条路径可达；「删了收入就把死狗复活成在库」会让死亡率与无害化处理费全对不上）。
- **「卖 → 退款（狗变 `returned`）→ 又卖一次」之后删掉更早那条 `income` → 狗状态不变**（这是 C3 的核心用例，别省）。
- 删退款流水 → 狗状态不变、`refundedCurrentSale` 变 `false`（在 `dogLedger.test.ts` 里用既有的 `sale` / `refund` 辅助函数补一条，证明删掉之后界面不会继续显示「已记退款」）。
- 删注资 / 分红 / 报销 / 支出 → 任何狗状态都不变。
- 不存在的 id → `toBe(data)`。

**Steps**
- [ ] **Step 1**：写失败测试（红态：`TypeError: updateEntry is not a function`、`deleteEntry` 同理）。
- [ ] **Step 2**：实现两个导出（放在 `actions.ts` 末尾，`renameBatch` 之后）。
- [ ] **Step 3**：`npx vitest run` / `npm run build` / `npm run lint`。
- [ ] **Step 4**：提交：
  ```bash
  git add src/domain/actions.ts src/domain/actions.test.ts src/ui/dogLedger.test.ts
  git commit -m "feat(domain): 流水可改可删（含删销售流水的连带规则）"
  ```

---

### Task 27: 预定单界面（「狗」页顶部的预定单区）

**Goal:** 让用户能记下一张预定单、看到"该去收了"、点一下收货。位置固定在**「狗」页列表视图顶部**（`DogsPage.tsx` 列表视图内、`<ul className="mt-4 space-y-2">` 之前——也就是 `:125` 之前），**不新增第 6 个标签**。

**Files:**
- Create: `src/ui/preOrderForm.ts`
- Create: `src/ui/preOrderForm.test.ts`
- Modify: `src/ui/pages/DogsPage.tsx`

**Interfaces:**
- Consumes: `preOrderList` / `duePreOrderCount` / `preOrderStage`（Task 23）、`addPreOrder` / `updatePreOrder` / `cancelPreOrder` / `deletePreOrder`（Task 23）、`receivePreOrder`（Task 24）、`useAppData`、`todayLocalIso`（`src/ui/planForm.ts:47`）、`localTimeHm`（`:54-66`）、`parseAliveInput`（`src/ui/channelView.ts:135`，**空串 → `null`**，正好用于"只数"字段）
- Produces: `src/ui/preOrderForm.ts` 里的纯函数（表单校验与草稿 → 动作入参的转换），例如：
  ```ts
  export interface PreOrderDraft { sellerName: string; sellerContact: string; expectedCount: string; collectDate: string; traits: string; note: string }
  export function canSubmitPreOrder(draft: PreOrderDraft): boolean
  export function draftIssue(draft: PreOrderDraft): string | null   // 返回中文红字，null = 没问题
  ```

**必须满足的行为**
- 顶部区块（列表视图内、批次列表之前）：
  - 一行标题「预定单」+ 一个「+ 记一张」按钮（展开新建表单）。
  - `duePreOrderCount(data, today) > 0` 时，标题下挂一条醒目提醒：**「有 N 张该去收了」**（橙/红字，与既有 `text-red-500` / `text-emerald-600` 的配色体例一致）。
  - 卡片列表严格按 `preOrderList(data, today)` 的顺序渲染，每张卡显示：卖家名、`约 ${expectedCount} 只`、`${collectDate} 去收`、一个阶段标签（`upcoming`「还没到日子」/ `due_soon` 与 `overdue` 都显示「**该去收了**」、`received`「已收货」、`cancelled`「黄了」+ 原因）。
  - 没有预定单时**不渲染整块**（与「报」页空态的处理一致：空时不占位置），而不是显示一个空标题。
- 每张卡的动作：
  - `reserved`（`upcoming` / `due_soon` / `overdue`）：**「收货」「改」「黄了」**三个按钮。`overdue` 时「收货」用主色突出。
  - `received`：只显示「已收货」与批次名（可点进那个批次）+「改备注」（**只有 `note` 可改**）。
  - `cancelled`：只显示原因 +「删掉」。
- 新建 / 修改表单（6 个字段：卖家、联系方式、约几只、约好哪天、特征、备注）：`type="date"` 用**原生日期输入**（与检疫页一致），只数与 `parseAliveInput` 同口径（空或非法 → 红字、按钮禁用）；提交前调 `canSubmitPreOrder` / `draftIssue`。
- 收货弹窗**只有两个字段**：实收只数（默认 `expectedCount`）、每只收购价（默认空）。确认 → `receivePreOrder(data, id, { name, date, receivedCount, unitPriceFen })`，其中 `name = \`收狗 ${receivedCount} 只 ${localTimeHm(new Date())}\``、`date = todayIso()`、`unitPriceFen = parseMoney(...)`；这三个都由**事件处理器**算（渲染体里不许 `new Date()`）。成功后显示「已收货，批次：{name}」。
- 「黄了」弹窗：一个原因输入（可空，但空时给中性提示「不写原因也行，以后自己看得懂就行」）→ `cancelPreOrder`。
- 删除：二次确认（`window.confirm` 与既有删除入口保持同一体例）→ `deletePreOrder`；**已收货的卡片没有删除按钮**。
- 表单状态（草稿）**不得跨卡片残留**：Task 21b 那个"草稿串台"的缺陷在这里同样会犯——打开另一张卡或收起表单时必须重置草稿；把理由写进 state 的注释里。

**测试要求**（`preOrderForm.test.ts`）
- `draftIssue`：卖家名为空 → 红字；只数为空 / `'abc'` / `'0'` / `'1.5'` → 红字；日期为空 → 红字；全部合法 → `null`。
- `canSubmitPreOrder` 与 `draftIssue` **同一个判定**（用同一组输入断言两者一致——避免出现"按钮亮着但点了出红字"或反过来）。
- 只数用 `parseAliveInput` 的口径：`'3'` → 3、`' 3 '` → 3、`''` → `null`、`'0'` → 0（0 是合法整数，但 `canSubmitPreOrder` 因为 `expectedCount < 1` 仍然为 `false`——**这两件事都要有测试**）。

**Steps**
- [ ] **Step 1**：写 `preOrderForm.test.ts` 与实现（这部分与界面无关，可以先红后绿）。
- [ ] **Step 2**：改 `src/ui/pages/DogsPage.tsx`（只加列表视图内的预定单区，**详情视图不碰**）。
- [ ] **Step 3**：`npx vitest run` / `npm run build` / `npm run lint`（注意 `noUnusedLocals`：`preOrderStage` 之类没用到的符号不要 import）。
- [ ] **Step 4**：提交：
  ```bash
  git add src/ui/preOrderForm.ts src/ui/preOrderForm.test.ts src/ui/pages/DogsPage.tsx
  git commit -m "feat(ui): 预定单区（记单、提醒、收货、黄了）"
  ```

---

### Task 27b: 预定单提醒天数进设置（`validateSettings` + 设置面板）

**Goal:** `Settings.preOrderLeadDays` 在 Task 22 只落了类型与默认值，**全仓没有任何界面能改它**，而设计 §3.9 / §10 写的是「想提前一周就在设置里改数字」。把它接进设置面板，并让负数进不了 `AppData`。

**为什么有这一条任务：** 控制器在 Task 23 复核时逐文件 grep 了 `preOrderLeadDays`，发现它只出现在 `types.ts` / `normalize.ts` / `backup.ts`（都是 Task 22 的读路径）与 `preOrders.ts`（Task 23 的推导），**`SettingsPanel.tsx` 与 `settlement.ts` 里一次都没有** —— 也就是说用户看到「该去收了」的提前量是硬编码般的 3 天，与 `rabiesWaitDays` / `quarantineLeadDays` 那两个"可改设置"不一致。这是设计承诺与实现之间的缺口，补它。

**Files:**
- Modify: `src/domain/settlement.ts`（`validateSettings` 末尾追加一行）
- Modify: `src/domain/settlement.test.ts`
- Modify: `src/ui/pages/SettingsPanel.tsx`

**Interfaces:**
- Consumes: `Settings.preOrderLeadDays`（Task 22）、`updateSettings`（`src/domain/actions.ts:218`）、设置面板既有的 `inputError('days', …)` / `applyDaysInput`（`SettingsPanel.tsx:157-191` 那两条字段的写法）
- Produces: 无新导出

**必须满足的行为**
- `validateSettings` 追加 `if (!(settings.preOrderLeadDays >= 0)) return '预定单提醒提前天数不能为负'`（`!(x >= 0)` 同时拦 `NaN`，与既有两条同风格，**不要**写成 `settings.preOrderLeadDays < 0`）。
- `SettingsPanel.tsx` 新增一个 `<h3>`「预定单」区与一行数字输入「预定单提前几天提醒」（`suffix="天"`、`inputMode="numeric"`），结构与「申报检疫提前天数」逐字同体例：一个 `preOrderLeadDaysDraft` state、`error={preOrderLeadDaysDraft === null ? undefined : inputError('days', draft)}`、`applyDaysInput` 返回 `days === null` 时**不写账只出红字**、合法时 `void update(d => updateSettings(d, { preOrderLeadDays: days }))`。
- 字段下面一行灰字说明：「默认 3 天。想提前一周就改成 7。」（**不要**写「法定 3 天」——这个数字是本工具的提醒提前量，没有任何法条依据。）

**测试要求**（`settlement.test.ts`）
- `preOrderLeadDays: -1` → 逐字 `'预定单提醒提前天数不能为负'`；`preOrderLeadDays: NaN` → 同一条；`0` → 合法（返回 `null`，与既有两个天数设置一致：0 = 设在当天）。
- 既有断言一条都不改。

**Steps**
- [ ] **Step 1**：先写两条失败测试（红态：`expected undefined to be '预定单提醒提前天数不能为负'` 或 `validateSettings` 返回 `null`）。
- [ ] **Step 2**：改 `src/domain/settlement.ts` 与 `src/ui/pages/SettingsPanel.tsx`。
- [ ] **Step 3**：`npx vitest run` / `npm run build` / `npm run lint` / `git status --short`。
- [ ] **Step 4**：提交：
  ```bash
  git add src/domain/settlement.ts src/domain/settlement.test.ts src/ui/pages/SettingsPanel.tsx
  git commit -m "feat(ui): 预定单提醒提前天数进设置"
  ```

---

### Task 28: 批次详情——补账表 + 卖家与留痕 + 「还没补成本」橙字

**Goal:** 让用户收完狗回来，能在批次详情页一屏把这一批的成本补齐；并且**看得见**卖家是谁、比约定的少了没有。

**Files:**
- Create: `src/ui/batchCostsForm.ts`
- Create: `src/ui/batchCostsForm.test.ts`
- Modify: `src/ui/pages/DogsPage.tsx`（详情视图）

**Interfaces:**
- Consumes: `addBatchCosts` / `previewBatchCosts` / `batchCostsIncomplete`（Task 25）、`batchTotalCost`（`src/domain/costing.ts:15-19`）、`parseMoney`（`src/domain/money.ts`）、`useAppData`、`todayLocalIso`
- Produces: `src/ui/batchCostsForm.ts` 里的纯函数（四行金额的解析、预览文案、提交入参），例如：
  ```ts
  export interface BatchCostDraft { transport: string; medicalPerDog: string; quarantinePerDog: string; disposalPerDog: string }
  export function draftToAmounts(draft: BatchCostDraft): { transportFen: Money; medicalPerDogFen: Money; quarantinePerDogFen: Money; disposalPerDogFen: Money }
  export function batchCostDraftIssue(draft: BatchCostDraft): string | null
  export function previewText(count: number, totalFen: Money): string   // 「将新增 19 笔，合计 ¥1,234.00」
  ```

**必须满足的行为**
- 详情视图底部加一个**默认折叠**的「补成本」区块（折叠体例与「算」页的渠道对照一致）。
- 四行输入（标签逐字）：**运输 + 笼具（整批一笔）**、**每只疫苗 / 驱虫 / 医疗**、**每只检疫（抗体检测 + 申报）**、**每只病死犬处理费**（后三个是"每只单价"，标签里必须写出"每只"，否则用户会当成总额）。
- 区块里常显一行：「**这一批已记成本 ¥X · 共 N 笔（含收购款）**」，其中 ¥X = `batchTotalCost(data, batchId)`、N = 该批 `expense` 流水的条数（**两者都含收购款**，设计 §3.10 已写死口径）。
- `batchCostsIncomplete(data, batchId)` 为 `true` 时，区块标题旁挂一行橙字：「**这一批还没补成本，保本价现在是偏低的**」（这是设计里那句话，逐字用）。
- 提交按钮文案带笔数与金额：用 `previewBatchCosts` 实时算（"将新增 19 笔 · ¥1,234.00"）；**点之前弹一次确认**（`window.confirm`，文案含笔数与金额），确认后才调 `addBatchCosts`。四行全 0 或全部非法 → 按钮禁用。
- 金额输入一律走 `parseMoney`；非法 → 行内红字 + 按钮禁用；**空 = 0**（"不补这一项"与"这项是 0"在账上等价——因为填 0 本来就不写流水）。
- 详情**头部**渲染 `batch.source`（卖家）与 `batch.note`（留痕）：`source` 非空时显示「卖家：老李家」，`note` 非空时显示在下面一行小字（此前 `Batch.note` 全仓没有任何渲染点，这次必须渲染出来，否则「来自预定单」「比约定的少 2 只」这些留痕用户根本看不到）。
- 补账**绝不删改**任何既有流水（Task 25 已保证，界面也不许自己"先清后写"）。

**测试要求**（`batchCostsForm.test.ts`）
- `draftToAmounts`：四个空串 → 四个 0；`'1,200'` → `120000`（`parseMoney` 的口径）；非法 → 由 `batchCostDraftIssue` 给红字。
- `batchCostDraftIssue`：`'abc'` → 红字；全空 → `null`（合法，只是不补）；负数 → 红字。
- `previewText(19, 123400)` → 逐字断言（含中文顿号与 `¥` 写法，与既有 `formatMoney` 输出一致——**用 `formatMoney` 拼，不要自己写货币格式**）。
- 四行全 0 时"能不能提交"的判定与 `previewBatchCosts().count === 0` 一致。

**Steps**
- [ ] **Step 1**：写 `batchCostsForm.test.ts` 与实现。
- [ ] **Step 2**：改 `src/ui/pages/DogsPage.tsx` 详情视图（补成本区块 + 头部渲染卖家与留痕）。
- [ ] **Step 3**：`npx vitest run` / `npm run build` / `npm run lint`；手动在 `npm run dev` 里点一遍（不要求真机）。
- [ ] **Step 4**：提交：
  ```bash
  git add src/ui/batchCostsForm.ts src/ui/batchCostsForm.test.ts src/ui/pages/DogsPage.tsx
  git commit -m "feat(ui): 批次详情补成本与留痕渲染"
  ```

---

### Task 29: 「钱」页——每笔都能改能删 + 「显示全部」

**Goal:** 用户发现记错一笔的时候，能就地改掉或删掉，而不是只能再记一笔抵消。

**Files:**
- Create: `src/ui/entryForm.ts`
- Create: `src/ui/entryForm.test.ts`
- Modify: `src/ui/pages/MoneyPage.tsx`

**Interfaces:**
- Consumes: `updateEntry` / `deleteEntry`（Task 26）、`entryLabel` / `catLabel` / `partnerName` / `canSubmit`（`src/ui/moneyBook.ts`）、`parseMoney`、`amountInvalid`（`src/ui/moneyBook.ts`）、`useAppData`
- Produces: `src/ui/entryForm.ts` 里的纯函数：
  ```ts
  export interface EntryDraft { amount: string; date: string; note: string; paidBy: 'pool' | string; category: string }
  export function entryPatch(entry: LedgerEntry, draft: EntryDraft): { amount?: Money; date?: string; note?: string; paidBy?: string; category?: string }
  export function entryDraftIssue(entry: LedgerEntry, draft: EntryDraft): string | null
  export function deleteWarning(data: AppData, entry: LedgerEntry): string   // 删除确认弹窗的正文
  export function entryScope(data: AppData, entry: LedgerEntry): string      // 「狗 收狗 3 只 09:10-2」/「批次 收狗 3 只 09:10」/「—」
  ```

**必须满足的行为**
- 每行流水加「改」「删」两个小按钮（体例与既有 `DogsPage` 卡片上的小按钮一致，不要做成大按钮挤掉金额）。
- 「改」打开弹窗（**复用既有 `src/ui/components/Modal.tsx`**），字段：金额、日期、备注、经手人（`pool` / 两位合伙人）、**支出类别（只有 `expense` 显示这一项）**。确认 → `updateEntry(data, id, entryPatch(...))`。
  - 金额空 / 非法 → 红字 + 按钮禁用；**0 合法**（与新增路径一致）。
  - 「什么都没改就点保存」时 `entryPatch` 返回空对象、`updateEntry` 返回同一引用、界面直接关弹窗。
- 「删」弹窗正文由 `deleteWarning` 生成，**必须覆盖这四种情形**（设计 §3.11 G5）：
  - 删的是带狗的销售流水（`type === 'income'`）→ 写明「**这只狗会回到在库**」（并且若它是该狗最后一条销售流水才真的回退——文案与 Task 26 的规则一致，别写反）。
  - 该狗还挂着退款支出（`refundedCurrentSale` 为 `true`）→ 追加「那笔退款从此在界面上对不上任何一只狗，请自己去核一下」。
  - 删的是退款流水（`category === 'aftercare_refund'`）→ 写明「删掉之后那只狗会重新出现『退款』按钮，别对同一只狗再退一次」。
  - 其余 → 一般性「这笔账会被永久删除，没有撤销」，并写明它挂在哪只狗 / 哪个批次。
- 每行第二行显示挂靠：`entryScope` 用狗的 `code` 与批次名解析（`batchId` → `batches` 里的 `name`；`dogId` → `dogs` 里的 `code`）。**批次改名不追溯狗号**，所以狗号与批次名可能不一致——**这是预期的**，不要"修正"它，解析不到就显示 `—`。
- 列表底部：`data.entries.length > 60` 时显示「**还有 N 笔更早的 · 显示全部**」按钮，点开渲染全部（倒序）；`N = data.entries.length - 60`。不做分页。

**测试要求**（`entryForm.test.ts`）
- `entryPatch` **只带真正改动的键**：金额从 `'50'` 改成 `'50'` → 空对象；`'50'` → `'60'` → `{ amount: 6000 }`；同时改日期与备注 → 两个键。
- `entryPatch` 对 `income` 的草稿里带 `category` → 生成的 patch **不含** `category`（护栏在域层，界面也不主动送）。
- `entryDraftIssue`：金额 `'abc'` → 红字；`'0'` → `null`（0 合法）；负号 → 红字。
- `deleteWarning` 四种情形各一条，**逐字断言关键字**（「回到在库」「对不上任何一只狗」「别对同一只狗再退一次」「没有撤销」），并且断言"普通支出"不会误报成销售流水。
- `entryScope`：三情形（挂狗、挂批次、都不挂）与"批次改名后狗号不变、批次名变新名"。

**Steps**
- [ ] **Step 1**：写 `entryForm.test.ts` 与实现。
- [ ] **Step 2**：改 `src/ui/pages/MoneyPage.tsx`（行内按钮、两个弹窗、显示全部）。
- [ ] **Step 3**：`npx vitest run` / `npm run build` / `npm run lint`。
- [ ] **Step 4**：提交：
  ```bash
  git add src/ui/entryForm.ts src/ui/entryForm.test.ts src/ui/pages/MoneyPage.tsx
  git commit -m "feat(ui): 流水就地改与删、显示全部"
  ```

---

### Task 30: 收尾——文档同步、真机走查、重新上线

**Goal:** 把修订三送到用户手上：文档说清楚、真机走一遍（含老数据不被打坏）、重新构建并推上去。**这一条与 `### Task 14` 不重复**：Task 14 的产物（备份横幅、备份面板、manifest、图标、`DEPLOY.md`）第一版已经上线，这里只做"改完之后再发一次"。

**Files:**
- Modify: `README.md`（功能一句话里补上「预定单」「先做后补账」「流水能改能删」；若已经有"五个标签页"的说明，**不要改数字**——预定单在「狗」页里）
- Modify: `docs/superpowers/specs/2026-10-02-dog-trading-ledger-design.md`（只在发现实现与设计不符时才改，改之前先报告）
- 台账：`.superpowers/sdd/2026-10-02-dog-ledger/progress.md`（被 `.gitignore:27` 忽略，不进 git）

**必须满足的行为**
- 三条门禁原样贴进报告：`npx vitest run`、`npm run build`、`npm run lint`，外加 `git status --short` 为空。
- **真机走查由控制器用 CDP 探针做**（与 Task 20 / 21 同一套骨架：`npx vite preview --port 5199 --strictPort` 后台作业 + 探针脚本 + 真实 IndexedDB），至少覆盖：
  1. **老数据不被打坏**：往 IndexedDB 里写一个**不含 `preOrders`、不含 `preOrderLeadDays`** 的旧 `AppData` → 刷新 → 五个标签页都能打开、「狗」页不空白、「报」页照常出数字。
  2. **导出 → 清空 → 导入**：导出后含预定单（写进文件里核对一次），清站点数据后导入，**预定单逐条还原**（这条专门钉住 `preOrders: data.preOrders ?? []` 那个陷阱）。
  3. 记一张预定单 → 改日期到"今天" → 顶部出现「有 1 张该去收了」→ 收货（实收只数比约定的少 1）→ 批次详情里卖家与「比约定的少 1 只」都看得到。
  4. 批次详情「补成本」：四行填数 → 确认弹窗笔数正确 → 补完后「这一批已记成本」数字与笔数都变、橙字消失。
  5. 「钱」页：改一笔金额 → 对账单与分账跟着变；删一笔销售流水 → 那只狗回到在库；「显示全部」在超过 60 笔时出现且能展开。
  - 0 条 `Runtime.exceptionThrown`、0 条 `console.error`。
- **重新上线**：`npm run build` → `git push origin master` → 产物推 `gh-pages`（`DEPLOY.md` 里的既有流程）；推送若被 GitHub 间歇阻断就重试。线上地址不变。**推之前先确认走查全绿**——用户的真实数据就在这个站上。
- 报告里必须写明：本次改动对上线的哪个提交、线上站址、走查 N/N、以及"老备份能否恢复"的实测结论。

**Steps**
- [ ] **Step 1**：改 `README.md`（只补功能说明，不重写）。
- [ ] **Step 2**：跑三条门禁，贴原文。
- [ ] **Step 3**：控制器跑 CDP 走查（探针归档到 `.superpowers/sdd/2026-10-02-dog-ledger/probes/`）。
- [ ] **Step 4**：提交 README：`git add README.md` → `git commit -m "docs: README 补预定单与补账说明"`。
- [ ] **Step 5**：推送 `master` 与 `gh-pages`，验证线上地址可用（打开、五个标签、旧数据在）。

---

### Task 14: 备份安全网 + PWA + 上线

> **状态（2026-10-03）**：本任务**已在第一版落地并上线**（GitHub Pages）。上面 Task 22–30 是修订三的实施任务，它们结束之后由 Task 30 负责重新构建与推送；本任务的步骤与验收标准保持原样，作为"如果将来要重做一遍"的参考与验收依据。

**Files:**
- Create: `src/ui/backupStatus.ts`（Step 3 写的两个纯函数）
- Create: `src/ui/backupStatus.test.ts`（Step 1 写的失败测试）
- Create: `src/ui/components/BackupBanner.tsx`
- Create: `src/ui/pages/BackupPanel.tsx`（嵌入「报」页面底部）
- Create: `public/manifest.webmanifest`
- Create: `public/icon-192.png`
- Create: `public/icon-512.png`
- Modify: `src/App.tsx`（挂上备份横幅）
- Modify: `src/ui/pages/ReportPage.tsx`（底部加备份面板）
- Modify: `index.html`（`<head>` 里加 manifest 与 apple-touch-icon）
- Create: `DEPLOY.md`
- Modify: `README.md`（**还是 Vite 样板文，上线前必须换成这个项目自己的说明，见 Step 9b**）

> `public/icon-192.png` 与 `public/icon-512.png` 是**二进制 PNG**，纯文本工具写不出来——必须用能生成图片的方式产出（例如 Node 脚本生成，或从现有图形导出），不要把 PNG 的字节当文本往里写。

**Interfaces:**
- Consumes: `exportBackup`、`importBackup`（Task 7，实际签名 `(data: AppData): string` / `(json: string): AppData`，`src/storage/backup.ts:7` / `:16`，解析失败**抛 Error**）；`useAppData`（Task 8）；`todayLocalIso(now: Date): string`（`src/ui/planForm.ts:47`）
- Produces: `BackupBanner`、`BackupPanel`、**`daysSinceBackup(iso: string | null, now: Date): number | null`**、**`shouldWarnBackup(iso: string | null, entryCount: number, now: Date): boolean`**（`shouldWarnBackup` 也被 `BackupBanner` 用，别漏）

- [ ] **Step 1: 写失败测试（备份天数判定）**

创建 `src/ui/backupStatus.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { daysSinceBackup, shouldWarnBackup } from './backupStatus'

describe('daysSinceBackup', () => {
  it('从未备份时返回 null', () => {
    expect(daysSinceBackup(null, new Date('2026-10-03T10:00:00Z'))).toBeNull()
  })
  it('同一天返回 0', () => {
    expect(daysSinceBackup('2026-10-03T08:00:00Z', new Date('2026-10-03T20:00:00Z'))).toBe(0)
  })
  it('三天前返回 3', () => {
    expect(daysSinceBackup('2026-09-30T08:00:00Z', new Date('2026-10-03T09:00:00Z'))).toBe(3)
  })
})

describe('shouldWarnBackup', () => {
  it('从未备份且已有数据 → 警告', () => {
    expect(shouldWarnBackup(null, 5, new Date('2026-10-03T09:00:00Z'))).toBe(true)
  })
  it('从未备份但没有数据 → 不警告', () => {
    expect(shouldWarnBackup(null, 0, new Date('2026-10-03T09:00:00Z'))).toBe(false)
  })
  it('3 天前备份过且有数据 → 警告', () => {
    expect(shouldWarnBackup('2026-09-30T08:00:00Z', 5, new Date('2026-10-03T09:00:00Z'))).toBe(true)
  })
  it('1 天前备份过 → 不警告', () => {
    expect(shouldWarnBackup('2026-10-02T08:00:00Z', 5, new Date('2026-10-03T09:00:00Z'))).toBe(false)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/ui/backupStatus.test.ts`
Expected: FAIL，报 `Failed to resolve import "./backupStatus"`

- [ ] **Step 3: 实现**

创建 `src/ui/backupStatus.ts`：

```ts
export function daysSinceBackup(iso: string | null, now: Date): number | null {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return null
  const diff = now.getTime() - then
  return Math.floor(diff / (24 * 60 * 60 * 1000))
}

/** 有数据、且（从未备份 或 距上次备份 ≥ 3 天）时提醒 */
export function shouldWarnBackup(iso: string | null, entryCount: number, now: Date): boolean {
  if (entryCount === 0) return false
  const days = daysSinceBackup(iso, now)
  return days === null || days >= 3
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/ui/backupStatus.test.ts`
Expected: 7 passed

- [ ] **Step 5: 写备份横幅**

创建 `src/ui/components/BackupBanner.tsx`：

```tsx
import { useState } from 'react'
import { useAppData } from '../../state/useAppData'
import { daysSinceBackup, shouldWarnBackup } from '../backupStatus'

export function BackupBanner({ onGoToBackup }: { onGoToBackup: () => void }) {
  const { data } = useAppData()
  // 渲染体里不许直接调 new Date()：react(purity) 会拦，本仓门禁是 0 warning。
  // 唯一能过 lint 的写法就是 useState 惰性初始化（useMemo / useEffect 同样被拦）。
  const [now] = useState(() => new Date())
  if (!shouldWarnBackup(data.settings.lastBackupAt, data.entries.length, now)) return null

  const days = daysSinceBackup(data.settings.lastBackupAt, now)
  return (
    <button
      type="button"
      onClick={onGoToBackup}
      className="w-full bg-amber-100 px-4 py-2 text-left text-xs text-amber-800"
    >
      ⚠️ {days === null ? '你还没有备份过数据' : `已经 ${days} 天没备份了`}
      —— 手机丢了或浏览器清了数据就全没了。点这里去备份。
    </button>
  )
}
```

> **不要写成 `const now = new Date()`。** 这是本任务最容易照抄出错的一处：在渲染体里调 `new Date()` 会被 `react(purity)` 标成 warning，而门禁要求 0 warning（`useMemo` 的回调也在渲染期跑，同样会被拦）。
>
> **写 `useState` 惰性初始化的依据不是推理，是本仓已经通过的代码**：`src/ui/pages/ReportPage.tsx:25` 现在就写着 `const [today] = useState(() => todayLocalIso(new Date()))`，而全仓 `npm run lint` 是 `Found 0 warnings and 0 errors.` —— 同一个写法在本仓已被门禁验证过。Step 6 的 `BackupPanel` 用同一写法，两处必须一致。

- [ ] **Step 6: 写备份面板**

创建 `src/ui/pages/BackupPanel.tsx`：

```tsx
import { useRef, useState } from 'react'
import { useAppData } from '../../state/useAppData'
import { exportBackup, importBackup } from '../../storage/backup'
import { daysSinceBackup } from '../backupStatus'
import { Modal } from '../components/Modal'
import { todayLocalIso } from '../planForm'
import type { AppData } from '../../domain/types'

export function BackupPanel() {
  const { data, update, replaceAll } = useAppData()
  const fileInput = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState('')
  const [pendingRestore, setPendingRestore] = useState<AppData | null>(null)

  // 渲染时就要用 now。不能在渲染体里调 new Date()（react(purity)），
  // useMemo / useEffect 也都被拦——只有 useState 惰性初始化能过门禁（见 Global Constraints）。
  const [now] = useState(() => new Date())
  const days = daysSinceBackup(data.settings.lastBackupAt, now)

  function handleExport() {
    const json = exportBackup(data)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const stamp = todayLocalIso(new Date())
    a.href = url
    a.download = `狗账备份-${stamp}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 0)
    // lastBackupAt 是**完整时间戳**（ISO datetime），不是 `YYYY-MM-DD` 那种日期串，
    // 所以这里用 toISOString() 是对的 —— 别照着「不许用 toISOString()」那条规则来「修」它
    //（那条规则针对的是日期串：UTC 会把东八区的晚上算成前一天）。见 `src/domain/types.ts:85`。
    update(d => ({ ...d, settings: { ...d.settings, lastBackupAt: new Date().toISOString() } }))
    setMessage('已导出。把文件发到微信收藏或存到电脑上。')
  }

  async function handleImport(file: File) {
    try {
      const restored = importBackup(await file.text())
      setPendingRestore(restored)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '恢复失败')
    }
  }

  return (
    <section className="mt-4 rounded-xl bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-gray-700">数据备份</h2>
      <p className="mt-1 text-xs text-gray-500">
        {days === null ? '从未备份过' : days === 0 ? '今天备份过' : `${days} 天前备份过`}
        {' · '}共 {data.entries.length} 条流水、{data.dogs.length} 只狗
      </p>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={handleExport}
          className="flex-1 rounded-xl bg-gray-900 py-3 text-sm font-semibold text-white"
        >
          导出备份文件
        </button>
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className="flex-1 rounded-xl border border-gray-300 py-3 text-sm font-semibold text-gray-700"
        >
          从备份恢复
        </button>
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={e => {
          const f = e.target.files?.[0]
          if (f) void handleImport(f)
          e.target.value = ''
        }}
      />
      {message && <p className="mt-2 text-xs text-emerald-600">{message}</p>}
      <p className="mt-2 text-xs text-gray-400">
        恢复前会先问一次。导出后请马上把文件发到微信「文件传输助手」或存进电脑。
      </p>

      <Modal open={pendingRestore !== null} title="恢复备份？" onClose={() => setPendingRestore(null)}>
        <p className="text-sm text-gray-600">
          将用备份覆盖当前全部数据（备份里有 {pendingRestore?.entries.length ?? 0} 条流水、
          {pendingRestore?.dogs.length ?? 0} 只狗）。这台设备上的现有数据会被全部替换，撤销不了。
        </p>
        <button
          type="button"
          className="mt-3 w-full rounded-xl bg-red-600 py-3 text-sm font-semibold text-white"
          onClick={() => {
            const restored = pendingRestore!
            replaceAll(restored)
            setPendingRestore(null)
            setMessage(`恢复成功，共 ${restored.entries.length} 条流水。`)
          }}
        >
          确认覆盖
        </button>
        <button
          type="button"
          className="mt-2 w-full rounded-xl border border-gray-300 py-3 text-sm font-semibold text-gray-700"
          onClick={() => setPendingRestore(null)}
        >
          取消
        </button>
      </Modal>
    </section>
  )
}
```

- [ ] **Step 7: 接线**

在 `src/ui/pages/ReportPage.tsx` 最外层 `<div>` 的最后、**最后一个 `</div>` 之前**加入：

```tsx
      <BackupPanel />
```

> **落点说明（按 ReportPage.tsx 的实际结构写，不要按 `<section>` 找）。** 这个文件里 **`<section>` 出现 0 次**——所有区块都是 `<div>`。当前结构是：`{ranking.length > 0 && (…)` 这段 JSX 表达式的 `</ul>` 收在 `:177`、片段的 `</>` 收在 `:178`、表达式的 `)}` 收在 `:179`，之后才是最外层 `<div>` 的收尾。Task 13 已经在同一位置挂过 `<SettingsPanel />`（`ReportPage.tsx:181`），**`<BackupPanel />` 紧接在它后面**即可，仍然在最后一个 `</div>` 之前。**不要按"所有 `<section>` 之后"去找——那个描述对不上这个文件。**

并在文件顶部的 import 区加入：

```tsx
import { BackupPanel } from './BackupPanel'
```

在 `src/App.tsx` 的 `Shell` 里，把 `<BackupBanner ... />` 放在 `<main>` 之前：

```tsx
      <BackupBanner onGoToBackup={() => setTab('report')} />
```

并加入 import：

```tsx
import { BackupBanner } from './ui/components/BackupBanner'
```

- [ ] **Step 8: 加 PWA 清单**

创建 `public/manifest.webmanifest`：

```json
{
  "name": "狗账",
  "short_name": "狗账",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#f9fafb",
  "theme_color": "#059669",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

在 `index.html` 的 `<head>` 里加：

```html
<link rel="manifest" href="/manifest.webmanifest" />
<link rel="apple-touch-icon" href="/icon-192.png" />
```

`public/icon-192.png` 与 `public/icon-512.png`：用任意一张 192/512 像素的纯色方块 PNG 即可（可以先用在线工具生成一张写着「狗账」的图，不必追求美观）。

> **这两个文件是二进制 PNG，纯文本工具写不出来。** 不要试图把 PNG 的字节当文本 `write` 进去——那样得到的是一张坏图，PWA 装到手机上会显示空白图标。可行的做法是用一段 Node 脚本（例如零依赖的手写 PNG 编码，或先 `npm i -D sharp` 再 `npm uninstall`）在仓库里生成这两张图，然后 `git add` 二进制文件；**或者**先用占位 PNG 交差并在报告里写明「图标是占位图，需要用户自己换」。两条路都可以，但必须**如实报告你选了哪一条**，不要把坏图当成品交付。

- [ ] **Step 9: 写部署说明**

创建 `DEPLOY.md`：

```markdown
# 狗账 · 部署

构建产物是纯静态文件，放在任何 https 静态托管上即可。

## 构建

```bash
npm ci
npm run build      # 产物在 dist/
```

## 托管（二选一）

- **腾讯云 EdgeOne Pages**：免费额度，国内可访问。新建项目 → 关联 Git 仓库 → 构建命令 `npm run build` → 输出目录 `dist`。
- **阿里云 OSS 静态网站**：约几元/月，国内稳定。把 `dist/` 上传到 bucket，开启静态网站托管。

## 上线后必做

1. 用**你自己的手机**打开链接，加到桌面（iOS：分享 → 添加到主屏幕；安卓：菜单 → 添加到主屏幕）。
2. 立刻做一次「导出备份」，把文件存到微信文件传输助手 —— 验证备份真的能用。
3. 把链接发给伙伴，告诉他这是给你俩看账用的，数据以你手机上的为准。
```

- [ ] **Step 9b: 把 README.md 换成这个项目自己的说明**

`README.md` 现在还是 Vite 脚手架的样板文（「# React + TypeScript + Vite」+ React Compiler 那几段），上线前必须换掉——它是这个仓库唯一一份对外的门面，留着样板文等于告诉别人「这是一次 `npm create vite` 出来的东西，没人管」。

写一份**简短**的（20~40 行足够，不要写成论文），至少包含：
1. 一句话说清这是什么：**给两个合伙人记犬只买卖账的手机网页**，装到桌面像 App，数据只存在自己手机上（不联网、不上传）。
2. 五个标签页各是干什么的（算 / 狗 / 检 / 钱 / 报），每页一句话。
3. 本地怎么跑：`npm ci` → `npm run dev`；四条门禁命令 `npx vitest run` / `npm run build` / `npm run lint`。
4. **数据在哪、怎么备份**：数据在浏览器 IndexedDB 里，清浏览器数据就没了 ⇒ 去「报」页导出备份文件、存到微信「文件传输助手」。
5. 指向 `DEPLOY.md` 与 `docs/compliance/`（合规调研三份文档，说明为什么要记检疫证明）。

**不要**在 README 里编造功能（比如「支持多人同步」「云端备份」——这两件事本工具明确不做，见设计文档 §1.3 非目标）。**不要**把 `docs/superpowers/` 里的实现计划或 `DEPLOY.md` 的内容整段抄进来——README 是给用户/未来的自己看的门面，不是开发日志。

- [ ] **Step 10: 全量验证**

Run: `npx vitest run`
Expected: 全部通过

Run: `npm run build`
Expected: 无 TS 错误

Run: `npm run lint`
Expected: `Found 0 warnings and 0 errors.`

> **不用 `npm run dev`。** 下面这份清单是**验收标准**，由控制器的真实浏览器（CDP）探针逐条验证——包括第 6 步（清站点数据再恢复），控制器会用 `Storage.clearDataForOrigin` + `DOM.setFileInputFiles` 真跑一遍。你只需要把上面三条门禁跑绿、并在报告里说明「这几条我没在浏览器里验」。
>
> 手工清单（控制器要验的）：1. 在「算」里建一个批次 → 2. 去「狗」里卖出一只、标记一只死亡，确认「剩余保本」变化 → 3. 去「钱」里记一笔注资，确认池子余额变化 → 4. 去「报」里生成对账单图片并下载 → 5. 点「导出备份文件」，确认下载到 `.json` → 6. 清掉浏览器站点数据 → 刷新，确认数据没了 → 「从备份恢复」选刚才的文件 → 确认数据全部回来。**第 6 步是必做的，不做等于没做备份功能。**

- [ ] **Step 11: 提交**

`git add` 的路径必须逐字列出，**不许用 `git add -A` / `git add .` / `git add src`**（见 Global Constraints 与 Task 18/19 的同一要求）。本任务应为：

```bash
git add src/ui/backupStatus.ts src/ui/backupStatus.test.ts src/ui/components/BackupBanner.tsx src/ui/pages/BackupPanel.tsx src/App.tsx src/ui/pages/ReportPage.tsx index.html public/manifest.webmanifest public/icon-192.png public/icon-512.png DEPLOY.md README.md
git commit -m "feat: 备份安全网、PWA 清单、部署说明与项目 README"
```

> **Task 14 实施记录（2026-10-04；本计划的最后一个任务）**
>
> **提交**：`a03d559 feat: 备份安全网、PWA 清单、部署说明与项目 README`（12 files / +248 / −23；新增 `src/ui/backupStatus.ts`(14) + `backupStatus.test.ts`(29, 7 条) + `src/ui/components/BackupBanner.tsx`(23) + `src/ui/pages/BackupPanel.tsx`(116) + `public/manifest.webmanifest`(12) + `public/icon-192.png`(412B) + `public/icon-512.png`(1495B) + `DEPLOY.md`(21)，改 `index.html` +2、`src/App.tsx` +2、`src/ui/pages/ReportPage.tsx` +2、`README.md` 50 行改动），父提交 `db0e5d4`。
> **随后一个修复提交**：`e4a7130 fix(ui): 刚导出后备份面板不再显示「-1 天前备份过」`（2 files / +13 / −1）——见下面「走查抓到的真实缺陷」。
>
> **门禁（控制器独立复跑，不看实施者转述）**：`npx vitest run` → `Test Files 22 passed (22)` / `Tests 506 passed (506)`（基线 21/499，+7 = `backupStatus.test.ts`）→ 追加修复后 **508 passed**；`npm run build` → `✓ 51 modules transformed`（47→51）/ `dist/assets/index-nvucCv1J.js` 292.74 kB / gzip 88.97 kB（修复后 `index-DK-zf1EH.js` 292.75 kB）；`npm run lint` → `Found 0 warnings and 0 errors.`（58→62 files）；`git status --short` 空。
> TDD 红态：`Error: Cannot find module './backupStatus' imported from ...`（任务书写的是 `Failed to resolve import`，同 Task 5 的先例——vitest 5.0.3 走 Node 解析器，**措辞不同、失败相同**）。
>
> **实施者的 6 处偏离，控制器全部接受**：①红态报错措辞（同上）；②`BackupPanel` 里把任务书的 `const restored = pendingRestore!` 改成 `const restored = pendingRestore; if (!restored) return` —— 更稳，且非空断言本就在「禁止任何类型绕过」的精神管控内；③README 首段显式写出「也不做多人同步或云端备份」（任务书只要求「不要编造」，写清边界比留白更好）；④落点按控制器核实过的语义位置（`<SettingsPanel />` 现 `:255`、`<BackupPanel />` 现 `:256`、import 加在 `:9` 之后），**没有**为迁就任务书的旧行号去动别的区块；⑤`index.html` 两行插在 `theme-color` meta 之后、`<title>` 之前；⑥两个 PNG 用零依赖 `node:zlib` 的 `deflateSync` 手拼（8 字节签名 + IHDR + IDAT + IEND、每行 filter=0、自己算 crc32），SDF + 2×2 超采样画 emerald-600 圆角底板 + 白色爪印，**没装任何依赖**（`sharp` 方案未采用）。生成脚本与验证脚本都在 `$env:TEMP\dogledger-icons\`，**未提交**。
>
> **两个 PNG 的独立复核（控制器自己做，不信实施者的自证）**：自己写解码器扫 chunk 边界 + 校验 crc32 + `inflateSync` 解 IDAT →
> `public/icon-192.png: bytes=412 sig=ok chunks=IHDR,IDAT,IEND 192x192 depth=8 color=2 inflated=110784 expected=(192*3+1)*192=110784 match=true sha256=a2e76880a2661fac`
> `public/icon-512.png: bytes=1495 sig=ok chunks=IHDR,IDAT,IEND 512x512 depth=8 color=2 inflated=786944 expected=786944 match=true sha256=939e8949c6ac53e3`
> 两张图的 sha256 前缀与实施者报的完全一致，IDAT 解压后字节数严格等于 `(w*3+1)*h` ⇒ 是**真能解码的像素流**，不是坏图。
>
> **走查（控制器 CDP 探针，真实浏览器 + 真实 IndexedDB）**：探针 `probes/dogledger-t14.mjs`（25704 B，`PORT = 9355`，`spawn(EDGE, [...], { stdio: 'ignore' })` + `--headless=new`）→ **86/86 PASS**，0 条 `Runtime.exceptionThrown`、0 条 `console.error`。九段覆盖：①全新库无横幅 + 面板「从未备份过 · 共 0 条流水、0 只狗」②算页建 2 只批次 ③有数据未备份 → 黄色横幅（含「手机丢了」）→ 点它跳「报」页 ④**导出**（文件名 `狗账备份-YYYY-MM-DD.json`、内容 `{app:'dog-ledger', version:1, exportedAt, data}`、快照里 `lastBackupAt` 仍是 `null`、导出后库里 `lastBackupAt` 变成带 `T` 的时间戳、横幅消失）⑤六步清单：卖出 1 只（有 income 流水）→ 标 1 只死亡 → 注资 1000（`type='injection'`/`amount=100000`）→ 生成对账单 PNG（文件名 `对账单-YYYY-MM-DD.png`、文件头 `89 50 4e 47 0d 0a 1a 0a`、>1KB）⑥`Storage.clearDataForOrigin` + reload → IndexedDB 空、报页「还没有数据」⑦`DOM.setFileInputFiles` 选回那个 `.json` → 「恢复备份？」「备份里有 N 条流水、M 只狗」「撤销不了」→ 确认覆盖 → 数据全部回来 + reload 后仍在 ⑧manifest 与两个 PNG 的 IHDR 宽高逐项对上 ⑨无异常。
> **探针的关键手法**：临时把 `HTMLAnchorElement.prototype.click` 换成只记 `{href, download}` 的桩、`URL.revokeObjectURL` 换成空操作，再点按钮，然后 `fetch(blobUrl)` 直接读内容 —— **完全绕开 CDP 下载落盘**（`Page.setDownloadBehavior` 那套在 headless+沙箱下容易踩坑）。
>
> **走查抓到的真实缺陷（首轮 76/85 里唯一的产品问题）**：点完「导出备份文件」后面板显示 **`-1 天前备份过`**。成因是任务书自己规定的写法：`now` 只能用 `useState(() => new Date())` 在**挂载时**取一次（渲染体里调 `new Date()` 会被 `react(purity)` 拦），而 `lastBackupAt` 是点完导出才写进库的 ⇒ 刚导完那一瞬间 `lastBackupAt > now`，`Math.floor(负数/86400000)` = `-1`。修法：`daysSinceBackup` 最后一行 `Math.max(0, Math.floor(diff / 86400000))` —— **天数没有负的，一律按 0（就是刚备份过）**。TDD：先加 2 条测试（`daysSinceBackup` 的未来时间戳 → 0；`shouldWarnBackup` 的未来时间戳 → 不警告），红态 `AssertionError: expected -1 to be +0`，改一行后 508 passed。
> **首轮另外 8 条失败全是探针自己的期望写错（第 9 次同类错误）**：恢复那一段我拿「清数据前的库」当期望，而 `backup.json` 是**导出那一刻的快照**（比清数据前少后面加的卖出收入与注资两笔）⇒ 恢复后正确结果就是 5 条流水、0 已售、0 死亡、没有注资。**教训（再记一次）：断言失败时先核探针自己的期望从哪来，再考虑给实现开缺陷。**
>
> **待用户拍板项（不在本轮做）**：**恢复备份后 `lastBackupAt` 会回到备份文件里的值**（我们这个文件里是 `null`），于是刚恢复完的界面会说「从未备份过」并重新挂上黄色提醒。两种解读都成立：⑧「这台设备的数据还没有备份过」⇒ 提醒是对的；⑨「我手里就有一个刚用过的备份文件」⇒「从未备份过」听着像恢复失败。改法很小（恢复时把 `lastBackupAt` 刷成现在，或在 `importBackup` 里用文件顶层的 `exportedAt`），但**这是产品语义决定，按设计文档 D10 须先经用户同意**，故仅记录现状：探针里钉住的就是「现状」。另一条 parked：`now` 只在挂载时取一次 ⇒ 页面长期不关不会自己刷新天数（手机浏览器会重载，暂不处理）。
>
> **本任务完成后，计划的 21 个任务（含 11b/13b/15b/16b/17b/18b/21b）全部落地**，`feature/dog-ledger` 分支上最后一次门禁为 22 files / 508 passed、lint 0/0、build 51 modules。

---

## 完成之后

上线后第一个月，观察三件事，它们决定第二期做什么：

1. **「算」页面是否真的每次出门前都会打开** —— 如果不是，说明保本价这个数字还不够痛，要去问为什么。
2. **有没有 3 天以上不备份** —— 如果有，说明提醒还不够显眼，或者备份动作还是太麻烦。
3. **首批狗的死亡率与预估差多少** —— 这个差值本身就是最有价值的数据，第二期的分析维度应该从这里长出来，而不是从"我们还能加个客户管理"长出来。
