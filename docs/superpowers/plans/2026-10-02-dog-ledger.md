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

**Consumes:** `ChannelId` / `SALES_CHANNELS` / `Money` / `AppData`（`src/domain/types.ts`）；`aliveCount` / `batchTotalCost`（`src/domain/costing.ts`）。

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

并把已有的 `dilutedCostFen`（`src/domain/costing.ts:49-56`）最后一行由 `return batchTotalCost(data, dog.batchId) / alive` 改为 `return batchPerDogCostFen(data, dog.batchId)`。它上面两行提前返回（`if (!dog) return own`、`if (alive === 0) return own`）**保持原样**，可观测行为完全不变——已有的 15 个 `costing.test.ts` 测试必须**一字不改地继续通过**。

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

1. `basePerDogCostFen` 必须来自 `batchPerDogCostFen(data, batchId)`——**本文件不得自己算批次总成本或存活数**。
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
- Modify: `src/ui/pages/CalculatePage.tsx`（加渠道对照区块）
- Modify: `src/ui/pages/DogsPage.tsx`（批次详情：显示并允许修改 `plannedChannel`）
- Modify: 批次详情用到的纯函数模块（若你把「渠道 id → 中文名」的映射放在 `src/ui/` 的纯函数文件里，一并列出；否则就在 `DogsPage.tsx` 里用一个局部常量，不要为它新建文件）

> **Task 18 派发前审计（2026-10-03，控制器核对了实际代码）**——四处计划书与实际不符，动手时以实际代码为准：
> 1. **本仓没有单独的「批次详情页」**。`src/ui/pages/` 下只有 `CalculatePage.tsx` / `DogsPage.tsx` / `MoneyPage.tsx` / `QuarantinePage.tsx` / `ReportPage.tsx`；批次列表与批次详情是 `src/ui/pages/DogsPage.tsx`（475 行）同一个文件里的两个视图（它有内部状态在列表与详情之间切换，`DogsPage.tsx:145` 附近有「批次被删掉时退回列表」的处理）。所以「批次详情页」= `src/ui/pages/DogsPage.tsx`。
> 2. **`plannedChannel` 已经在批次详情里显示了，但显示的是英文 id**：`src/ui/pages/DogsPage.tsx:171` 是 `{batch.date} · 去向：{batch.plannedChannel === 'undecided' ? '未定' : batch.plannedChannel}`——用户会看到 `去向：pet_shop`。**这是现存缺陷，本任务必须顺手修掉**：改走 `SALES_CHANNELS` 查中文名（`undecided` 仍显示「未定」），并把它做成可改的下拉（本任务行为 7）。
> 3. **行为 5 里那个临时 `AppData` 的字面量字段名错了**：`AppData` 的形状是 `{ version: 1, settings: Settings, batches: Batch[], dogs: Dog[], entries: LedgerEntry[] }`（`src/domain/types.ts`），**没有 `ledger` 字段**，要写 `entries: []`；而且 `version` 与 `settings` 也是必填，构造临时对象时别漏（`settings` 直接用 `data.settings`）。
> 4. 「一键建批次」的调用处就在 `src/ui/pages/CalculatePage.tsx` 里（`handleCreateBatch`），不是第三个文件。`createBatchFromPlan` 的签名是 `createBatchFromPlan(data: AppData, input: PlanInput, batchName: string, date: string, plannedChannel?: ChannelId): AppData`（`src/domain/planning.ts:83` 起，省略时用 `'undecided'`）。

**Consumes:** `compareChannels` / `ChannelInput` / `ChannelBreakdown`（`src/domain/channels.ts`，Task 16）；`batchPerDogCostFen` / `aliveCount`（`src/domain/costing.ts`）；`SALES_CHANNELS` / `ChannelId`（types.ts）；`formatMoney` / `fenToYuan` / `parseMoney`（`src/domain/money.ts`）。

**必须满足的行为:**

