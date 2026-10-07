import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { AppData } from '../domain/types'
import { DEFAULT_DATA } from '../domain/types'
import type { Storage } from '../storage/types'
import { indexedDbStorage, requestPersistentStorage } from '../storage/indexeddb'
import { loadPersistedData, persistData } from './persistence'
import { AppDataContext } from './useAppData'

export function AppDataProvider({
  children,
  storage = indexedDbStorage,
}: {
  children: ReactNode
  storage?: Storage
}) {
  // ★ 必须 structuredClone：DEFAULT_DATA 是模块级单例，而且 DEFAULT_SETTINGS.costItems
  // 与 BUILTIN_COST_ITEMS 是同一个数组对象。直接把它交给 useState 会让界面状态与那个
  // 常量共享引用——任何一处就地 push / 改字段都会永久污染常量，之后新建的数据与测试也
  // 会跟着变脏。克隆一次，界面状态就与常量彻底脱钩。
  // （Task 1 的审查已用探针证实过这个别名：push 之后 BUILTIN_COST_ITEMS.length 4→5。）
  const [data, setData] = useState<AppData>(() => structuredClone(DEFAULT_DATA))
  const [ready, setReady] = useState(false)
  // 写入失败要让用户看见（红底横幅），写入成功要能让它消失 —— 存的是「最近一次」的结果。
  const [saveFailed, setSaveFailed] = useState(false)
  // null = 还没问出来（或这个环境没有 navigator.storage）—— 界面不许把 null 当坏消息。
  const [persisted, setPersisted] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    void requestPersistentStorage().then(ok => {
      if (!cancelled) setPersisted(ok)
    })
    loadPersistedData(storage)
      .then(loaded => {
        if (cancelled) return
        if (loaded) setData(loaded)
        setReady(true)
      })
      // 兜底：即使 loadPersistedData 之后被改成可能 reject 的实现（或有人把这里换回
      // 裸的 storage.load()），ready 也必须翻转。少这一句，存储不可用时界面就永远停在
      // 「正在载入…」——一块白屏。
      .catch(() => {
        if (!cancelled) setReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [storage])

  // 每次落盘都把结果记进 saveFailed。注意这里**不改** persistData 的行为：
  // 它照样不 reject（否则 update 里每次改动都会冒出一个未处理的 rejection）。
  const save = useCallback(
    (next: AppData) => {
      void persistData(storage, next).then(ok => setSaveFailed(!ok))
    },
    [storage],
  )

  const update = useCallback(
    (fn: (d: AppData) => AppData) => {
      setData(prev => {
        const next = fn(prev)
        save(next)
        return next
      })
    },
    [save],
  )

  const replaceAll = useCallback(
    (next: AppData) => {
      setData(next)
      save(next)
    },
    [save],
  )

  return (
    <AppDataContext.Provider value={{ data, ready, update, replaceAll, saveFailed, persisted }}>
      {children}
    </AppDataContext.Provider>
  )
}
