import { describe, it, expect } from 'vitest'
import { BUILTIN_COST_ITEMS, DEFAULT_DATA, DEFAULT_SETTINGS } from '../domain/types'
import type { AppData, CostItemDef, EntryType } from '../domain/types'
import { addExpense } from '../domain/actions'
import { advanceBalance, poolBalance } from '../domain/ledger'
import { formatMoney } from '../domain/money'
import {
  TYPE_LABEL, catLabel, entryLabel, partnerName, needsPartner, canSubmit, amountInvalid,
  overAdvance, overAdvanceHint, applyBooking,
} from './moneyBook'
import type { BookDialog, BookingDraft } from './moneyBook'

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
    expect(canSubmit('expense', '', 'pool', 0)).toBe(false)
    expect(canSubmit('income', '', '', 0)).toBe(false)
  })

  it('金额不是数字 → 不能用（abc / 1200元 / 指数写法）', () => {
    expect(canSubmit('expense', 'abc', '', 0)).toBe(false)
    expect(canSubmit('expense', '1200元', '', 0)).toBe(false)
    expect(canSubmit('expense', '1e999', '', 0)).toBe(false)
  })

  it('正常金额的支出 → 能用（不要求合伙人）', () => {
    expect(canSubmit('expense', '400', '', 0)).toBe(true)
  })

  it('★ partners 为空时注资 / 报销 / 分红不能用（否则记出一笔无主的钱）', () => {
    expect(canSubmit('injection', '5000', '', 0)).toBe(false)
    expect(canSubmit('reimbursement', '700', '', 70000)).toBe(false)
    expect(canSubmit('distribution', '500', '', 0)).toBe(false)
  })

  it('指定了合伙人就能用', () => {
    expect(canSubmit('injection', '5000', 'p1', 0)).toBe(true)
    expect(canSubmit('reimbursement', '700', 'p1', 70000)).toBe(true)
    expect(canSubmit('distribution', '500', 'p2', 0)).toBe(true)
  })

  it('金额为 0 合法（记一笔 0 元比丢掉用户刚填的表单好）', () => {
    expect(canSubmit('expense', '0', '', 0)).toBe(true)
  })

  it('带 ¥ 与千分位逗号的输入能被接受', () => {
    expect(canSubmit('expense', '¥1,200.50', '', 0)).toBe(true)
  })

  it('报销时余额参数真的起作用（不是摆设）', () => {
    expect(canSubmit('reimbursement', '700', 'p1', 70000)).toBe(true)
    expect(canSubmit('reimbursement', '700', 'p1', 0)).toBe(false)
  })
})

describe('overAdvance：报销不能超过垫付', () => {
  it('恰好等于余额 → 放行（报完归零是正常操作）', () => {
    expect(overAdvance('reimbursement', '700', 70000)).toBe(false)
  })

  it('多 1 分 → 拦住', () => {
    expect(overAdvance('reimbursement', '700.01', 70000)).toBe(true)
  })

  it('余额为 0 时任何正数都拦住', () => {
    expect(overAdvance('reimbursement', '0.01', 0)).toBe(true)
    expect(overAdvance('reimbursement', '5000', 0)).toBe(true)
  })

  it('余额为 0 时报 0 元不拦（0 不是正数）', () => {
    expect(overAdvance('reimbursement', '0', 0)).toBe(false)
  })

  it('其它四种钱不受这条上限影响（支出超过任何余额都是正常的）', () => {
    const others: BookDialog[] = ['expense', 'income', 'injection', 'distribution']
    for (const d of others) {
      expect(overAdvance(d, '999999', 0)).toBe(false)
      expect(canSubmit(d, '999999', 'p1', 0)).toBe(true)
    }
  })

  it('金额解析不出来时不算「超报」（归「金额只能填数字」那条提示管）', () => {
    expect(overAdvance('reimbursement', 'abc', 70000)).toBe(false)
    expect(overAdvance('reimbursement', '1200元', 70000)).toBe(false)
    expect(overAdvance('reimbursement', '', 70000)).toBe(false)
    expect(overAdvance('reimbursement', '   ', 70000)).toBe(false)
  })

  it('提示文案必须把「现在只垫付了多少」说出来，否则用户不知道改成多少', () => {
    expect(overAdvanceHint(70000)).toContain('¥700')
    expect(overAdvanceHint(0)).toContain('¥0')
    expect(overAdvanceHint(40000)).toBe(`该合伙人现在只垫付了 ${formatMoney(40000)}，报销不能超过这个数`)
  })
})

describe('报销上限：按「选中的那个人」算余额，别算错人', () => {
  // p1 垫付了 700，p2 一分没垫。
  const withAdvance: AppData = addExpense(DEFAULT_DATA, {
    batchId: null, dogId: null, category: 'purchase',
    amount: 70000, paidBy: 'p1', date: '2026-10-03', note: '',
  })

  it('前提：p1 垫付 700，p2 垫付 0', () => {
    expect(advanceBalance(withAdvance, 'p1')).toBe(70000)
    expect(advanceBalance(withAdvance, 'p2')).toBe(0)
  })

  it('给垫付过的人报销 700 → 放行', () => {
    expect(canSubmit('reimbursement', '700', 'p1', advanceBalance(withAdvance, 'p1'))).toBe(true)
  })

  it('给没垫付过的那个人报销任何正数 → 拦住', () => {
    expect(canSubmit('reimbursement', '400', 'p2', advanceBalance(withAdvance, 'p2'))).toBe(false)
    expect(canSubmit('reimbursement', '0.01', 'p2', advanceBalance(withAdvance, 'p2'))).toBe(false)
  })

  it('★ 拿错人的余额会放过一笔超报 —— 所以余额必须按选中的人算', () => {
    // p2 一分没垫，但如果误用 p1 的 700 当上限，这笔 400 的报销就会被放行。
    expect(canSubmit('reimbursement', '400', 'p2', advanceBalance(withAdvance, 'p1'))).toBe(true)
    expect(canSubmit('reimbursement', '400', 'p2', advanceBalance(withAdvance, 'p2'))).toBe(false)
  })
})

