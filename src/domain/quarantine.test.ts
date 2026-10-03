import { describe, it, expect } from 'vitest'
import { DEFAULT_DATA, DEFAULT_SETTINGS } from './types'
import type { AppData, Dog, Settings } from './types'
import {
  addDays, daysBetween, certExpiresIn, isSellable, preSaleChecklist, quarantineStatus, quarantineSummary,
} from './quarantine'
import type { QuarantineStage } from './quarantine'
// 源码原文，用来钉住「本文件不得出现无参 new Date()」这条纪律（见文件末尾的 describe）。
// `?raw` 的类型来自 tsconfig 里的 `types: ["vite/client"]`。
import quarantineSource from './quarantine.ts?raw'

/** 今天的固定值。测试里一律用字面量日期，不调 addDays 造基准，免得实现错了带着测试一起错。 */
const TODAY = '2026-10-02'
/** 2026-09-11 + 21 天 = 2026-10-02，正好是 rabiesWaitDays 的满期日。 */
const FULLY_WAITED = '2026-09-11'
const JUST_VACCINATED = '2026-10-01'

const S: Settings = { ...DEFAULT_SETTINGS, rabiesWaitDays: 21 }

const ALL_STAGES: QuarantineStage[] = [
  'unvaccinated', 'waiting_antibody', 'ready_to_test', 'waiting_cert', 'certified', 'cert_expired',
]

/** 一只「还没有任何检疫记录」的在库狗。测试只写自己关心的字段。 */
function dog(over: Partial<Dog> = {}): Dog {
  return {
    id: 'd1', batchId: 'b1', code: 'D1', breed: '泰迪', sex: 'unknown', ageMonths: null,
    status: 'in_stock', note: '',
    rabiesVaccinatedOn: null, antibodyTestedOn: null, antibodyReportNo: '',
    quarantineCertNo: '', quarantineCertIssuedOn: null, quarantineCertValidUntil: null,
    ...over,
  }
}

/** 已接种、已检测、手里有一张有效期到 2026-12-31 的证明 —— 标准的「可出售」狗。 */
function certifiedDog(id: string, over: Partial<Dog> = {}): Dog {
  return dog({
    id,
    rabiesVaccinatedOn: '2026-09-01',
    antibodyTestedOn: '2026-09-25',
    antibodyReportNo: `RPT-${id}`,
    quarantineCertNo: `JY-${id}`,
    quarantineCertIssuedOn: '2026-09-28',
    quarantineCertValidUntil: '2026-12-31',
    ...over,
  })
}

function dataOf(dogs: Dog[], settings: Settings = S): AppData {
  return { ...DEFAULT_DATA, settings, dogs }
}

describe('addDays：日期算术不依赖本地时区', () => {
  it('加 0 天原样返回', () => {
    expect(addDays('2026-10-02', 0)).toBe('2026-10-02')
  })

  it('加 21 天跨月', () => {
    expect(addDays('2026-10-02', 21)).toBe('2026-10-23')
    expect(addDays('2026-09-11', 21)).toBe('2026-10-02')
  })

  it('加 1 天跨年', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('平年 2 月末 +1 天到 3 月 1 日', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
  })

  it('闰年 2 月末 +1 天到 2 月 29 日', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2028-02-29', 1)).toBe('2028-03-01')
  })

  it('负数倒着走', () => {
    expect(addDays('2026-10-02', -1)).toBe('2026-10-01')
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31')
  })

  it('返回的永远是 10 位 YYYY-MM-DD（toISOString 不掺时分秒）', () => {
    for (const d of ['2026-01-01', '2026-06-15', '2026-12-31']) {
      expect(addDays(d, 7)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })
})

describe('daysBetween：两侧都用 UTC 解析', () => {
  it('同一天是 0', () => {
    expect(daysBetween(TODAY, TODAY)).toBe(0)
  })

  it('向后为正、跨月跨年都对', () => {
    expect(daysBetween('2026-09-11', '2026-10-02')).toBe(21)
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1)
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2)
  })

  it('反向为负（certExpiresIn 靠这个表示已过期）', () => {
    expect(daysBetween('2026-10-02', '2026-10-01')).toBe(-1)
  })

  it('★ 跨美国夏令时切换日也正好是 1 天（本地时区算法会差 1 小时以上）', () => {
    expect(daysBetween('2026-03-07', '2026-03-08')).toBe(1)
    expect(daysBetween('2026-03-08', '2026-03-09')).toBe(1)
    expect(daysBetween('2026-11-01', '2026-11-02')).toBe(1)
  })

  it('与 addDays 互为逆运算', () => {
    for (const n of [-40, -1, 1, 21, 365]) {
      expect(daysBetween(TODAY, addDays(TODAY, n))).toBe(n)
      expect(daysBetween(addDays(TODAY, n), TODAY)).toBe(-n)
    }
    // 0 单独断言：`-0` 与 `0` 在 toBe 下不是同一个值（Object.is），写进循环会假红
    expect(daysBetween(TODAY, TODAY)).toBe(0)
    expect(daysBetween(TODAY, addDays(TODAY, 0))).toBe(0)
  })
})

