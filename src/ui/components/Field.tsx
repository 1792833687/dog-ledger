import { useId } from 'react'

export function Field({
  label,
  value,
  onChange,
  suffix,
  inputMode = 'decimal',
  error,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  suffix?: string
  inputMode?: 'decimal' | 'numeric' | 'text'
  /** 有值时输入框标红并在下面显示这条中文提示 */
  error?: string
}) {
  // 外层 `<label>` 已经把名字给了输入框，但读屏器要靠 id/htmlFor 才稳（label 包住 input
  // 只是隐式关联，遇到嵌套结构就会认错）；红字用 aria-describedby 挂上去，不然只播报
  // 「输入框」而不播报「为什么是红的」。
  const inputId = useId()
  const errorId = useId()
  return (
    <label htmlFor={inputId} className="block border-b border-gray-100 py-3">
      <span className="flex items-center justify-between gap-3">
        <span className="text-sm text-gray-600">{label}</span>
        <span className="flex items-center gap-1">
          <input
            id={inputId}
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={error ? errorId : undefined}
            className={`w-28 rounded-md px-2 py-1.5 text-right text-base outline-none focus:bg-white focus:ring-2 ${
              error ? 'bg-red-50 text-red-700 ring-2 ring-red-300' : 'bg-gray-100 focus:ring-emerald-500'
            }`}
            value={value}
            inputMode={inputMode}
            onChange={e => onChange(e.target.value)}
          />
          {suffix && <span className="text-xs text-gray-500">{suffix}</span>}
        </span>
      </span>
      {error && (
        <span id={errorId} className="mt-1 block text-right text-xs text-red-700">
          {error}
        </span>
      )}
    </label>
  )
}
