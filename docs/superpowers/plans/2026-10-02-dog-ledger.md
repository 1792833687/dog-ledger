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
- 数据模型以 `docs/superpowers/specs/2026-10-02-dog-trading-ledger-design.md` 为准。
- 单测命令：`npx vitest run`；单文件：`npx vitest run <文件路径>`。
- 测试环境为 `node`（领域层是纯函数，不需要 jsdom）。
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
Expected: 全部 passed（本任务实测 77 个；本任务新增 24 个。全部任务做完预计 95 个上下——以实际为准，不要为了凑数增删测试）

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
    void update(d => createBatchFromPlan(d, input, name, new Date().toISOString().slice(0, 10)))
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

Run: `npm run dev`，在手机模式浏览器里：
- 输入 8 / 600 / 400 / 80 / 25% / 1200，确认「低于这个价别卖」显示 `¥973.33`
- 确认「卖不掉怎么办」三行分别为 5、6、8 只
- 点「一键建批次」，切到「狗」标签（此时还是占位），刷新页面后切回「算」，确认没报错

- [ ] **Step 5: 提交**

```bash
git add src/ui
git commit -m "feat(ui): 决策台页面"
```

---

### Task 10: 「狗」页面（批次台账）

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
  const batch: Batch = { id: newId(), name, date, source: '', note: '', status: 'active' }
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

  const today = new Date().toISOString().slice(0, 10)

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