describe('六个阶段的判定各一例', () => {
  it('unvaccinated：没接种日期', () => {
    const s = quarantineStatus(dog(), S, TODAY)
    expect(s.stage).toBe('unvaccinated')
    expect(s.label).toBe('未接种狂犬疫苗')
    expect(s.nextAction).toBe('先带去接种狂犬疫苗')
    expect(s.daysUntilTestable).toBeNull()
    expect(s.isSellable).toBe(false)
  })

  it('waiting_antibody：接种了但还没等够', () => {
    const s = quarantineStatus(dog({ rabiesVaccinatedOn: JUST_VACCINATED }), S, TODAY)
    expect(s.stage).toBe('waiting_antibody')
    expect(s.label).toBe('等待抗体检测期')
    expect(s.daysUntilTestable).toBe(20)
    expect(s.nextAction).toBe('再等 20 天才能采血送检')
    expect(s.nextAction).not.toContain('法定')
    expect(s.isSellable).toBe(false)
  })

  it('ready_to_test：等够天数了', () => {
    const s = quarantineStatus(dog({ rabiesVaccinatedOn: FULLY_WAITED }), S, TODAY)
    expect(s.stage).toBe('ready_to_test')
    expect(s.label).toBe('可以送检')
    expect(s.nextAction).toBe('去采血做免疫抗体检测')
    expect(s.daysUntilTestable).toBeNull()
    expect(s.isSellable).toBe(false)
  })

  it('waiting_cert：检测做完了，在等证明', () => {
    const s = quarantineStatus(
      dog({ rabiesVaccinatedOn: FULLY_WAITED, antibodyTestedOn: '2026-09-30', antibodyReportNo: 'RPT-1' }),
      S, TODAY,
    )
    expect(s.stage).toBe('waiting_cert')
    expect(s.label).toBe('待申报检疫')
    expect(s.nextAction).toBe('提前 3 天向当地动物卫生监督机构申报')
    expect(s.daysUntilTestable).toBeNull()
    expect(s.isSellable).toBe(false)
  })

  it('certified：手里有有效期内的证明', () => {
    const s = quarantineStatus(certifiedDog('d1'), S, TODAY)
    expect(s.stage).toBe('certified')
    expect(s.label).toBe('可出售')
    expect(s.nextAction).toBe('已具备检疫证明，可以出售')
    expect(s.daysUntilTestable).toBeNull()
    expect(s.isSellable).toBe(true)
  })

  it('cert_expired：证明过期了', () => {
    const s = quarantineStatus(certifiedDog('d1', { quarantineCertValidUntil: '2026-09-30' }), S, TODAY)
    expect(s.stage).toBe('cert_expired')
    expect(s.label).toBe('检疫证明已过期')
    expect(s.nextAction).toBe('必须重新申报检疫，不能用旧证出售')
    expect(s.isSellable).toBe(false)
  })

  it('六个阶段的中文标签各不相同（界面靠它区分）', () => {
    const labels = [
      quarantineStatus(dog(), S, TODAY),
      quarantineStatus(dog({ rabiesVaccinatedOn: JUST_VACCINATED }), S, TODAY),
      quarantineStatus(dog({ rabiesVaccinatedOn: FULLY_WAITED }), S, TODAY),
      quarantineStatus(dog({ rabiesVaccinatedOn: FULLY_WAITED, antibodyTestedOn: '2026-09-30' }), S, TODAY),
      quarantineStatus(certifiedDog('d1'), S, TODAY),
      quarantineStatus(certifiedDog('d1', { quarantineCertValidUntil: '2026-09-30' }), S, TODAY),
    ].map(s => s.label)
    expect(new Set(labels).size).toBe(6)
  })
})

