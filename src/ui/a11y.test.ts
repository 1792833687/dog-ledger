import { describe, it, expect } from 'vitest'

/**
 * 无障碍的源码守卫。
 *
 * 探针测不到的东西（读屏器怎么念、焦点落在哪、Esc 是不是真的关窗），至少可以把
 * 「代码里得先有这些属性」钉住。上线前的第三方审计报告里这几条是扣分项，钉住它们
 * 免得下次改界面时又被顺手抹掉。
 *
 * 读源码的手法与 `src/ui/contrast.test.ts` 一样：用 Vite 自己的 `import.meta.glob`，
 * 不用 `node:fs`（理由见那个文件的注释：`tsconfig.app.json` 的 `types` 只放
 * `vite/client`，引入 node 内置模块会让 `npm run build` 直接红）。
 */
const SOURCES: Record<string, string> = import.meta.glob<string>('../**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
})

const TSX_FILES = Object.keys(SOURCES)
  .sort((a, b) => (a < b ? -1 : 1))
  .map(path => ({ path: path.replace(/^(?:\.\.\/|\.\/)+/, ''), text: SOURCES[path] }))

function file(path: string): { path: string; text: string } | undefined {
  return TSX_FILES.find(f => f.path === path)
}

/**
 * 注释里也会出现 `<h1>` 这类字样（既有注释就解释过「`<h1>` 里放 `<button>` 是合法的」），
 * 数标签前先剥掉注释，否则数出来的是「代码 + 讲解」。
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

function countTag(text: string, tag: string): number {
  const matches = stripComments(text).match(new RegExp(`<${tag}\\b`, 'g'))
  return matches === null ? 0 : matches.length
}

describe('源码守卫自己得先能看见文件', () => {
  it('glob 至少捞到 src 下的那些 .tsx（捞不到就等于守卫形同虚设）', () => {
    // 守卫最怕的不是「有漏网的」，是「其实一个文件都没读」还显示绿。
    expect(TSX_FILES.length).toBeGreaterThanOrEqual(10)
    const paths = TSX_FILES.map(f => f.path)
    // glob 的基准目录是本文件所在的 `src/ui/`，所以键是 `App.tsx`（上行）、
    // `components/Modal.tsx`、`pages/DogsPage.tsx` 这种形状。
    expect(paths).toContain('App.tsx')
    expect(paths).toContain('components/Modal.tsx')
    expect(paths).toContain('pages/DogsPage.tsx')
  })
})

describe('Modal 是个真的对话框', () => {
  const modal = file('components/Modal.tsx')

  it('Modal.tsx 在（改了名字就得来这里改守卫）', () => {
    expect(modal, '找不到 src/ui/components/Modal.tsx').toBeDefined()
  })

  it('面板上是 role="dialog" + aria-modal="true"', () => {
    const text = modal === undefined ? '' : modal.text
    expect(text).toContain('role="dialog"')
    expect(text).toContain('aria-modal="true"')
  })

  it('标题与面板关联（aria-labelledby 指到 useId 生成的那个 id）', () => {
    const text = modal === undefined ? '' : modal.text
    expect(text).toContain('aria-labelledby')
    expect(text).toContain('useId')
  })

  it('按 Escape 能关（没有键盘出口的弹窗只能靠点遮罩，读屏用户尤其难受）', () => {
    const text = modal === undefined ? '' : modal.text
    expect(text).toContain('Escape')
    expect(text).toContain('addEventListener')
  })

  it('焦点会进面板、关的时候还回去、Tab 不许跑到背后的页面上', () => {
    const text = modal === undefined ? '' : modal.text
    expect(text).toContain('tabIndex={-1}')
    expect(text).toContain('.focus()')
    // focus trap：至少得真的判断过 Tab
    expect(text).toContain('Tab')
  })
})

describe('每个页面恰好一个一级标题', () => {
  // 只有这五个是真页面；`pages/` 目录里还住着 BackupPanel / SettingsPanel 两个**面板**
  // （它们被 ReportPage 渲染，自己不配有 h1），所以按文件名挑 Page 结尾的。
  const PAGE_H1: Record<string, number> = {
    'pages/CalculatePage.tsx': 1,
    // 列表视图与详情视图各一个，同一时刻只渲染其中一个。
    'pages/DogsPage.tsx': 2,
    // 同上：没批次时的空态与有批次时的正文各自带一个标题。
    'pages/QuarantinePage.tsx': 2,
    'pages/MoneyPage.tsx': 1,
    'pages/ReportPage.tsx': 1,
  }

  it('页面清单就是那五个（新增页面得顺手补进这张表）', () => {
    const pages = TSX_FILES.map(f => f.path)
      .filter(p => /^pages\/[A-Za-z]+Page\.tsx$/.test(p))
      .sort()
    expect(pages).toEqual(Object.keys(PAGE_H1).sort())
  })

  it.each(Object.entries(PAGE_H1))('%s 里有 %i 个 <h1>', (path, expected) => {
    const target = file(path)
    expect(target, `找不到 ${path}`).toBeDefined()
    const text = target === undefined ? '' : target.text
    expect(countTag(text, 'h1'), `${path} 的 <h1> 个数不对`).toBe(expected)
  })
})

describe('不许用系统弹框', () => {
  it('src/ui/**/*.tsx 里没有 window.confirm / window.alert / window.prompt', () => {
    const found: string[] = []
    for (const f of TSX_FILES) {
      const text = stripComments(f.text)
      text.split('\n').forEach((line, index) => {
        for (const banned of ['window.confirm', 'window.alert', 'window.prompt']) {
          if (line.includes(banned)) {
            found.push(`${f.path}:${index + 1} 用了 ${banned} —— 系统弹框没有中文上下文，也拦不住误点`)
          }
        }
      })
    }
    expect(found).toEqual([])
  })
})

