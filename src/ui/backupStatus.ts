export function daysSinceBackup(iso: string | null, now: Date): number | null {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return null
  const diff = now.getTime() - then
  return Math.floor(diff / (24 * 60 * 60 * 1000))
}

/** 有数据、且（从未备份 或 距上次备份 ≥ 3 天）时提醒 */
export function shouldWarnBackup(iso: string | null, entryCount: number, now: Date): boolean {
  if (entryCount === 0) return false
  const days = daysSinceBackup(iso, now)
  return days === null || days >= 3
}