describe('判定顺序与边界', () => {
  it('★ 满 rabiesWaitDays 当天即可送检（不多等一天）', () => {
    const vaccinatedOn = addDays(TODAY, -S.rabiesWaitDays)
    expect(daysBetween(vaccinatedOn, TODAY)).toBe(21)
    expect(quarantineStatus(dog({ rabiesVaccinatedOn: vaccinatedOn }), S, TODAY).stage).toBe('ready_to_test')
  })

  it('差一天仍然要等，且 daysUntilTestable 是 1', () => {
    const s = quarantineStatus(dog({ rabiesVaccinatedOn: addDays(TODAY, -20) }), S, TODAY)
    expect(s.stage).toBe('waiting_antibody')
    expect(s.daysUntilTestable).toBe(1)
  })

  it('★ 有效期最后一天（=== today）仍然可售', () => {
    const s = quarantineStatus(certifiedDog('d1', { quarantineCertValidUntil: TODAY }), S, TODAY)
    expect(s.stage).toBe('certified')
    expect(s.isSellable).toBe(true)
  })

  it('★ 过了有效期一天就不可售', () => {
    const s = quarantineStatus(certifiedDog('d1', { quarantineCertValidUntil: '2026-10-01' }), S, TODAY)
    expect(s.stage).toBe('cert_expired')
    expect(s.isSellable).toBe(false)
  })

  it('★ 证明编号全是空格 = 没有证明', () => {
    const s = quarantineStatus(
      dog({
        rabiesVaccinatedOn: FULLY_WAITED,
        antibodyTestedOn: '2026-09-30',
        quarantineCertNo: '   ',
        quarantineCertValidUntil: '2026-12-31',
      }),
      S, TODAY,
    )
    expect(s.stage).toBe('waiting_cert')
    expect(s.isSellable).toBe(false)
  })

  it('cert_expired 必须先于 certified 判定：过期证不能因为「字段齐」就算可售', () => {
    const s = quarantineStatus(certifiedDog('d1', { quarantineCertValidUntil: '2020-01-01' }), S, TODAY)
    expect(s.stage).toBe('cert_expired')
  })

  // Task 15b 裁定（2026-10-02）：证明分支先于接种日期判定。理由是「证明是免疫与抗体检测
  // 都已满足的下游产物」——它存在就蕴含上游满足；`rabiesVaccinatedOn` 只是给自己看的便利
  // 记录，不是出售的前置条件。详见 quarantine.ts 里 quarantineStatus 上方那段注释。
  it('★ 有有效证明但接种日期不详 → certified 且可售（「证随狗走」的真实场景）', () => {
    const s = quarantineStatus(certifiedDog('d1', { rabiesVaccinatedOn: null }), S, TODAY)
    expect(s.stage).toBe('certified')
    expect(s.isSellable).toBe(true)
    expect(s.label).toBe('可出售')
    expect(s.nextAction).toBe('已具备检疫证明，可以出售')
  })

  it('★ 证明已过期且接种日期不详 → cert_expired 且不可售（不再丢成 unvaccinated）', () => {
    const s = quarantineStatus(
      certifiedDog('d1', { rabiesVaccinatedOn: null, quarantineCertValidUntil: '2026-09-30' }),
      S, TODAY,
    )
    expect(s.stage).toBe('cert_expired')
    expect(s.isSellable).toBe(false)
    expect(s.nextAction).toBe('必须重新申报检疫，不能用旧证出售')
  })

  it('★ 证明今天到期且接种日期不详 → certified（边界是 < 不是 <=）', () => {
    const s = quarantineStatus(
      certifiedDog('d1', { rabiesVaccinatedOn: null, quarantineCertValidUntil: TODAY }),
      S, TODAY,
    )
    expect(s.stage).toBe('certified')
    expect(s.isSellable).toBe(true)
  })

  it('★ 有证号但有效期为空 → 不算有证明；接种日期也不详时落到 unvaccinated', () => {
    const s = quarantineStatus(
      certifiedDog('d1', { rabiesVaccinatedOn: null, quarantineCertValidUntil: null }),
      S, TODAY,
    )
    expect(s.stage).toBe('unvaccinated')
    expect(s.isSellable).toBe(false)
  })

  it('★ 有效期非空但证号是空白 → 同样不算有证明，落到 unvaccinated（两个条件缺一不可）', () => {
    const s = quarantineStatus(
      certifiedDog('d1', { rabiesVaccinatedOn: null, quarantineCertNo: '   ' }),
      S, TODAY,
    )
    expect(s.stage).toBe('unvaccinated')
    expect(s.isSellable).toBe(false)
  })

  it('有接种、有检测，但证明编号为空 → waiting_cert（证号是证明的凭据）', () => {
    const s = quarantineStatus(certifiedDog('d1', { quarantineCertNo: '' }), S, TODAY)
    expect(s.stage).toBe('waiting_cert')
  })

  it('有接种、有检测，但有效期为空 → waiting_cert（不知道有效期就不敢卖）', () => {
    const s = quarantineStatus(certifiedDog('d1', { quarantineCertValidUntil: null }), S, TODAY)
    expect(s.stage).toBe('waiting_cert')
  })

  it('rabiesWaitDays 为 0 时当天接种即可送检（waiting_antibody 不可达）', () => {
    const s0: Settings = { ...S, rabiesWaitDays: 0 }
    const s = quarantineStatus(dog({ rabiesVaccinatedOn: TODAY }), s0, TODAY)
    expect(s.stage).toBe('ready_to_test')
    expect(s.daysUntilTestable).toBeNull()
  })

  it('rabiesWaitDays 可配置：等 7 天时第 7 天送检、第 6 天还要等', () => {
    const s7: Settings = { ...S, rabiesWaitDays: 7 }
    expect(quarantineStatus(dog({ rabiesVaccinatedOn: addDays(TODAY, -7) }), s7, TODAY).stage).toBe('ready_to_test')
    const s = quarantineStatus(dog({ rabiesVaccinatedOn: addDays(TODAY, -6) }), s7, TODAY)
    expect(s.stage).toBe('waiting_antibody')
    expect(s.daysUntilTestable).toBe(1)
  })

  it('quarantineLeadDays 可配置：申报提前天数跟着设置走', () => {
    const s5: Settings = { ...S, quarantineLeadDays: 5 }
    const s = quarantineStatus(
      dog({ rabiesVaccinatedOn: FULLY_WAITED, antibodyTestedOn: '2026-09-30' }),
      s5, TODAY,
    )
    expect(s.nextAction).toBe('提前 5 天向当地动物卫生监督机构申报')
  })

  it('接种日期被填成未来（录入错误）时，daysUntilTestable 仍是正数', () => {
    const s = quarantineStatus(dog({ rabiesVaccinatedOn: addDays(TODAY, 1) }), S, TODAY)
    expect(s.stage).toBe('waiting_antibody')
    expect(s.daysUntilTestable).toBe(22)
  })
})

