import type { AppData } from '../domain/types'
import { settle } from '../domain/settlement'
import { batchSummary } from '../domain/costing'
import { formatMoney } from '../domain/money'

/**
 * 一键对账单：把当前数据整理成几行字，再用 canvas 手绘成一张竖版 PNG。
 *
 * 为什么是 canvas 而不是截图/PDF：这张图要能在微信里直接发出去，零依赖、零字体下载，
 * 伙伴在手机上点开就能看。所以这里不引任何第三方库，只用 `document.createElement('canvas')`。
 *
 * 两件事被抽成了**纯函数**，好让它们能脱离浏览器被测到：
 * `buildReceiptRows`（图上写什么）与 `receiptSize`（画布要多大）。
 * 真正落笔的 `drawReceipt` 与 `receiptToBlob` 需要真 canvas，由真浏览器走查覆盖。
 */

export interface ReceiptRow {
  label: string
  value: string
  /** 高亮行（对账单上只有「净利」是） */
  emphasis?: boolean
}

export interface ReceiptSize {
  width: number
  height: number
  headerHeight: number
  rowHeight: number
}

const WIDTH = 720
const ROW_HEIGHT = 64
const HEADER_HEIGHT = 190
/** 最后一行之后留出的空间，页脚的「由…生成」写在这段里 */
const FOOTER_SPACE = 60
/** 高分辨率导出（手机上放大不糊） */
const DPR = 2

/**
 * 画布尺寸。行数决定高度 —— 抽出来是为了能测「行多了会不会画到画布外面去」。
 */
export function receiptSize(rowCount: number): ReceiptSize {
  return {
    width: WIDTH,
    height: HEADER_HEIGHT + rowCount * ROW_HEIGHT + FOOTER_SPACE,
    headerHeight: HEADER_HEIGHT,
    rowHeight: ROW_HEIGHT,
  }
}

/**
 * 纯函数：把当前数据整理成对账单上的行。
 *
 * 上半是全局数字，中间是每位合伙人的三笔账（应分 / 垫付未还 / 已注资 —— 缺一条就没法对账：
 * 「应分」是权益、「垫付未还」是别人替池子垫出去的钱、「已注资」是本金），
 * 最后每个批次一行，把在库/已售/死亡的只数带上 —— 只有金额没有只数，伙伴没法判断这批货还剩多少。
 */
export function buildReceiptRows(data: AppData): ReceiptRow[] {
  const s = settle(data)
  const rows: ReceiptRow[] = [
    { label: '总收入', value: formatMoney(s.totalIncome) },
    { label: '总支出', value: formatMoney(s.totalExpense) },
    { label: '净利', value: formatMoney(s.netProfit), emphasis: true },
    { label: '池子余额', value: formatMoney(s.pool) },
  ]

  for (const p of s.partners) {
    rows.push({ label: `${p.name} · 应分`, value: formatMoney(p.claimable) })
    rows.push({ label: `${p.name} · 垫付未还`, value: formatMoney(p.advance) })
    rows.push({ label: `${p.name} · 已注资`, value: formatMoney(p.contributed) })
  }

  for (const b of data.batches) {
    const bs = batchSummary(data, b.id)
    rows.push({
      label: `批次 ${b.name}`,
      value: `在库 ${bs.inStock} / 已售 ${bs.sold} / 死亡 ${bs.dead} · ${formatMoney(bs.netProfitFen)}`,
    })
  }

  return rows
}

/** 只用到 `measureText`：真 canvas 上下文与测试里的假尺子都能满足它（不必为测试造一个 canvas）。 */
export interface TextMeasurer {
  measureText(text: string): { width: number }
}

/**
 * 放不下就在尾巴上加省略号。
 *
 * 不这么做的话，「批次 某个很长的名字」会一路画到右边的金额上，两张字叠在一起 ——
 * 而这张图是要发给伙伴的，糊一行就等于少一行信息。用 `measureText` 量真实宽度，
 * 不按字数猜（中英文、数字宽度差很多）。
 */
export function fitText(measurer: TextMeasurer, text: string, maxWidth: number): string {
  if (measurer.measureText(text).width <= maxWidth) return text
  let head = text
  while (head.length > 1 && measurer.measureText(`${head}…`).width > maxWidth) {
    head = head.slice(0, -1)
  }
  return `${head}…`
}

/** 用 canvas 手绘一张竖版对账单。零依赖，微信里能直接发。 */
export function drawReceipt(
  canvas: HTMLCanvasElement,
  title: string,
  subtitle: string,
  rows: ReceiptRow[],
): void {
  const { width, height, headerHeight, rowHeight } = receiptSize(rows.length)

  canvas.width = width * DPR
  canvas.height = height * DPR
  // style.height 也要设，否则这张图在版面里会被按原比例压扁
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`

  const ctx = canvas.getContext('2d')
  if (ctx === null) throw new Error('这个浏览器拿不到 canvas 绘图上下文，生成不了对账单图片')
  ctx.scale(DPR, DPR)

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)

  ctx.fillStyle = '#065f46'
  ctx.fillRect(0, 0, width, 120)
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 40px system-ui, sans-serif'
  ctx.fillText(fitText(ctx, title, width - 80), 40, 66)
  ctx.font = '24px system-ui, sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  ctx.fillText(fitText(ctx, subtitle, width - 80), 40, 100)

  let y = headerHeight
  for (const row of rows) {
    if (row.emphasis) {
      ctx.fillStyle = '#ecfdf5'
      ctx.fillRect(24, y - 40, width - 48, 56)
    }
    // 先量出右边的金额要占多宽，标签才有确定的可用宽度。
    // 写死「一半宽」是不行的：批次那行的值（在库 X / 已售 Y / 死亡 Z · ¥…）比金额长得多，
    // 长批次名就会压到它上面。
    ctx.font = row.emphasis ? 'bold 32px system-ui, sans-serif' : '28px system-ui, sans-serif'
    const valueWidth = ctx.measureText(row.value).width
    // 左边距 40 + 右边距 40 + 中间间隙 24
    const labelMax = width - 104 - valueWidth

    ctx.fillStyle = row.emphasis ? '#065f46' : '#374151'
    ctx.font = row.emphasis ? 'bold 30px system-ui, sans-serif' : '28px system-ui, sans-serif'
    ctx.fillText(fitText(ctx, row.label, labelMax), 40, y)

    ctx.textAlign = 'right'
    ctx.font = row.emphasis ? 'bold 32px system-ui, sans-serif' : '28px system-ui, sans-serif'
    ctx.fillText(row.value, width - 40, y)
    ctx.textAlign = 'left'
    y += rowHeight
  }

  ctx.fillStyle = '#9ca3af'
  ctx.font = '22px system-ui, sans-serif'
  ctx.fillText('由「狗账」生成 · 数据以记录人手机为准', 40, height - 30)
}

export async function receiptToBlob(
  rows: ReceiptRow[],
  title: string,
  subtitle: string,
): Promise<Blob> {
  const canvas = document.createElement('canvas')
  drawReceipt(canvas, title, subtitle, rows)
  return new Promise((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('生成图片失败'))), 'image/png')
  })
}
