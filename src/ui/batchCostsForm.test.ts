import { describe, it, expect } from 'vitest'
import { DEFAULT_DATA } from '../domain/types'
import type { AppData, Dog, DogStatus } from '../domain/types'
import { previewBatchCosts } from '../domain/batchCosts'
import type { BatchCostDraft } from './batchCostsForm'
import {
  batchCostDraftIssue,
  batchCostRowIssue,
  batchCostsInput,
  draftToAmounts,
  emptyBatchCostDraft,
  parseBatchCostAmount,
  previewText,
} from './batchCostsForm'

const BATCH_ID = 'b1'

/** 造一只狗。检疫那六个字段与补账表无关，一律留空。 */
function makeDog(id: string, status: DogStatus): Dog {
  return {
    id, batchId: BATCH_ID, code: `一批-${id}`, breed: '', sex: 'unknown', ageMonths: null,
    status, note: '',
    rabiesVaccinatedOn: null, antibodyTestedOn: null, antibodyReportNo: '',
    quarantineCertNo: '', quarantineCertIssuedOn: null, quarantineCertValidUntil: null,
  }
}

/**
 * 一个批次 + 两只狗（1 死 1 在库）+ 收货时记下的一笔收购款。
 * 补账表的「按只数生成几笔」只有拿真实的 `data` 才算得出来（"每只"要数狗，
 * 处理费只算死狗），所以这里必须造一份 `AppData`，不能只喂纯数。
 */
function seed(): AppData {
  return {
    ...DEFAULT_DATA,
    batches: [{
      id: BATCH_ID, name: '一批', date: '2026-10-03', source: '', note: '',
      status: 'active', plannedChannel: 'undecided',
    }],
    dogs: [makeDog('d1', 'dead'), makeDog('d2', 'in_stock')],
    entries: [{
      id: 'e-purchase', date: '2026-10-03', type: 'expense', category: 'purchase', amount: 30000,
      paidBy: 'pool', payee: null, batchId: BATCH_ID, dogId: 'd1', note: '',
    }],
  }
}

/** 四行都填了正数的草稿；每个用例只改它要动的那一行。 */
const filled: BatchCostDraft = {
  transport: '400', medicalPerDog: '80', quarantinePerDog: '50', disposalPerDog: '200',
}

function withDraft(patch: Partial<BatchCostDraft>): BatchCostDraft {
  return { ...filled, ...patch }
}

/** 用户什么都没填（这不是错误，只是"不补"）。 */
const blank: BatchCostDraft = {
  transport: '', medicalPerDog: '', quarantinePerDog: '', disposalPerDog: '',
}

describe('emptyBatchCostDraft', () => {
  it('四个字段都是空串，而且每次都是新对象（别人的草稿不能被这一批改到）', () => {
    expect(emptyBatchCostDraft()).toEqual({
      transport: '', medicalPerDog: '', quarantinePerDog: '', disposalPerDog: '',
    })
    expect(emptyBatchCostDraft()).not.toBe(emptyBatchCostDraft())
  })
})

describe('parseBatchCostAmount', () => {
  it('空串是 0（"不补这一项"与"这项是 0"在账上等价：填 0 本来就不写流水）', () => {
    expect(parseBatchCostAmount('')).toBe(0)
  })

  it('只打了空格也算空：用户删数字时留下的空白不该变成红字', () => {
    expect(parseBatchCostAmount('   ')).toBe(0)
  })

  it("'1,200' → 120000（走 parseMoney 的口径，千分位逗号要认）", () => {
    expect(parseBatchCostAmount('1,200')).toBe(120000)
  })

  it("'200' → 20000（输入的是元，存的是分）", () => {
    expect(parseBatchCostAmount('200')).toBe(20000)
  })

  it("'¥3' → 300（复制粘贴带符号也认）", () => {
    expect(parseBatchCostAmount('¥3')).toBe(300)
  })

  it("'1.5' → 150（可以带角分）", () => {
    expect(parseBatchCostAmount('1.5')).toBe(150)
  })

  it("'abc' → null（非法，交给 batchCostDraftIssue 出红字）", () => {
    expect(parseBatchCostAmount('abc')).toBeNull()
  })

  it("'-5' → -500（负数是解析得出来但不合法，两件事分开）", () => {
    expect(parseBatchCostAmount('-5')).toBe(-500)
  })
})