describe('daysUntilTestable：只有 waiting_antibody 有值', () => {
  const cases: { name: string; d: Dog; stage: QuarantineStage }[] = [
    { name: 'unvaccinated', d: dog(), stage: 'unvaccinated' },
    { name: 'waiting_antibody', d: dog({ rabiesVaccinatedOn: JUST_VACCINATED }), stage: 'waiting_antibody' },
    { name: 'ready_to_test', d: dog({ rabiesVaccinatedOn: FULLY_WAITED }), stage: 'ready_to_test' },
    { name: 'waiting_cert', d: dog({ rabiesVaccinatedOn: FULLY_WAITED, antibodyTestedOn: '2026-09-30' }), stage: 'waiting_cert' },
    { name: 'certified', d: certifiedDog('d1'), stage: 'certified' },
    { name: 'cert_expired', d: certifiedDog('d1', { quarantineCertValidUntil: '2026-09-30' }), stage: 'cert_expired' },
  ]

  for (const c of cases) {
    it(`${c.name} 时是 ${c.stage === 'waiting_antibody' ? '正数' : 'null'}`, () => {
      const s = quarantineStatus(c.d, S, TODAY)
      expect(s.stage).toBe(c.stage)
      if (c.stage === 'waiting_antibody') {
        expect(s.daysUntilTestable).toBeGreaterThan(0)
      } else {
        expect(s.daysUntilTestable).toBeNull()
      }
    })
  }

  it('等于 rabiesWaitDays - daysBetween(接种日, 今天)', () => {
    const d = dog({ rabiesVaccinatedOn: addDays(TODAY, -3) })
    const s = quarantineStatus(d, S, TODAY)
    expect(s.daysUntilTestable).toBe(S.rabiesWaitDays - daysBetween(addDays(TODAY, -3), TODAY))
    expect(s.daysUntilTestable).toBe(18)
  })
})

