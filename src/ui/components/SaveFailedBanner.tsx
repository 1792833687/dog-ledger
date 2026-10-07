import { useAppData } from '../../state/useAppData'
import { requestTab } from '../navigation'

/**
 * 写入本地存储失败时的红条。
 *
 * 这是全应用最坏的一条消息：用户刚记完一笔账，而那一笔**只活在内存里**，关掉网页就没了。
 * 所以它必须显眼（红底白字）、必须给出下一步（去导出备份），而且要一直挂着直到某次写入成功
 * —— 不能做成「3 秒后自动消失」的提示：用户可能正把手机揣兜里，回来时最需要看到的就是这句。
 */
export function SaveFailedBanner() {
  const { saveFailed } = useAppData()
  if (!saveFailed) return null

  return (
    <div className="w-full bg-red-600 px-4 py-2 text-xs text-white">
      <p className="font-semibold">当前设备无法可靠保存</p>
      <p className="mt-0.5">
        刚才那次改动只留在内存里，关掉网页就会丢。请立刻导出备份。
      </p>
      <button
        type="button"
        onClick={() => requestTab('report')}
        className="mt-1.5 rounded-lg bg-white px-2.5 py-1 text-xs font-semibold text-red-700"
      >
        去导出备份
      </button>
    </div>
  )
}