1. 「算」页面在保本价结果**下方**加一个**默认折叠**的「渠道对照」区块，标题旁一句：「同一批狗，走不同的路，最低可卖价不一样。」
2. 展开后，对 `SALES_CHANNELS` 里除 `undecided` 外的 **8 条渠道**各一行，每行三个输入：**预期单价** / **每只额外成本** / **该渠道固定成本**（都走 `parseMoney`，留空按 0）。
3. 每行实时显示 **保本单价** 与 **每只利润**。`isLoss` 为 true 的行标红并写「亏」，否则标绿。
4. 区块顶部有**存活数**输入（默认取计划里的 `count × (1 − mortalityRate)` 向上取整），因为它决定固定成本摊到几只上。这个数字要能手动改。
5. 渠道对照**必须调用 `compareChannels`**，界面里不得出现 `base + extra + fixed / n` 这类自己算的式子。**「算」页还没有真实批次时**，用 `{ version: 1, settings: data.settings, batches: [{ id: '__plan__', ... }], dogs: [], entries: [] }` 这样的临时 `AppData`（批次内含一条每只成本 = 决策台算出的每只成本的支出流水），再调用 `compareChannels`——**成本只能有一处算法**。（注意 `AppData` 的字段是 `entries` 不是 `ledger`，且 `version`/`settings` 也是必填，见上面的派发前审计。）实现时若发现更干净的做法，可以改，但必须满足"界面里没有第二套成本公式"。
6. 「一键存为批次」时，把用户在渠道对照里**选中的那一条**（默认 `undecided`）写进 `batch.plannedChannel`。
7. 批次详情页显示「计划去向：宠物店」，可点击修改（下拉列 `SALES_CHANNELS`），改完立刻保存。
8. 金额显示一律走 `formatMoney`（只在界面边界四舍五入）。
9. 界面文案全中文。

**Steps:**
- [ ] **Step 0**：read `src/ui/pages/CalculatePage.tsx` 与 `src/ui/pages/DogsPage.tsx`（批次详情就在后者的详情视图里），确认现有 `input` useMemo 与「存为批次」的调用链。
- [ ] **Step 1**：实现渠道对照区块。
- [ ] **Step 2**：把 `plannedChannel` 接进建批次与批次详情。
- [ ] **Step 3**：`npx vitest run` / `npm run build` / `npm run lint`。
- [ ] **Step 4**：`npm run dev` 手动验证：填一个批次 → 展开渠道对照 → 「宠物店」填单价 900、每只成本 0、固定成本 0 → 保本单价应等于决策台的每只成本；「犬市」填固定成本 400、单价 900 → 保本单价变高、可能标红 → 存为批次后进批次详情 → 计划去向是选中的那条，能改。
- [ ] **Step 5**：提交：
  ```bash
  git add src/ui/pages/CalculatePage.tsx src/ui/pages/DogsPage.tsx
  git commit -m "feat(ui): 渠道对照与批次计划去向"
  ```
  （若确实新建了 `src/ui/` 下的纯函数模块，把它加进 `git add` 的显式路径列表。**不许写 `git add src`**——这个仓里同时可能有人在改别的文件，已经因此误提交过一次。）

---

### Task 19: 设置面板补两个检疫天数 + 校验

**Goal:** `rabiesWaitDays` 与 `quarantineLeadDays` 必须能在界面上改——后者的默认 3 是法定的；**前者的默认 21 查不到官方出处，只是一个占位值**，本地实际要求不同时必须能改。

**Files:**
- Modify: `src/domain/settlement.ts`（`validateSettings` 加两个字段的校验）
- Modify: `src/domain/settlement.test.ts`（加对应测试）
- Modify: `src/ui/pages/SettingsPanel.tsx`（两个输入框）

**Consumes:** `Settings` / `DEFAULT_SETTINGS`（types.ts）；`validateSettings`（`src/domain/settlement.ts`，Task 5）；Task 13 已有的表单组件 `Field`。

**必须满足的行为:**

1. `validateSettings` 新增两条：
   ```ts
   if (!(settings.rabiesWaitDays >= 0)) return '狂犬免疫后等待天数不能为负'
   if (!(settings.quarantineLeadDays >= 0)) return '检疫申报提前天数不能为负'
   ```
   两条都要能拦住 `-1` **与 `NaN`**。注意现有校验的写法风格是 `!(x >= 0)` 而不是 `x < 0`（`NaN` 会被前者拦下）——**保持一致**。
