/**
 * 「从哪里都能请人打开财务设置」的一根电话线。
 *
 * 起因：合伙人一个都没有时，「钱」页那行提示写的是「先去『设置』页把人加上」——
 * 可底部根本没有叫「设置」的标签，设置面板是「报」页最底下一个人默认收起的
 * `<details>`。用户照着这句话去找，只会挨个标签点一遍。
 *
 * 这一层不做任何渲染，只维护两样东西：一张订阅表 + 一个「有人请求过」的挂起标志。
 * 放在模块级而不是 React Context，是为了让「钱」页不必知道「报」页的存在
 * （`MoneyPage` → 这里 → `App` / `SettingsPanel`），也就能单独测。
 *
 * 请求多半发生在「钱」页，而那一刻设置面板**还没挂载**（`App` 一次只渲染当前标签那一页），
 * 通知发出去没有人接。所以除了通知，还要留一个标志让设置面板第一次渲染时读得到
 * （`settingsRequested`）。
 *
 * 为什么标志是「置位 + 渲染时读」而不是「取走就清」（原本写的是 `takeSettingsRequest`）：
 * 取走式得在一个挂载期 effect 里 `if (take()) setSettingsOpen(true)`，而 React 官方的
 * `set-state-in-effect` 规则会把「effect 里同步 setState」判成警告（多一轮渲染）；
 * 换成惰性初值 `useState(takeSettingsRequest)` 更糟 —— StrictMode 下初值函数会被调用
 * 两次，第二次返回 false，开发环境里那个按钮就白点了（生产环境不双调，问题只在开发时露头）。
 *
 * 「置位 + 渲染时读」的时序自然成立：人在「钱」页按下按钮 → 标志置位 → `App` 切到
 * 「报」页 → 设置面板这时才挂载 → 第一次渲染就读到 true。用户在界面上把它收起来时
 * （事件处理器里）再清掉。
 */
type Listener = () => void

const listeners = new Set<Listener>()

let requested = false

/**
 * 订阅「有人想打开财务设置」。返回退订函数，`useEffect` 里直接 `return` 它就行。
 * 订阅本身**不会**补发已经挂起的请求 —— 那种情况由 `settingsRequested()` 在渲染时兜住。
 */
export function onSettingsRequest(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * 请求打开财务设置：标志置位，然后通知所有订阅者。
 *
 * 遍历的是副本：万一某个订阅者在被通知的过程中退订了自己或别人，
 * 这一轮里其他人的通知不会被跳过（`Set` 边遍历边删会让迭代器跳过元素）。
 */
export function requestSettings(): void {
  requested = true
  for (const listener of [...listeners]) listener()
}

/** 有没有人正在请人打开财务设置。渲染时读，只读不清。 */
export function settingsRequested(): boolean {
  return requested
}

/** 用户把设置收起来了：清掉标志，免得下次挂载时它又自己弹开。 */
export function clearSettingsRequest(): void {
  requested = false
}