describe('certExpiresIn', () => {
  it('没有有效期就返回 null', () => {
    expect(certExpiresIn(dog(), TODAY)).toBeNull()
    expect(certExpiresIn(dog({ quarantineCertValidUntil: null }), TODAY)).toBeNull()
  })

  it('还有 10 天到期', () => {
    expect(certExpiresIn(certifiedDog('d1', { quarantineCertValidUntil: addDays(TODAY, 10) }), TODAY)).toBe(10)
  })

  it('今天到期是 0', () => {
    expect(certExpiresIn(certifiedDog('d1', { quarantineCertValidUntil: TODAY }), TODAY)).toBe(0)
  })

  it('已过期返回负数', () => {
    expect(certExpiresIn(certifiedDog('d1', { quarantineCertValidUntil: '2026-09-30' }), TODAY)).toBe(-2)
  })

  it('只看有效期字段，不需要编号（界面拿它显示「还剩几天」）', () => {
    expect(certExpiresIn(dog({ quarantineCertNo: '', quarantineCertValidUntil: '2026-10-12' }), TODAY)).toBe(10)
  })
})

describe('isSellable 只有 certified 为 true，且复用 quarantineStatus', () => {
  const matrix: Dog[] = [
    dog(),
    dog({ rabiesVaccinatedOn: JUST_VACCINATED }),
    dog({ rabiesVaccinatedOn: FULLY_WAITED }),
    dog({ rabiesVaccinatedOn: FULLY_WAITED, antibodyTestedOn: '2026-09-30' }),
    certifiedDog('d1'),
    certifiedDog('d1', { quarantineCertValidUntil: TODAY }),
    certifiedDog('d1', { quarantineCertValidUntil: '2026-10-01' }),
    certifiedDog('d1', { quarantineCertNo: '  ' }),
    certifiedDog('d1', { rabiesVaccinatedOn: null }),
  ]

  it('每一只狗都与 quarantineStatus(...).isSellable 一致（没有第二套判定）', () => {
    for (const d of matrix) {
      expect(isSellable(d, S, TODAY)).toBe(quarantineStatus(d, S, TODAY).isSellable)
    }
  })

  it('当且仅当阶段是 certified', () => {
    for (const d of matrix) {
      expect(isSellable(d, S, TODAY)).toBe(quarantineStatus(d, S, TODAY).stage === 'certified')
    }
  })

  it('★ 这组样本里恰好三只可售（有效期今天到期的那只、接种日期不详但证齐全的那只）', () => {
    expect(matrix.filter(d => isSellable(d, S, TODAY)).length).toBe(3)
  })
})