2. 设置面板加两个数字输入：「狂犬免疫后等待天数」（默认 21）、「申报检疫提前天数」（默认 3），各自下面一句说明：
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
- [ ] **Step 4**：`npx vitest run` / `npm run build` / `npm run lint`。
- [ ] **Step 5**：`npm run dev` 手动验证：把等待天数改成 0 → 回「检」页面，刚接种的狗应立刻变成「可以送检」。
- [ ] **Step 6**：提交：
  ```bash
  git add src/domain/settlement.ts src/domain/settlement.test.ts src/ui/pages/SettingsPanel.tsx
  git commit -m "feat(ui): 设置面板补检疫天数并校验"
  ```
  （**不许写 `git add src`**——这个仓里同时可能有人在改别的文件。）

---

### Task 20: 「报」页的成本结构与死亡率趋势

**为什么有这一组任务**：设计文档 §4 的「报」页明确列了「成本结构」与「死亡率趋势」，但 Task 12 只做了分账、对账单图片、批次盈亏排行榜与备份导出。这两项本来就该在「报」页——用户要回答的是「钱到底花在哪了」和「我这批狗是不是死太多了」。控制器在派发前审计时发现**全计划没有任何任务实现它们**，所以补上。**不要把它们塞进 Task 12**，那个任务已经够大。

**Files:**
- Create: `src/domain/stats.ts`
- Test: `src/domain/stats.test.ts`
- Modify: `src/ui/pages/ReportPage.tsx`（在 Task 12 的产出之后追加一节；Task 14 还会在本页底部再加备份面板，两次追加互不冲突）

**Interfaces:**
- Consumes: `AppData`、`LedgerEntry`、`Money`（`src/domain/types.ts`）；`dogsOfBatch`（`src/domain/costing.ts`）
- Produces（`src/domain/stats.ts`，全部为纯函数）：
  - `interface CostShare { category: string; name: string; totalFen: Money; share: number }`
  - `costBreakdown(data: AppData): CostShare[]`
  - `interface MortalityPoint { batchId: string; name: string; date: string; rate: number; dead: number; total: number }`
  - `mortalityTrend(data: AppData): MortalityPoint[]`

**必须满足的行为：**
1. `costBreakdown` **只统计 `type === 'expense'` 的流水**（不要把 `income` 算进去），按 `category` 汇总，返回数组按 `totalFen` **降序**；`share = totalFen / 所有支出之和`；**支出总额为 0 时所有 `share` 都是 0，绝不许出现 NaN**。
2. `name` 从 `data.settings.costItems.find(c => c.id === category)?.name` 解析，**解析不到时回落 `'其他'`**（用户在设置页删掉某个成本项后，历史流水仍要能显示）。**不要在 `stats.ts` 里另抄一张硬编码的分类表**——Task 11 的「钱」页与 Task 13 的设置页共用同一套可自定义成本项，多抄一张表就会漂移。
3. `mortalityTrend` 每个批次一条，按 `date` **升序**（老的在前，才看得出趋势）；`total` = 该批次**全部**狗数（含在库/已售/死亡/退回），`dead` = `status === 'dead'` 的只数；`rate = total === 0 ? 0 : dead / total`。
4. 空数据（没有批次 / 没有流水）返回 `[]`，不抛错、不产生 NaN。
5. 纯函数：不 import React、不 import storage、**不调用无参 `new Date()`**、不得修改入参。
6. 界面：在「报」页追加两节——标题「钱花在哪了」列出成本结构（分类名 + 金额 + 占比条），标题「死亡率」列出各批次 `日期 · 批次名 · N 只里死了 M 只（X%）`。两节都无数据时各显示一句「还没有数据」。这一节**只读、不接受任何输入**。如果这一节不需要 today，就**不要**去取今天（渲染期不得调 `new Date()`，见 `## Global Constraints` 最后那条）。

**测试要求**（`src/domain/stats.test.ts`，**新建文件，必须显式 `import { describe, it, expect } from 'vitest'`**）：至少覆盖 —— 两类支出各自汇总正确且按金额降序；只有收入没有支出时 `share` 全为 0 且不出 NaN；自定义成本项的名字能被解析出来、被删掉的成本项回落成「其他」；`mortalityTrend` 按日期升序且 `rate` 数值正确（含 `total === 0` 的分支）；空数据返回 `[]`；函数不修改入参。

