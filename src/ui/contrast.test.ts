import { describe, it, expect } from 'vitest'

/**
 * 颜色对比度的守卫（WCAG 2.1 AA，普通正文 4.5:1）。
 *
 * **为什么要有这一层。** 第三方审计量出来「计算页 19 处、报表页 13 处小字低于
 * AA」——最要命的是 `text-gray-400`（白底 2.54:1，连大字号标准 3:1 都不到），
 * 而它在全仓有 46 处，全是「这个数是干嘛的」那类说明文字。
 *
 * 把这些颜色一次性改对不难，难的是**以后不再滑回去**：这个应用只有两个人在看，
 * 没有设计评审，没有谁会在提交前拿计算器量对比度。所以这里做两件事：
 * ①把调色板本身的比例算出来钉住（改错了立刻知道错在哪）；
 * ②当一条源码守卫 —— 直接读 `src/**\/*.tsx` 的文本，谁把被禁的颜色写回去就红，
 *   并且报错信息要说出「哪个文件哪一行、该改成什么」，让人一眼能改。
 *
 * 纯文本 + 算术，不需要 DOM，跑得飞快。
 */

// ── WCAG 2.1 对比度公式 ────────────────────────────────────────────────────

function channelToLinear(srgb: number): number {
  const v = srgb / 255
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

/** 相对亮度：`#888` 与 `#888888` 两种写法都收。 */
function relativeLuminance(hex: string): number {
  const raw = hex.replace('#', '')
  const full = raw.length === 3 ? raw.split('').map(c => c + c).join('') : raw
  const r = Number.parseInt(full.slice(0, 2), 16)
  const g = Number.parseInt(full.slice(2, 4), 16)
  const b = Number.parseInt(full.slice(4, 6), 16)
  return 0.2126 * channelToLinear(r) + 0.7152 * channelToLinear(g) + 0.0722 * channelToLinear(b)
}

/** 两个颜色的对比度比值，1:1 ~ 21:1。前景背景谁在前都一样。 */
function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const lighter = Math.max(la, lb)
  const darker = Math.min(la, lb)
  return (lighter + 0.05) / (darker + 0.05)
}

describe('contrastRatio（先把公式本身钉住）', () => {
  it('黑白是 21:1', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1)
  })

  it('#777777 对白约 4.48:1', () => {
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2)
  })

  it('#9ca3af（就是旧 text-gray-400）对白约 2.54:1 —— 审计说的就是这件事', () => {
    expect(contrastRatio('#9ca3af', '#ffffff')).toBeCloseTo(2.54, 2)
  })

  it('前景背景调换，比值不变', () => {
    expect(contrastRatio('#047857', '#fff')).toBeCloseTo(contrastRatio('#fff', '#047857'), 6)
  })

  it('三位简写与六位写法等价', () => {
    expect(relativeLuminance('#777')).toBeCloseTo(relativeLuminance('#777777'), 6)
  })
})

/**
 * 本次选定的调色板。每一行都写清楚「谁用在哪」，改色的时候知道要连带改什么。
 * 底色用的是 Tailwind 的实际色值（v4 默认调色板）。
 */
const PALETTE: { name: string; fg: string; bg: string }[] = [
  { name: 'text-gray-500 在页面底色 bg-gray-50 上', fg: '#6b7280', bg: '#f9fafb' },
  { name: 'text-gray-500 在白卡上', fg: '#6b7280', bg: '#ffffff' },
  { name: 'text-gray-600 在灰底 bg-gray-100 上（输入框里的 placeholder 用它）', fg: '#4b5563', bg: '#f3f4f6' },
  { name: 'text-emerald-50 在 bg-emerald-700 上（保本价卡的标签）', fg: '#ecfdf5', bg: '#047857' },
  { name: 'text-emerald-700 在白卡上', fg: '#047857', bg: '#ffffff' },
  { name: 'bg-emerald-700 白字按钮', fg: '#ffffff', bg: '#047857' },
  { name: 'text-red-700 在白卡上', fg: '#b91c1c', bg: '#ffffff' },
  { name: 'bg-red-600 白字按钮（保留，已达标）', fg: '#ffffff', bg: '#dc2626' },
  { name: 'text-amber-700 在白卡上', fg: '#b45309', bg: '#ffffff' },
  { name: 'bg-gray-900 白字主按钮（保留）', fg: '#ffffff', bg: '#111827' },
]

