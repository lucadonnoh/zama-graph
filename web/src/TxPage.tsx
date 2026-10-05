import { useEffect, useState } from 'react'
import type { UnwrapDetail } from '../../src/graph/types'
import { api, useApi } from './api'
import { Linked, Unwrap } from './Flow'
import { plural } from './format'
import { OpList } from './HandlePage'
import { History } from './HistoryGraph'
import { Address, Amount, Kind, Loading, Time, Tx, ZERO } from './ui'

/**
 * One transaction, the page of everything that happens in it: what it
 * moved, each unwrap with where its funds came from, the history of the
 * withdrawals it is part of as one graph, and the FHE program it ran
 */
export function TxPage({ hash }: { hash: string }) {
  const { data: d, error } = useApi(api.tx, hash)
  const unwraps = useUnwraps(d?.unwraps ?? [])
  if (!d) return <Loading error={error} />
  // the unwraps below speak for themselves; the rest is listed up here
  const shown = new Set(unwraps.map((u) => u.handle))
  const moved = d.transfers.filter((t) => !shown.has(t.handle))
  return (
    <>
      <section className="card grid gap-2 p-3">
        <div className="grid gap-0.5">
          <div className="flex flex-wrap items-baseline gap-x-3">
            <span className="font-semibold">Transaction</span>
            <Tx
              hash={d.hash}
              label={<span className="break-all">0x{d.hash}</span>}
            />
          </div>
          <div className="text-xs text-ink-2">
            <Time t={d.time} /> · block {d.block.toLocaleString('en-US')}
            {d.sender && (
              <>
                {' '}
                · sent by <Address address={d.sender} />
              </>
            )}
            {d.target && (
              <>
                {' '}
                to <Address address={d.target} />
              </>
            )}
          </div>
        </div>
        {moved.length > 0 && (
          <table className="stack">
            <tbody>
              {moved.map((t) => (
                <tr key={t.log}>
                  <td className="whitespace-nowrap">
                    <Kind
                      kind={
                        t.from === ZERO
                          ? 'wrap'
                          : t.to === ZERO
                            ? 'unwrap'
                            : 'transfer'
                      }
                    />{' '}
                    <span className="text-ink-2">{t.symbol}</span>
                  </td>
                  <td data-label="from">
                    <Address address={t.from} />
                  </td>
                  <td data-label="to">
                    <Address address={t.to} />
                  </td>
                  <td className="whitespace-nowrap text-right">
                    {/* how the data pins it: the computation behind it */}
                    <a href={`#handle/${t.handle}`}>
                      <Amount a={t.amount} />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {unwraps.map((u) => (
        <Unwrap key={u.handle} d={u} />
      ))}
      <History graph={d.graph} />
      <Linked
        linked={d.linked}
        through={
          d.transfers.some((t) => t.from === ZERO)
            ? 'from this deposit'
            : 'via this tx'
        }
      />
      {d.ops.length > 0 && (
        <details className="card p-3">
          <summary className="text-sm">
            <span className="font-semibold">FHE operations</span>{' '}
            <span className="text-xs text-muted">
              {plural(d.ops.length, 'operation')}, in log order
            </span>
          </summary>
          <div className="mt-2">
            <OpList ops={d.ops} />
          </div>
        </details>
      )}
    </>
  )
}

/** The unwraps a transaction requested or finalized, in full */
function useUnwraps(handles: string[]): UnwrapDetail[] {
  const [list, setList] = useState<UnwrapDetail[]>([])
  const key = handles.join(',')
  useEffect(() => {
    let cancelled = false
    setList([])
    const wanted = key ? key.split(',').slice(0, 3) : []
    Promise.all(wanted.map((h) => api.unwrap(h).catch(() => undefined))).then(
      (r) => {
        if (!cancelled) setList(r.filter((u): u is UnwrapDetail => !!u))
      },
    )
    return () => {
      cancelled = true
    }
  }, [key])
  return list
}
