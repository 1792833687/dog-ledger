import { describe, it, expect } from 'vitest'
import type { Dog, LedgerEntry } from '../domain/types'
import { isOnHand, lastSaleIndex, refundedCurrentSale } from './dogLedger'

const DOG_ID = 'd1'
const BATCH_ID = 'b1'

function dog(status: Dog['status']): Dog {
  return {
    id: DOG_ID, batchId: BATCH_ID, code: '1', breed: '', sex: 'unknown',
    ageMonths: null, status, note: '',
    rabiesVaccinatedOn: null, antibodyTestedOn: null,
    antibodyReportNo: '', quarantineCertNo: '',
    quarantineCertIssuedOn: null, quarantineCertValidUntil: null,
  }
}

function sale(id: string, amount: number): LedgerEntry {
  return {
    id, date: '2026-10-05', type: 'income', category: 'sale', amount,
    paidBy: 'pool', payee: null, batchId: BATCH_ID, dogId: DOG_ID, note: '',
  }
}

function refund(id: string, amount: number): LedgerEntry {
  return {
    id, date: '2026-10-06', type: 'expense', category: 'aftercare_refund', amount,
    paidBy: 'pool', payee: null, batchId: BATCH_ID, dogId: DOG_ID, note: '',
  }
}

describe('isOnHand：这只狗还站在我们笼子里吗', () => {
  it('在库与退回都算在册的活狗', () => {
    expect(isOnHand(dog('in_stock'))).toBe(true)
    expect(isOnHand(dog('returned'))).toBe(true)
  })

  it('已售与已死不算（收入已入账 / 已经记过损耗）', () => {
    expect(isOnHand(dog('sold'))).toBe(false)
    expect(isOnHand(dog('dead'))).toBe(false)
  })
})

describe('lastSaleIndex / refundedCurrentSale', () => {
  it('没有卖出记录时：下标 -1，谈不上退款', () => {
    const entries: LedgerEntry[] = []
    expect(lastSaleIndex(entries, DOG_ID)).toBe(-1)
    expect(refundedCurrentSale(entries, DOG_ID)).toBe(false)
  })

  it('卖出但没退款 → false', () => {
    const entries = [sale('e1', 120000)]
    expect(lastSaleIndex(entries, DOG_ID)).toBe(0)
    expect(refundedCurrentSale(entries, DOG_ID)).toBe(false)
  })

  it('卖出之后记了退款 → true', () => {
    const entries = [sale('e1', 120000), refund('e2', 120000)]
    expect(refundedCurrentSale(entries, DOG_ID)).toBe(true)
  })

  it('★ 卖了 → 退款 → 又卖出：这是新的一次成交，要能再退（不能被按狗判误收）', () => {
    // 按「这只狗有没有退款记录」判会在这里返回 true，把第二次退款的按钮收掉，
    // 界面上只剩「已记退款」，用户再也点不到 —— 这正是 FIX B 要修的。
    const entries = [sale('e1', 120000), refund('e2', 120000), sale('e3', 110000)]
    expect(lastSaleIndex(entries, DOG_ID)).toBe(2)
    expect(refundedCurrentSale(entries, DOG_ID)).toBe(false)
  })

  it('新一次成交再退之后 → 又是 true', () => {
    const entries = [sale('e1', 120000), refund('e2', 120000), sale('e3', 110000), refund('e4', 110000)]
    expect(refundedCurrentSale(entries, DOG_ID)).toBe(true)
  })

  it('退款在卖出之前（上一轮的残留）不算这一次成交退过款', () => {
    const entries = [refund('e1', 120000), sale('e2', 120000)]
    expect(refundedCurrentSale(entries, DOG_ID)).toBe(false)
  })

  it('别的狗的卖出与退款都不影响这只狗', () => {
    const otherSale: LedgerEntry = { ...sale('e1', 120000), dogId: 'd2' }
    const otherRefund: LedgerEntry = { ...refund('e2', 120000), dogId: 'd2' }
    expect(refundedCurrentSale([otherSale, otherRefund], DOG_ID)).toBe(false)
  })

  it('同一个狗 id 在多笔流水里取的是最后一次卖出', () => {
    const entries = [sale('e1', 1), sale('e2', 2), sale('e3', 3)]
    expect(lastSaleIndex(entries, DOG_ID)).toBe(2)
  })

  it('category 不是「售后退款」的支出不算退款', () => {
    const medical: LedgerEntry = { ...refund('e2', 8000), category: 'medical' }
    expect(refundedCurrentSale([sale('e1', 120000), medical], DOG_ID)).toBe(false)
  })
})
