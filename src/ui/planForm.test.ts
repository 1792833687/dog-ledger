import { describe, it, expect } from 'vitest'
import type { Settings } from '../domain/types'
import type { PlanTextForm } from './planForm'
import {
  defaultPlanText,
  fenToTextInput,
  localTimeHm,
  parseMortalityPercent,
  parsePlanText,
  todayLocalIso,
} from './planForm'

/** 默认设置：检疫费与处理费都是 0（「还不知道」，不是「不要钱」），死亡率 15%。 */
const settings: Settings = {
  partners: [{ id: 'p1', name: '我', shareRatio: 1 }],
  costItems: [],
  targetMarginRate: 0.3,
  expectedMortalityRate: 0.15,
  quarantinePerDog: 0,
  disposalPerDog: 0,
  rabiesWaitDays: 21,
  quarantineLeadDays: 3,
  preOrderLeadDays: 3,
  lastBackupAt: null,
}

/** 计划 Task 9 手动验证那一组输入，另加每只检疫 25 元。 */
const goodForm: PlanTextForm = {
  n: '8',
  purchasePrice: '600',
  freight: '400',
  medicalPerDog: '80',
  quarantinePerDog: '25',
  disposalPerDog: '0',
  mortalityPercent: '25',
  targetPrice: '1200',
}

describe('fenToTextInput', () => {
  it('分转成元的字符串', () => {
    expect(fenToTextInput(0)).toBe('0')
    expect(fenToTextInput(2500)).toBe('25')
    expect(fenToTextInput(1234)).toBe('12.34')
  })
})

describe('defaultPlanText', () => {
  it('只数与单价是给用户改的示例值，检疫与处理费照抄设置里的默认值', () => {
    const form = defaultPlanText(settings)
    expect(form.n).toBe('8')
    expect(form.purchasePrice).toBe('600')
    expect(form.freight).toBe('400')
    expect(form.medicalPerDog).toBe('80')
    expect(form.targetPrice).toBe('1200')
    // 默认 0 而不是编一个看起来合理的数字
    expect(form.quarantinePerDog).toBe('0')
    expect(form.disposalPerDog).toBe('0')
    expect(form.mortalityPercent).toBe('15')
  })

  it('设置里改过检疫费与处理费时按设置预填', () => {
    const form = defaultPlanText({ ...settings, quarantinePerDog: 5000, disposalPerDog: 20000 })
    expect(form.quarantinePerDog).toBe('50')
    expect(form.disposalPerDog).toBe('200')
  })
})

describe('parseMortalityPercent', () => {
  it('百分数文本转成 0~1 的比率', () => {
    expect(parseMortalityPercent('25')).toBeCloseTo(0.25, 10)
    expect(parseMortalityPercent('7.5')).toBeCloseTo(0.075, 10)
    expect(parseMortalityPercent('0')).toBe(0)
    expect(parseMortalityPercent('99')).toBeCloseTo(0.99, 10)
  })

  it('空输入与越界都返回 null，绝不 clamp 成一个用户没输入的数', () => {
    expect(parseMortalityPercent('')).toBeNull()
    expect(parseMortalityPercent('   ')).toBeNull()
    expect(parseMortalityPercent('100')).toBeNull()
    expect(parseMortalityPercent('-1')).toBeNull()
    expect(parseMortalityPercent('一成')).toBeNull()
    expect(parseMortalityPercent('25%')).toBeNull()
  })
})