const CATEGORY_LABEL: Record<string, string> = {
  purchase: '收购价', transport: '运输+笼具', medical: '疫苗医疗',
  aftercare_refund: '售后退款', sale: '收入', transfer: '转账',
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

  const today = new Date().toISOString().slice(0, 10)
  const pool = poolBalance(data)
  const recent = [...data.entries].reverse().slice(0, 60)

  function close() {
    setDialog(null); setAmount(''); setNote('')
  }

  function submit() {
    const fen = parseMoney(amount)
    if (fen === null) return
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
              <div>{TYPE_LABEL[e.type]} · {CATEGORY_LABEL[e.category] ?? e.category}</div>
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
Expected: 3 passed

- [ ] **Step 5: 实现页面**

`src/ui/pages/ReportPage.tsx`：

```tsx
import { useMemo, useState } from 'react'
import { useAppData } from '../../state/useAppData'
import { settle } from '../../domain/settlement'
import { batchSummary } from '../../domain/costing'
import { formatMoney } from '../../domain/money'
import { buildReceiptRows, receiptToBlob } from '../receipt'

export function ReportPage() {
  const { data } = useAppData()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const s = settle(data)
  const today = new Date().toISOString().slice(0, 10)

  const ranking = useMemo(
    () => data.batches
      .map(b => ({ batch: b, summary: batchSummary(data, b.id) }))
      .sort((a, b) => b.summary.netProfitFen - a.summary.netProfitFen),
    [data],
  )

  async function shareReceipt() {
    setBusy(true)
    setMessage('')
    try {
      const blob = await receiptToBlob(buildReceiptRows(data), '狗账对账单', `截至 ${today}`)
      const file = new File([blob], `狗账对账单-${today}.png`, { type: 'image/png' })
      const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean }
      if (nav.share && nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], title: '狗账对账单' })
      } else {
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = file.name
        a.click()
        URL.revokeObjectURL(url)
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
            {ranking.map(({ batch, summary }) => (
              <li key={batch.id} className="flex items-center justify-between text-sm">
                <span>{batch.name}</span>
                <span className={summary.netProfitFen >= 0 ? 'text-emerald-600' : 'text-red-500'}>
                  {formatMoney(summary.netProfitFen)}
                  <span className="ml-2 text-xs text-gray-400">
                    死亡率 {summary.dead + summary.sold + summary.inStock + summary.returned > 0
                      ? Math.round(summary.dead / (summary.dead + summary.sold + summary.inStock + summary.returned) * 100)
                      : 0}%
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
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
git add src
git commit -m "feat(ui): 对账页面与一键对账单图片"
```

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

把 `src/domain/actions.ts` 顶部的类型 import 改成：

```ts
import type { AppData, Batch, CostItemDef, DogStatus, LedgerEntry, Money, Settings } from './types'
```

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
import { fenToYuan, parseMoney } from '../../domain/money'
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
          if (!Number.isFinite(pct)) return
          void update(d => updateSettings(d, { expectedMortalityRate: Math.min(99, Math.max(0, pct)) / 100 }))
        }}
      />
      <Field
        label="默认每只检疫费"
        value={String(fenToYuan(s.quarantinePerDog))}
        suffix="元"
        onChange={v => {
          const fen = parseMoney(v)
          if (fen === null) return
          void update(d => updateSettings(d, { quarantinePerDog: fen }))
        }}
      />
      <Field
        label="默认每只病死犬处理费"
        value={String(fenToYuan(s.disposalPerDog))}
        suffix="元"
        onChange={v => {
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

在 `src/ui/pages/ReportPage.tsx` 的最后一个 `</section>` 之后、外层 `</div>` 之前加入：

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
git add src
git commit -m "feat(ui): 设置页（合伙人 / 分成 / 目标毛利 / 自定义成本项）"
```

---

### Task 15: 检疫纯函数（`src/domain/quarantine.ts`）

**Goal:** 把设计文档 §3.7 的检疫阶段推导写成纯函数，让界面能回答「这只狗现在能不能卖」。

**为什么有这一组任务（Task 15–19）**：它们来自用户批准的**修订二**。原来「检疫流程台账」被排在第二期，前提是"货源可能转为与繁育基地签约"；现在前提变了——无论走哪条渠道，检疫证明都是每一单出售的法定前置，且一证多用按货值 15~30 倍处罚、负责人 5 年禁业。**没地方记证明编号与有效期，就只能靠脑子记，这正是最贵的那类遗忘。** 同时「批次计划去向 + 渠道对照」来自 D11：线下成交是唯一走得通的路径，而各渠道成本结构差别极大。

**顺序**：15 与 16 是纯函数（`domain/`，有单测）；17–19 是界面接线。19 依赖 17 的页面存在，18 依赖 16。

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
   - `unvaccinated`：`dog.rabiesVaccinatedOn === null`
   - `cert_expired`：`quarantineCertNo.trim() !== ''` 且 `quarantineCertValidUntil !== null` 且 `quarantineCertValidUntil < today` —— **必须先于 `certified` 判定**
   - `certified`：`quarantineCertNo.trim() !== ''` 且 `quarantineCertValidUntil !== null` 且 `quarantineCertValidUntil >= today`
   - `waiting_cert`：`dog.antibodyTestedOn !== null`（且没有有效证明）
   - `ready_to_test`：`daysBetween(dog.rabiesVaccinatedOn, today) >= settings.rabiesWaitDays`
   - `waiting_antibody`：以上都不满足（已接种，但还没等够）
2. **边界（必须有测试）**：
   - `daysBetween(rabiesVaccinatedOn, today) === settings.rabiesWaitDays` → `ready_to_test`（满当天即可送检）
   - `quarantineCertValidUntil === today` → `certified`（有效期末尾那天仍可售）
   - `quarantineCertValidUntil < today` → `cert_expired`，且 `isSellable === false`
   - `quarantineCertNo === '   '`（全空格）→ 视为无证明
3. `isSellable(dog, settings, today)` **只有** `stage === 'certified'` 时为 `true`，实现上直接返回 `quarantineStatus(...).isSellable`——**不得另写一套判定**。
4. `daysUntilTestable`：仅在 `waiting_antibody` 时 = `settings.rabiesWaitDays - daysBetween(dog.rabiesVaccinatedOn, today)`（正数）；其余阶段为 `null`。
5. `certExpiresIn(dog, today)`：`quarantineCertValidUntil` 非 `null` 时返回 `daysBetween(today, quarantineCertValidUntil)`（可能为负，表示已过期），否则 `null`。
6. `preSaleChecklist`：遍历该批次所有狗（用 `dogsOfBatch`），`sellable` 收 `isSellable === true` 的，`blocked` 收其余的并带上完整 `status`。**死狗（`status === 'dead'`）也留在 `blocked` 里**——它当然不可卖，但在这里过滤掉会让清单数字与批次只数对不上（界面文案由 UI 决定）。
7. `quarantineSummary` 返回的 `Record<QuarantineStage, number>` **6 个 key 必须全部存在**（没有的填 0），这样界面可以直接遍历。
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

**测试要求**：`src/domain/quarantine.test.ts` 至少覆盖 6 个阶段各一例；上面第 2 条的 4 个边界；`preSaleChecklist` 的「8 只里 3 只没有有效证明」案例（断言 `blocked.length === 3` 且正是那 3 只）；`quarantineSummary` 的 6 个 key 齐全；`certExpiresIn` 对无证明返回 `null`。测试一律显式 `import { describe, it, expect } from 'vitest'`（仓库没有 `vitest/globals` 类型，裸写会让 `tsc -b` 报 TS2593/TS2304）。

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
- 需要的子组件自行决定（例如 `src/ui/components/DogQuarantineCard.tsx`）

**Consumes:** `quarantineStatus` / `isSellable` / `preSaleChecklist` / `addDays`（`src/domain/quarantine.ts`，Task 15）；`AppData` / `SALES_CHANNELS`（types.ts）；Task 8 建立的状态容器与保存入口。

**必须满足的行为:**

1. 页面顶部是批次选择器，默认选中**最近创建的批次**（`createdAt` 最大者）。没有批次时显示空状态：「先去「算」页面建一个批次。」
2. 每只狗一张卡片，显示：编号、`status.label`、`status.nextAction`、`waiting_antibody` 时的「还要等 N 天」（用 `daysUntilTestable`）、检疫证明编号、证明有效期、以及 `certExpiresIn` 的天数（负值显示「已过期 N 天」）。
3. 卡片默认**折叠**，只露出阶段标签 + 一个快捷动作按钮；展开后是 6 个字段的编辑表单：
   - `rabiesVaccinatedOn` / `antibodyTestedOn` / `quarantineCertIssuedOn` / `quarantineCertValidUntil`：`<input type="date">`
   - `antibodyReportNo` / `quarantineCertNo`：文本输入
   - 改动立刻写入 `AppData` 并走**已有的保存流程**（不要另建保存机制）
4. 快捷动作按钮按阶段给最省事的那个：
   - `unvaccinated` → 「今天已接种」：把 `rabiesVaccinatedOn` 设成今天
   - `ready_to_test` → 「今天已送检」：把 `antibodyTestedOn` 设成今天
   - `waiting_cert` → 「已有证明」：展开表单并聚焦 `quarantineCertNo`
   - 其余阶段不给快捷按钮
5. 页面底部是 `preSaleChecklist` 的结果：
   - 全部可卖 → 绿色确认块：「这批 N 只全部具备有效检疫证明，可以出售。」
   - 有 blocked → 醒目警告块，标题「N 只里有 M 只不能卖」，逐条列出狗编号 + 阶段原因，并固定附一句：「检疫证明与狗不一致（数量超出证明载明部分、种类不符、使用别人的证明）会被按『未经检疫』处理，罚款是货值的 15~30 倍。」
6. **「今天」从哪来**：页面内部用 `new Date()` 取一次当天并格式化成 `'YYYY-MM-DD'`。**这是 UI 层，允许用 `new Date()`；`domain/` 里不允许**（见 Global Constraints）。必须格式化成局部日期，**不要用 `toISOString()`**（按 UTC 算，晚上会差一天）：
   ```ts
   const d = new Date()
   const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
   ```
7. 底部导航变成 **5 项：算 / 狗 / 检 / 钱 / 报**，顺序与设计文档 §4 的表一致。
8. 界面文案全中文。

**Steps:**
- [ ] **Step 0**：read `src/App.tsx` 与 Task 8/10 产出的页面，确认导航与状态容器的写法；read `src/domain/quarantine.ts` 确认实际签名。
- [ ] **Step 1**：实现页面与导航。
- [ ] **Step 2**：`npx vitest run`（本任务不加 domain 测试，应仍全绿）、`npm run build`、`npm run lint`。
- [ ] **Step 3**：`npm run dev` 手动验证（这是本任务的主要验收方式）：建一个批次 → 收 3 只狗 → 「检」页面应显示 3 只未接种 → 点「今天已接种」→ 变「等待抗体检测期」并显示还要等 21 天 → 把设置里的等待天数改成 0 → 变「可以送检」→ 点「今天已送检」→ 变「待申报检疫」→ 填证明编号与有效期 → 变「可出售」，底部变绿色确认块 → 把有效期改成昨天 → 变「检疫证明已过期」，底部警告块列出它。
- [ ] **Step 4**：提交：
  ```bash
  git add src
  git commit -m "feat(ui): 检疫页面与出栏前检查清单"
  ```

---

### Task 18: 渠道对照接进「算」页面与批次详情

**Goal:** 出门看狗之前能顺便回答「这批走哪条路更划算」。

**Files:**
- Modify: `src/ui/pages/CalculatePage.tsx`（加渠道对照区块）
- Modify: 批次详情页（显示并允许修改 `plannedChannel`）
- Modify: 「一键建批次」的调用处（把选中的渠道写进 `plannedChannel`）

**Consumes:** `compareChannels` / `ChannelInput` / `ChannelBreakdown`（`src/domain/channels.ts`，Task 16）；`batchPerDogCostFen` / `aliveCount`（`src/domain/costing.ts`）；`SALES_CHANNELS` / `ChannelId`（types.ts）；`formatMoney` / `fenToYuan` / `parseMoney`（`src/domain/money.ts`）。

**必须满足的行为:**

1. 「算」页面在保本价结果**下方**加一个**默认折叠**的「渠道对照」区块，标题旁一句：「同一批狗，走不同的路，最低可卖价不一样。」
2. 展开后，对 `SALES_CHANNELS` 里除 `undecided` 外的 **8 条渠道**各一行，每行三个输入：**预期单价** / **每只额外成本** / **该渠道固定成本**（都走 `parseMoney`，留空按 0）。
3. 每行实时显示 **保本单价** 与 **每只利润**。`isLoss` 为 true 的行标红并写「亏」，否则标绿。
4. 区块顶部有**存活数**输入（默认取计划里的 `count × (1 − mortalityRate)` 向上取整），因为它决定固定成本摊到几只上。这个数字要能手动改。
5. 渠道对照**必须调用 `compareChannels`**，界面里不得出现 `base + extra + fixed / n` 这类自己算的式子。**「算」页还没有真实批次时**，用 `{ batches: [{ id: '__plan__', ... }], dogs: [], ledger: [] }` 这样的临时 `AppData`（批次内含一条每只成本 = 决策台算出的每只成本的支出流水），再调用 `compareChannels`——**成本只能有一处算法**。实现时若发现更干净的做法，可以改，但必须满足"界面里没有第二套成本公式"。
6. 「一键存为批次」时，把用户在渠道对照里**选中的那一条**（默认 `undecided`）写进 `batch.plannedChannel`。
7. 批次详情页显示「计划去向：宠物店」，可点击修改（下拉列 `SALES_CHANNELS`），改完立刻保存。
8. 金额显示一律走 `formatMoney`（只在界面边界四舍五入）。
9. 界面文案全中文。

**Steps:**
- [ ] **Step 0**：read `src/ui/pages/CalculatePage.tsx` 与批次详情页，确认现有 `input` useMemo 与「存为批次」的调用链。
- [ ] **Step 1**：实现渠道对照区块。
- [ ] **Step 2**：把 `plannedChannel` 接进建批次与批次详情。
- [ ] **Step 3**：`npx vitest run` / `npm run build` / `npm run lint`。
- [ ] **Step 4**：`npm run dev` 手动验证：填一个批次 → 展开渠道对照 → 「宠物店」填单价 900、每只成本 0、固定成本 0 → 保本单价应等于决策台的每只成本；「犬市」填固定成本 400、单价 900 → 保本单价变高、可能标红 → 存为批次后进批次详情 → 计划去向是选中的那条，能改。
- [ ] **Step 5**：提交：
  ```bash
  git add src
  git commit -m "feat(ui): 渠道对照与批次计划去向"
  ```

---

### Task 19: 设置面板补两个检疫天数 + 校验

**Goal:** `rabiesWaitDays` 与 `quarantineLeadDays` 必须能在界面上改——默认 21 / 3 是国家规程的转述值，本地实际要求不同时要能改。

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
   - 天数一：「国家规程要求免疫满这个天数才能送检。默认 21 来自规程转述，**以当地动物卫生监督机构的答复为准**，问清了就改成真值。」
   - 天数二：「出售前要提前这么多天申报检疫（《动物检疫管理办法》第八条第二款是三天）。」
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
  git add src
  git commit -m "feat(ui): 设置面板补检疫天数并校验"
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

  const days = daysSinceBackup(data.settings.lastBackupAt, new Date())

  function handleExport() {
    const json = exportBackup(data)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const stamp = new Date().toISOString().slice(0, 10)
    a.href = url
    a.download = `狗账备份-${stamp}.json`
    a.click()
    URL.revokeObjectURL(url)
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

在 `src/ui/pages/ReportPage.tsx` 底部（最后一个 `</section>` 之后、外层 `</div>` 之前）加入：

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
