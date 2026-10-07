import { Modal } from './Modal'

/**
 * 二次确认弹窗：一句话说清「删了会怎样」，再加一个红底确认键。
 *
 * 为什么不用 `window.confirm`：全仓 `src/` 零命中，而且系统框只有一行英文按钮、
 * 说不清「删了什么、影响什么」——删流水、删预定单都属于「点错了没法回头」的动作，
 * 那句话必须写在按钮上方，而不是塞进一个 60 字的系统提示里。
 *
 * 全仓只做这一个：Task 29 删流水也走它，于是「红底 = 会丢东西」在哪儿都是同一个样子。
 */
export function ConfirmDialog({
  open, title, message, confirmLabel, onConfirm, onClose,
}: {
  open: boolean
  title: string
  /** 说清后果的那句话。别写「确定删除吗」，要写「删了就没有撤销」。 */
  message: string
  confirmLabel: string
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Modal open={open} title={title} onClose={onClose}>
      <p className="text-sm text-gray-600">{message}</p>
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          // 默认焦点落在「算了」上：这是个会丢东西的确认框，回车键不该正好按在红键上。
          autoFocus
          className="flex-1 rounded-xl bg-gray-100 py-3 text-sm font-semibold text-gray-700"
          onClick={onClose}
        >
          算了
        </button>
        <button
          type="button"
          className="flex-1 rounded-xl bg-red-600 py-3 text-sm font-semibold text-white"
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  )
}
