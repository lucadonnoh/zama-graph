import { useEffect, useState } from 'react'
import type { TxDetail, UnwrapDetail } from '../../src/graph/types'
import { api } from './api'
import { plural } from './format'
import { OpList } from './HandlePage'
import { Linked } from './LinkFlow'
import { Flow, History } from './UnwrapPage'
import { Address, Amount, Handle, Muted, Section, Time, Tx } from './ui'

const ZERO = '0x0000000000000000000000000000000000000000'

/**
 * One transaction: its confidential transfers, and the FHE program it ran,
 * operation by operation, with what the public data pins each result to
 */
export function TxPage({ hash }: { hash: string }) {
  const [d, setD] = useState<TxDetail>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    setD(undefined)
    setError(undefined)
    api
      .tx(hash)
      .then(setD)
      .catch((e: unknown) => setError(String(e)))
  }, [hash])
  const unwraps = useUnwraps(d?.unwraps ?? [])
  if (error) return <Muted>{error}</Muted>
  if (!d) return <Muted>Loading…</Muted>
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
        <div className="text-xs" style={{ color: 'var(--ink-2)' }}>
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
          <table className="stack w-full text-left text-xs">
            <thead style={{ color: 'var(--muted)' }}>
              <tr>
                <th className="py-1 font-normal">Token</th>
                <th className="py-1 font-normal">From</th>
                <th className="py-1 font-normal">To</th>
                <th className="py-1 text-right font-normal">Amount</th>
                <th className="py-1 font-normal">Handle</th>
              </tr>
            </thead>
            <tbody>
              {d.transfers.map((t) => (
                <tr key={t.log} className="row hairline border-t">
                  <td className="py-1">
                    {t.symbol}{' '}
                    {t.from === ZERO && (
                      <span className="chip chip-deposit">wrap</span>
                    )}
                    {t.to === ZERO && (
                      <span className="chip chip-withdrawal">unwrap</span>
                    )}
                  </td>
                  <td className="py-1" data-label="from">
                    <Address address={t.from} />
                  </td>
                  <td className="py-1" data-label="to">
                    <Address address={t.to} />
                  </td>
                  <td className="whitespace-nowrap py-1 text-right">
                    {t.to === ZERO ? (
                      <a href={`#unwrap/${t.handle}`}>
                        <Amount a={t.amount} />
                      </a>
                    ) : (
                      <Amount a={t.amount} />
                    )}
                  </td>
                  <td className="py-1">
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
