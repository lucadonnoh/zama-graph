import type { BatchRow, HubDetail, IntentRow } from '../../src/graph/types'
import { api, useApi } from './api'
import { day, plural, units } from './format'
import { labelOf } from './labels'
import { Address, Amount, Handle, Muted, Section, Time, useExpand } from './ui'

/** Rows shown before "expand all" */
const ROWS = 12

/**
 * What a contract that pools users' funds publishes about them: the
 * members of every batch and the batch total, the auction's price levels,
 * the swap's candidate orders and what moved. Hubs mix amounts; their
 * events still name every account.
 */
export function HubPanel({ address }: { address: string }) {
  const { data: d } = useApi(api.hub, address)
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
  const [shown, more] = useExpand(batches, ROWS)
  return (
    <Section
      title="Batches"
      note={`join ${d.fromSymbol ?? '?'}, claim ${d.toSymbol ?? '?'} · members, totals and rates public`}
    >
      <table className="stack">
        <thead>
          <tr>
            <th>Batch</th>
            <th>State</th>
            <th className="text-right">Total</th>
            <th>Joined → claimed</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((b) => (
            <tr key={b.id} className="align-top">
              <td className="mono">
                #{b.id}
                <div className="text-muted">{day(b.time)}</div>
              </td>
              <td>
                <span
                  className={
                    b.state === 'canceled' ? 'chip chip-warning' : 'chip'
                  }
                >
                  {b.state}
                </span>
                {b.rate && (
                  <div
                    className="mono text-muted"
                    title="claim = join × rate / 10^6"
                  >
                    rate {Number(b.rate) / 1e6}
                  </div>
                )}
              </td>
              <td className="whitespace-nowrap text-right">
                {b.total ? (
                  <Amount a={b.total} symbol={d.fromSymbol} />
                ) : (
                  <Muted>–</Muted>
                )}
              </td>
              <td className="wide">
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
      {more}
    </Section>
  )
}

function Auction({ d }: { d: HubDetail }) {
  const a = d.auction
  const [levels, more] = useExpand(a?.levels ?? [], 30)
  if (!a) return null
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
      <p className="mb-2 text-xs text-ink-2">
        {plural(a.bids, 'bid')} · {plural(a.bidders, 'bidder')} ·{' '}
        {a.canceled.toLocaleString('en-US')} cancelled ·{' '}
        {plural(a.winners, 'winner')}
        {a.settlementPrice && ` · settled at ${units(a.settlementPrice)} USDT`}{' '}
        · <mark>{plural(solo, 'bid')} alone at its price, quantity public</mark>
      </p>
      <table className="stack">
        <thead>
          <tr>
            <th className="text-right">Price (USDT)</th>
            <th className="text-right">Quantity (ZAMA)</th>
            <th className="text-right">Bids</th>
            <th>Alone</th>
          </tr>
        </thead>
        <tbody>
          {levels.map((l) => (
            <tr key={l.price}>
              <td className="mono text-right">{units(l.price)}</td>
              <td className="mono text-right">
                {l.total === null ? (
                  <Muted>–</Muted>
                ) : (
                  BigInt(l.total).toLocaleString('en-US')
                )}
              </td>
              <td className="mono text-right">{l.bids}</td>
              <td className="wide">
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
      {more}
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
      <table className="stack">
        <thead>
          <tr>
            <th>Time</th>
            <th>Maker</th>
            <th>Candidates</th>
            <th>Outcome</th>
            <th>What moved</th>
          </tr>
        </thead>
        <tbody>
          {intents.map((i) => {
            const nonzero = i.legs.filter((l) => l.amount.hi !== '0')
            const revealed = i.legs.length > 1 && nonzero.length === 1
            return (
              <tr key={i.id} className="align-top">
                <td>
                  <Time t={i.time} />
                </td>
                <td>
                  <Address address={i.maker} />
                </td>
                <td>
                  {i.candidates.map((c) => (
                    <div key={`${c.assetIn}:${c.assetOut}`}>
                      {symbolOf(c.assetIn)} → {symbolOf(c.assetOut)}
                    </div>
                  ))}
                </td>
                <td>
                  <span className="chip">{i.outcome}</span>
                  {i.taker && (
                    <div>
                      <Muted>with </Muted>
                      <Address address={i.taker} />
                    </div>
                  )}
                </td>
                <td className="wide">
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
