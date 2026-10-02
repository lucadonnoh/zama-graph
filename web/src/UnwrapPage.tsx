import { useEffect, useState } from 'react'
import type { ShareRow, UnwrapDetail } from '../../src/graph/types'
import { api } from './api'
import { day, pct, plural, units } from './format'
import { HistoryGraph } from './HistoryGraph'
import { labelOf, useLabels } from './labels'
import {
  Address,
  Amount,
  Handle,
  Muted,
  Section,
  Time,
  Tx,
  visibility,
} from './ui'

/**
 * One withdrawal: what it took out, who finalized it, and which deposits
 * can have funded it, each with the share the public data allows.
 */
export function UnwrapPage({ handle }: { handle: string }) {
  const [d, setD] = useState<UnwrapDetail>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    setD(undefined)
    setError(undefined)
    api
      .unwrap(handle)
      .then(setD)
      .catch((e: unknown) => setError(String(e)))
  }, [handle])
  if (error) return <Muted>{error}</Muted>
  if (!d) return <Muted>Loading…</Muted>
  const v = visibility(d.amount)
  return (
    <>
      <section className="card grid gap-2 p-3">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-base">
          <span className="chip chip-withdrawal">unwrap</span>
          <span className="font-semibold">
            <Amount a={d.amount} symbol={d.symbol} />
          </span>
          <Muted>from</Muted>
          <Address address={d.burner} />
          {d.receiver !== d.burner && (
            <>
              <Muted>to</Muted>
              <Address address={d.receiver} />
            </>
          )}
        </div>
        <div className="grid gap-1 text-xs" style={{ color: 'var(--ink-2)' }}>
          <div>
            requested <Time t={d.time} /> in <Tx hash={d.tx} /> · handle{' '}
            <Handle h={d.handle} chars={6} />
            {d.decryptable && ' · publicly decryptable'}
          </div>
          {d.finalized && d.finTx ? (
            <div>
              finalized <Time t={d.finTime ?? 0} /> in <Tx hash={d.finTx} />
              {d.finalizer &&
                d.finalizer !== d.burner &&
                d.finalizer !== d.receiver && (
                  <>
                    {' '}
                    by <Address address={d.finalizer} />
                  </>
                )}
            </div>
          ) : (
            <div>
              <span className="chip chip-warning">pending</span>{' '}
              {v === 'public'
                ? 'value public anyway'
                : v === 'derived'
                  ? 'value pinned anyway'
                  : 'anyone can decrypt its value'}
            </div>
          )}
        </div>
      </section>
      <Flow d={d} />
      {d.shares.length > 1 && <Shares d={d} />}
      {d.graph && d.graph.edges.length > 1 && (
        <Section
          title="History"
          note={`every transfer that can have funded it${d.graph.truncated ? ', newest part' : ''}`}
        >
          <HistoryGraph graph={d.graph} />
        </Section>
      )}
    </>
  )
}

/** Height of one source in the flow, and the gap between two */
const ROW = 44
const GAP = 8
/** Space between a band and the edge of the boxes it joins */
const INSET = 6
/** Sources drawn; the rest are summed into one */
const SOURCES = 5
/** An upper bound this large says nothing */
const HUGE = 10n ** 15n

interface Source {
  key: string
  address?: string
  kind: 'depositor' | 'pool' | 'more'
  min: bigint
  /** null: unknown, a pool the walk does not enter */
  max: bigint | null
  count?: number
}

const big = (x: string | null | undefined) =>
  x === null || x === undefined ? null : BigInt(x)
/** Larger first */
const desc = (x: bigint, y: bigint) => (x > y ? -1 : x < y ? 1 : 0)

function sources(d: UnwrapDetail): Source[] {
  const sorted = [...d.shares].sort(
    (a, b) =>
      desc(BigInt(a.min), BigInt(b.min)) ||
      desc(big(a.max) ?? 0n, big(b.max) ?? 0n),
  )
  const list: Source[] = sorted.slice(0, SOURCES).map((s: ShareRow) => ({
    key: s.depositor,
    address: s.depositor,
    kind: 'depositor',
    min: BigInt(s.min),
    max: big(s.max),
  }))
  const rest = sorted.slice(SOURCES)
  if (rest.length > 0) {
    list.push({
      key: 'more',
      kind: 'more',
      min: rest.reduce((a, s) => a + BigInt(s.min), 0n),
      max: rest.some((s) => s.max === null)
        ? null
        : rest.reduce((a, s) => a + (big(s.max) ?? 0n), 0n),
      count: rest.length,
    })
  }
  for (const h of d.trace?.hubs ?? []) {
    list.push({ key: h, address: h, kind: 'pool', min: 0n, max: null })
  }
  return list
}

