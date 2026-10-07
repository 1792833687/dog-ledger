import type { ComponentType } from 'react'
import { CalculatePage } from './pages/CalculatePage'
import { DogsPage } from './pages/DogsPage'
import { MoneyPage } from './pages/MoneyPage'
import { ReportPage } from './pages/ReportPage'
import { QuarantinePage } from './pages/QuarantinePage'

/**
 * 底部标签的键。加一个页面时只需要动两处、都在本文件：
 * 这个联合类型补一个键，下面 `TABS` 里补一条 —— 导航栏与页面切换都从 `TABS` 渲染，
 * 没有第二份清单要同步。（「检」由 Task 17 这样接进来。）
 */
export type TabKey = 'calc' | 'dogs' | 'quarantine' | 'money' | 'report'

/**
 * 底部标签的图标键。图标本体在 `TabBar.tsx` 里手写成内联 SVG（`ICON_PATHS`）——
 * 不引图标库，也不再用 emoji：emoji 的字形、颜色、基线由系统字体决定，
 * 同一个应用在安卓、iOS、Windows 上长得不一样，审计里也算无障碍问题。
 */
export type TabIconKey = 'calculator' | 'dog' | 'stethoscope' | 'yuan' | 'chart'

/**
 * 允许的图标键白名单。`tabs.test.ts` 拿它挡住「顺手塞回一个 emoji」——
 * 那种改动编译得过、lint 也不响。
 */
export const TAB_ICON_KEYS: readonly TabIconKey[] = [
  'calculator',
  'dog',
  'stethoscope',
  'yuan',
  'chart',
]

export interface TabDef {
  key: TabKey
  /** 底部标签栏上的短标签 */
  label: string
  /** 图标键（不是 emoji 字符） */
  icon: TabIconKey
  /** 选中这个标签时渲染的页面 */
  component: ComponentType
}

/** 唯一的标签清单：顺序即底部标签栏从左到右的顺序。 */
export const TABS: TabDef[] = [
  { key: 'calc', label: '算', icon: 'calculator', component: CalculatePage },
  { key: 'dogs', label: '狗', icon: 'dog', component: DogsPage },
  { key: 'quarantine', label: '检', icon: 'stethoscope', component: QuarantinePage },
  { key: 'money', label: '钱', icon: 'yuan', component: MoneyPage },
  { key: 'report', label: '报', icon: 'chart', component: ReportPage },
]

/** 打开应用时停在第一项（「算」）。 */
export const DEFAULT_TAB: TabKey = TABS[0].key