describe('preSaleChecklist：在库的狗里哪些能卖', () => {
  it('★ 8 只里 3 只没有有效证明', () => {
    const dogs: Dog[] = [
      certifiedDog('d1'), certifiedDog('d2'), certifiedDog('d3'), certifiedDog('d4'), certifiedDog('d5'),
      // 没接种
      dog({ id: 'd6' }),
      // 接种了但还在等抗体期
      dog({ id: 'd7', rabiesVaccinatedOn: JUST_VACCINATED }),
      // 证明过期了
      certifiedDog('d8', { quarantineCertValidUntil: '2026-09-30' }),
    ]
    const list = preSaleChecklist(dataOf(dogs), 'b1', TODAY)
    expect(list.sellable.length).toBe(5)
    expect(list.blocked.length).toBe(3)
    expect(list.blocked.map(b => b.dog.id)).toEqual(['d6', 'd7', 'd8'])
    expect(list.blocked.map(b => b.status.stage)).toEqual(['unvaccinated', 'waiting_antibody', 'cert_expired'])
  })

  it('blocked 里带的是完整的 QuarantineStatus（界面要直接显示 label 与 nextAction）', () => {
    const list = preSaleChecklist(dataOf([dog({ id: 'd1' })]), 'b1', TODAY)
    expect(list.sellable.length).toBe(0)
    expect(list.blocked.length).toBe(1)
    const entry = list.blocked[0]
    expect(entry.dog.id).toBe('d1')
    expect(entry.status.stage).toBe('unvaccinated')
    expect(entry.status.label).toBe('未接种狂犬疫苗')
    expect(entry.status.nextAction).toBe('先带去接种狂犬疫苗')
    expect(entry.status.isSellable).toBe(false)
  })

  it('★ 只统计在库的狗：1 只已售 + 1 只已死 + 2 只在库 → 清单里只有那 2 只', () => {
    const dogs: Dog[] = [
      dog({ id: 'sold1', status: 'sold' }),
      dog({ id: 'dead1', status: 'dead' }),
      certifiedDog('live1'),
      dog({ id: 'live2' }),
    ]
    const list = preSaleChecklist(dataOf(dogs), 'b1', TODAY)
    expect(list.sellable.map(d => d.id)).toEqual(['live1'])
    expect(list.blocked.map(b => b.dog.id)).toEqual(['live2'])
    const ids = [...list.sellable.map(d => d.id), ...list.blocked.map(b => b.dog.id)]
    expect(ids).not.toContain('sold1')
    expect(ids).not.toContain('dead1')
  })

  it('死狗与已售狗即使没有证明也不算「不能卖」（文案说「在库 N 只里有 M 只不能卖」）', () => {
    const dogs: Dog[] = [dog({ id: 'dead1', status: 'dead' }), dog({ id: 'sold1', status: 'sold' })]
    const list = preSaleChecklist(dataOf(dogs), 'b1', TODAY)
    expect(list.sellable.length).toBe(0)
    expect(list.blocked.length).toBe(0)
  })

  it('★ 退回来的狗（returned）要出栏，必须出现在清单里', () => {
    const dogs: Dog[] = [
      certifiedDog('r1', { status: 'returned' }),
      dog({ id: 'r2', status: 'returned' }),
    ]
    const list = preSaleChecklist(dataOf(dogs), 'b1', TODAY)
    expect(list.sellable.map(d => d.id)).toEqual(['r1'])
    expect(list.blocked.map(b => b.dog.id)).toEqual(['r2'])
  })

  it('只看本批次：别的批次的狗一只都不算', () => {
    const dogs: Dog[] = [
      certifiedDog('mine'),
      certifiedDog('other', { batchId: 'b2' }),
      dog({ id: 'other2', batchId: 'b2' }),
    ]
    const list = preSaleChecklist(dataOf(dogs), 'b1', TODAY)
    expect(list.sellable.map(d => d.id)).toEqual(['mine'])
    expect(list.blocked.length).toBe(0)
  })

  it('空批次返回两个空数组', () => {
    const list = preSaleChecklist(dataOf([]), 'b1', TODAY)
    expect(list.sellable).toEqual([])
    expect(list.blocked).toEqual([])
  })

  it('卖得动的顺序跟着 data.dogs 的录入顺序走（界面不做二次排序）', () => {
    const dogs: Dog[] = [certifiedDog('z1'), dog({ id: 'z2' }), certifiedDog('z3')]
    const list = preSaleChecklist(dataOf(dogs), 'b1', TODAY)
    expect(list.sellable.map(d => d.id)).toEqual(['z1', 'z3'])
    expect(list.blocked.map(b => b.dog.id)).toEqual(['z2'])
  })

  it('用的是 data.settings（每个批次共用全局设置）', () => {
    const dogs: Dog[] = [dog({ id: 'd1', rabiesVaccinatedOn: addDays(TODAY, -7) })]
    const settings7: Settings = { ...S, rabiesWaitDays: 7 }
    expect(preSaleChecklist(dataOf(dogs, settings7), 'b1', TODAY).sellable.length).toBe(0)
    expect(preSaleChecklist(dataOf(dogs, settings7), 'b1', TODAY).blocked[0].status.stage).toBe('ready_to_test')
  })
})

