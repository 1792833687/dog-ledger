export function daysSinceBackup(iso: string | null, now: Date): number | null {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return null
  const diff = now.getTime() - then
  // 界面上传进来的 now 是挂载时取的（渲染体里不许调 new Date()，只能用 useState 惰性初始化），
  // 而 lastBackupAt 是点完「导出备份文件」才写进库的——刚导完那一瞬间它比 now 晚，
  // 不夹一下就会显示「-1 天前备份过」。天数没有负的：算作 0（就是刚备份过）。
  return Math.max(0, Math.floor(diff / (24 * 60 * 60 * 1000)))
}

/** 有数据、且（从未备份 或 距上次备份 ≥ 3 天）时提醒 */
export function shouldWarnBackup(iso: string | null, entryCount: number, now: Date): boolean {
  if (entryCount === 0) return false
  const days = daysSinceBackup(iso, now)
  return days === null || days >= 3
}
