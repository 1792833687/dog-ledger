import { useRef, useState } from 'react'
import { useAppData } from '../../state/useAppData'
import { exportBackup, importBackup } from '../../storage/backup'
import { DEFAULT_DATA } from '../../domain/types'
import { canClearData, clearPhrase } from '../backupDanger'
import { daysSinceBackup } from '../backupStatus'
import { Modal } from '../components/Modal'
import { todayLocalIso } from '../planForm'
import type { AppData } from '../../domain/types'

export function BackupPanel() {
  const { data, update, replaceAll, persisted } = useAppData()
  const fileInput = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState('')
  const [pendingRestore, setPendingRestore] = useState<AppData | null>(null)
  // 清空弹窗的输入。关掉就清空 —— 留着的话下次打开是「清空」两个字已经打好了、
  // 确认键已经亮着，那这道门槛就等于没有（与任务 21b 的「草稿不跨卡片残留」同一个道理）。
  const [clearOpen, setClearOpen] = useState(false)
  const [clearInput, setClearInput] = useState('')

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

  function closeClear() {
    setClearOpen(false)
    setClearInput('')
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
      {/* 这个文件框是隐藏的（点上面那个按钮代它触发），但读屏器仍然会念到它，
          所以给个名字，别念成一串「文件选择」。 */}
      <input
        ref={fileInput}
        type="file"
        aria-label="选一个备份文件恢复"
        accept="application/json,.json"
        className="hidden"
        onChange={e => {
          const f = e.target.files?.[0]
          if (f) void handleImport(f)
          e.target.value = ''
        }}
      />
      {message && <p className="mt-2 text-xs text-emerald-700">{message}</p>}
      {/* 导出之前先说清楚它是什么：用户把 JSON 发到群里的时候，
          里面躺着的是卖家的姓名、电话和检疫证明编号。这事只有他自己能判断，
          我们能做的是别让他在不知情的情况下发出去。 */}
      <p className="mt-2 text-xs text-red-700">
        备份文件是<b>明文</b>的，里面有你记的卖家姓名、联系方式、检疫证明编号
        —— 发出去之前想清楚发给谁，别发到群里或公开的地方。
      </p>
      {/* 只在「问过、答案是不持久」且**真记了东西**时提醒：空账本被系统清掉也无所谓，
          而 persisted 为 null（没问出来）时更不能当成坏消息吓人。
          这里刻意用琥珀小字，不用红色警告条 —— 红条是「已经存不进去了」（SaveFailedBanner），
          两者不是一回事。 */}
      {persisted === false && data.entries.length > 0 && (
        <p className="mt-2 text-xs text-amber-700">
          这台设备没有把本站数据标为「持久」，系统在存储紧张时可能清掉它 —— 备份不能省。
        </p>
      )}
      <p className="mt-2 text-xs text-gray-500">
        恢复前会先问一次。导出后请马上把文件发到微信「文件传输助手」或存进电脑。
      </p>

      {/* 清空入口。刻意与上面两个按钮隔开一段、只用红字描边：
          它不是日常动线里的一步，是「这台设备要还人 / 要重来」时才会找的东西。
          以前这个动作只能靠用户自己去清浏览器数据，那个办法既不精确也教不会。 */}
      <div className="mt-4 border-t border-gray-100 pt-3">
        <button
          type="button"
          className="w-full rounded-xl border border-red-600 py-2.5 text-xs font-semibold text-red-700"
          onClick={() => {
            setClearInput('')
            setClearOpen(true)
          }}
        >
          清空全部数据
        </button>
      </div>

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

      <Modal open={clearOpen} title="清空全部数据？" onClose={closeClear}>
        <p className="text-sm text-gray-600">
          这台设备上的全部批次、狗、流水、预定单都会被删掉，<b>没有撤销</b>。要留就先导出备份。
        </p>
        <p className="mt-3 text-xs text-gray-500">
          确认请在下面打出「{clearPhrase()}」两个字。
        </p>
        <input
          autoFocus
          aria-label={`打出「${clearPhrase()}」两个字以确认清空`}
          className="mt-2 w-full rounded-lg bg-gray-100 px-3 py-2 text-sm outline-none placeholder:text-gray-600"
          placeholder={clearPhrase()}
          value={clearInput}
          onChange={e => setClearInput(e.target.value)}
        />
        <button
          type="button"
          className="mt-3 w-full rounded-xl bg-red-600 py-3 text-sm font-semibold text-white disabled:opacity-40"
          disabled={!canClearData(clearInput)}
          onClick={() => {
            // 与「从备份恢复」走同一条路：整个对象覆盖着写回库。用克隆出来的默认数据，
            // 而不是把现有对象里的数组清空 —— 后者会留着用户自己加过的成本项、
            // 合伙人名字这些东西，那叫「清账」不叫「清空全部数据」，名不副实。
            replaceAll(structuredClone(DEFAULT_DATA))
            closeClear()
            setMessage('已清空。这台设备上现在是一本空账。')
          }}
        >
          清空
        </button>
        <button
          type="button"
          className="mt-2 w-full rounded-xl border border-gray-300 py-3 text-sm font-semibold text-gray-700"
          onClick={closeClear}
        >
          取消
        </button>
      </Modal>
    </section>
  )
}
