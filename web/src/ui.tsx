import type { ReactNode } from 'react'
import type { Amount as AmountT } from '../../src/graph/types'
import { addressUrl, compact, date, shortHex, txUrl, units } from './format'
import { labelOf, useLabels } from './labels'
import { nameOf, useNames } from './names'

const ZERO = '0x0000000000000000000000000000000000000000'
/** An upper bound this large says nothing a reader can use */
const HUGE = 10n ** 15n

/** How much the public data says about an amount, for styling and words */
export type Visibility = 'public' | 'derived' | 'bounded' | 'hidden'

export function visibility(a: AmountT): Visibility {
  if (a.hi !== undefined && a.lo === a.hi) {
    return a.source === 'inferred' ? 'derived' : 'public'
  }
  if (a.hi !== undefined && BigInt(a.hi) < HUGE) return 'bounded'
  if (BigInt(a.lo) > 0n) return 'bounded'
  return 'hidden'
}

const SOURCE_TEXT: Record<string, string> = {
  wrap: 'public: in clear in the Wrap event',
  finalize: 'public: published by UnwrapFinalized',
  gateway: 'public: decrypted by the KMS on the Zama Gateway',
  verified: 'public: published with PublicDecryptionVerified',
  disclose: 'public: disclosed by its owner',
  relayer:
    'public: decrypted by the KMS on request, signatures checked against Ethereum',
  inferred:
    'pinned: published by nobody, but the only value the public data allows',
}

/**
 * An encrypted amount as the public data pins it. Exact values are either
 * published (ink) or derived by this tool (highlighted); ranges show both
 * bounds; nothing usable shows as hidden.
 */
export function Amount({
  a,
  symbol,
  short,
  handle,
}: {
  a: AmountT
  symbol?: string
  short?: boolean
  /** the handle, when it may be an ebool (byte 30 is the type) */
  handle?: string
}) {
  const v = visibility(a)
  if (handle && handle.slice(60, 62) === '00') {
    const known = a.hi !== undefined && a.lo === a.hi
    return (
      <span
        className={`mono amt-${known ? (a.source === 'inferred' ? 'derived' : 'public') : 'hidden'}`}
        title={
          known ? SOURCE_TEXT[a.source ?? 'inferred'] : 'an encrypted condition'
        }
      >
        {known ? (a.lo === '1' ? 'true' : 'false') : 'true or false'}
      </span>
    )
  }
  const fmt = short ? compact : units
  const sym = symbol ? (
    <span style={{ color: 'var(--muted)' }}> {symbol}</span>
  ) : null
  let text: ReactNode
  let title: string
  if (v === 'public' || v === 'derived') {
    text = fmt(a.lo)
    title = SOURCE_TEXT[a.source ?? 'inferred'] ?? ''
  } else if (v === 'bounded') {
    const lo = BigInt(a.lo)
    text =
      a.hi === undefined || BigInt(a.hi) >= HUGE
        ? `≥ ${fmt(a.lo)}`
        : lo > 0n
          ? `${fmt(a.lo)} – ${fmt(a.hi)}`
          : `≤ ${fmt(a.hi)}`
    title = 'bounded: the public data allows only this range'
  } else {
    text = 'hidden'
    title = 'hidden: nothing public narrows it down'
  }
  return (
    <span className={`mono amt-${v}`} title={title}>
      {text}
      {v !== 'hidden' && sym}
    </span>
  )
}

/**
 * An address as a reader wants to see it: its label (wrappers, hubs,
 * Zama's own accounts, verified contracts) or the shortened hex. Links to
 * its page here; the explorer link is on that page.
 */
export function Address({
  address,
  full,
  plain,
}: {
  address: string
  full?: boolean
  /** no link, e.g. inside a link already */
  plain?: boolean
}) {
  useLabels()
  const names = useNames(address === ZERO ? [] : [address])
  if (address === ZERO) return <span style={{ color: 'var(--muted)' }}>–</span>
  const l = labelOf(address)
  const name = nameOf(names, address)
  const cls = l?.zama
    ? 'chip chip-zama'
    : l?.kind && l.kind !== 'wrapper'
      ? 'chip chip-hub'
      : l
        ? 'chip'
        : name
          ? 'font-medium'
          : 'mono'
  const text = l?.label ?? name ?? (full ? address : shortHex(address, 5))
  const title = [address, l?.label, name, l?.kind && `hub: ${l.kind}`]
    .filter(Boolean)
    .join('\n')
  if (plain) {
    return (
      <span className={cls} title={title}>
        {text}
      </span>
    )
  }
  return (
    <a
      href={`#${address}`}
      className={cls}
      title={title}
      onClick={(e) => e.stopPropagation()}
    >
      {text}
    </a>
  )
}

export function ExplorerLink({ address }: { address: string }) {
  return (
    <a
      href={addressUrl(address)}
      target="_blank"
      rel="noreferrer"
      style={{ color: 'var(--muted)' }}
      title="on Etherscan"
    >
      ↗
    </a>
  )
}

/** A transaction: its page here, and Etherscan */
export function Tx({ hash, label }: { hash: string; label?: ReactNode }) {
  return (
    <span className="whitespace-nowrap">
      <a href={`#tx/${hash}`} className="mono" title={`0x${hash}`}>
        {label ?? shortHex(hash, 4)}
      </a>{' '}
      <a
        href={txUrl(hash)}
        target="_blank"
        rel="noreferrer"
        style={{ color: 'var(--muted)' }}
        title="on Etherscan"
      >
        ↗
      </a>
    </span>
  )
}

/** A ciphertext handle: its page here */
export function Handle({ h, chars = 4 }: { h: string; chars?: number }) {
  if (!h) return null
  return (
    <a
      href={`#handle/${h}`}
      className="mono"
      style={{ color: 'var(--ink-2)' }}
      title={`handle 0x${h}`}
    >
      {shortHex(h, chars)}
    </a>
  )
}

export function Time({ t }: { t: number }) {
  return (
    <span className="mono whitespace-nowrap" title={`${date(t)} UTC`}>
      {date(t)}
    </span>
  )
}

export function Section({
  title,
  note,
  children,
}: {
  title: ReactNode
  note?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="card p-3">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3">
        <h2 className="font-semibold">{title}</h2>
        {note && (
          <span className="text-xs" style={{ color: 'var(--muted)' }}>
            {note}
          </span>
        )}
      </div>
      {children}
    </section>
  )
}

/** Async data for a page, with its error */
export function Muted({ children }: { children: ReactNode }) {
  return <span style={{ color: 'var(--muted)' }}>{children}</span>
}
