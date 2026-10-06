import { describe, it, expect } from 'vitest'
import type { PreOrder } from '../domain/types'
import type { PreOrderDraft } from './preOrderForm'
import {
  canSubmitPreOrder,
  draftFromOrder,
  draftIssue,
  emptyPreOrderDraft,
  parseExpectedCount,
  preOrderInput,
  preOrderPatch,
  stageText,
} from './preOrderForm'

/** 一张填得没问题的草稿：下面每个用例只改它一个字段。 */
const good: PreOrderDraft = {
  sellerName: '老李家',
  sellerContact: '13800000000',
  expectedCount: '6',
  collectDate: '2026-10-20',
  traits: '两只黄的，三只黑的',
  note: '',
}

function withDraft(patch: Partial<PreOrderDraft>): PreOrderDraft {
  return { ...good, ...patch }
}

const order: PreOrder = {
  id: 'o1',
  sellerName: '老李家',
  sellerContact: '13800000000',
  expectedCount: 6,
  collectDate: '2026-10-20',
  traits: '两只黄的，三只黑的',
  note: '别迟到',
  createdAt: '2026-10-01T09:00:00.000Z',
  status: 'reserved',
  receivedCount: 0,
  receivedBatchId: null,
  cancelReason: '',
}

describe('emptyPreOrderDraft', () => {
  it('六个字段都是空串，而且每次都是新对象（别人的草稿不能被这张单子改到）', () => {
    expect(emptyPreOrderDraft()).toEqual({
      sellerName: '',
      sellerContact: '',
      expectedCount: '',
      collectDate: '',
      traits: '',
      note: '',
    })
    expect(emptyPreOrderDraft()).not.toBe(emptyPreOrderDraft())
  })
})

describe('parseExpectedCount', () => {
  it("'3' → 3", () => {
    expect(parseExpectedCount('3')).toBe(3)
  })

  it("' 3 ' → 3（前后空格不算错）", () => {
    expect(parseExpectedCount(' 3 ')).toBe(3)
  })

  it("'' → null（空输入框不是「0 只」）", () => {
    expect(parseExpectedCount('')).toBeNull()
    expect(parseExpectedCount('   ')).toBeNull()
  })

  it("'0' → 0（0 是合法整数，拦不拦是 canSubmitPreOrder 的事）", () => {
    expect(parseExpectedCount('0')).toBe(0)
  })

  it("'1.5' / 'abc' / '-1' / '３' 都不是只数 → null", () => {
    expect(parseExpectedCount('1.5')).toBeNull()
    expect(parseExpectedCount('abc')).toBeNull()
    expect(parseExpectedCount('-1')).toBeNull()
    expect(parseExpectedCount('３')).toBeNull()
  })
})

describe('draftIssue', () => {
  it('六个字段都填对了 → null', () => {
    expect(draftIssue(good)).toBeNull()
  })

  it('卖家名为空 → 红字', () => {
    const issue = draftIssue(withDraft({ sellerName: '' }))
    expect(issue).not.toBeNull()
    expect(issue).toContain('卖家')
  })

  it('卖家名只有空格也算空 → 红字', () => {
    expect(draftIssue(withDraft({ sellerName: '   ' }))).not.toBeNull()
  })

  it('只数为空 → 红字', () => {
    const issue = draftIssue(withDraft({ expectedCount: '' }))
    expect(issue).not.toBeNull()
    expect(issue).toContain('只')
  })

  it("只数是 'abc' → 红字", () => {
    expect(draftIssue(withDraft({ expectedCount: 'abc' }))).not.toBeNull()
  })

  it("只数是 '0' → 红字（一只都不收的单子不该记）", () => {
    const issue = draftIssue(withDraft({ expectedCount: '0' }))
    expect(issue).not.toBeNull()
    expect(issue).toContain('只')
  })

  it("只数是 '1.5' → 红字（狗只有整只）", () => {
    expect(draftIssue(withDraft({ expectedCount: '1.5' }))).not.toBeNull()
  })

  it('日期为空 → 红字', () => {
    const issue = draftIssue(withDraft({ collectDate: '' }))
    expect(issue).not.toBeNull()
    expect(issue).toContain('日子')
  })

  it('联系方式 / 特征 / 备注留空不算错', () => {
    expect(draftIssue(withDraft({ sellerContact: '', traits: '', note: '' }))).toBeNull()
  })
})

