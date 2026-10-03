import { createContext, useContext } from 'react'
import type { AppData } from '../domain/types'

export interface AppDataContextValue {
  data: AppData
  ready: boolean
  update: (fn: (d: AppData) => AppData) => void
  replaceAll: (d: AppData) => void
}

// 这个文件单独存在，不与 AppDataProvider 挤在一起，是因为 oxlint 的
// react(only-export-components) 规则要求「一个文件要么只导出组件，要么别指望 Fast
// Refresh」。把 hook 和 context 留在组件文件里，改那个文件就会整页刷新而不是热更新——
// 后面要连着做四个页面，每次改状态容器都整页重载很难受。
// 本仓的 lint 门禁是 0 warning 0 error，所以这里不能将就。
export const AppDataContext = createContext<AppDataContextValue | null>(null)

export function useAppData(): AppDataContextValue {
  const ctx = useContext(AppDataContext)
  if (!ctx) throw new Error('useAppData 必须在 AppDataProvider 内使用')
  return ctx
}
