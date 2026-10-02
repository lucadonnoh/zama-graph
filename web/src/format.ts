import { EXPLORER, GATEWAY_EXPLORER } from '../../src/protocol'

/** Confidential tokens all have 6 decimals */
export const DECIMALS = 6

/** An integer amount in the token's smallest unit, as a decimal string */
export function units(raw: string | bigint, decimals = DECIMALS): string {
  const v = typeof raw === 'bigint' ? raw : BigInt(raw)
  const base = 10n ** BigInt(decimals)
  const whole = v / base
  const fraction = (v % base)
    .toString()
    .padStart(decimals, '0')
    .replace(/0+$/, '')
  return `${whole.toLocaleString('en-US')}${fraction ? `.${fraction}` : ''}`
}

/** A short form for tight places: 1.2k, 3.4M */
export function compact(raw: string | bigint, decimals = DECIMALS): string {
  const v = Number(typeof raw === 'bigint' ? raw : BigInt(raw)) / 10 ** decimals
  if (v === 0) return '0'
  if (v < 0.01) return '<0.01'
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: v < 10 ? 2 : 1,
  }).format(v)
}

/** Unix seconds as `YYYY-MM-DD HH:MM` in UTC */
export function date(unix: number): string {
  return new Date(unix * 1000).toISOString().slice(0, 16).replace('T', ' ')
}

export function day(unix: number): string {
  return date(unix).slice(0, 10)
}

/** How long ago, coarsely */
export function ago(unix: number, now = Date.now() / 1000): string {
  const s = Math.max(0, now - unix)
  if (s < 90) return `${Math.round(s)}s ago`
  if (s < 5400) return `${Math.round(s / 60)}m ago`
  if (s < 129600) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

export function shortHex(hex: string, chars = 4): string {
  const h = hex.startsWith('0x') ? hex : `0x${hex}`
  return `${h.slice(0, 2 + chars)}…${h.slice(-chars)}`
}

export function txUrl(tx: string): string {
  return `${EXPLORER}/tx/0x${tx.replace(/^0x/, '')}`
}

export function addressUrl(address: string): string {
  return `${EXPLORER}/address/${address}`
}

export function gatewayTxUrl(tx: string): string {
  return `${GATEWAY_EXPLORER}/tx/0x${tx.replace(/^0x/, '')}`
}

export function plural(n: number, word: string, words?: string): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? word : (words ?? `${word}s`)}`
}

export function pct(part: number, whole: number): string {
  if (whole === 0) return '–'
  const p = (100 * part) / whole
  // never round a part up to all of it, or down to none of it
  if (part < whole && p > 99) return `${Math.min(p, 99.9).toFixed(1)}%`
  if (part > 0 && p < 1) return `${Math.max(p, 0.1).toFixed(1)}%`
  return `${p < 10 ? p.toFixed(1) : Math.round(p)}%`
}