describe('draftToAmounts', () => {
  it('四个空串 → 四个 0', () => {
    expect(draftToAmounts(blank)).toEqual({
      transportFen: 0, medicalPerDogFen: 0, quarantinePerDogFen: 0, disposalPerDogFen: 0,
    })
  })

  it("'1,200' → 120000（千分位照样转成 120000 分）", () => {
    const amounts = draftToAmounts({ ...blank, transport: '1,200' })
    expect(amounts.transportFen).toBe(120000)
  })

  it('四行各自转各自的，不会串行', () => {
    expect(draftToAmounts(filled)).toEqual({
      transportFen: 40000, medicalPerDogFen: 8000, quarantinePerDogFen: 5000, disposalPerDogFen: 20000,
    })
  })

  it('非法那一行按 0 计（永远不会吐出 NaN 去污染金额）', () => {
    expect(draftToAmounts({ ...blank, medicalPerDog: 'abc' }).medicalPerDogFen).toBe(0)
  })
})

describe('batchCostDraftIssue', () => {
  it('四行全空是合法的（null = 没有红字，只是没东西要补）', () => {
    expect(batchCostDraftIssue(blank)).toBeNull()
  })

  it('四行都填对 → null', () => {
    expect(batchCostDraftIssue(filled)).toBeNull()
  })

  it("某一行 'abc' → 红字", () => {
    expect(batchCostDraftIssue(withDraft({ transport: 'abc' }))).not.toBeNull()
  })

  it('每一行都能被查出来（四行都要有，漏一行就等于放 NaN 进账）', () => {
    expect(batchCostDraftIssue(withDraft({ transport: 'x' }))).not.toBeNull()
    expect(batchCostDraftIssue(withDraft({ medicalPerDog: 'x' }))).not.toBeNull()
    expect(batchCostDraftIssue(withDraft({ quarantinePerDog: 'x' }))).not.toBeNull()
    expect(batchCostDraftIssue(withDraft({ disposalPerDog: 'x' }))).not.toBeNull()
  })

  it('负数是红字（补账只会加钱，负数意味着用户想把某笔账倒着写回去）', () => {
    expect(batchCostDraftIssue(withDraft({ quarantinePerDog: '-1' }))).not.toBeNull()
    expect(batchCostDraftIssue(withDraft({ transport: '-100' }))).not.toBeNull()
  })

  it("0 不是负数：'0' 合法（等于不补这一项）", () => {
    expect(batchCostDraftIssue(withDraft({ transport: '0' }))).toBeNull()
  })

  it('空串那几行不参与检查：其余三行填错也要报出来', () => {
    expect(batchCostDraftIssue({ ...blank, disposalPerDog: 'abc' })).not.toBeNull()
  })
})

describe('previewText', () => {
  it("previewText(19, 123400) → '将新增 19 笔 · ¥1,234'（整数分不带小数点）", () => {
    expect(previewText(19, 123400)).toBe('将新增 19 笔 · ¥1,234')
  })

  it("有角分时写出来：previewText(3, 12345) → '将新增 3 笔 · ¥123.45'", () => {
    expect(previewText(3, 12345)).toBe('将新增 3 笔 · ¥123.45')
  })

  it("一笔都没有时也给出文案：previewText(0, 0) → '将新增 0 笔 · ¥0'", () => {
    expect(previewText(0, 0)).toBe('将新增 0 笔 · ¥0')
  })
})

describe('batchCostsInput', () => {
  it('合法草稿 → 逐字段的 addBatchCosts 入参（日期与批次 id 由调用方传）', () => {
    expect(batchCostsInput(BATCH_ID, '2026-10-10', filled)).toEqual({
      batchId: BATCH_ID,
      date: '2026-10-10',
      transportFen: 40000,
      medicalPerDogFen: 8000,
      quarantinePerDogFen: 5000,
      disposalPerDogFen: 20000,
    })
  })

  it('红字状态下返回 null：界面拿不到入参，就绝不会把这一版草稿写进账', () => {
    expect(batchCostsInput(BATCH_ID, '2026-10-10', withDraft({ transport: 'abc' }))).toBeNull()
  })

  it('全空的草稿也能转出入参（四个 0）：拦不拦由 previewBatchCosts 说了算', () => {
    expect(batchCostsInput(BATCH_ID, '2026-10-10', blank)).toEqual({
      batchId: BATCH_ID,
      date: '2026-10-10',
      transportFen: 0, medicalPerDogFen: 0, quarantinePerDogFen: 0, disposalPerDogFen: 0,
    })
  })
})