/**
 * Who provably paid for a withdrawal, at a glance: a band from each source
 * to the withdrawal, solid for what the data proves came from it, faint
 * for what only might have.
 */
function Flow({ d }: { d: UnwrapDetail }) {
  useLabels()
  const t = d.trace
  if (!t) {
    // the walk starts only where funds enter a pool: a pool's own unwraps mix
    const l = labelOf(d.burner)
    if (!l?.kind || l.kind === 'wrapper') return null
    return (
      <section className="card p-3 text-sm">
        Unwrapped by a pool: funds mixed, its members are public on{' '}
        <Address address={d.burner} />.
      </section>
    )
  }
  const a = d.amount
  const exact = a.hi !== undefined && a.lo === a.hi
  const list = sources(d)
  const proven = list.reduce((s, x) => s + x.min, 0n)
  const hi = big(a.hi)
  const total = exact
    ? BigInt(a.lo)
    : hi !== null && hi < HUGE
      ? hi
      : proven > BigInt(a.lo)
        ? proven
        : BigInt(a.lo)
  const top = list[0]
  const self = (x: string | undefined) => x === d.burner || x === d.receiver
  let caption: React.ReactNode
  if (t.origin === 'empty' || total === 0n) {
    caption = (
      <>
        <mark>Zero</mark>: the account had nothing left to burn.
      </>
    )
  } else if (top && top.kind === 'depositor' && exact && top.min === total) {
    caption = (
      <>
        <mark>Linked</mark>: all of it came from{' '}
        {self(top.address) ? 'its own deposits' : 'the deposits of'}{' '}
        {!self(top.address) && top.address && <Address address={top.address} />}
      </>
    )
  } else if (top && top.min > 0n) {
    caption = (
      <>
        <mark>≥ {pct(Number((top.min * 1000n) / total), 1000)}</mark> provably
        from {top.address && <Address address={top.address} />}
      </>
    )
  } else if (t.origin === 'hub') {
    caption = <>Partly via pools, no depositor proven.</>
  } else if (t.origin === 'several') {
    caption = <>{plural(t.depositors, 'possible depositor')}, none proven.</>
  } else {
    caption = <>No deposit in its history.</>
  }
  const meta = [
    plural(t.events, 'transfer'),
    t.cut && 'cut at an empty balance',
    t.truncated && 'too large to walk: lower bounds',
  ].filter(Boolean)
  return (
    <section className="card grid gap-3 p-3">
      <div className="text-sm">
        {caption}
        <span className="ml-2 text-xs" style={{ color: 'var(--muted)' }}>
          {meta.join(' · ')}
        </span>
      </div>
      {total > 0n && list.length > 0 && t.origin !== 'empty' && (
        <Bands d={d} list={list} total={total} />
      )}
    </section>
  )
}

