import { useEffect, useState } from 'react'
import { AppDataProvider } from './state/AppDataContext'
import { useAppData } from './state/useAppData'
import { TabBar } from './ui/TabBar'
import { BackupBanner } from './ui/components/BackupBanner'
import { OfflineBanner } from './ui/components/OfflineBanner'
import { SaveFailedBanner } from './ui/components/SaveFailedBanner'
import { TABS, DEFAULT_TAB } from './ui/tabs'
import type { TabKey } from './ui/tabs'
import { onSettingsRequest, onTabRequest } from './ui/navigation'

function Shell() {
  const { ready } = useAppData()
  const [tab, setTab] = useState<TabKey>(DEFAULT_TAB)

  // 「钱」页那句「还没有合伙人」旁边有个「前往财务设置」按钮：它只负责喊一声
  // 「有人想开设置」，设置到底在哪一页由这里决定。这样两个页面不必互相认识。
  useEffect(() => onSettingsRequest(() => setTab('report')), [])

  // 「存不进去」那条红条上的「去导出备份」按钮走这条线。谁都能请谁跳到某一页，
  // 页面之间不必互相认识。理由与上面这条一样。
  useEffect(() => onTabRequest(key => setTab(key)), [])

  if (!ready) {
    return <div className="flex h-dvh items-center justify-center text-gray-500">正在载入…</div>
  }

  // 页面从同一份 TABS 清单里取，所以加第 5 个标签（Task 17 的「检」）不需要动这里。
  const current = TABS.find(t => t.key === tab) ?? TABS[0]
  const Current = current.component

  return (
    <div className="min-h-dvh bg-gray-50 pb-16">
      {/* 顺序就是严重程度：存不进去（红）> 该备份了（黄）> 现在没网（灰，只是安心话）。 */}
      <SaveFailedBanner />
      <BackupBanner onGoToBackup={() => setTab('report')} />
      <OfflineBanner />
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
