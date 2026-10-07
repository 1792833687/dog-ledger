import type { ReactNode } from 'react'
import { TABS } from './tabs'
import type { TabIconKey, TabKey } from './tabs'

/**
 * 底栏图标：手写的内联 SVG，不引图标库。
 *
 * 之前用的是 emoji（🧮🐕🩺💰📊）。emoji 的字形由系统字体决定 —— 同一个应用在安卓、
 * iOS、Windows 上大小、颜色、基线都不一样，还有几个在部分安卓机型上会渲染成
 * 黑白轮廓。线性图标用 `currentColor` 描边，选中态跟着文字颜色走，五台设备一个样。
 *
 * 统一规格：24×24 视框、`fill="none"`、1.8 描边、圆角与圆头、`h-5 w-5`。
 * 尺寸写在这里而不是各个 path 上：改大小只改一处。
 */
const ICON_PATHS: Record<TabIconKey, ReactNode> = {
  // 算：一台计算器（外框 + 屏 + 六颗键）
  calculator: (
    <>
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M8.5 7.5h7" />
      <path d="M8.5 12h.01M12 12h.01M15.5 12h.01M8.5 16.5h.01M12 16.5h.01M15.5 16.5h.01" />
    </>
  ),
  // 狗：一张狗脸（两只耳朵 + 脸颊 + 眼睛 + 嘴）
  dog: (
    <>
      <path d="M5 9.5V4l3.5 2.5h7L19 4v5.5a7 7 0 0 1-14 0Z" />
      <path d="M9.5 11h.01M14.5 11h.01" />
      <path d="M10 15h4" />
    </>
  ),
  // 检：一支听诊器（耳件 + U 型管 + 听头）
  stethoscope: (
    <>
      <path d="M6 3v5.5a4.5 4.5 0 0 0 9 0V3" />
      <path d="M10.5 14.5v1a4.5 4.5 0 0 0 9 0v-1.5" />
      <circle cx="19.5" cy="12" r="2.5" />
    </>
  ),
  // 钱：一个圈子里的「￥」
  yuan: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.5 8.5 12 12.5l3.5-4" />
      <path d="M8.5 12.5h7M8.5 15.5h7" />
    </>
  ),
  // 报：坐标轴 + 三根柱子
  chart: (
    <>
      <path d="M4 4v16h16" />
      <path d="M8 20v-4.5M12 20v-9M16 20v-6.5" />
    </>
  ),
}

function TabIcon({ name }: { name: TabIconKey }) {
  return (
    <svg
      className="h-5 w-5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      // 图标只是标签文字的重复，读屏念两遍反而更吵
      aria-hidden="true"
    >
      {ICON_PATHS[name]}
    </svg>
  )
}

export function TabBar({ active, onChange }: { active: TabKey; onChange: (k: TabKey) => void }) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-20 border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)]">
      {/* 内层跟主内容一样宽（`max-w-lg` 居中）：桌面端底栏横跨整个窗口、
          五个按钮撒到 1440px 两边，和上面 512px 宽的内容完全对不齐。 */}
      <div className="mx-auto flex w-full max-w-lg">
        {TABS.map(t => (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
            // 读屏靠这个念出「当前页」，只靠颜色加粗是不够的
            aria-current={active === t.key ? 'page' : undefined}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-inset ${
              active === t.key ? 'text-emerald-700 font-semibold' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <TabIcon name={t.icon} />
            {t.label}
          </button>
        ))}
      </div>
    </nav>
  )
}