**Steps:**
- [ ] **Step 1**：写 `src/domain/stats.test.ts`（TDD，先跑一次看它失败）。
- [ ] **Step 2**：实现 `src/domain/stats.ts`，让测试通过。
- [ ] **Step 3**：接进 `src/ui/pages/ReportPage.tsx`。
- [ ] **Step 4**：`npx vitest run`、`npm run build`、`npm run lint`（必须 `Found 0 warnings and 0 errors.`）、`git status --short`（必须为空）。
- [ ] **Step 5**：提交：`git add src/domain/stats.ts src/domain/stats.test.ts src/ui/pages/ReportPage.tsx && git commit -m "feat(domain): 成本结构与死亡率趋势"`

---

### Task 21: 批次改名（消掉两条一模一样的下拉选项）

**为什么有这一项**：Task 17 的实机走查发现——批次名由 `src/ui/pages/CalculatePage.tsx` 自动生成为 `收狗 ${input.n} 只`，狗号又是 `` `${batchName}-${i}` ``（`src/domain/planning.ts:105`）。用户同一天建两个**只数相同**的批次（很常见：上午收 2 只、下午又收 2 只），批次下拉里就会出现**两条读起来完全一样的选项**，狗号也会跨批次重名。账算不错（`id` 唯一、「检」页按批次分开显示），但用户没法在界面上分辨这两个批次，迟早会记错账。这是可用性缺陷，不是数据缺陷。

**Files:**
- Modify: `src/domain/actions.ts`（**末尾追加**一个动作）
- Modify: `src/domain/actions.test.ts`（补测试）
- Modify: `src/ui/pages/DogsPage.tsx`（批次名可改）
- Modify: `src/ui/pages/CalculatePage.tsx`（默认批次名带上时间，让新建的批次默认就不重名）

**Interfaces:**
- Produces（追加到 `src/domain/actions.ts` 末尾）：
  ```ts
  /** 改某个批次的名字。只改那一批；找不到时原样返回（同一引用）。 */
  export function renameBatch(data: AppData, batchId: string, name: string): AppData
  ```

**必须满足的行为：**

1. `renameBatch` 只改 `data.batches` 里那一批的 `name`；不碰 `dogs`、不碰 `entries`；`batches` 数组顺序不变；`batchId` 不存在时**返回传入的同一个对象引用**（与 `src/domain/actions.ts` 里既有动作保持一致）。
2. **`renameBatch` 不得追溯修改狗号。** 每只狗的 `code` 是建批次时写死的 `${batchName}-${i}`，它是这批狗的历史标识（对账单、清单、纸质记录上已经这么写了）。改批次名只让**以后**新建的批次好看，不改已有狗号——**这一点必须在代码注释里写清**，否则下一个人会以为是漏了。
3. 「狗」页面上批次名要能就地改：点一下名字变成输入框，改完立刻保存（走 `update(d => renameBatch(d, b.id, name))`）。**名字留空或只含空白时不保存**（保留原名），并给一句提示，不要让用户以为改成功了。
4. `CalculatePage` 建批次时的默认名从 `收狗 ${n} 只` 改成 **`` `收狗 ${n} 只 ${HH}:${MM}` ``**（24 小时制、两位补零，例如 `收狗 2 只 14:07`）。时间取自 `handleCreateBatch` 里**已经存在**的那个 `new Date()`（那个调用已经是事件处理器里的、不在渲染期，符合 `## Global Constraints`），**不要新增第二个 `new Date()`**。同一分钟内建两个同只数批次仍会重名，这是可接受的——第 3 条让用户能自己改。
5. 界面文案全中文。

**测试要求**（`src/domain/actions.test.ts`，**必须显式 `import { describe, it, expect } from 'vitest'`**）：至少覆盖 —— 改名只影响那一批；不修改原数据；`batchId` 不存在时返回同一引用；`dogs` 与 `entries` 一字未动；**改批次名之后已有狗的 `code` 不变**（这条是给第 2 条钉桩的）。

