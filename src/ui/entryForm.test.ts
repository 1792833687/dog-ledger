import { describe, it, expect } from 'vitest'
import { DEFAULT_DATA } from '../domain/types'
import type { AppData, Batch, Dog, DogStatus, LedgerEntry } from '../domain/types'
import { deleteWarning, entryDraftFrom, entryDraftIssue, entryPatch, entryScope } from './entryForm'

/**
 * 「钱」页面「就地改一笔 / 删一笔」那一层的测试。这一层判错的两个后果都很直接：
 * ①保存时把用户没碰的字段一起写掉（只改个备注，金额却被舍入或清成 0）；
 * ②删除确认弹窗对后果说错话 —— 承诺「这只狗会回到在库」而它其实不会，
 * 用户照着那句话点下去，账就真的错在那里了（`deleteEntry` 的回退规则有三个前提）。
 */

const BATCH_ID = 'b1'
const BATCH_NAME = '收狗 3 只 09:10'
const DOG_CODE = '收狗 3 只 09:10-2'

/** 取数组里第 `index` 个元素。越界就让测试炸掉，好过用 `!` 静音。 */
function at<T>(items: T[], index: number): T {
  const found = items[index]
  if (found === undefined) throw new Error(`第 ${index} 个元素不存在`)
  return found
}

function makeBatch(id: string, name: string): Batch {
  return {
    id, name, date: '2026-10-03', source: '', note: '', status: 'active', plannedChannel: 'undecided',
  }
}

function makeDog(id: string, code: string, status: DogStatus): Dog {
  return {
    id, batchId: BATCH_ID, code, breed: '', sex: 'unknown', ageMonths: null, status, note: '',
    rabiesVaccinatedOn: null, antibodyTestedOn: null, antibodyReportNo: '',
    quarantineCertNo: '', quarantineCertIssuedOn: null, quarantineCertValidUntil: null,
  }
}

/**
 * 一笔流水的底稿。标注成 `LedgerEntry` 而不是让 TS 从字面量推：`type: 'expense'` 推出来是
 * `string`，展开进 `Partial<LedgerEntry>` 时会当场报类型不符。
 */
const BASE_ENTRY: LedgerEntry = {
  id: 'e0', date: '2026-10-05', type: 'expense', category: 'medical', amount: 5000,
  paidBy: 'pool', payee: null, batchId: null, dogId: null, note: '',
}

function entry(overrides: Partial<LedgerEntry>): LedgerEntry {
  return { ...BASE_ENTRY, ...overrides }
}

/** 一条挂在狗 `d1` 上的销售流水（¥800）。 */
function sale(id: string, dogId = 'd1'): LedgerEntry {
  return entry({ id, type: 'income', category: 'sale', amount: 80000, batchId: BATCH_ID, dogId })
}

/** 一笔挂在该狗身上的售后退款（支出）。 */
function refund(id: string, dogId = 'd1'): LedgerEntry {
  return entry({ id, type: 'expense', category: 'aftercare_refund', amount: 60000, batchId: BATCH_ID, dogId })
}

function seed(entries: LedgerEntry[], dogStatus: DogStatus = 'sold', dogs?: Dog[]): AppData {
  return {
    ...DEFAULT_DATA,
    batches: [makeBatch(BATCH_ID, BATCH_NAME)],
    dogs: dogs ?? [makeDog('d1', DOG_CODE, dogStatus)],
    entries,
  }
}

/** 一条「与底稿一模一样」的草稿：金额按元写回去，其余原样。 */
const sameDraft = {
  amount: '50', date: '2026-10-05', note: '', paidBy: 'pool', category: 'medical',
}

describe('entryDraftFrom', () => {
  it('把一笔流水还原成草稿：金额按元、别的字段原样', () => {
    const e = entry({
      id: 'e1', amount: 123450, date: '2026-10-01', note: '给老李', paidBy: 'p2', category: 'transport',
    })
    expect(entryDraftFrom(e)).toEqual({
      amount: '1234.5', date: '2026-10-01', note: '给老李', paidBy: 'p2', category: 'transport',
    })
  })

  it('整数元不带小数点', () => {
    expect(entryDraftFrom(entry({ id: 'e1', amount: 5000 })).amount).toBe('50')
  })

  it('造出来的草稿原样交回去，判定说没问题、patch 是空的（打开弹窗直接点是空操作）', () => {
    const e = entry({ id: 'e1', amount: 80000, type: 'income', category: 'sale' })
    const draft = entryDraftFrom(e)
    expect(entryDraftIssue(e, draft)).toBeNull()
    expect(entryPatch(e, draft)).toEqual({})
  })
})

