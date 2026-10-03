import { describe, it, expect } from 'vitest'
import type { Batch, Dog } from '../domain/types'
import type { QuarantineStage } from '../domain/quarantine'
import { expiresText, latestBatch, needsVaccinationDateHint, pickBatch, quickAction } from './quarantineView'

const TODAY = '2026-10-05'
const OTHER_TODAY = '2026-11-11'

/** 所有必填字段都给全；改哪一格就传哪一格。 */
function batch(over: Partial<Batch> = {}): Batch {
  return {
    id: 'b1', name: '第一批', date: '2026-10-01', source: '', note: '',
    status: 'active', plannedChannel: 'undecided',
    ...over,
  }
}

/** 检疫台账六格全给全：未接种/未检测/无证明用 null，编号用 ''。 */
function dog(over: Partial<Dog> = {}): Dog {
  return {
    id: 'd1', batchId: 'b1', code: '1', breed: '', sex: 'unknown',
    ageMonths: null, status: 'in_stock', note: '',
    rabiesVaccinatedOn: null, antibodyTestedOn: null,
    antibodyReportNo: '', quarantineCertNo: '',
    quarantineCertIssuedOn: null, quarantineCertValidUntil: null,
    ...over,
  }
}

describe('latestBatch：最近创建的批次是数组最后一条', () => {
  it('空数组 → null', () => {
    expect(latestBatch([])).toBeNull()
  })

  it('两条 → 返回最后一条（而不是按 date 排出来的那条）', () => {
    // 后建的那条故意填了更早的业务日期：按 date 排会挑错人。
    const first = batch({ id: 'b1', name: '第一批', date: '2026-10-09' })
    const second = batch({ id: 'b2', name: '第二批', date: '2026-10-01' })
    const result = latestBatch([first, second])
    expect(result).toBe(second)
    expect(result?.id).toBe('b2')
    expect(result?.name).toBe('第二批')
  })

  it('三条 → 还是最后一条', () => {
    const a = batch({ id: 'b1', name: 'A' })
    const b = batch({ id: 'b2', name: 'B' })
    const c = batch({ id: 'b3', name: 'C' })
    expect(latestBatch([a, b, c])?.id).toBe('b3')
  })
})

describe('pickBatch：选中哪个批次', () => {
  const first = batch({ id: 'b1', name: '第一批' })
  const second = batch({ id: 'b2', name: '第二批' })

  it('命中 id → 就是那一条（哪怕它不是最后一条）', () => {
    const result = pickBatch([first, second], 'b1')
    expect(result).toBe(first)
    expect(result?.id).toBe('b1')
  })

  it('selectedId 为 null → 回落到最后一条', () => {
    expect(pickBatch([first, second], null)).toBe(second)
  })

  it('selectedId 是不存在的 id → 回落到最后一条', () => {
    expect(pickBatch([first, second], 'b404')).toBe(second)
  })

  it('空数组 → null（两种 selectedId 都是）', () => {
    const none: Batch[] = []
    expect(pickBatch(none, null)).toBeNull()
    expect(pickBatch(none, 'b1')).toBeNull()
  })
})