**Steps:**
- [ ] **Step 1**：先给 `src/domain/actions.test.ts` 加测试（TDD），跑一次看它失败。
- [ ] **Step 2**：实现 `renameBatch`，让测试通过。
- [ ] **Step 3**：改「狗」页面的批次名入口与 `CalculatePage` 的默认名。
- [ ] **Step 4**：`npx vitest run` / `npm run build` / `npm run lint` / `git status --short`。
- [ ] **Step 5**：提交（**显式路径，不要 `git add src`**）：
  ```bash
  git add src/domain/actions.ts src/domain/actions.test.ts src/ui/pages/DogsPage.tsx src/ui/pages/CalculatePage.tsx
  git commit -m "feat(ui): 批次改名与默认批次名去重"
  ```

---

### Task 14: 备份安全网 + PWA + 上线

**Files:**
- Create: `src/ui/components/BackupBanner.tsx`
- Create: `src/ui/pages/BackupPanel.tsx`（嵌入「报」页面底部）
- Create: `public/manifest.webmanifest`
- Modify: `src/App.tsx`（挂上备份横幅）
- Modify: `src/ui/pages/ReportPage.tsx`（底部加备份面板）
- Create: `DEPLOY.md`

**Interfaces:**
- Consumes: `exportBackup`、`importBackup`（Task 7）；`useAppData`（Task 8）
- Produces: `BackupBanner`、`BackupPanel`、`daysSinceBackup(iso: string | null, now: Date): number | null`

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
    expect(shouldWarnBackup(null, 5, new Date())).toBe(true)
  })
  it('从未备份但没有数据 → 不警告', () => {
    expect(shouldWarnBackup(null, 0, new Date())).toBe(false)
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
import { useAppData } from '../../state/useAppData'
import { daysSinceBackup, shouldWarnBackup } from '../backupStatus'

export function BackupBanner({ onGoToBackup }: { onGoToBackup: () => void }) {
  const { data } = useAppData()
  const now = new Date()
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

- [ ] **Step 6: 写备份面板**

创建 `src/ui/pages/BackupPanel.tsx`：

```tsx
import { useRef, useState } from 'react'
import { useAppData } from '../../state/useAppData'
import { exportBackup, importBackup } from '../../storage/backup'
import { daysSinceBackup } from '../backupStatus'
import { Modal } from '../components/Modal'
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

在 `src/ui/pages/ReportPage.tsx` 底部加入（同 Task 14 Step 7 的落点规则：**所有** `<section>` 之后、最后那个 `</div>` 之前；本页排行榜那段的 `</section>` 在 JSX 表达式内部，落点是在它的 `)}` 之后）：

```tsx
      <BackupPanel />
```

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

- [ ] **Step 10: 全量验证**

Run: `npx vitest run`
Expected: 全部通过

Run: `npm run build`
Expected: 无 TS 错误

Run: `npm run dev`，手动走一遍完整流程：
1. 在「算」里建一个批次
2. 去「狗」里卖出一只、标记一只死亡，确认「剩余保本」变化
3. 去「钱」里记一笔注资，确认池子余额变化
4. 去「报」里生成对账单图片并下载
5. 点「导出备份文件」，确认下载到 `.json`
6. 清掉浏览器站点数据 → 刷新，确认数据没了 → 「从备份恢复」选刚才的文件 → 确认数据全部回来

第 6 步是必做的，不做等于没做备份功能。

- [ ] **Step 11: 提交**

```bash
git add -A
git commit -m "feat: 备份安全网、PWA 清单与部署说明"
```

---

## 完成之后

上线后第一个月，观察三件事，它们决定第二期做什么：

1. **「算」页面是否真的每次出门前都会打开** —— 如果不是，说明保本价这个数字还不够痛，要去问为什么。
2. **有没有 3 天以上不备份** —— 如果有，说明提醒还不够显眼，或者备份动作还是太麻烦。
3. **首批狗的死亡率与预估差多少** —— 这个差值本身就是最有价值的数据，第二期的分析维度应该从这里长出来，而不是从"我们还能加个客户管理"长出来。
