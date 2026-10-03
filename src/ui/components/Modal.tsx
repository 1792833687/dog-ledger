import type { ReactNode } from 'react'

/**
 * 手机上从底部升起的弹窗。记账是本软件最高频的动作，
 * 所以金额输入与成本项选择走这里，而不是 `window.prompt` —— 系统弹框没法选成本项，
 * 也没法给中文提示。
 */
export function Modal({
  open, title, onClose, children,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-t-2xl bg-white p-4 pb-8"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="mb-3 text-base font-semibold">{title}</h2>
        {children}
      </div>
    </div>
  )
}
