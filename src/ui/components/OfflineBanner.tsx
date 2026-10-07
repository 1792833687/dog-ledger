import { useEffect, useState } from 'react'

/**
 * 断网时在顶上说明一句「照常能用」。
 *
 * 这行字不是警告，是**安心话**：账本本来就不联网（数据全在这台设备的 IndexedDB 里），
 * 断网时真正会出事的是「没导出备份就清浏览器数据」，所以话只说到这一句为止。
 * 不做成红色，免得和「存不进去」那条真警告抢注意力。
 *
 * 初始值取 `navigator.onLine`：直接从离线状态打开（装了 service worker 之后很常见）时，
 * 不该等到第一次 `offline` 事件才显出来 —— 那个事件不会再来了。
 */
export function OfflineBanner() {
  const [online, setOnline] = useState(() => navigator.onLine)

  useEffect(() => {
    const goOnline = () => setOnline(true)
    const goOffline = () => setOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  if (online) return null
  return (
    <p className="w-full bg-gray-100 px-4 py-2 text-xs text-gray-600">
      现在没有网络。账本本来就不联网，照常能用 —— 只要别在没导出备份前清浏览器数据。
    </p>
  )
}