describe('canSubmitPreOrder', () => {
  it('与 draftIssue 是同一个判定：一组输入上两者永远一致', () => {
    const cases: PreOrderDraft[] = [
      good,
      withDraft({ sellerContact: '', traits: '', note: '' }),
      withDraft({ sellerName: '' }),
      withDraft({ sellerName: '   ' }),
      withDraft({ expectedCount: '' }),
      withDraft({ expectedCount: '  ' }),
      withDraft({ expectedCount: 'abc' }),
      withDraft({ expectedCount: '0' }),
      withDraft({ expectedCount: '1.5' }),
      withDraft({ expectedCount: '20' }),
      withDraft({ collectDate: '' }),
    ]
    for (const draft of cases) {
      expect(canSubmitPreOrder(draft)).toBe(draftIssue(draft) === null)
    }
  })

  it("只数 '0' 解析得出来（parseExpectedCount → 0）但按钮仍然禁用 —— 这两件事不是一回事", () => {
    const draft = withDraft({ expectedCount: '0' })
    expect(parseExpectedCount(draft.expectedCount)).toBe(0)
    expect(canSubmitPreOrder(draft)).toBe(false)
  })

  it('全部合法 → true', () => {
    expect(canSubmitPreOrder(good)).toBe(true)
  })
})

describe('preOrderPatch', () => {
  it('合法草稿 → 六个可改字段，卖家名 / 联系方式 / 日期两边空格都去掉', () => {
    expect(preOrderPatch(withDraft({ sellerName: ' 老李家 ', sellerContact: ' 138 ', collectDate: ' 2026-10-20 ' })))
      .toEqual({
        sellerName: '老李家',
        sellerContact: '138',
        expectedCount: 6,
        collectDate: '2026-10-20',
        traits: '两只黄的，三只黑的',
        note: '',
      })
  })

  it('非法草稿 → null（界面据此不写库，而不是写进一张错的单子）', () => {
    expect(preOrderPatch(withDraft({ expectedCount: '' }))).toBeNull()
    expect(preOrderPatch(withDraft({ sellerName: '' }))).toBeNull()
    expect(preOrderPatch(withDraft({ collectDate: '' }))).toBeNull()
  })
})

describe('preOrderInput', () => {
  it('合法草稿 → AddPreOrderInput，createdAt 逐字用调用方传进来的 ISO', () => {
    expect(preOrderInput(good, '2026-10-02T10:00:00.000Z')).toEqual({
      sellerName: '老李家',
      sellerContact: '13800000000',
      expectedCount: 6,
      collectDate: '2026-10-20',
      traits: '两只黄的，三只黑的',
      note: '',
      createdAt: '2026-10-02T10:00:00.000Z',
    })
  })

  it('非法草稿 → null', () => {
    expect(preOrderInput(withDraft({ expectedCount: '0' }), '2026-10-02T10:00:00.000Z')).toBeNull()
  })
})

describe('draftFromOrder', () => {
  it('把账上的单子摊成草稿：只数变成字符串，其余逐字照抄', () => {
    expect(draftFromOrder(order)).toEqual({
      sellerName: '老李家',
      sellerContact: '13800000000',
      expectedCount: '6',
      collectDate: '2026-10-20',
      traits: '两只黄的，三只黑的',
      note: '别迟到',
    })
  })
})

describe('stageText', () => {
  it('黄了的单子只写「黄了」', () => {
    expect(stageText(order, 'cancelled', '2026-10-04')).toBe('黄了')
  })

  it('已收货的单子只写「已收货」', () => {
    expect(stageText(order, 'received', '2026-10-04')).toBe('已收货')
  })

  it('还没到日子的单子写「还没到日子」', () => {
    expect(stageText(order, 'upcoming', '2026-10-04')).toBe('还没到日子')
  })

  // 过期与快到期要能一眼分出急缓：两张卡如果都写「该去收了」，
  // 「约的是上周三」和「约的是后天」在界面上长得一模一样。
  it('过期了写「已经过期 N 天」', () => {
    const late = { ...order, collectDate: '2026-10-01' }
    expect(stageText(late, 'overdue', '2026-10-04')).toBe('已经过期 3 天')
  })

  it('快到期写「还有 N 天去收」', () => {
    const soon = { ...order, collectDate: '2026-10-07' }
    expect(stageText(soon, 'due_soon', '2026-10-04')).toBe('还有 3 天去收')
  })

  it('就是今天的话写「今天去收」，不写「还有 0 天」', () => {
    const todayOrder = { ...order, collectDate: '2026-10-04' }
    expect(stageText(todayOrder, 'due_soon', '2026-10-04')).toBe('今天去收')
  })

  // 手写坏数据（导入进来的空日期）不能让卡片上出现「还有 NaN 天」。
  it('日期是坏串时回落成「该去收了」，不吐 NaN', () => {
    const broken = { ...order, collectDate: '' }
    expect(stageText(broken, 'overdue', '2026-10-04')).toBe('该去收了')
    expect(stageText(broken, 'due_soon', '2026-10-04')).toBe('该去收了')
    expect(stageText(broken, 'upcoming', '2026-10-04')).toBe('还没到日子')
  })
})
