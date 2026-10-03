import type { Batch, Dog } from '../domain/types'
import type { DogQuarantinePatch } from '../domain/actions'
import type { QuarantineStage } from '../domain/quarantine'

/**
 * 「检」页面的显示判定与快捷动作。抽出来是为了能单测：这里挑错批次、挑错动作或算错天数，
 * 用户就会点到不该有的按钮（或点不到该有的按钮）。全部是纯函数，不 import React。
 */

/**
 * 最近创建的批次。
 *
 * 任务书写的是「`createdAt` 最大者」，但 `Batch` 上**没有 `createdAt` 这个字段**
 * （`types.ts:88-97` 只有 id/name/date/source/note/status/plannedChannel）。
 * `createBatch` 是往数组尾部追加的，所以「最后一条」就是最近建的那条 —— 这也是唯一
 * 与创建时刻相关的顺序。不拿 `date` 排：`date` 是这批狗的业务日期，用户可以同一天建两批、
 * 也可以给新批次填个过去的日期，按它排会把刚建的批次藏起来。
 */
export function latestBatch(batches: Batch[]): Batch | null {
  return batches.length === 0 ? null : batches[batches.length - 1]
}

/** 选中哪个批次：先按 id 找，找不到（含 `selectedId` 为 null）就回落到 `latestBatch`。 */
export function pickBatch(batches: Batch[], selectedId: string | null): Batch | null {
  return batches.find(b => b.id === selectedId) ?? latestBatch(batches)
}

/** 快捷动作：把阶段往前推一格最省事的那一步。`focusCert` 表示这一格要人填东西，不是点一下能完成的。 */
export interface QuickAction {
  text: string
  patch?: DogQuarantinePatch
  focusCert?: boolean
}

/**
 * 这个阶段有没有「点一下就好」的下一步。
 *
 * 六个阶段穷尽 `switch`，**不写 `default`**：将来 `QuarantineStage` 新增一个阶段时，
 * `tsc -b` 会在这里报错，逼着人来决定新阶段要不要按钮 —— 而不是静默地少一个按钮。
 */
export function quickAction(stage: QuarantineStage, today: string): QuickAction | null {
  switch (stage) {
    case 'unvaccinated': return { text: '今天已接种', patch: { rabiesVaccinatedOn: today } }
    case 'ready_to_test': return { text: '今天已送检', patch: { antibodyTestedOn: today } }
    case 'waiting_cert': return { text: '已有证明', focusCert: true }
    // 等待期内没有什么「点一下就好」的事；可售与已过期都不需要动作。
    case 'waiting_antibody': return null
    case 'certified': return null
    case 'cert_expired': return null
  }
}

/** 证明还有几天到期。`null` = 没填有效期（是「不知道」，不是「还剩 0 天」）。 */
export function expiresText(days: number | null): string | null {
  if (days === null) return null
  if (days < 0) return `已过期 ${-days} 天`
  if (days === 0) return '今天到期'
  return `还有 ${days} 天到期`
}

/**
 * 有证明但接种日期没记 —— 不影响出售，但台账不完整，卡上给一句中性提示。
 *
 * 2026-10-03 裁定：有证明就能卖，接种日期只是台账的完整性问题。
 * 判据写在界面侧（域层不为这一条加字段、也不改 `QuarantineStatus` 的形状），
 * 所以它需要一个 `stage` 参数而不是一只狗：`certified` 的狗才提示，
 * `unvaccinated` / `cert_expired` 的狗本来就没有证明，提示「接种日期未记录」会误导人。
 */
export function needsVaccinationDateHint(dog: Dog, stage: QuarantineStage): boolean {
  return dog.rabiesVaccinatedOn === null && stage === 'certified'
}
