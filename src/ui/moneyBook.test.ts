import { describe, it, expect } from 'vitest'
import { BUILTIN_COST_ITEMS, DEFAULT_SETTINGS } from '../domain/types'
import type { CostItemDef, EntryType } from '../domain/types'
import {
  TYPE_LABEL, catLabel, entryLabel, partnerName, needsPartner, canSubmit, amountInvalid,
} from './moneyBook'

const COST_ITEMS = BUILTIN_COST_ITEMS
const PARTNERS = DEFAULT_SETTINGS.partners

/** EntryType 的全部成员。写死一份是为了「新增成员时这里也要看一眼」，tsc 不检查数组完整性。 */
const ALL_TYPES: EntryType[] = ['injection', 'expense', 'income', 'reimbursement', 'distribution']

describe('TYPE_LABEL：每一种流水类型都有中文名', () => {
  it('五种类型全覆盖，且不是英文 id 本身', () => {
    for (const t of ALL_TYPES) {
      const label = TYPE_LABEL[t]
      expect(typeof label).toBe('string')
      expect(label.length).toBeGreaterThan(0)
      // 漏配时 Record<EntryType, string> 会让 tsc 报错，漏的是「配了但配成英文 id」这种
      expect(label).not.toBe(t)
    }
  })

  it('标签互不相同（两个类型显示成同一个名字，用户分不清钱怎么走的）', () => {
    const labels = ALL_TYPES.map(t => TYPE_LABEL[t])
    expect(new Set(labels).size).toBe(labels.length)
  })
})

describe('catLabel：分类名必须中文，且不能漏掉内置成本项', () => {
  it('quarantine 与 disposal 这两个内置项有中文名（硬编码表就是漏了它们）', () => {
    expect(catLabel(COST_ITEMS, 'quarantine')).toBe('检疫（抗体检测+申报）')
    expect(catLabel(COST_ITEMS, 'disposal')).toBe('病死犬无害化处理')
  })

  it('六个内置成本项一个都不漏', () => {
    for (const c of COST_ITEMS) {
      expect(catLabel(COST_ITEMS, c.id)).toBe(c.name)
    }
  })

  it('用户自建的成本项走设置表，不显示英文 id', () => {
    const custom: CostItemDef[] = [
      ...COST_ITEMS,
      { id: 'my_own_fee', name: '狗市的摊位费', scope: 'batch', isBuiltin: false },
    ]
    expect(catLabel(custom, 'my_own_fee')).toBe('狗市的摊位费')
  })

  it('非成本项的分类名：sale → 收入，transfer → 转账', () => {
    expect(catLabel(COST_ITEMS, 'sale')).toBe('收入')
    expect(catLabel(COST_ITEMS, 'transfer')).toBe('转账')
  })

  it('查不到时兜底「其他」，绝不把英文 id 显示给用户', () => {
    expect(catLabel(COST_ITEMS, 'mobile_game_topup')).toBe('其他')
    expect(catLabel([], 'purchase')).toBe('其他')
  })

  it('设置里的成本项表为空时，非成本项仍然有名字', () => {
    expect(catLabel([], 'sale')).toBe('收入')
  })
})

describe('entryLabel：流水行标题', () => {
  it('支出带成本项名', () => {
    expect(entryLabel(COST_ITEMS, 'expense', 'medical')).toBe('支出 · 疫苗驱虫医疗')
  })

  it('卖狗的收入不重复成「收入 · 收入」', () => {
    expect(entryLabel(COST_ITEMS, 'income', 'sale')).toBe('收入')
  })

  it('注资 / 报销 / 分红 只显示类型名（它们的 category 恒为 transfer，是接口约定不是信息）', () => {
    expect(entryLabel(COST_ITEMS, 'injection', 'transfer')).toBe('注资')
    expect(entryLabel(COST_ITEMS, 'reimbursement', 'transfer')).toBe('报销')
    expect(entryLabel(COST_ITEMS, 'distribution', 'transfer')).toBe('分红')
  })

  it('支出遇到查不到的分类也兜底成中文', () => {
    expect(entryLabel(COST_ITEMS, 'expense', 'unknown_thing')).toBe('支出 · 其他')
  })
})

describe('partnerName', () => {
  it('查得到就用名字', () => {
    expect(partnerName(PARTNERS, 'p1')).toBe('我')
  })

  it('查不到就显示原始 id，不留空白', () => {
    expect(partnerName(PARTNERS, 'ghost')).toBe('ghost')
    expect(partnerName([], 'p1')).toBe('p1')
  })
})

describe('needsPartner：哪几种钱必须有归属人', () => {
  it('注资 / 报销 / 分红必须有归属人', () => {
    expect(needsPartner('injection')).toBe(true)
    expect(needsPartner('reimbursement')).toBe(true)
    expect(needsPartner('distribution')).toBe(true)
  })

  it('支出与收入不需要（支出的人由 paidBy 决定）', () => {
    expect(needsPartner('expense')).toBe(false)
    expect(needsPartner('income')).toBe(false)
  })
})

describe('canSubmit：「记下」按钮什么时候能用', () => {
  it('金额为空 → 不能用', () => {
    expect(canSubmit('expense', '', 'pool')).toBe(false)
    expect(canSubmit('income', '', '')).toBe(false)
  })

  it('金额不是数字 → 不能用（abc / 1200元 / 指数写法）', () => {
    expect(canSubmit('expense', 'abc', '')).toBe(false)
    expect(canSubmit('expense', '1200元', '')).toBe(false)
    expect(canSubmit('expense', '1e999', '')).toBe(false)
  })

  it('正常金额的支出 → 能用（不要求合伙人）', () => {
    expect(canSubmit('expense', '400', '')).toBe(true)
  })

  it('★ partners 为空时注资 / 报销 / 分红不能用（否则记出一笔无主的钱）', () => {
    expect(canSubmit('injection', '5000', '')).toBe(false)
    expect(canSubmit('reimbursement', '700', '')).toBe(false)
    expect(canSubmit('distribution', '500', '')).toBe(false)
  })

  it('指定了合伙人就能用', () => {
    expect(canSubmit('injection', '5000', 'p1')).toBe(true)
    expect(canSubmit('reimbursement', '700', 'p1')).toBe(true)
    expect(canSubmit('distribution', '500', 'p2')).toBe(true)
  })

  it('金额为 0 合法（记一笔 0 元比丢掉用户刚填的表单好）', () => {
    expect(canSubmit('expense', '0', '')).toBe(true)
  })

  it('带 ¥ 与千分位逗号的输入能被接受', () => {
    expect(canSubmit('expense', '¥1,200.50', '')).toBe(true)
  })
})

describe('amountInvalid：什么时候要显示中文错误行', () => {
  it('空输入不算错（用户还没开始填）', () => {
    expect(amountInvalid('')).toBe(false)
    expect(amountInvalid('   ')).toBe(false)
  })

  it('填了但不是数字才算错', () => {
    expect(amountInvalid('abc')).toBe(true)
    expect(amountInvalid('1200元')).toBe(true)
  })

  it('合法金额不算错', () => {
    expect(amountInvalid('1200')).toBe(false)
    expect(amountInvalid('0')).toBe(false)
  })
})

describe('一致性：canSubmit 与 amountInvalid 不能互相打架', () => {
  it('「有错误提示」与「按钮可用」不会同时为真', () => {
    const samples = ['', '  ', '0', 'abc', '1200元', '1200', '¥1,200.50', '1e999', '-500']
    for (const s of samples) {
      expect(amountInvalid(s) && canSubmit('expense', s, 'p1')).toBe(false)
    }
  })
})