describe('parsePlanText', () => {
  it('正常输入翻译成 PlanInput，金额按分', () => {
    const { input, errors } = parsePlanText(goodForm, settings)
    expect(errors).toEqual({})
    expect(input).toEqual({
      n: 8,
      purchasePrice: 60000,
      freight: 40000,
      medicalPerDog: 8000,
      quarantinePerDog: 2500,
      disposalPerDog: 0,
      mortalityRate: 0.25,
      targetPrice: 120000,
    })
  })

  it('允许带 ¥ 与千分位、以及首尾空格', () => {
    const { input, errors } = parsePlanText(
      { ...goodForm, freight: ' ¥1,200 ', medicalPerDog: ' 80 ' },
      settings,
    )
    expect(errors).toEqual({})
    expect(input.freight).toBe(120000)
    expect(input.medicalPerDog).toBe(8000)
  })

  it('空字符串按 0 处理（等于「还没填」），不报错', () => {
    const { input, errors } = parsePlanText(
      { ...goodForm, freight: '', medicalPerDog: '', quarantinePerDog: '', disposalPerDog: '' },
      settings,
    )
    expect(errors).toEqual({})
    expect(input.freight).toBe(0)
    expect(input.medicalPerDog).toBe(0)
    expect(input.quarantinePerDog).toBe(0)
    expect(input.disposalPerDog).toBe(0)
  })

  it('★ 填了东西但解析不了时记错误，并且绝不回退成 0 让人算出一个假的保本价', () => {
    const { errors } = parsePlanText({ ...goodForm, purchasePrice: '６00', targetPrice: '1200元' }, settings)
    expect(errors.purchasePrice).toBeDefined()
    expect(errors.targetPrice).toBeDefined()
  })

  it('负数金额被拒绝', () => {
    const { errors } = parsePlanText({ ...goodForm, freight: '-100' }, settings)
    expect(errors.freight).toBeDefined()
  })

  it('只数必须是整数', () => {
    expect(parsePlanText({ ...goodForm, n: '' }, settings).errors).toEqual({})
    expect(parsePlanText({ ...goodForm, n: '' }, settings).input.n).toBe(0)
    expect(parsePlanText({ ...goodForm, n: '8.5' }, settings).errors.n).toBeDefined()
    expect(parsePlanText({ ...goodForm, n: '八' }, settings).errors.n).toBeDefined()
    expect(parsePlanText({ ...goodForm, n: '-3' }, settings).errors.n).toBeDefined()
  })

  it('死亡率越界时报错，input 里回退成设置里的默认值（占位，不可用于展示）', () => {
    const tooHigh = parsePlanText({ ...goodForm, mortalityPercent: '120' }, settings)
    expect(tooHigh.errors.mortalityPercent).toBeDefined()
    expect(tooHigh.input.mortalityRate).toBe(settings.expectedMortalityRate)
  })

  it('多个字段同时出错时一次全报，不是只报第一个', () => {
    const { errors } = parsePlanText({ ...goodForm, n: 'x', freight: 'y', mortalityPercent: 'z' }, settings)
    expect(Object.keys(errors).sort()).toEqual(['freight', 'mortalityPercent', 'n'])
  })

  it('不修改传入的表单对象', () => {
    const before = JSON.stringify(goodForm)
    parsePlanText(goodForm, settings)
    expect(JSON.stringify(goodForm)).toBe(before)
  })
})

describe('todayLocalIso', () => {
  it('按本机时区给出 YYYY-MM-DD，不因晚上而退回昨天', () => {
    // 本机时区下的 2026-10-03 23:30 —— 用 toISOString() 在东八区会变成 10-03T15:30Z，
    // 在更西的时区甚至会变成 10-04。这里要的是本机日历上的那一天。
    expect(todayLocalIso(new Date(2026, 9, 3, 23, 30))).toBe('2026-10-03')
    expect(todayLocalIso(new Date(2026, 0, 1, 0, 0))).toBe('2026-01-01')
    expect(todayLocalIso(new Date(2026, 11, 31, 12, 0))).toBe('2026-12-31')
  })
})

/**
 * Task 21：默认批次名带上的「时:分」。
 *
 * 两个测试用的是**本机构造**的 `Date`（`new Date(2026, 9, 3, 14, 7)` 就是本机 14:07），
 * 所以断言在任何时区都成立；而它恰好也能钉住「不能用 UTC」—— 东八区下
 * `toISOString().slice(11, 16)` 会给出 `06:07` 而不是 `14:07`。
 */
describe('localTimeHm', () => {
  it('个位数的小时与分钟都补零', () => {
    expect(localTimeHm(new Date(2026, 9, 3, 9, 7))).toBe('09:07')
  })

  it('下午用 24 小时制，不退回 12 小时制', () => {
    expect(localTimeHm(new Date(2026, 9, 3, 14, 7))).toBe('14:07')
    expect(localTimeHm(new Date(2026, 9, 3, 23, 59))).toBe('23:59')
  })

  it('午夜是 00:00（不是 12:00、也不是 24:00）', () => {
    expect(localTimeHm(new Date(2026, 9, 3, 0, 0))).toBe('00:00')
  })
})
