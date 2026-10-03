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

export interface TabDef {
  key: TabKey
  /** 底部标签栏上的短标签 */
  label: string
  icon: string
  /** 选中这个标签时渲染的页面 */
  component: ComponentType
}

/** 唯一的标签清单：顺序即底部标签栏从左到右的顺序。 */
export const TABS: TabDef[] = [
  { key: 'calc', label: '算', icon: '🧮', component: CalculatePage },
  { key: 'dogs', label: '狗', icon: '🐕', component: DogsPage },
  { key: 'quarantine', label: '检', icon: '🩺', component: QuarantinePage },
  { key: 'money', label: '钱', icon: '💰', component: MoneyPage },
  { key: 'report', label: '报', icon: '📊', component: ReportPage },
]

/** 打开应用时停在第一项（「算」）。 */
export const DEFAULT_TAB: TabKey = TABS[0].key
