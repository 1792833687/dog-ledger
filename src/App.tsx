import { useState } from 'react'
import { AppDataProvider, useAppData } from './state/AppDataContext'
import { TabBar } from './ui/TabBar'
import { DEFAULT_TAB, TABS } from './ui/tabs'
import type { TabKey } from './ui/tabs'

function Shell() {
  const { ready } = useAppData()
  const [tab, setTab] = useState<TabKey>(DEFAULT_TAB)

  if (!ready) {
    return <div className="flex h-dvh items-center justify-center text-gray-400">正在载入…</div>
  }

  // 页面从同一份 TABS 清单里取，所以加第 5 个标签（Task 17 的「检」）不需要动这里。
  const current = TABS.find(t => t.key === tab) ?? TABS[0]
  const Current = current.component

  return (
    <div className="min-h-dvh bg-gray-50 pb-16">
      <main className="mx-auto max-w-lg">
        <Current />
      </main>
      <TabBar active={tab} onChange={setTab} />
    </div>
  )
}

export default function App() {
  return (
    <AppDataProvider>
      <Shell />
    </AppDataProvider>
  )
}
