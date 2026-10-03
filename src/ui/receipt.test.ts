import { describe, it, expect } from 'vitest'
import { buildReceiptRows, receiptSize, fitText } from './receipt'
import { DEFAULT_DATA } from '../domain/types'
import type { AppData, Batch, Dog, DogStatus, LedgerEntry } from '../domain/types'

/**
 * `src/ui/receipt.ts` 里能脱离浏览器测的部分：行内容（纯函数）与版面尺寸（纯函数）。
 *
 * `drawReceipt` / `receiptToBlob` 要真 canvas 与 `document`，本仓没有 jsdom，
 * 它们由真浏览器走查覆盖；这里把「画之前要算的东西」抽成 `receiptSize` 就是为了
 * 让「画布够不够高、最后一行会不会被裁掉」这件事能被测到。
 */

function entry(over: Partial<LedgerEntry> = {}): LedgerEntry {
  const base: LedgerEntry = {
    id: 'e0', date: '2026-10-03', type: 'expense', category: 'purchase',
    amount: 0, paidBy: 'pool', payee: null, batchId: null, dogId: null, note: '',
  }
  return { ...base, ...over }
}

function withEntries(overrides: Partial<LedgerEntry>[]): AppData {
  return { ...DEFAULT_DATA, entries: overrides.map((o, i) => entry({ id: `e${i}`, ...o })) }
}

function dog(id: string, batchId: string, status: DogStatus): Dog {
  const base: Dog = {
    id, batchId, code: `D-${id}`, breed: '土狗', sex: 'unknown', ageMonths: null,
    status, note: '',
    rabiesVaccinatedOn: null, antibodyTestedOn: null, antibodyReportNo: '',
    quarantineCertNo: '', quarantineCertIssuedOn: null, quarantineCertValidUntil: null,
  }
  return base
}

const BATCH: Batch = {
  id: 'b1', name: '十月一车', date: '2026-10-01', source: '狗市', note: '',
  status: 'active', plannedChannel: 'undecided',
}

/** 一批 5 只：在库 2 + 卖出 1 + 死亡 1 + 退回 1；成本 3000 元、收入 4000 元。 */
function withBatch(): AppData {
  return {
    ...DEFAULT_DATA,
    batches: [BATCH],
    dogs: [
      dog('d1', 'b1', 'in_stock'),
      dog('d2', 'b1', 'in_stock'),
      dog('d3', 'b1', 'sold'),
      dog('d4', 'b1', 'dead'),
      dog('d5', 'b1', 'returned'),
    ],
    entries: [
      entry({ id: 'x1', type: 'expense', category: 'purchase', amount: 300000, batchId: 'b1' }),
      entry({ id: 'x2', type: 'income', category: 'sale', amount: 400000, batchId: 'b1' }),
    ],
  }
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
    expect(buildReceiptRows(data).find(r => r.label === '净利')?.value).toBe('¥1,360')
  })

  it('没有批次和流水时也能生成（不崩）', () => {
    const rows = buildReceiptRows(DEFAULT_DATA)
    expect(rows.length).toBeGreaterThan(0)
  })

  it('★ 只有「净利」一行是 emphasis（图片上被高亮的那行不能是别的）', () => {
    const rows = buildReceiptRows(DEFAULT_DATA)
    const emphasized = rows.filter(r => r.emphasis === true).map(r => r.label)
    expect(emphasized).toEqual(['净利'])
  })

  it('★ 每位合伙人恰好 3 行，且标签用名字、不是合伙人 id', () => {
    const rows = buildReceiptRows(DEFAULT_DATA)
    for (const p of DEFAULT_DATA.settings.partners) {
      const mine = rows.filter(r => r.label.startsWith(`${p.name} · `))
      expect(mine.map(r => r.label)).toEqual([
        `${p.name} · 应分`,
        `${p.name} · 垫付未还`,
        `${p.name} · 已注资`,
      ])
      expect(rows.some(r => r.label.includes(p.id))).toBe(false)
    }
  })

  it('★ 每个批次一行，数字按狗的状态来（退回的狗算在库，不计成已售）', () => {
    const rows = buildReceiptRows(withBatch())
    const row = rows.find(r => r.label === '批次 十月一车')
    expect(row?.value).toBe('在库 3 / 已售 1 / 死亡 1 · ¥1,000')
  })

  it('批次行数 = 批次数（没有批次时一行都不多）', () => {
    expect(buildReceiptRows(DEFAULT_DATA).filter(r => r.label.startsWith('批次 '))).toEqual([])
    expect(buildReceiptRows(withBatch()).filter(r => r.label.startsWith('批次 ')).length).toBe(1)
  })
})

describe('receiptSize', () => {
  it('宽度固定 720；高度 = 表头 + 行数 × 行高 + 页脚留白', () => {
    const size = receiptSize(0)
    expect(size.width).toBe(720)
    expect(size.headerHeight).toBe(190)
    expect(size.rowHeight).toBe(64)
    // 0 行时不该有任何行高：190 + 60 = 250（行高的增量由下一条钉住）
    expect(size.height).toBe(250)
  })

  it('每多一行就多一个行高（图像高度跟着行数长）', () => {
    expect(receiptSize(5).height - receiptSize(4).height).toBe(64)
  })

  it('★ 25 行也装得下：最后一个行基线高于画布底，页脚不压到最后一行上', () => {
    const rows = 25
    const size = receiptSize(rows)
    const lastBaseline = size.headerHeight + (rows - 1) * size.rowHeight
    const footerY = size.height - 30
    expect(lastBaseline).toBeLessThan(size.height)
    expect(footerY).toBeGreaterThan(lastBaseline)
  })
})

describe('fitText', () => {
  /** 一个假的尺子：每个字符 10px 宽。不用真 canvas 也能量出「会不会压到右边金额上」。 */
  const ruler = { measureText: (t: string) => ({ width: t.length * 10 }) }

  it('放得下就原样返回', () => {
    expect(fitText(ruler, '净利', 100)).toBe('净利')
  })

  it('★ 恰好等于上限时不截断（边界是 <= 而不是 <）', () => {
    expect(fitText(ruler, '1234567890', 100)).toBe('1234567890')
  })

  it('★ 放不下时尾巴加省略号，且截完的宽度不超过上限', () => {
    const out = fitText(ruler, '批次 某个很长很长的名字', 100)
    expect(out.endsWith('…')).toBe(true)
    expect(ruler.measureText(out).width).toBeLessThanOrEqual(100)
  })

  it('★ 一个字就超宽时至少留下一个字，不返回空串', () => {
    expect(fitText(ruler, '宽宽宽', 5)).toBe('宽…')
  })
})