describe('entryPatch', () => {
  it('什么都没改 → 空对象（`updateEntry` 据此返回同一引用，界面直接关弹窗）', () => {
    expect(entryPatch(BASE_ENTRY, sameDraft)).toEqual({})
  })

  it('金额写法不同但数值相同 → 空对象', () => {
    expect(entryPatch(BASE_ENTRY, { ...sameDraft, amount: '50.00' })).toEqual({})
    expect(entryPatch(BASE_ENTRY, { ...sameDraft, amount: '¥50' })).toEqual({})
  })

  it('只改金额 → 只带 amount（分）', () => {
    expect(entryPatch(BASE_ENTRY, { ...sameDraft, amount: '60' })).toEqual({ amount: 6000 })
  })

  it('同时改日期与备注 → 就这两个键', () => {
    expect(entryPatch(BASE_ENTRY, { ...sameDraft, date: '2026-10-01', note: '补录' })).toEqual({
      date: '2026-10-01', note: '补录',
    })
  })

  it('备注从有到空 → 带 note: \'\'（undefined 是「别动」，空串才是「清空」）', () => {
    const withNote = entry({ id: 'e1', note: '记错了' })
    expect(entryPatch(withNote, { ...sameDraft, note: '' })).toEqual({ note: '' })
  })

  it('经手人改了 → 带 paidBy', () => {
    expect(entryPatch(BASE_ENTRY, { ...sameDraft, paidBy: 'p2' })).toEqual({ paidBy: 'p2' })
  })

  it('支出的类别改了 → 带 category', () => {
    expect(entryPatch(BASE_ENTRY, { ...sameDraft, category: 'transport' })).toEqual({ category: 'transport' })
  })

  it('收入的草稿里带类别 → patch 不带 category（护栏在域层，界面也不主动送）', () => {
    const income = entry({ id: 'e2', type: 'income', category: 'sale', amount: 5000 })
    expect(entryPatch(income, { ...sameDraft, amount: '60', category: 'medical' })).toEqual({ amount: 6000 })
    expect(entryPatch(income, { ...sameDraft, category: 'transport' })).toEqual({})
  })

  it('金额为空 / 非法 / 负数 → 一个 amount 都不送（那种草稿界面本来就点不下去）', () => {
    expect(entryPatch(BASE_ENTRY, { ...sameDraft, amount: '' })).toEqual({})
    expect(entryPatch(BASE_ENTRY, { ...sameDraft, amount: 'abc' })).toEqual({})
    expect(entryPatch(BASE_ENTRY, { ...sameDraft, amount: '-5' })).toEqual({})
  })

  it('patch 只会出现这五个键，别的字段（id / type / 挂靠）一个都不在里面', () => {
    const patch = entryPatch(BASE_ENTRY, {
      amount: '60', date: '2026-10-01', note: 'x', paidBy: 'p2', category: 'transport',
    })
    expect(Object.keys(patch).sort()).toEqual(['amount', 'category', 'date', 'note', 'paidBy'])
  })
})

describe('entryDraftIssue', () => {
  it('原样的草稿 → null', () => {
    expect(entryDraftIssue(BASE_ENTRY, sameDraft)).toBeNull()
  })

  it('金额 `abc` → 红字', () => {
    const issue = entryDraftIssue(BASE_ENTRY, { ...sameDraft, amount: 'abc' })
    expect(issue).not.toBeNull()
    expect(issue).toContain('金额')
  })

  it('金额空着 → 红字', () => {
    const issue = entryDraftIssue(BASE_ENTRY, { ...sameDraft, amount: '   ' })
    expect(issue).not.toBeNull()
    expect(issue).toContain('金额')
  })

  it('金额 `0` → null（0 合法，与新增路径一致）', () => {
    expect(entryDraftIssue(BASE_ENTRY, { ...sameDraft, amount: '0' })).toBeNull()
  })

  it('金额带负号 → 红字，且说到「负」', () => {
    const issue = entryDraftIssue(BASE_ENTRY, { ...sameDraft, amount: '-5' })
    expect(issue).not.toBeNull()
    expect(issue).toContain('负')
  })

  it('日期被清空 → 红字（记不了「没有日子」的账）', () => {
    const issue = entryDraftIssue(BASE_ENTRY, { ...sameDraft, date: '' })
    expect(issue).not.toBeNull()
    expect(issue).toContain('日期')
  })

  it('支出的类别被弄成空串 → 红字；收入不管这一项', () => {
    expect(entryDraftIssue(BASE_ENTRY, { ...sameDraft, category: '' })).not.toBeNull()
    const income = entry({ id: 'e2', type: 'income', category: 'sale' })
    expect(entryDraftIssue(income, { ...sameDraft, category: '' })).toBeNull()
  })
})

