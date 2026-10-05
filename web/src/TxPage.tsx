import { useEffect, useState } from 'react'
import type { UnwrapDetail } from '../../src/graph/types'
import { api, useApi } from './api'
import { Flow, Linked } from './Flow'
import { plural } from './format'
import { OpList } from './HandlePage'
import { History } from './HistoryGraph'
import {
  Address,
  Amount,
  Handle,
  Kind,
  Loading,
  Section,
  Time,
  Tx,
  ZERO,
} from './ui'

/**
 * One transaction: its confidential transfers, and the FHE program it ran,
 * operation by operation, with what the public data pins each result to
 */
export function TxPage({ hash }: { hash: string }) {
  const { data: d, error } = useApi(api.tx, hash)
  const unwraps = useUnwraps(d?.unwraps ?? [])
  if (!d) return <Loading error={error} />
  return (
    <>
      <section className="card grid gap-1 p-3">
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
      </section>
      {unwraps.map((u) => (
        <Flow key={u.handle} d={u} />
      ))}
      <Linked
        linked={d.linked}
        through={
          d.transfers.some((t) => t.from === ZERO)
            ? 'from this deposit'
            : 'via this tx'
        }
      />
      {d.transfers.length > 0 && (
        <Section title={plural(d.transfers.length, 'confidential transfer')}>
          <table className="stack">
            <thead>
              <tr>
                <th>Token</th>
                <th>From</th>
                <th>To</th>
                <th className="text-right">Amount</th>
                <th>Handle</th>
              </tr>
            </thead>
            <tbody>
              {d.transfers.map((t) => (
                <tr key={t.log}>
                  <td>
                    {t.symbol} {t.from === ZERO && <Kind kind="wrap" />}
                    {t.to === ZERO && <Kind kind="unwrap" />}
                  </td>
                  <td data-label="from">
                    <Address address={t.from} />
                  </td>
                  <td data-label="to">
                    <Address address={t.to} />
                  </td>
                  <td className="whitespace-nowrap text-right">
                    <a
                      href={
                        t.to === ZERO
                          ? `#unwrap/${t.handle}`
                          : `#handle/${t.handle}`
                      }
                    >
                      <Amount a={t.amount} />
                    </a>
                  </td>
                  <td>
                    <Handle h={t.handle} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}
      {unwraps.map((u) => (
        <History key={u.handle} d={u} />
      ))}
      {d.ops.length > 0 && (
        <Section title="FHE operations" note={`${d.ops.length} in log order`}>
          <OpList ops={d.ops} />
        </Section>
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
