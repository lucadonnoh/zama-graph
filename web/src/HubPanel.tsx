import { useEffect, useState } from 'react'
import type { BatchRow, HubDetail, IntentRow } from '../../src/graph/types'
import { api } from './api'
import { day, plural, units } from './format'
import { labelOf } from './labels'
import { Address, Amount, Handle, Muted, Section, Time } from './ui'

/** Rows shown before "expand all" */
const ROWS = 12

/**
 * What a contract that pools users' funds publishes about them: the
 * members of every batch and the batch total, the auction's price levels,
 * the swap's candidate orders and what moved. Hubs mix amounts; their
 * events still name every account.
 */
export function HubPanel({ address }: { address: string }) {
  const [d, setD] = useState<HubDetail>()
  useEffect(() => {
    api
      .hub(address)
      .then(setD)
      .catch(() => undefined)
  }, [address])
  if (!d) return null
  return (
    <>
      {d.batches && <Batches d={d} batches={d.batches} />}
      {d.auction && <Auction d={d} />}
      {d.intents && <Intents intents={d.intents} />}
    </>
  )
}

function Batches({ d, batches }: { d: HubDetail; batches: BatchRow[] }) {
  const [all, setAll] = useState(false)
  const shown = all ? batches : batches.slice(0, ROWS)
  return (
    <Section
      title="Batches"
      note={`join ${d.fromSymbol ?? '?'}, claim ${d.toSymbol ?? '?'} · members, totals and rates public`}
    >
      <table className="stack w-full text-left text-xs">
        <thead style={{ color: 'var(--muted)' }}>
          <tr>
            <th className="py-1 font-normal">Batch</th>
            <th className="py-1 font-normal">State</th>
            <th className="py-1 text-right font-normal">Total</th>
            <th className="py-1 font-normal">Joined → claimed</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((b) => (
            <tr key={b.id} className="hairline border-t align-top">
              <td className="mono py-1">
                #{b.id}
                <div style={{ color: 'var(--muted)' }}>{day(b.time)}</div>
              </td>
              <td className="py-1">
                <span
                  className={
                    b.state === 'canceled' ? 'chip chip-warning' : 'chip'
                  }
                >
                  {b.state}
                </span>
                {b.rate && (
                  <div
                    className="mono"
                    style={{ color: 'var(--muted)' }}
                    title="claim = join × rate / 10^6"
                  >
                    rate {Number(b.rate) / 1e6}
                  </div>
                )}
              </td>
              <td className="whitespace-nowrap py-1 text-right">
                {b.total ? (
                  <Amount a={b.total} symbol={d.fromSymbol} />
                ) : (
                  <Muted>–</Muted>
                )}
              </td>
              <td className="py-1 wide">
                {b.members.length === 0 && <Muted>no members</Muted>}
                {b.members.map((m) => (
                  <div
                    key={m.account}
                    className="flex flex-wrap items-baseline gap-x-2"
                  >
                    <Address address={m.account} />
                    <a href={`#handle/${m.joinHandle.replace(/^0x/, '')}`}>
                      <Amount a={m.joined} />
                    </a>
                    {m.joined.hi === '0' && <span className="chip">zero</span>}
                    {m.claimed && (
                      <>
                        <Muted>→</Muted>
                        <Amount a={m.claimed} symbol={d.toSymbol} />
                      </>
                    )}
                    {m.quit && (
                      <>
                        <Muted>quit</Muted> <Amount a={m.quit} />
                      </>
                    )}
                  </div>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!all && batches.length > ROWS && (
        <button
          type="button"
          className="toggle mt-2 text-xs"
          onClick={() => setAll(true)}
        >
          expand all {batches.length}
        </button>
      )}
    </Section>
  )
}

function Auction({ d }: { d: HubDetail }) {
  const a = d.auction
  const [all, setAll] = useState(false)
  if (!a) return null
  const levels = all ? a.levels : a.levels.slice(0, 30)
  const solo = a.levels.filter((l) => l.solo && !l.solo.external).length
  return (
    <Section
      title={
        <>
          Auction <Address address={a.address} />
        </>
      }
      note="prices in clear, quantities encrypted"
    >
      <p className="mb-2 text-xs" style={{ color: 'var(--ink-2)' }}>
        {plural(a.bids, 'bid')} · {plural(a.bidders, 'bidder')} ·{' '}
        {a.canceled.toLocaleString('en-US')} cancelled ·{' '}
        {plural(a.winners, 'winner')}
        {a.settlementPrice && ` · settled at ${units(a.settlementPrice)} USDT`}{' '}
        · <mark>{plural(solo, 'bid')} alone at its price, quantity public</mark>
      </p>
      <table className="stack w-full text-left text-xs">
        <thead style={{ color: 'var(--muted)' }}>
          <tr>
            <th className="py-1 text-right font-normal">Price (USDT)</th>
            <th className="py-1 text-right font-normal">Quantity (ZAMA)</th>
            <th className="py-1 text-right font-normal">Bids</th>
            <th className="py-1 font-normal">Alone</th>
          </tr>
        </thead>
        <tbody>
          {levels.map((l) => (
            <tr key={l.price} className="hairline border-t">
              <td className="mono py-1 text-right">{units(l.price)}</td>
              <td className="mono py-1 text-right">
                {l.total === null ? (
                  <Muted>–</Muted>
                ) : (
                  BigInt(l.total).toLocaleString('en-US')
                )}
              </td>
              <td className="mono py-1 text-right">{l.bids}</td>
              <td className="py-1 wide">
                {l.solo &&
                  (l.solo.external ? (
                    <Muted>escrow, in clear</Muted>
                  ) : (
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <Address address={l.solo.bidder} /> <Muted>paid</Muted>
                      <a
                        href={`#handle/${l.solo.paidHandle.replace(/^0x/, '')}`}
                      >
                        <Amount a={l.solo.paid} symbol="cUSDT" />
                      </a>
                    </span>
                  ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!all && a.levels.length > 30 && (
        <button
          type="button"
          className="toggle mt-2 text-xs"
          onClick={() => setAll(true)}
        >
          expand all {a.levels.length}
        </button>
      )}
    </Section>
  )
}

function symbolOf(address: string): string {
  return (
    labelOf(address)?.label.replace(' wrapper', '') ?? `${address.slice(0, 8)}…`
  )
}

function Intents({ intents }: { intents: IntentRow[] }) {
  return (
    <Section
      title="Intents"
      note="one real order among decoys; decoys move zero"
    >
      <table className="stack w-full text-left text-xs">
        <thead style={{ color: 'var(--muted)' }}>
          <tr>
            <th className="py-1 font-normal">Time</th>
            <th className="py-1 font-normal">Maker</th>
            <th className="py-1 font-normal">Candidates</th>
            <th className="py-1 font-normal">Outcome</th>
            <th className="py-1 font-normal">What moved</th>
          </tr>
        </thead>
        <tbody>
          {intents.map((i) => {
            const nonzero = i.legs.filter((l) => l.amount.hi !== '0')
            const revealed = i.legs.length > 1 && nonzero.length === 1
            return (
              <tr key={i.id} className="hairline border-t align-top">
                <td className="py-1">
                  <Time t={i.time} />
                </td>
                <td className="py-1">
                  <Address address={i.maker} />
                </td>
                <td className="py-1">
                  {i.candidates.map((c) => (
                    <div key={`${c.assetIn}:${c.assetOut}`}>
                      {symbolOf(c.assetIn)} → {symbolOf(c.assetOut)}
                    </div>
                  ))}
                </td>
                <td className="py-1">
                  <span className="chip">{i.outcome}</span>
                  {i.taker && (
                    <div>
                      <Muted>with </Muted>
                      <Address address={i.taker} />
                    </div>
                  )}
                </td>
                <td className="py-1 wide">
                  {i.legs.map((l) => (
                    <div key={`${l.asset}:${l.handle}`}>
                      {symbolOf(l.asset)} <Amount a={l.amount} />{' '}
                      <Handle h={l.handle} />
                    </div>
                  ))}
                  {revealed && (
                    <span className="chip chip-strong">real order public</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </Section>
  )
}
