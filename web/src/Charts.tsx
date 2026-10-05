import {
  type AddressEvent,
  type Amount,
  type LiveFilter,
  SET_FILTERS,
  type SetFilter,
  type Stats,
} from '../../src/graph/types'
import { date, day, pct, units } from './format'
import { liveHref } from './route'
import { exact, HUGE } from './ui'

const SET_LABEL: Record<SetFilter, string> = {
  linked: '1',
  'set-2': '2',
  'set-3-5': '3–5',
  'set-6-20': '6–20',
  'set-21': '>20',
  pool: 'pool',
}

/** One possible depositor is a link; through a pool the set is unknown */
const SET_COLOR: Record<SetFilter, string> = {
  linked: 'var(--zama)',
  'set-2': 'var(--axis)',
  'set-3-5': 'var(--axis)',
  'set-6-20': 'var(--axis)',
  'set-21': 'var(--axis)',
  pool: 'var(--hub)',
}

/**
 * How many depositors can have funded each withdrawal: its anonymity set.
 * One bar per size, each leading to its withdrawals.
 */
export function SetBars({
  sets,
  filter,
}: {
  sets: Stats['sets']
  filter: LiveFilter
}) {
  const total = SET_FILTERS.reduce((a, f) => a + sets[f], 0)
  const most = Math.max(1, ...SET_FILTERS.map((f) => sets[f]))
  return (
    <section
      className={`card grid content-start gap-1 p-3 text-xs ${SET_FILTERS.some((f) => f === filter) || filter === 'several' ? 'on' : ''}`}
    >
      <h2 className="mb-1 text-sm font-semibold">
        Possible depositors per unwrap
      </h2>
      {SET_FILTERS.map((f) => (
        <a
          key={f}
          href={liveHref(f)}
          className={`set-row ${filter === f ? 'on' : ''}`}
          title={`${sets[f].toLocaleString('en-US')} unwraps, ${pct(sets[f], total)}${f === 'pool' ? ': through a pool, its own depositors unknown' : ''}`}
        >
          <span className="mono text-ink-2">{SET_LABEL[f]}</span>
          <span className="flex items-center">
            <span
              className="set-bar"
              style={{
                width: `${(100 * sets[f]) / most}%`,
                background: SET_COLOR[f],
              }}
            />
          </span>
          <span className="mono text-right">
            {sets[f].toLocaleString('en-US')}
          </span>
        </a>
      ))}
    </section>
  )
}

const CLASSES: [keyof Stats['months'][number], string, string][] = [
  ['linked', 'linked', 'var(--zama)'],
  ['pool', 'via pool', 'var(--hub)'],
  ['several', 'several depositors', 'var(--axis)'],
]

const MONTH = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  timeZone: 'UTC',
})

/**
 * Withdrawals per month, each month's column split by what the data
 * proves about them, with the month's count under it
 */