describe('applyBooking：判定不过就一分钱都不写', () => {
  const draft = (patch: Partial<BookingDraft>): BookingDraft => ({
    dialog: 'reimbursement',
    amountInput: '700',
    partnerId: 'p1',
    category: 'medical',
    paidBy: 'pool',
    note: '',
    date: '2026-10-03',
    ...patch,
  })

  const withAdvance: AppData = addExpense(DEFAULT_DATA, {
    batchId: null, dogId: null, category: 'purchase',
    amount: 70000, paidBy: 'p1', date: '2026-10-03', note: '',
  })

  it('超报：原样返回同一个引用，一条流水也不写', () => {
    const next = applyBooking(withAdvance, draft({ amountInput: '700.01' }))
    expect(next).toBe(withAdvance)
    expect(next.entries.length).toBe(withAdvance.entries.length)
    expect(advanceBalance(next, 'p1')).toBe(70000)
  })

  it('给没垫付过的人报销：也不写', () => {
    const next = applyBooking(withAdvance, draft({ amountInput: '1', partnerId: 'p2' }))
    expect(next).toBe(withAdvance)
    expect(next.entries.length).toBe(withAdvance.entries.length)
  })

  it('恰好等于余额：写账，报销后垫付归零', () => {
    const next = applyBooking(withAdvance, draft({ amountInput: '700' }))
    expect(next).not.toBe(withAdvance)
    expect(next.entries.length).toBe(withAdvance.entries.length + 1)
    const e = next.entries[next.entries.length - 1]
    expect(e.type).toBe('reimbursement')
    expect(e.category).toBe('transfer')
    expect(e.paidBy).toBe('pool')
    expect(e.payee).toBe('p1')
    expect(e.amount).toBe(70000)
    expect(e.date).toBe('2026-10-03')
    expect(advanceBalance(next, 'p1')).toBe(0)
    expect(poolBalance(next)).toBe(poolBalance(withAdvance) - 70000)
  })

  it('金额解析不出来：不写账', () => {
    expect(applyBooking(DEFAULT_DATA, draft({ amountInput: 'abc' }))).toBe(DEFAULT_DATA)
    expect(applyBooking(DEFAULT_DATA, draft({ amountInput: '' }))).toBe(DEFAULT_DATA)
  })

  it('需要归属人却没有归属人：不写账', () => {
    expect(applyBooking(DEFAULT_DATA, draft({ partnerId: '' }))).toBe(DEFAULT_DATA)
  })

  it('支出：走 paidBy，金额解析到分，备注带上', () => {
    const next = applyBooking(DEFAULT_DATA, draft({
      dialog: 'expense', amountInput: '¥1,200.50', category: 'medical', paidBy: 'p2', note: '打针',
    }))
    expect(next.entries.length).toBe(1)
    const e = next.entries[0]
    expect(e.type).toBe('expense')
    expect(e.category).toBe('medical')
    expect(e.paidBy).toBe('p2')
    expect(e.amount).toBe(120050)
    expect(e.note).toBe('打针')
    expect(advanceBalance(next, 'p2')).toBe(120050)
    expect(DEFAULT_DATA.entries.length).toBe(0)
  })

  it('注资 / 收入 / 分红：各写各的，且都不带 batchId / dogId', () => {
    const injected = applyBooking(DEFAULT_DATA, draft({ dialog: 'injection', amountInput: '5000', note: '开张' }))
    expect(injected.entries[0].type).toBe('injection')
    expect(injected.entries[0].paidBy).toBe('p1')
    expect(injected.entries[0].payee).toBeNull()
    expect(injected.entries[0].note).toBe('开张')

    const earned = applyBooking(DEFAULT_DATA, draft({ dialog: 'income', amountInput: '1200' }))
    expect(earned.entries[0].type).toBe('income')
    expect(earned.entries[0].category).toBe('sale')

    const shared = applyBooking(DEFAULT_DATA, draft({ dialog: 'distribution', amountInput: '500', partnerId: 'p2' }))
    expect(shared.entries[0].type).toBe('distribution')
    expect(shared.entries[0].payee).toBe('p2')
    expect(shared.entries[0].paidBy).toBe('pool')

    for (const d of [injected, earned, shared]) {
      expect(d.entries[0].batchId).toBeNull()
      expect(d.entries[0].dogId).toBeNull()
    }
    expect(DEFAULT_DATA.entries.length).toBe(0)
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

describe('一致性：几条提示与按钮不能互相打架', () => {
  it('「金额只能填数字」与「按钮可用」不会同时为真', () => {
    const samples = ['', '  ', '0', 'abc', '1200元', '1200', '¥1,200.50', '1e999', '-500']
    for (const s of samples) {
      expect(amountInvalid(s) && canSubmit('expense', s, 'p1', 0)).toBe(false)
    }
  })

  it('★「金额只能填数字」与「报销超了」两条红色提示不会同时出现', () => {
    const samples = ['', '  ', '0', 'abc', '1200元', '1200', '¥1,200.50', '1e999', '-500', '999999']
    for (const s of samples) {
      expect(amountInvalid(s) && overAdvance('reimbursement', s, 70000)).toBe(false)
    }
  })
})
