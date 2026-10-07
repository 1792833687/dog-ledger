import { TABS } from './tabs'
import type { TabKey } from './tabs'

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
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-xs ${
              active === t.key ? 'text-emerald-700 font-semibold' : 'text-gray-500'
            }`}
          >
            <span className="text-lg leading-none">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>
    </nav>
  )
}