describe('quarantineSummary：阶段分布', () => {
  it('★ 6 个 key 全部存在，空批次全是 0', () => {
    const summary = quarantineSummary(dataOf([]), 'b1', TODAY)
    expect(Object.keys(summary).sort()).toEqual([...ALL_STAGES].sort())
    for (const stage of ALL_STAGES) expect(summary[stage]).toBe(0)
  })

  it('★ 只统计在库的狗：1 已售 + 1 已死 + 2 在库 → 6 个 key 之和 = 2', () => {
    const dogs: Dog[] = [
      dog({ id: 'sold1', status: 'sold' }),
      dog({ id: 'dead1', status: 'dead' }),
      certifiedDog('live1'),
      dog({ id: 'live2' }),
    ]
    const summary = quarantineSummary(dataOf(dogs), 'b1', TODAY)
    expect(Object.keys(summary).sort()).toEqual([...ALL_STAGES].sort())
    const sum = ALL_STAGES.reduce((acc, stage) => acc + summary[stage], 0)
    expect(sum).toBe(2)
    expect(summary.certified).toBe(1)
    expect(summary.unvaccinated).toBe(1)
  })

  it('各阶段分别计数', () => {
    const dogs: Dog[] = [
      certifiedDog('c1'), certifiedDog('c2'), certifiedDog('c3'),
      dog({ id: 'u1' }),
      dog({ id: 'u2' }),
      dog({ id: 'r1', rabiesVaccinatedOn: FULLY_WAITED }),
      dog({ id: 'w1', rabiesVaccinatedOn: FULLY_WAITED, antibodyTestedOn: '2026-09-30' }),
      certifiedDog('e1', { quarantineCertValidUntil: '2026-09-30' }),
      dog({ id: 'a1', rabiesVaccinatedOn: JUST_VACCINATED }),
    ]
    const summary = quarantineSummary(dataOf(dogs), 'b1', TODAY)
    expect(summary).toEqual({
      unvaccinated: 2,
      waiting_antibody: 1,
      ready_to_test: 1,
      waiting_cert: 1,
      certified: 3,
      cert_expired: 1,
    })
  })

  it('退回来的狗也计入（它又站在笼子里了）', () => {
    const dogs: Dog[] = [dog({ id: 'r1', status: 'returned' }), certifiedDog('r2', { status: 'returned' })]
    const summary = quarantineSummary(dataOf(dogs), 'b1', TODAY)
    expect(summary.unvaccinated).toBe(1)
    expect(summary.certified).toBe(1)
    expect(ALL_STAGES.reduce((acc, stage) => acc + summary[stage], 0)).toBe(2)
  })

  it('只看本批次', () => {
    const dogs: Dog[] = [certifiedDog('mine'), certifiedDog('other', { batchId: 'b2' })]
    const summary = quarantineSummary(dataOf(dogs), 'b1', TODAY)
    expect(summary.certified).toBe(1)
  })

  it('与 preSaleChecklist 对同一批狗的口径一致（总数 = 可售 + 被拦）', () => {
    const dogs: Dog[] = [
      certifiedDog('d1'), dog({ id: 'd2' }), dog({ id: 'd3', status: 'returned' }),
      dog({ id: 'd4', status: 'sold' }),
    ]
    const list = preSaleChecklist(dataOf(dogs), 'b1', TODAY)
    const summary = quarantineSummary(dataOf(dogs), 'b1', TODAY)
    const total = ALL_STAGES.reduce((acc, stage) => acc + summary[stage], 0)
    expect(list.sellable.length + list.blocked.length).toBe(total)
    expect(summary.certified).toBe(list.sellable.length)
  })
})

describe('源码纪律：不依赖系统时钟', () => {
  it('quarantine.ts 里没有无参 new Date() / Date.now()（今天一律由调用方传入）', () => {
    // 正例：先证明拿到的是真源码（防止 ?raw 变成空字符串让下面两条断言假绿）
    expect(quarantineSource).toContain('export function quarantineStatus')
    expect(quarantineSource).toMatch(/Date\.UTC\(/)
    // 注释里会引用 `new Date()` 这个写法本身，所以剥掉注释行再断言代码部分
    const codeOnly = quarantineSource
      .split('\n')
      .filter(line => !/^\s*(\*|\/\*|\/\/)/.test(line))
      .join('\n')
    expect(codeOnly).toMatch(/export function addDays/)
    expect(codeOnly).not.toMatch(/new Date\(\s*\)/)
    expect(codeOnly).not.toMatch(/Date\.now\(/)
  })

  it('纯函数：同样的入参给同样的结果，改 today 就会有不同的结果', () => {
    const d = certifiedDog('d1', { quarantineCertValidUntil: '2026-12-31' })
    expect(quarantineStatus(d, S, TODAY)).toEqual(quarantineStatus(d, S, TODAY))
    // 若实现里偷看了系统时钟，下面两行就不会分别等于 10 / 负数
    expect(certExpiresIn(d, '2026-12-21')).toBe(10)
    expect(certExpiresIn(d, '2027-01-10')).toBe(-10)
    expect(quarantineStatus(d, S, '2027-01-10').stage).toBe('cert_expired')
    expect(quarantineStatus(d, S, '2026-12-31').stage).toBe('certified')
  })
})