describe('调色板全部达到 WCAG AA（4.5:1）', () => {
  it.each(PALETTE)('$name', ({ fg, bg }) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5)
  })

  it('旧配色里那几个确实是不达标的（证明这次改的不是洁癖）', () => {
    expect(contrastRatio('#9ca3af', '#ffffff')).toBeLessThan(4.5) // text-gray-400
    expect(contrastRatio('#6ee7b7', '#ffffff')).toBeLessThan(4.5) // 顺带一提的浅绿
    expect(contrastRatio('#059669', '#ffffff')).toBeLessThan(4.5) // emerald-600 文字
    expect(contrastRatio('#ffffff', '#059669')).toBeLessThan(4.5) // emerald-600 底上的白字
    expect(contrastRatio('#ef4444', '#ffffff')).toBeLessThan(4.5) // red-500 文字
    expect(contrastRatio('#d97706', '#ffffff')).toBeLessThan(4.5) // amber-600 文字
  })

  it('gray-500 直接铺在 bg-gray-100 上只有 4.39 —— 所以输入框里的 placeholder 用 gray-600', () => {
    // 这条是「按表格推」会踩的坑：映射表说 gray-400 → gray-500，
    // 但输入框自己的底是 bg-gray-100（不是白），gray-500 叠上去差一点点不达标，
    // 于是按同一条规则的例外（灰底上用 gray-600）。数字摆在这里，免得下次有人改回去。
    expect(contrastRatio('#6b7280', '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio('#6b7280', '#f3f4f6')).toBeLessThan(4.5)
    expect(contrastRatio('#4b5563', '#f3f4f6')).toBeGreaterThanOrEqual(4.5)
  })
})

// ── 源码守卫 ──────────────────────────────────────────────────────────────

/**
 * 用 Vite 自己的 `import.meta.glob` 把 `src/**\/*.tsx` 的**源码文本**拿进来，
 * 而不是 `node:fs`（`:113` 之前的写法）。
 *
 * 为什么换：`tsconfig.app.json` 的 `types` 只放 `vite/client`，那个字段一收窄，
 * `import ... from 'node:fs'` 在 `tsc -b` 下就是 `TS2591`，`npm run build` 直接红。
 * 想让它过，就得往那份配置里塞 `@types/node` —— 那等于让**应用代码**也能直接调
 * node API（浏览器里一跑就炸，而且要到运行时才发现）。守卫要的只是源码文本，
 * 不值得为它给整个应用开这个口子。`vite/client` 本来就在 `types` 里，用它零成本。
 */
const SOURCES: Record<string, string> = import.meta.glob<string>('../**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
})

const TSX_FILES = Object.keys(SOURCES)
  .filter(path => !path.endsWith('.test.tsx'))
  .sort((a, b) => (a < b ? -1 : 1))
  .map(path => ({ path: path.replace(/^(?:\.\.\/|\.\/)+/, ''), text: SOURCES[path] }))

function findUses(rules: { token: string; fix: string }[]): string[] {
  const found: string[] = []
  for (const file of TSX_FILES) {
    file.text.split('\n').forEach((line, index) => {
      for (const { token, fix } of rules) {
        if (line.includes(token)) {
          found.push(`${file.path}:${index + 1} 还在用 ${token}，应改成 ${fix}`)
        }
      }
    })
  }
  return found
}

describe('源码守卫自己得先能看见文件', () => {
  it('glob 至少捞到 src 下那十几个 .tsx（捞不到就等于守卫形同虚设）', () => {
    // 守卫最怕的不是「有漏网的」，是「其实一个文件都没读」还显示绿。
    expect(TSX_FILES.length).toBeGreaterThanOrEqual(10)
    expect(TSX_FILES.map(f => f.path)).toContain('App.tsx')
    expect(TSX_FILES.map(f => f.path)).toContain('TabBar.tsx')
  })
})

describe('源码守卫：灰字不许再滑回低对比度', () => {
  it('src/**/*.tsx 里没有 text-gray-400 / text-gray-300', () => {
    const found = findUses([
      { token: 'text-gray-400', fix: 'text-gray-500（若它在 bg-gray-100 / bg-gray-200 里则改 text-gray-600）' },
      { token: 'text-gray-300', fix: 'text-gray-500' },
    ])
    expect(found, '下面这些地方还是低对比度的灰字：').toEqual([])
  })
})

describe('源码守卫：绿 / 红 / 琥珀文字与按钮不许再滑回低对比度', () => {
  it('src/**/*.tsx 里没有 text-emerald-600 / bg-emerald-600 / text-red-500 / text-amber-600', () => {
    const found = findUses([
      { token: 'text-emerald-600', fix: 'text-emerald-700' },
      { token: 'bg-emerald-600', fix: 'bg-emerald-700' },
      { token: 'text-red-500', fix: 'text-red-700' },
      { token: 'text-amber-600', fix: 'text-amber-700' },
    ])
    expect(found, '下面这些地方还是低对比度的彩色文字/按钮：').toEqual([])
  })
})
