import { type ReactNode, useEffect, useState } from 'react'
import type { LiveEvent, Stats } from '../../src/graph/types'
import { TRUST } from '../../src/protocol'
import { api, type LiveFilter } from './api'
import { ago, pct, plural } from './format'
import { Address, Amount, Muted, visibility } from './ui'

const TABS: [LiveFilter, string, string][] = [
  ['all', 'all', 'the newest wraps, transfers and unwraps'],
  ['exact', 'pinned', 'transfers whose hidden amount the data pins'],
  ['linked', 'linked', 'unwraps provably funded by one depositor'],
  ['unwraps', 'unwraps', 'every unwrap, with where it came from'],
  ['named', 'named', 'accounts with an ENS or GNS name'],
]

/** How often the live view refreshes */
const REFRESH_MS = 20_000

/**
 * The page without a query: what the public data reveals, as numbers, and
 * the newest activity with what is known of each amount and link.
 */
export function Live() {
  const [stats, setStats] = useState<Stats>()
  const [events, setEvents] = useState<LiveEvent[]>()
  const [tab, setTab] = useState<LiveFilter>('all')
  const [now, setNow] = useState(() => Date.now() / 1000)

  useEffect(() => {
    api
      .stats()
      .then((s) => s.transfers && setStats(s))
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    let cancelled = false
    const load = () => {
      if (document.hidden) return
      api
        .live(tab)
        .then((e) => {
          if (cancelled) return
          setEvents(e)
          setNow(Date.now() / 1000)
        })
        .catch(() => undefined)
    }
    load()
    const timer = setInterval(load, REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [tab])

  return (
    <>
      <div className="grid gap-1">
        <h2 className="text-lg font-semibold sm:text-xl">
          Zama hides amounts, sometimes. <mark>It never hides links.</mark>
        </h2>
        <p className="lead">
          Encryption hides values, not structure: every transfer names both
          sides, every encrypted amount is a public formula over earlier ones.{' '}
          <a href="#about" className="underline">
            Method
          </a>
        </p>
      </div>
      {stats && <Scoreboard s={stats} />}
      {stats && <ByToken s={stats} />}
      <section className="card p-3">
        <div className="mb-2 flex flex-wrap gap-1 text-xs">
          {TABS.map(([id, text, title]) => (
            <button
              key={id}
              type="button"
              className={`toggle ${tab === id ? 'on' : ''}`}
              onClick={() => setTab(id)}
              title={title}
            >
              {text}
            </button>
          ))}
        </div>
        {events && <Feed events={events} now={now} />}
      </section>
    </>
  )
}

function Scoreboard({ s }: { s: Stats }) {
  const t = s.transfers
  const u = s.unwraps
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <Card title="Links">
        <Stat
          value={pct(s.links.oneDepositor, s.links.traced)}
          label={`of ${plural(s.links.traced, 'unwrap')} provably funded by one depositor`}
          mark
        />
        <Stat value="100%" label="of transfers name sender and recipient" />
        <Facts
          lines={[
            `${s.links.self.toLocaleString('en-US')} linked to the unwrapping address itself`,
            s.named &&
              `${s.named.accounts.toLocaleString('en-US')} ENS-named accounts, ${plural(s.named.linked, 'linked unwrap')}`,
          ]}
        />
      </Card>
      <Card title="Amounts">
        <Stat
          value={pct(t.exact, t.total)}
          label={`amounts pinned, of ${plural(t.total, 'transfer')}`}
          mark
        />
        <TransferBar s={s} />
        <Facts
          lines={[
            u.pendingKnown > 0 &&
              `${plural(u.pendingKnown, 'unfinalized unwrap')} known anyway`,
            u.pendingDecryptable > 0 &&
              `${plural(u.pendingDecryptable, 'unwrap')} anyone can decrypt`,
            s.router &&
              s.router.deposits > 0 &&
              `${s.router.revealed} of ${s.router.deposits} router deposits reveal the vault`,
          ]}
        />
      </Card>
      <Card title="Balances">
        <Stat
          value={pct(s.balances.exact, s.balances.accounts)}
          label={`of ${plural(s.balances.accounts, 'balance')} known exactly`}
          mark
        />
        <Facts
          lines={[
            `${s.balances.zero.toLocaleString('en-US')} of them zero`,
            'every balance change is public in time',
          ]}
        />
      </Card>
      <Card title="Readers">
        <Stat
          value={`${TRUST.publicThreshold} of ${TRUST.kmsNodes}`}
          label="KMS operators can decrypt everything"
        />
        <Facts
          lines={[
            `${s.readers.delegations.toLocaleString('en-US')} active delegations to ${plural(s.readers.delegates, 'address', 'addresses')}`,
            `${s.gateway.userDecryptions.toLocaleString('en-US')} balance views logged with who asked`,
          ]}
        />
      </Card>
    </div>
  )
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card grid content-start gap-3 p-3">
      <h2 className="font-semibold">{title}</h2>
      {children}
    </section>
  )
}