describe('deleteWarning', () => {
  it('带狗的销售流水、是该狗最后一条、狗已卖出 → 写明「这只狗会回到在库」', () => {
    const data = seed([sale('e1')])
    const warning = deleteWarning(data, at(data.entries, 0))
    expect(warning).toContain('这只狗会回到在库')
    expect(warning).toContain('没有撤销')
  })

  it('该狗还有更晚的一笔卖出 → 不说会回到在库', () => {
    const data = seed([sale('e1'), sale('e2')])
    const warning = deleteWarning(data, at(data.entries, 0))
    expect(warning).not.toContain('这只狗会回到在库')
    expect(warning).toContain('后面还有一笔卖出')
  })

  it('狗已经记过死亡 → 删收入不会把它复活', () => {
    const data = seed([sale('e1')], 'dead')
    const warning = deleteWarning(data, at(data.entries, 0))
    expect(warning).not.toContain('这只狗会回到在库')
    expect(warning).toContain('不会把它复活')
  })

  it('狗本来就在库 → 不必再动它', () => {
    const data = seed([sale('e1')], 'in_stock')
    const warning = deleteWarning(data, at(data.entries, 0))
    expect(warning).not.toContain('这只狗会回到在库')
    expect(warning).toContain('就在库')
  })

  it('该狗还挂着退款支出 → 追加一句「对不上任何一只狗」', () => {
    const data = seed([sale('e1'), refund('e2')])
    const warning = deleteWarning(data, at(data.entries, 0))
    expect(warning).toContain('这只狗会回到在库')
    expect(warning).toContain('对不上任何一只狗')
  })

  it('删的是售后退款那一笔 → 写明「别对同一只狗再退一次」', () => {
    const data = seed([sale('e1'), refund('e2')])
    const warning = deleteWarning(data, at(data.entries, 1))
    expect(warning).toContain('别对同一只狗再退一次')
    expect(warning).toContain('没有撤销')
  })

  it('普通支出（挂狗）→ 一般性文案，绝不误报成销售流水', () => {
    const data = seed([entry({ id: 'e1', batchId: BATCH_ID, dogId: 'd1', category: 'medical' })])
    const warning = deleteWarning(data, at(data.entries, 0))
    expect(warning).toContain('没有撤销')
    expect(warning).not.toContain('回到在库')
    expect(warning).not.toContain('退款')
    expect(warning).toContain(DOG_CODE)
  })

  it('不挂狗也不挂批次 → 说清它哪儿都不挂', () => {
    const data = seed([entry({ id: 'e1', type: 'injection', category: 'transfer', paidBy: 'p1' })])
    const warning = deleteWarning(data, at(data.entries, 0))
    expect(warning).toContain('没有撤销')
    expect(warning).toContain('不挂在任何一批')
  })

  it('只说流水自己的事：不承诺动预定单，也不提「收货」', () => {
    const data = seed([sale('e1')])
    const warning = deleteWarning(data, at(data.entries, 0))
    expect(warning).not.toContain('预定单')
    expect(warning).not.toContain('收货')
  })
})

describe('entryScope', () => {
  it('挂了狗的 → 「狗 <狗号>」', () => {
    const data = seed([])
    expect(entryScope(data, entry({ id: 'e1', dogId: 'd1', batchId: BATCH_ID }))).toBe(`狗 ${DOG_CODE}`)
  })

  it('挂了狗的优先显示狗，哪怕它同时也挂着批次', () => {
    const data = seed([])
    // 不能用 `not.toContain(BATCH_NAME)` 判：狗号本来就是「批次名-序号」，
    // 批次名是狗号的前缀，那条断言无论实现怎么写都会红。
    expect(entryScope(data, entry({ id: 'e1', dogId: 'd1', batchId: BATCH_ID }))).not.toContain('批次')
  })

  it('只挂批次的 → 「批次 <批次名>」', () => {
    const data = seed([])
    expect(entryScope(data, entry({ id: 'e1', batchId: BATCH_ID }))).toBe(`批次 ${BATCH_NAME}`)
  })

  it('都不挂的 → 「—」', () => {
    const data = seed([])
    expect(entryScope(data, entry({ id: 'e1' }))).toBe('—')
  })

  it('批次改名不追溯狗号：狗号还是旧的，批次名换成新的', () => {
    const data = seed([])
    const e = entry({ id: 'e1', dogId: 'd1', batchId: BATCH_ID })
    expect(entryScope(data, e)).toContain(DOG_CODE)
    const renamed: AppData = {
      ...data,
      batches: [makeBatch(BATCH_ID, '10月3日李村')],
      dogs: [makeDog('d1', DOG_CODE, 'sold')],
    }
    expect(entryScope(renamed, e)).toBe(`狗 ${DOG_CODE}`)
    expect(entryScope(renamed, entry({ id: 'e2', batchId: BATCH_ID }))).toBe('批次 10月3日李村')
  })

  it('指向的狗或批次已经找不到了 → 「—」，不凭空显示一个编号', () => {
    const data = seed([])
    expect(entryScope(data, entry({ id: 'e1', dogId: '没有这只狗' }))).toBe('—')
    expect(entryScope(data, entry({ id: 'e2', batchId: '没有这一批' }))).toBe('—')
  })
})
