import type { UnwrapDetail } from '../../src/graph/types'
import { api, useApi } from './api'
import { Flow, SOURCES } from './Flow'
import { day, units } from './format'
import { History } from './HistoryGraph'
import {
  Address,
  Amount,
  Bar,
  Handle,
  Kind,
  Loading,
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
  const { data: d, error } = useApi(api.unwrap, handle)
  if (!d) return <Loading error={error} />
  const v = visibility(d.amount)
  return (
    <>
      <section className="card grid gap-2 p-3">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-base">
          <Kind kind="unwrap" />
          <span className="font-semibold">
            <Amount a={d.amount} symbol={d.symbol} />
          </span>
          <span className="text-muted">from</span>
          <Address address={d.burner} />
          {d.receiver !== d.burner && (
            <>
              <span className="text-muted">to</span>
              <Address address={d.receiver} />
            </>
          )}
        </div>
        <div className="grid gap-1 text-xs text-ink-2">
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
      {d.shares.length > SOURCES && <Shares d={d} />}
      <History d={d} />
    </>
  )
}

/** Every depositor, when there are more than the flow draws */
function Shares({ d }: { d: UnwrapDetail }) {
  const total = BigInt(d.amount.hi ?? d.amount.lo)
  const w = (x: string | null) =>
    total > 0n && x !== null ? Number((BigInt(x) * 1000n) / total) / 10 : 0
  return (
    <Section title="Sources" note="at least (yellow), at most (grey)">
      <table className="stack">
        <thead>
          <tr>
            <th>Depositor</th>
            <th>Wraps</th>
            <th className="text-right">At least</th>
            <th className="text-right">At most</th>
            <th className="w-1/3" />
          </tr>
        </thead>
        <tbody>
          {d.shares.map((s) => (
            <tr key={s.depositor}>
              <td>
                <Address address={s.depositor} />
              </td>
              <td className="whitespace-nowrap text-ink-2">
                {s.wraps} · {day(s.first)}
                {s.last !== s.first && ` – ${day(s.last)}`}
              </td>
              <td className="mono text-right" data-label="≥">
                {units(s.min)}
              </td>
              <td className="mono text-right text-ink-2" data-label="≤">
                {s.max === null ? '?' : units(s.max)}
              </td>
              <td className="wide">
                <Bar
                  parts={[
                    { n: w(s.min), color: 'var(--zama)' },
                    { n: w(s.max) - w(s.min), color: 'var(--axis)' },
                    { n: 100 - Math.max(w(s.min), w(s.max)) },
                  ]}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  )
}