function Stat({
  value,
  label,
  mark,
}: {
  value: string
  label: string
  /** a fact the data reveals */
  mark?: boolean
}) {
  return (
    <div className="stat">
      <span className="stat-value">{mark ? <mark>{value}</mark> : value}</span>
      <span className="stat-label">{label}</span>
    </div>
  )
}

function Facts({ lines }: { lines: (string | false | undefined | null)[] }) {
  const shown = lines.filter(Boolean)
  if (shown.length === 0) return null
  return (
    <ul className="grid gap-0.5 text-xs" style={{ color: 'var(--ink-2)' }}>
      {shown.map((l) => (
        <li key={l as string}>{l}</li>
      ))}
    </ul>
  )
}

function ByToken({ s }: { s: Stats }) {
  const rows = [...s.byToken].sort(
    (a, b) => b.transfers + b.wraps - (a.transfers + a.wraps),
  )
  return (
    <details className="card p-3">
      <summary className="text-xs" style={{ color: 'var(--ink-2)' }}>
        tokens ({rows.length})
      </summary>
      <table className="stack mt-2 w-full text-left text-xs">
        <thead style={{ color: 'var(--muted)' }}>
          <tr>
            <th className="py-1 font-normal">Token</th>
            <th className="py-1 text-right font-normal">Wraps</th>
            <th className="py-1 text-right font-normal">Unwraps</th>
            <th className="py-1 text-right font-normal">Transfers</th>
            <th className="py-1 text-right font-normal">Amounts pinned</th>
            <th
              className="py-1 text-right font-normal"
              title="accounts whose current balance is not known to be zero"
            >
              Holders
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.token} className="row hairline border-t">
              <td className="py-1">
                <a href={`#${t.token}`}>{t.symbol}</a>
              </td>
              <td className="mono py-1 text-right" data-label="wraps">
                {t.wraps.toLocaleString('en-US')}
              </td>
              <td className="mono py-1 text-right" data-label="unwraps">
                {t.unwraps.toLocaleString('en-US')}
              </td>
              <td className="mono py-1 text-right" data-label="transfers">
                {t.transfers.toLocaleString('en-US')}
              </td>
              <td className="mono py-1 text-right" data-label="pinned">
                {t.transfers
                  ? `${t.exact.toLocaleString('en-US')} (${pct(t.exact, t.transfers)})`
                  : ''}
              </td>
              <td className="mono py-1 text-right" data-label="holders">
                {t.holders.toLocaleString('en-US')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  )
}

/** Transfer amounts by how much the public data says */
function TransferBar({ s }: { s: Stats }) {
  const t = s.transfers
  const parts: [number, string, string][] = [
    [t.exact, 'var(--zama)', 'pinned'],
    [t.narrow, 'var(--bounded)', 'within 2×'],
    [t.bounded, 'var(--axis)', 'bounded'],
  ]
  return (
    <div className="grid gap-1">
      <div className="bar">
        {parts.map(([n, color, label]) => (
          <span
            key={label}
            style={{
              width: `${(100 * n) / Math.max(1, t.total)}%`,
              background: color,
            }}
            title={`${label}: ${n.toLocaleString('en-US')}`}
          />
        ))}
      </div>
      <div
        className="flex flex-wrap gap-x-3 text-xs"
        style={{ color: 'var(--muted)' }}
      >
        {parts.map(([n, color, label]) => (
          <span key={label}>
            <span className="dot" style={{ background: color }} />
            {label} {pct(n, t.total)}
          </span>
        ))}
      </div>
    </div>
  )
}

const KIND_CHIP: Record<string, string> = {
  wrap: 'chip chip-deposit',
  transfer: 'chip',
  unwrap: 'chip chip-withdrawal',
}

/** Transactions with this many transfers are shown as one row */
const GROUP = 3

function Feed({ events, now }: { events: LiveEvent[]; now: number }) {
  const [open, setOpen] = useState<Set<string>>(new Set())
  if (events.length === 0) return <Muted>Nothing yet.</Muted>
  // events of one transaction are adjacent (newest first)
  const groups: LiveEvent[][] = []
  for (const e of events) {
    const last = groups.at(-1)
    if (last && last[0]?.tx === e.tx) last.push(e)
    else groups.push([e])
  }
  return (
    <table className="stack w-full text-left text-xs">
      <thead style={{ color: 'var(--muted)' }}>
        <tr>
          <th className="py-1 font-normal">When</th>
          <th className="py-1 font-normal">What</th>
          <th className="py-1 font-normal">From</th>
          <th className="py-1 font-normal">To</th>
          <th className="py-1 text-right font-normal">Amount</th>
          <th className="py-1 font-normal">Notes</th>
        </tr>
      </thead>
      <tbody>
        {groups.flatMap((g) => {
          const first = g[0] as LiveEvent
          if (g.length < GROUP || open.has(first.tx)) {
            return g.map((e) => (
              <Row key={`${e.tx}:${e.handle}:${e.kind}`} e={e} now={now} />
            ))
          }
          return [
            <GroupRow
              key={first.tx}
              g={g}
              now={now}
              onOpen={() => setOpen((o) => new Set(o).add(first.tx))}
            />,
          ]
        })}
      </tbody>
    </table>
  )
}