export function MonthBars({
  months,
  filter,
}: {
  months: Stats['months']
  filter: LiveFilter
}) {
  return (
    <section className="card grid gap-2 p-3">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h2 className="font-semibold">Unwraps by month</h2>
        <div className="flex flex-wrap gap-x-3 text-xs text-muted">
          {CLASSES.map(([key, label, color]) => (
            <a
              key={key}
              href={liveHref(key as LiveFilter)}
              className={`evidence ${filter === key ? 'on' : ''}`}
            >
              <span className="dot" style={{ background: color }} />
              {label}
            </a>
          ))}
        </div>
      </div>
      <div className="months">
        {months.map((m, i) => {
          const total = m.linked + m.pool + m.several
          const [year, month] = m.month.split('-')
          const name = MONTH.format(new Date(`${m.month}-01T00:00:00Z`))
          return (
            <div key={m.month} className="month">
              <div className="month-bar">
                {CLASSES.map(([key, label, color]) => {
                  const n = m[key] as number
                  if (n === 0) return null
                  return (
                    <a
                      key={key}
                      href={liveHref(key as LiveFilter)}
                      style={{ flexGrow: n, background: color }}
                      title={`${m.month}: ${n.toLocaleString('en-US')} ${label} (${pct(n, total)})`}
                    >
                      <span className="sr-only">
                        {label} {n}
                      </span>
                    </a>
                  )
                })}
              </div>
              <div className="mono text-ink-2">
                {total.toLocaleString('en-US')}
              </div>
              <div className="text-muted">
                {name}
                {(i === 0 || month === '01') && ` ’${year?.slice(2)}`}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

/** Height of a balance strip, and the room under it for the ticks */
const STRIP = 56
const TICK = 6

const TICK_COLOR: Record<AddressEvent['kind'], string> = {
  wrap: 'var(--deposit)',
  unwrap: 'var(--withdrawal)',
  in: 'var(--axis)',
  out: 'var(--axis)',
}

/**
 * An account's balance in one token after each of its events, as the
 * public data allows it: a line where it is known exactly, a band where it
 * is only bounded, the band to the top where nothing bounds it. One step
 * per event, in order; a tick under each, by kind.
 */
export function BalanceStrip({ events }: { events: AddressEvent[] }) {
  const n = events.length
  if (n === 0) return null
  const top = (b: Amount | null) =>
    !b || b.hi === undefined || BigInt(b.hi) >= HUGE
      ? BigInt(b?.lo ?? 0)
      : BigInt(b.hi)
  const max = events.reduce((m, e) => {
    const t = top(e.balance)
    return t > m ? t : m
  }, 0n)
  const scale = max > 0n ? max : 1n
  const y = (v: bigint) =>
    STRIP -
    (Number(((v > scale ? scale : v) * 1000n) / scale) * (STRIP - 4)) / 1000
  const w = 1000 / n
  return (
    <div className="grid gap-0.5">
      <svg
        viewBox={`0 0 1000 ${STRIP + TICK}`}
        preserveAspectRatio="none"
        className="block h-[62px] w-full"
        role="img"
        aria-label="balance after each event"
      >
        <line
          x1={0}
          x2={1000}
          y1={STRIP}
          y2={STRIP}
          stroke="var(--hairline)"
          vectorEffect="non-scaling-stroke"
        />
        {events.map((e, i) => {
          const b = e.balance
          const x = i * w
          const lo = BigInt(b?.lo ?? 0)
          const open = !b || b.hi === undefined || BigInt(b.hi) >= HUGE
          const known = !!b && exact(b)
          return (
            <g key={`${e.block}:${e.log}:${e.kind}`}>
              {known ? (
                <line
                  x1={x}
                  x2={x + w}
                  y1={y(lo)}
                  y2={y(lo)}
                  stroke="var(--mark-line)"
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                />
              ) : (
                // a range: its edges drawn, so that a narrow one still shows
                <>
                  <rect
                    x={x}
                    width={w}
                    y={open ? 0 : y(top(b))}
                    height={y(lo) - (open ? 0 : y(top(b)))}
                    fill="var(--axis)"
                    opacity={open ? 0.2 : 0.45}
                  />
                  {[open ? undefined : y(top(b)), y(lo)].map(
                    (edge, k) =>
                      edge !== undefined && (
                        <line
                          // biome-ignore lint/suspicious/noArrayIndexKey: top and bottom
                          key={k}
                          x1={x}
                          x2={x + w}
                          y1={edge}
                          y2={edge}
                          stroke="var(--ink-2)"
                          strokeWidth={1}
                          vectorEffect="non-scaling-stroke"
                        />
                      ),
                  )}
                </>
              )}
              <line
                x1={x + w / 2}
                x2={x + w / 2}
                y1={STRIP + 1}
                y2={STRIP + TICK}
                stroke={TICK_COLOR[e.kind]}
                strokeWidth={e.kind === 'wrap' || e.kind === 'unwrap' ? 2 : 1}
                vectorEffect="non-scaling-stroke"
              />
              <rect
                x={x}
                width={w}
                y={0}
                height={STRIP + TICK}
                fill="transparent"
              >
                <title>
                  {`${date(e.time)} · ${e.kind} ${amountText(e.amount)} · balance ${b ? amountText(b) : '?'}`}
                </title>
              </rect>
            </g>
          )
        })}
      </svg>
      <div className="flex justify-between text-[11px] text-muted">
        <span>{day(events[0]?.time ?? 0)}</span>
        <span className="mono">{max > 0n ? `max ${units(max)}` : ''}</span>
        <span>{day(events[n - 1]?.time ?? 0)}</span>
      </div>
    </div>
  )
}

/** An amount as plain text, for tooltips */
function amountText(a: Amount): string {
  if (exact(a)) return units(a.lo)
  if (a.hi === undefined || BigInt(a.hi) >= HUGE) return `≥ ${units(a.lo)}`
  return a.lo === '0' ? `≤ ${units(a.hi)}` : `${units(a.lo)} – ${units(a.hi)}`
}