describe('batchCostRowIssue', () => {
  it('填对的一行没有任何提示（null）', () => {
    expect(batchCostRowIssue('200')).toBeNull()
  })

  it('空着的一行也没有提示（空 = 不补这一项，不是错误）', () => {
    expect(batchCostRowIssue('')).toBeNull()
    expect(batchCostRowIssue('  ')).toBeNull()
  })

  it("认不出来的给红字（Field 会把这句话画在这一行输入框下面）", () => {
    expect(batchCostRowIssue('abc')).not.toBeNull()
  })

  it('负数给红字', () => {
    expect(batchCostRowIssue('-1')).not.toBeNull()
  })

  it('红字落在出错的那一行：只有错的那行有提示，别的行还是干净', () => {
    expect(batchCostRowIssue('200')).toBeNull()
    expect(batchCostRowIssue('xyz')).not.toBeNull()
    expect(batchCostRowIssue('50')).toBeNull()
  })

  it('batchCostDraftIssue 的第一条就是最上面那一行的错（从上往下改）', () => {
    const draft = { ...blank, transport: 'abc', medicalPerDog: 'xyz' }
    expect(batchCostDraftIssue(draft)).toBe(batchCostRowIssue(draft.transport))
  })
})

/**
 * 「按钮亮不亮」的口径来自 `previewBatchCosts`（域层），不是这一层自己求和 ——
 * 所以这一组测试**必须**把两边放在一起断言，否则界面哪天把「有没有东西要补」
 * 改成自己算（比如按总金额 > 0 判），这批测试也不会响。
 */
describe('四行全 0 的判定与 previewBatchCosts().count === 0 一致', () => {
  it('四行全 0：输入合法（没有红字），但 preview 说一笔都不加 → 按钮该是灰的', () => {
    const data = seed()
    const input = batchCostsInput(BATCH_ID, '2026-10-10', blank)
    expect(batchCostDraftIssue(blank)).toBeNull()
    expect(input).not.toBeNull()
    if (input === null) throw new Error('全空草稿应当能转出入参')
    expect(previewBatchCosts(data, input).count).toBe(0)
  })

  it('只要有一行填了正数，preview 就会真的加流水（笔数不为 0）', () => {
    const data = seed()
    const input = batchCostsInput(BATCH_ID, '2026-10-10', { ...blank, transport: '400' })
    if (input === null) throw new Error('填对的草稿应当能转出入参')
    // 运输是整批一笔
    expect(previewBatchCosts(data, input).count).toBe(1)
  })

  it('四行都填了正数时，笔数是域层数出来的：运输 1 + 疫苗 2 只 + 检疫 2 只 + 处理费 1 只死的', () => {
    const data = seed()
    const input = batchCostsInput(BATCH_ID, '2026-10-10', filled)
    if (input === null) throw new Error('填对的草稿应当能转出入参')
    expect(previewBatchCosts(data, input).count).toBe(6)
    // 整批一笔运输 ¥400 + 两只各 ¥80 + 两只各 ¥50 + 一只死狗 ¥200 = ¥860
    expect(previewBatchCosts(data, input).totalFen).toBe(40000 + 8000 * 2 + 5000 * 2 + 20000)
  })

  it('空白两行都填 0、只填了别的行：0 那几行一笔都不生成', () => {
    const data = seed()
    // 两只狗（含死的那只）各一笔疫苗 → 2 笔；运输与检疫是 0 → 不生成
    const input = batchCostsInput(BATCH_ID, '2026-10-10', { ...blank, medicalPerDog: '80' })
    if (input === null) throw new Error('填对的草稿应当能转出入参')
    expect(previewBatchCosts(data, input).count).toBe(2)
  })

  it('红字时界面连预览都算不出来（入参是 null）—— 不可能出现"红字还亮着按钮"', () => {
    const input = batchCostsInput(BATCH_ID, '2026-10-10', withDraft({ transport: 'abc' }))
    expect(batchCostDraftIssue(withDraft({ transport: 'abc' }))).not.toBeNull()
    expect(input).toBeNull()
  })
})
