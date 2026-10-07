import { useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'

/** 面板里能得焦点的东西。用来把 Tab 锁在弹窗里。 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * 手机上从底部升起的弹窗。记账是本软件最高频的动作，
 * 所以金额输入与成本项选择走这里，而不是 `window.prompt` —— 系统弹框没法选成本项，
 * 也没法给中文提示。
 *
 * 无障碍（第三方审计的扣分项）：面板上有 `role="dialog"` + `aria-modal="true"` 并用
 * `aria-labelledby` 指到标题；Esc 能关；打开时焦点进面板、关掉时还给原来那个元素；
 * Tab 在面板内环绕，不跑到背后的页面上。
 */
export function Modal({
  open, title, onClose, children,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
}) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement | null>(null)
  const openerRef = useRef<Element | null>(null)

  // `onClose` 基本每次渲染都是新的箭头函数。放进 ref 而不是 effect 依赖里，否则那个
  // 「把焦点移进面板」的 effect 会跟着每次渲染重跑 —— 在弹窗里打字时焦点会被反复抢回面板。
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!open) return

    // 记下是谁打开的，关的时候原样还回去（不然读屏用户的落点会掉回页面开头）。
    openerRef.current = document.activeElement
    const panel = panelRef.current
    if (panel !== null) {
      // 面板自己先接着焦点；但如果里面已经有 autoFocus 的输入框抢到了，就别抢回来。
      const active = document.activeElement
      if (!(active instanceof HTMLElement) || !panel.contains(active)) panel.focus()
    }

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const node = panelRef.current
      if (node === null) return
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (items.length === 0) {
        // 没有任何可聚焦元素时，Tab 也不许溜到背后。
        event.preventDefault()
        node.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const current = document.activeElement
      const inside = current instanceof HTMLElement && node.contains(current)
      if (event.shiftKey) {
        if (!inside || current === first || current === node) {
          event.preventDefault()
          last.focus()
        }
      } else if (!inside || current === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      const opener = openerRef.current
      if (opener instanceof HTMLElement) opener.focus()
    }
  }, [open])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="w-full max-w-lg rounded-t-2xl bg-white p-4 pb-8 outline-none"
        onClick={e => e.stopPropagation()}
      >
        <h2 id={titleId} className="mb-3 text-base font-semibold">
          {title}
        </h2>
        {children}
      </div>
    </div>
  )
}