describe('输入框的 placeholder 有明确颜色', () => {
  /** 本文件里「值是带 placeholder:text- 的字符串」的常量名（`const X = '...'` 形式）。 */
  function coloredConstants(text: string): string[] {
    const names: string[] = []
    const re = /const\s+(\w+)\s*=\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`)/g
    let m = re.exec(text)
    while (m !== null) {
      const value = m[2] ?? m[3] ?? m[4] ?? ''
      if (value.includes('placeholder:text-')) names.push(m[1])
      m = re.exec(text)
    }
    return names
  }

  /** 把每个 `<input ...>` / `<textarea ...>` 起始标签切成一块（`>` 结束，跳过引号里的）。 */
  function controlBlocks(text: string): string[] {
    const blocks: string[] = []
    const re = /<(?:input|textarea)\b/g
    let m = re.exec(text)
    while (m !== null) {
      let i = m.index + m[0].length
      let quote: string | null = null
      while (i < text.length) {
        const ch = text[i]
        if (quote !== null) {
          if (ch === quote) quote = null
        } else if (ch === '"' || ch === "'" || ch === '`') {
          quote = ch
        } else if (ch === '>') {
          break
        }
        i += 1
      }
      blocks.push(text.slice(m.index, i + 1))
      m = re.exec(text)
    }
    return blocks
  }

  it('带 placeholder 的输入框要么自己写了颜色，要么用了带颜色的共享常量', () => {
    const found: string[] = []
    for (const f of TSX_FILES) {
      const text = stripComments(f.text)
      const constants = coloredConstants(text)
      for (const block of controlBlocks(text)) {
        if (!block.includes('placeholder=')) continue
        if (block.includes('placeholder:text-')) continue
        if (constants.some(name => block.includes(name))) continue
        const preview = block.replace(/\s+/g, ' ').slice(0, 90)
        found.push(`${f.path} 里这个输入框没写 placeholder 颜色：${preview}…`)
      }
    }
    // 灰底上的 placeholder 必须用 text-gray-600（gray-500 叠在 bg-gray-100 上只有 4.39:1，
    // 数字在 contrast.test.ts 里钉着）。
    expect(found).toEqual([])
  })
})