function Bands({
  d,
  list,
  total,
}: {
  d: UnwrapDetail
  list: Source[]
  total: bigint
}) {
  const n = list.length
  const height = n * ROW + (n - 1) * GAP
  // bands stay clear of the boxes' edges, so they read as connections
  const span = height - 2 * INSET
  const share = (x: bigint) => (Number((x * 10_000n) / total) / 10_000) * span
  // the withdrawal's side: what each source provably gave, from the top,
  // then what no single source is proven to have given
  let y = INSET
  const solid = list.map((s) => {
    const h = Math.min(share(s.min), height - INSET - y)
    const seg = { from: y, to: y + h }
    y += h
    return seg
  })
  const open = { from: y, to: height - INSET }
  const openH = open.to - open.from
  const center = (i: number) => i * (ROW + GAP) + ROW / 2
  const band = (c: number, s: number, from: number, to: number) => {
    const t = Math.min(s, ROW - 2 * INSET)
    return `M0,${c - t / 2} C50,${c - t / 2} 50,${from} 100,${from} L100,${to} C50,${to} 50,${c + t / 2} 0,${c + t / 2} Z`
  }
  const left = (k: Source) =>
    k.kind === 'pool' ? 'var(--hub)' : 'var(--deposit)'
  const range = (k: Source) => {
    if (k.kind === 'pool') return 'pool'
    const lo = units(k.min)
    if (k.max === null) return k.min > 0n ? `≥ ${lo}` : 'unknown'
    if (k.min === 0n) return `≤ ${units(k.max)}`
    return k.max > k.min ? `${lo} – ${units(k.max)}` : lo
  }
  return (
    <div
      className="grid max-w-[760px]"
      style={{
        gridTemplateColumns:
          'minmax(0, 15rem) minmax(48px, 1fr) minmax(0, 15rem)',
      }}
    >
      <div className="grid" style={{ gap: GAP }}>
        {list.map((s) => (
          <div
            key={s.key}
            className="flex flex-col justify-center overflow-hidden rounded-md px-2 text-xs"
            style={{
              height: ROW,
              border: `1.5px solid ${left(s)}`,
              background: 'var(--surface)',
            }}
          >
            <div className="truncate">
              {s.kind === 'more' ? (
                <Muted>+{plural(s.count ?? 0, 'depositor')}</Muted>
              ) : (
                s.address && <Address address={s.address} />
              )}
              {s.kind === 'depositor' &&
                (s.address === d.burner || s.address === d.receiver) && (
                  <span className="chip chip-strong ml-1">itself</span>
                )}
            </div>
            <div className="mono truncate" style={{ color: 'var(--muted)' }}>
              {range(s)}
            </div>
          </div>
        ))}
      </div>
      <div className="relative">
        <svg
          width="100%"
          height={height}
          viewBox={`0 0 100 ${height}`}
          preserveAspectRatio="none"
          aria-hidden="true"
          className="block"
        >
          {openH > 0.5 &&
            list.map((s, i) => {
              const room =
                s.max === null
                  ? openH
                  : share(s.max > s.min ? s.max - s.min : 0n)
              const h = Math.min(room, openH)
              if (h < 0.5) return null
              const mid = (open.from + open.to) / 2
              return (
                <path
                  key={`open:${s.key}`}
                  d={band(center(i), h, mid - h / 2, mid + h / 2)}
                  fill={s.kind === 'pool' ? 'var(--hub)' : 'var(--axis)'}
                  opacity={s.kind === 'pool' ? 0.25 : 0.45}
                />
              )
            })}
          {list.map((s, i) => {
            const seg = solid[i]
            if (!seg || seg.to - seg.from < 0.5) return null
            return (
              <path
                key={`solid:${s.key}`}
                d={band(center(i), seg.to - seg.from, seg.from, seg.to)}
                fill="var(--zama)"
              />
            )
          })}
        </svg>
        {list.map((s, i) => {
          const seg = solid[i]
          if (!seg || seg.to - seg.from < 14) return null
          return (
            <span
              key={`pct:${s.key}`}
              className="mono absolute text-xs font-semibold"
              style={{
                left: '50%',
                top: (center(i) + (seg.from + seg.to) / 2) / 2,
                transform: 'translate(-50%, -50%)',
                color: 'var(--on-zama)',
              }}
            >
              {pct(Number((s.min * 1000n) / total), 1000)}
            </span>
          )
        })}
      </div>
      <div
        className="flex flex-col justify-center gap-0.5 rounded-md px-2 text-xs"
        style={{
          height,
          border: '1.5px solid var(--withdrawal)',
          background: 'var(--surface)',
        }}
      >
        <div className="truncate">
          <Amount a={d.amount} symbol={d.symbol} />
        </div>
        <div className="truncate">
          <Muted>to </Muted>
          <Address address={d.receiver} />
        </div>
      </div>
    </div>
  )
}

function Shares({ d }: { d: UnwrapDetail }) {
  const total = BigInt(d.amount.hi ?? d.amount.lo)
  const w = (x: string | null) =>
    total > 0n && x !== null ? Number((BigInt(x) * 1000n) / total) / 10 : 0
  return (
    <Section title="Sources" note="at least (yellow), at most (grey)">
      <table className="stack w-full text-left text-xs">
        <thead style={{ color: 'var(--muted)' }}>
          <tr>
            <th className="py-1 font-normal">Depositor</th>
            <th className="py-1 font-normal">Wraps</th>
            <th className="py-1 text-right font-normal">At least</th>
            <th className="py-1 text-right font-normal">At most</th>
            <th className="w-1/3 py-1 font-normal" />
          </tr>
        </thead>
        <tbody>
          {d.shares.map((s) => (
            <tr key={s.depositor} className="row hairline border-t">
              <td className="py-1">
                <Address address={s.depositor} />
              </td>
              <td
                className="whitespace-nowrap py-1"
                style={{ color: 'var(--ink-2)' }}
              >
                {s.wraps} · {day(s.first)}
                {s.last !== s.first && ` – ${day(s.last)}`}
              </td>
              <td className="mono py-1 text-right" data-label="≥">
                {units(s.min)}
              </td>
              <td
                className="mono py-1 text-right"
                style={{ color: 'var(--ink-2)' }}
                data-label="≤"
              >
                {s.max === null ? '?' : units(s.max)}
              </td>
              <td className="py-1 wide">
                <div className="bar">
                  <span
                    style={{
                      width: `${w(s.min)}%`,
                      background: 'var(--zama)',
                    }}
                  />
                  <span
                    style={{
                      width: `${Math.max(0, w(s.max) - w(s.min))}%`,
                      background: 'var(--axis)',
                    }}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  )
}