function Row({ e, now }: { e: LiveEvent; now: number }) {
  return (
    <tr
      className="row hairline cursor-pointer border-t"
      onClick={() => {
        location.hash =
          e.kind === 'unwrap' ? `unwrap/${e.handle}` : `tx/${e.tx}`
      }}
    >
      <td
        className="mono whitespace-nowrap py-1"
        title={new Date(e.time * 1000).toISOString()}
      >
        {ago(e.time, now)}
      </td>
      <td className="whitespace-nowrap py-1">
        <span className={KIND_CHIP[e.kind]}>{e.kind}</span>{' '}
        <span style={{ color: 'var(--ink-2)' }}>{e.symbol}</span>
      </td>
      <td className="py-1" data-label="from">
        <Address address={e.from} />
      </td>
      <td className="py-1" data-label="to">
        <Address address={e.to} />
      </td>
      <td className="whitespace-nowrap py-1 text-right">
        <Amount a={e.amount} />
      </td>
      <td className="py-1 wide" style={{ color: 'var(--ink-2)' }}>
        <Says e={e} />
      </td>
    </tr>
  )
}

/** Several transfers of one transaction (a vault deposit through the router, a swap) */
function GroupRow({
  g,
  now,
  onOpen,
}: {
  g: LiveEvent[]
  now: number
  onOpen: () => void
}) {
  const first = g[0] as LiveEvent
  const parties = [...new Set(g.flatMap((e) => [e.from, e.to]))].filter(
    (a) => a !== '0x0000000000000000000000000000000000000000',
  )
  const symbols = [...new Set(g.map((e) => e.symbol))]
  const pinned = g.filter(
    (e) => e.amount.hi !== undefined && e.amount.lo === e.amount.hi,
  )
  const zero = pinned.filter((e) => e.amount.lo === '0').length
  const boundary = g.find((e) => e.kind !== 'transfer')
  return (
    <tr
      className="row hairline cursor-pointer border-t"
      onClick={() => {
        location.hash = `tx/${first.tx}`
      }}
    >
      <td className="mono whitespace-nowrap py-1">{ago(first.time, now)}</td>
      <td className="py-1">
        <span className="chip">{g.length} transfers</span>{' '}
        <span style={{ color: 'var(--ink-2)' }} title={symbols.join(', ')}>
          {symbols.slice(0, 2).join(', ')}
          {symbols.length > 2 && ` +${symbols.length - 2}`}
        </span>
      </td>
      <td className="py-1 wide" colSpan={2}>
        {parties.slice(0, 4).map((a, i) => (
          <span key={a}>
            {i > 0 && <Muted> · </Muted>}
            <Address address={a} />
          </span>
        ))}
        {parties.length > 4 && <Muted> +{parties.length - 4}</Muted>}
      </td>
      <td className="whitespace-nowrap py-1 text-right">
        {boundary && <Amount a={boundary.amount} />}
      </td>
      <td className="py-1 wide" style={{ color: 'var(--ink-2)' }}>
        {pinned.length}/{g.length} pinned
        {zero > 0 && `, ${zero} zero`}{' '}
        <button
          type="button"
          className="toggle ml-1"
          onClick={(e) => {
            e.stopPropagation()
            onOpen()
          }}
        >
          expand
        </button>
      </td>
    </tr>
  )
}

/** What the public data says about an event, in a word or two */
function Says({ e }: { e: LiveEvent }) {
  if (e.kind === 'wrap') return <>clear</>
  if (e.kind === 'transfer') {
    const a = e.amount
    if (a.hi !== undefined && a.lo === a.hi) {
      return a.lo === '0' ? <>zero</> : <>pinned</>
    }
    return visibility(a) === 'hidden' ? <>hidden</> : <>bounded</>
  }
  const t = e.trace
  const pending = !e.finalized && (
    <span className="chip chip-warning">pending</span>
  )
  if (!t) return <>{pending}</>
  if (t.origin === 'empty') return <>{pending} zero</>
  if (t.sender && t.senderMin === e.amount.lo && e.amount.lo !== '0') {
    return (
      <>
        {pending} ← all from{' '}
        {t.sender === e.from || t.sender === e.to ? (
          <span className="chip chip-strong">itself</span>
        ) : (
          <Address address={t.sender} />
        )}
        {t.via.length > 0 && (
          <span title="through a pool that only returns a member its own funds">
            {' '}
            <Muted>via pool</Muted>
          </span>
        )}
      </>
    )
  }
  if (t.origin === 'hub') {
    return (
      <>
        {pending} via{' '}
        {t.hubs.slice(0, 2).map((h) => (
          <span key={h}>
            <Address address={h} />{' '}
          </span>
        ))}
      </>
    )
  }
  return (
    <>
      {pending} {plural(t.depositors, 'possible depositor')}
    </>
  )
}