describe('quickAction：把阶段往前推一格最省事的那一步', () => {
  it('unvaccinated → 今天已接种，patch 带参数透传的今天', () => {
    const a = quickAction('unvaccinated', TODAY)
    expect(a).toEqual({ text: '今天已接种', patch: { rabiesVaccinatedOn: TODAY } })
    expect(a?.text).toBe('今天已接种')
    expect(a?.patch).toEqual({ rabiesVaccinatedOn: TODAY })
    expect(a?.focusCert).toBeUndefined()
  })

  it('unvaccinated → 换一个 today，patch 跟着换（证明它来自参数，不是常量）', () => {
    const a = quickAction('unvaccinated', OTHER_TODAY)
    expect(a?.patch).toEqual({ rabiesVaccinatedOn: OTHER_TODAY })
    expect(a?.patch).not.toEqual({ rabiesVaccinatedOn: TODAY })
  })

  it('ready_to_test → 今天已送检，patch 带参数透传的今天', () => {
    const a = quickAction('ready_to_test', TODAY)
    expect(a).toEqual({ text: '今天已送检', patch: { antibodyTestedOn: TODAY } })
    expect(a?.text).toBe('今天已送检')
    expect(a?.patch).toEqual({ antibodyTestedOn: TODAY })
    expect(a?.focusCert).toBeUndefined()
  })

  it('ready_to_test → 换一个 today，patch 跟着换', () => {
    const a = quickAction('ready_to_test', OTHER_TODAY)
    expect(a?.patch).toEqual({ antibodyTestedOn: OTHER_TODAY })
  })

  it('waiting_cert → 已有证明，只聚焦不落笔（没有 patch 这个键）', () => {
    const a = quickAction('waiting_cert', TODAY)
    expect(a).toEqual({ text: '已有证明', focusCert: true })
    expect(a?.text).toBe('已有证明')
    expect(a?.patch).toBeUndefined()
    expect(a?.focusCert).toBe(true)
    // 不只是 undefined：这个键根本不存在（存在 undefined 键会让 setDogQuarantine 收到空 patch）
    expect(a !== null && Object.prototype.hasOwnProperty.call(a, 'patch')).toBe(false)
  })

  it('waiting_antibody / certified / cert_expired → 没有「点一下就好」的事', () => {
    expect(quickAction('waiting_antibody', TODAY)).toBeNull()
    expect(quickAction('certified', TODAY)).toBeNull()
    expect(quickAction('cert_expired', TODAY)).toBeNull()
  })

  it('★ 六个阶段一个不漏（漏写一个阶段会被 tsc 的穷尽性检查拦下）', () => {
    const stages: QuarantineStage[] = [
      'unvaccinated', 'waiting_antibody', 'ready_to_test',
      'waiting_cert', 'certified', 'cert_expired',
    ]
    const withAction = stages.filter(s => quickAction(s, TODAY) !== null)
    expect(withAction).toEqual(['unvaccinated', 'ready_to_test', 'waiting_cert'])
  })
})

describe('expiresText：证明还有几天到期', () => {
  it('没填有效期 → null（「不知道」，不是「还剩 0 天」）', () => {
    expect(expiresText(null)).toBeNull()
  })

  it('已过期：-1 → 已过期 1 天', () => {
    expect(expiresText(-1)).toBe('已过期 1 天')
  })

  it('已过期：-3 → 已过期 3 天', () => {
    expect(expiresText(-3)).toBe('已过期 3 天')
  })

  it('0 → 今天到期（不是「还有 0 天到期」，也不是「已过期 0 天」）', () => {
    expect(expiresText(0)).toBe('今天到期')
  })

  it('1 → 还有 1 天到期', () => {
    expect(expiresText(1)).toBe('还有 1 天到期')
  })

  it('30 → 还有 30 天到期', () => {
    expect(expiresText(30)).toBe('还有 30 天到期')
  })
})

describe('needsVaccinationDateHint：有证明但接种日期没记', () => {
  it('certified + 接种日期为 null → true', () => {
    expect(needsVaccinationDateHint(dog({ rabiesVaccinatedOn: null }), 'certified')).toBe(true)
  })

  it('certified + 有接种日期 → false', () => {
    expect(needsVaccinationDateHint(dog({ rabiesVaccinatedOn: '2026-01-01' }), 'certified')).toBe(false)
  })

  it('★ unvaccinated + 接种日期为 null → false（没证明的狗根本不该提示这条）', () => {
    expect(needsVaccinationDateHint(dog({ rabiesVaccinatedOn: null }), 'unvaccinated')).toBe(false)
  })

  it('cert_expired + 接种日期为 null → false（旧证不算「有证明」）', () => {
    expect(needsVaccinationDateHint(dog({ rabiesVaccinatedOn: null }), 'cert_expired')).toBe(false)
  })

  it('其余三个阶段 + 日期为 null → 都不提示', () => {
    const d = dog({ rabiesVaccinatedOn: null })
    expect(needsVaccinationDateHint(d, 'waiting_antibody')).toBe(false)
    expect(needsVaccinationDateHint(d, 'ready_to_test')).toBe(false)
    expect(needsVaccinationDateHint(d, 'waiting_cert')).toBe(false)
  })
})
