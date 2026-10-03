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
  return (
    <label className="block border-b border-gray-100 py-3">
      <span className="flex items-center justify-between gap-3">
        <span className="text-sm text-gray-600">{label}</span>
        <span className="flex items-center gap-1">
          <input
            className={`w-28 rounded-md px-2 py-1.5 text-right text-base outline-none focus:bg-white focus:ring-2 ${
              error ? 'bg-red-50 text-red-700 ring-2 ring-red-300' : 'bg-gray-100 focus:ring-emerald-500'
            }`}
            value={value}
            inputMode={inputMode}
            onChange={e => onChange(e.target.value)}
          />
          {suffix && <span className="text-xs text-gray-400">{suffix}</span>}
        </span>
      </span>
      {error && <span className="mt-1 block text-right text-xs text-red-500">{error}</span>}
    </label>
  )
}
