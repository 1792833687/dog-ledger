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

  /**
   * **关着的时候**盯着「谁拿到了焦点」——那通常就是等一下要把弹窗打开的那个按钮。
   *
   * 为什么不在 `open` 变真之后再记：React 在提交阶段就会把焦点交给带 `autoFocus` 的输入框，
   * 等「打开」那个 effect 跑起来时 `document.activeElement` 已经在面板里了，记下来的会是
   * 「面板里的输入框」；关掉时那个节点已经脱离文档，`focus()` 无效、焦点掉回 `body`
   *（控制器的 CDP 探针实测到的就是这个：Esc 关掉「改这一笔」之后 `activeElement` 是 `body`）。
   *
   * 为什么用 `focusin` 而不是「渲染期写 ref」：后者会被 `react(refs)` 门禁拦下来
   *（refs 不该在渲染期访问）。事件监听器里写 ref 是标准做法。
   */
  useEffect(() => {
    if (open) return
    openerRef.current = document.activeElement
    const remember = (event: FocusEvent): void => {
      // 只看面板**外面**的焦点：打开弹窗那一下，React 会在提交阶段就把焦点给 autoFocus
      // 的输入框，而那一刻本监听器还没被卸载 —— 不排掉它，就会把「开启者」记成面板里的
      // 输入框；关闭时那个节点已经脱离文档，focus() 无效、焦点掉回 body。
      if (event.target instanceof Element && event.target.closest('[role="dialog"]') === null) {
        openerRef.current = event.target
      }
    }
    document.addEventListener('focusin', remember)
    return () => {
      document.removeEventListener('focusin', remember)
    }
  }, [open])

  // `onClose` 基本每次渲染都是新的箭头函数。放进 ref 而不是 effect 依赖里，否则那个
  // 「把焦点移进面板」的 effect 会跟着每次渲染重跑 —— 在弹窗里打字时焦点会被反复抢回面板。
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!open) return

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
      // `isConnected` 是必要的：打开弹窗的那个按钮可能已经不在文档里了（比如删掉那一行
      // 之后列表重渲染），这时 `focus()` 不会生效、焦点白掉一次。
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
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
