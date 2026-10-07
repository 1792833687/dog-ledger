import { useRef, useState } from 'react'
import { useAppData } from '../../state/useAppData'
import { exportBackup, importBackup } from '../../storage/backup'
import { daysSinceBackup } from '../backupStatus'
import { Modal } from '../components/Modal'
import { todayLocalIso } from '../planForm'
import type { AppData } from '../../domain/types'

export function BackupPanel() {
  const { data, update, replaceAll } = useAppData()
  const fileInput = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState('')
  const [pendingRestore, setPendingRestore] = useState<AppData | null>(null)

  // 渲染时就要用 now。不能在渲染体里调 new Date()（react(purity)），
  // useMemo / useEffect 也都被拦——只有 useState 惰性初始化能过门禁（见 Global Constraints）。
  const [now] = useState(() => new Date())
  const days = daysSinceBackup(data.settings.lastBackupAt, now)

  function handleExport() {
    const json = exportBackup(data)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const stamp = todayLocalIso(new Date())
    a.href = url
    a.download = `狗账备份-${stamp}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 0)
    // lastBackupAt 是**完整时间戳**（ISO datetime），不是 `YYYY-MM-DD` 那种日期串，
    // 所以这里用 toISOString() 是对的 —— 别照着「不许用 toISOString()」那条规则来「修」它
    //（那条规则针对的是日期串：UTC 会把东八区的晚上算成前一天）。见 `src/domain/types.ts:85`。
    update(d => ({ ...d, settings: { ...d.settings, lastBackupAt: new Date().toISOString() } }))
    setMessage('已导出。把文件发到微信收藏或存到电脑上。')
  }

  async function handleImport(file: File) {
    try {
      const restored = importBackup(await file.text())
      setPendingRestore(restored)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '恢复失败')
    }
  }

  return (
    <section className="mt-4 rounded-xl bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-gray-700">数据备份</h2>
      <p className="mt-1 text-xs text-gray-500">
        {days === null ? '从未备份过' : days === 0 ? '今天备份过' : `${days} 天前备份过`}
        {' · '}共 {data.entries.length} 条流水、{data.dogs.length} 只狗
      </p>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={handleExport}
          className="flex-1 rounded-xl bg-gray-900 py-3 text-sm font-semibold text-white"
        >
          导出备份文件
        </button>
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className="flex-1 rounded-xl border border-gray-300 py-3 text-sm font-semibold text-gray-700"
        >
          从备份恢复
        </button>
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={e => {
          const f = e.target.files?.[0]
          if (f) void handleImport(f)
          e.target.value = ''
        }}
      />
      {message && <p className="mt-2 text-xs text-emerald-700">{message}</p>}
      <p className="mt-2 text-xs text-gray-500">
        恢复前会先问一次。导出后请马上把文件发到微信「文件传输助手」或存进电脑。
      </p>

      <Modal open={pendingRestore !== null} title="恢复备份？" onClose={() => setPendingRestore(null)}>
        <p className="text-sm text-gray-600">
          将用备份覆盖当前全部数据（备份里有 {pendingRestore?.entries.length ?? 0} 条流水、
          {pendingRestore?.dogs.length ?? 0} 只狗）。这台设备上的现有数据会被全部替换，撤销不了。
        </p>
        <button
          type="button"
          className="mt-3 w-full rounded-xl bg-red-600 py-3 text-sm font-semibold text-white"
          onClick={() => {
            const restored = pendingRestore
            if (!restored) return
            // 恢复完这一下，「这台设备上的数据有备份」就是事实：用户手里正拿着那个文件。
            // 不写这一笔的话，恢复当天面板上会写「从未备份过」、黄色横幅还会催他再备份一次 ——
            // 在他刚刚用备份把自己救回来的时候说这句假话，是最容易让人不再相信这条提醒的时机。
            // （`lastBackupAt` 是完整 ISO 时间戳，用 `toISOString()` 是对的，见 `handleExport` 的说明。）
            replaceAll({
              ...restored,
              settings: { ...restored.settings, lastBackupAt: new Date().toISOString() },
            })
            setPendingRestore(null)
            setMessage(`恢复成功，共 ${restored.entries.length} 条流水。`)
          }}
        >
          确认覆盖
        </button>
        <button
          type="button"
          className="mt-2 w-full rounded-xl border border-gray-300 py-3 text-sm font-semibold text-gray-700"
          onClick={() => setPendingRestore(null)}
        >
          取消
        </button>
      </Modal>
    </section>
  )
}
