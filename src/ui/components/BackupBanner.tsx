import { useState } from 'react'
import { useAppData } from '../../state/useAppData'
import { daysSinceBackup, shouldWarnBackup } from '../backupStatus'

export function BackupBanner({ onGoToBackup }: { onGoToBackup: () => void }) {
  const { data } = useAppData()
  // 渲染体里不许直接调 new Date()：react(purity) 会拦，本仓门禁是 0 warning。
  // 唯一能过 lint 的写法就是 useState 惰性初始化（useMemo / useEffect 同样被拦）。
  const [now] = useState(() => new Date())
  if (!shouldWarnBackup(data.settings.lastBackupAt, data.entries.length, now)) return null

  const days = daysSinceBackup(data.settings.lastBackupAt, now)
  return (
    <button
      type="button"
      onClick={onGoToBackup}
      className="w-full bg-amber-100 px-4 py-2 text-left text-xs text-amber-800"
    >
      ⚠️ {days === null ? '你还没有备份过数据' : `已经 ${days} 天没备份了`}
      —— 手机丢了或浏览器清了数据就全没了。点这里去备份。
    </button>
  )
}
