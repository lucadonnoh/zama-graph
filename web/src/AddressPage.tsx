import { useEffect, useMemo, useState } from 'react'
import type { AddressEvent, AddressSummary } from '../../src/graph/types'
import { WILDCARD } from '../../src/protocol'
import { api } from './api'
import { day, plural } from './format'
import { HubPanel } from './HubPanel'
import { Linked, PartialLinks } from './LinkFlow'
import { labelOf, useLabels } from './labels'
import { nameOf, useNames } from './names'
import { TokenPanel } from './TokenPanel'
import { Address, Amount, ExplorerLink, Muted, Section, Time, Tx } from './ui'

const KIND_TEXT: Record<AddressEvent['kind'], string> = {
  wrap: 'wrap',
  unwrap: 'unwrap',
  in: 'received',
  out: 'sent',
}

/** A delegation's expiry: a day, or never for uint64 max */
export function expiryText(expiry: string | null): string {
  if (expiry === null) return '–'
  const v = BigInt(expiry)
  return v > 10n ** 11n ? 'never' : day(Number(v))
}

/** Rows of the ledger shown before "expand all" */
const ROWS = 200

export function AddressPage({ address }: { address: string }) {
  const [s, setS] = useState<AddressSummary>()
  const [error, setError] = useState<string>()
  useLabels()
  const names = useNames([address])
  useEffect(() => {
    setS(undefined)
    setError(undefined)
    api
      .address(address)
      .then(setS)
      .catch((e: unknown) => setError(String(e)))
  }, [address])

  if (error) return <Muted>{error}</Muted>
  if (!s) return <Muted>Loading…</Muted>
  const label = labelOf(address)
  const name = nameOf(names, address)
  const a = s.account
  return (
    <>
      <section className="card grid gap-2 p-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="mono break-all text-base">{address}</span>
          <ExplorerLink address={address} />
          {name && (
            <span
              className="text-base font-semibold"
              title="its primary ENS or GNS name, checked both ways"
            >
              {name}
            </span>
          )}
          {label && <Address address={address} plain />}
          <span className="text-xs" style={{ color: 'var(--muted)' }}>
            {a.kind === 'delegated'
              ? `EIP-7702 account, code of ${a.delegate}`
              : a.kind === 'contract'
                ? `contract${a.name ? ` ${a.name}` : ''}`
                : a.kind === 'eoa'
                  ? 'externally owned account'
                  : ''}
          </span>
        </div>
        {s.events.length === 0 ? (
          !a.token && (
            <Muted>This address never held a confidential token.</Muted>
          )
        ) : (
          <Balances s={s} />
        )}
      </section>
      {a.token && <TokenPanel address={address} />}
      {a.kind === 'contract' && !a.token && <HubPanel address={address} />}
      <Links s={s} />
      <ReadersOf s={s} />
      {s.events.length > 0 && <Ledger s={s} address={address} />}
    </>
  )
}

function Balances({ s }: { s: AddressSummary }) {
  const exact = (a: AddressSummary['events'][number]['amount']) =>
    a.hi !== undefined && a.lo === a.hi
  const transfers = s.events.filter((e) => e.kind === 'in' || e.kind === 'out')
  const pinned = transfers.filter((e) => exact(e.amount)).length
  const boundary = s.events.filter(
    (e) => e.kind === 'wrap' || e.kind === 'unwrap',
  )
  const publicBoundary = boundary.filter((e) => exact(e.amount)).length
  const known = s.balances.filter((b) => b.balance && exact(b.balance)).length
  const parties = new Set(transfers.map((e) => e.counterparty)).size
  return (
    <div className="grid gap-1 text-sm">
      <div className="text-xs" style={{ color: 'var(--ink-2)' }}>
        {plural(s.events.length, 'public event')} ·{' '}
        {plural(parties, 'counterparty', 'counterparties')}
        {boundary.length > 0 &&
          ` · ${publicBoundary}/${boundary.length} wrap and unwrap amounts`}
        {transfers.length > 0 &&
          ` · ${pinned}/${transfers.length} transfer amounts pinned`}
        {` · ${known}/${s.balances.length} balances known`}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1">
        {s.balances.map((b) => (
          <span key={b.token}>
            <span style={{ color: 'var(--muted)' }}>{b.symbol} </span>
            {b.balance ? <Amount a={b.balance} /> : <Muted>?</Muted>}
          </span>
        ))}
      </div>
    </div>
  )
}

/** Who this address is linked to through withdrawals, drawn as on an unwrap page */
function Links({ s }: { s: AddressSummary }) {
  const symbol = (token: string) =>
    s.events.find((e) => e.token === token)?.symbol ?? ''
  return (
    <Linked
      linked={s.linked}
      here={s.account.address}
      partial={
        s.fundedBy.length + s.funded.length > 0 ? (
          <PartialLinks
            fundedBy={s.fundedBy}
            funded={s.funded}
            here={s.account.address}
            symbolOf={symbol}
          />
        ) : undefined
      }
    />
  )
}

function ReadersOf({ s }: { s: AddressSummary }) {
  const own = s.account.address
  const given = s.delegations.filter((d) => d.delegator === own)
  const received = s.delegations.filter((d) => d.delegate === own)
  if (
    given.length === 0 &&
    received.length === 0 &&
    s.viewedBy.length === 0 &&
    s.userDecryptions.length === 0
  ) {
    return null
  }
  const contract = (c: string) =>
    c === WILDCARD ? (
      <span className="chip chip-warning">every contract</span>
    ) : (
      <Address address={c} />
    )
  return (
    <Section title="Readers" note="besides the KMS">
      <div className="grid gap-2 text-sm">
        {given.map((d) => (
          <div key={`${d.delegate}:${d.contract}`}>
            <Address address={d.delegate} /> can decrypt it in{' '}
            {contract(d.contract)}{' '}
            <Muted>
              {d.active
                ? `until ${expiryText(d.expiry)}`
                : 'expired or revoked'}
              {' · granted '}
              {day(d.time)} <Tx hash={d.tx} label="tx" />
            </Muted>
          </div>
        ))}
        {received.length > 0 && <Received received={received} />}
        {s.reads.accounts > 0 && (
          <div>
            <Muted>it decrypted balances of </Muted>
            {plural(s.reads.accounts, 'other account')}
            <Muted>
              {' '}
              in {plural(s.reads.requests, 'request')} since{' '}
              {s.reads.first ? day(s.reads.first) : ''}
            </Muted>
          </div>
        )}
        {s.viewedBy.length > 0 && (
          <div>
            <Muted>decrypted by </Muted>
            {s.viewedBy.map((v, i) => (
              <span key={v.user}>
                {i > 0 && ', '}
                {v.user === own ? (
                  <span className="chip">itself</span>
                ) : (
                  <Address address={v.user} />
                )}
                <Muted>
                  {' '}
                  {v.requests}× last {day(v.last)}
                </Muted>
              </span>
            ))}
          </div>
        )}
        {s.userDecryptions.length > 0 && (
          <details>
            <summary className="text-xs" style={{ color: 'var(--ink-2)' }}>
              {plural(s.reads.requests, 'decryption request')}
              {s.reads.requests > s.userDecryptions.length &&
                ` (latest ${s.userDecryptions.length})`}
            </summary>
            <table className="stack mt-1 w-full text-left text-xs">
              <tbody>
                {s.userDecryptions.map((u) => (
                  <tr key={u.id} className="hairline border-t">
                    <td className="py-1">
                      <Time t={u.time} />
                    </td>
                    <td
                      className="mono py-1"
                      title="digest of the public key: the same key links sessions"
                    >
                      key {u.key.slice(0, 8)}
                    </td>
                    <td className="py-1 wide">
                      {u.known.length === 0
                        ? plural(u.handles.length, 'handle')
                        : u.known.map((k) => (
                            <span key={k.handle} className="mr-3">
                              {k.what}: <Amount a={k.amount} />
                            </span>
                          ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        )}
      </div>
    </Section>
  )
}

/** The accounts that delegated decryption to this address */
function Received({ received }: { received: AddressSummary['delegations'] }) {
  const by = new Map<string, { grants: number; active: number }>()
  for (const d of received) {
    const e = by.get(d.delegator) ?? { grants: 0, active: 0 }
    e.grants++
    if (d.active) e.active++
    by.set(d.delegator, e)
  }
  const accounts = [...by.entries()].sort((a, b) => b[1].active - a[1].active)
  const active = accounts.filter(([, e]) => e.active > 0).length
  return (
    <div>
      <Muted>it can decrypt </Muted>
      {plural(active, 'account')}
      <Muted>
        {' '}
        ({plural(received.length, 'grant')} by {accounts.length} accounts
        {active < accounts.length &&
          `, ${accounts.length - active} expired or revoked`}
        ):{' '}
      </Muted>
      {accounts.slice(0, 12).map(([a], i) => (
        <span key={a}>
          {i > 0 && ', '}
          <Address address={a} />
        </span>
      ))}
      {accounts.length > 12 && <Muted> and {accounts.length - 12} more</Muted>}
    </div>
  )
}

function Ledger({ s, address }: { s: AddressSummary; address: string }) {
  const tokens = useMemo(
    () => [...new Map(s.events.map((e) => [e.token, e.symbol])).entries()],
    [s],
  )
  const [token, setToken] = useState<string>()
  const [all, setAll] = useState(false)
  const events = s.events.filter((e) => !token || e.token === token).reverse()
  const shown = all ? events : events.slice(0, ROWS)
  return (
    <Section title="Ledger" note="newest first">
      {tokens.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-1 text-xs">
          <button
            type="button"
            className={`toggle ${!token ? 'on' : ''}`}
            onClick={() => setToken(undefined)}
          >
            all
          </button>
          {tokens.map(([t, sym]) => (
            <button
              key={t}
              type="button"
              className={`toggle ${token === t ? 'on' : ''}`}
              onClick={() => setToken(t)}
            >
              {sym}
            </button>
          ))}
        </div>
      )}
      <table className="stack w-full text-left text-xs">
        <thead style={{ color: 'var(--muted)' }}>
          <tr>
            <th className="py-1 font-normal">Time</th>
            <th className="py-1 font-normal">Event</th>
            <th className="py-1 font-normal">Counterparty</th>
            <th className="py-1 text-right font-normal">Amount</th>
            <th className="py-1 text-right font-normal">Balance after</th>
            <th className="py-1 font-normal">Tx</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((e) => (
            <tr
              key={`${e.block}:${e.log}:${e.kind}`}
              className="row hairline border-t"
            >
              <td className="py-1">
                <Time t={e.time} />
              </td>
              <td className="whitespace-nowrap py-1">
                <span
                  className={
                    e.kind === 'wrap'
                      ? 'chip chip-deposit'
                      : e.kind === 'unwrap'
                        ? 'chip chip-withdrawal'
                        : 'chip'
                  }
                >
                  {KIND_TEXT[e.kind]}
                </span>{' '}
                <Muted>{e.symbol}</Muted>
                {e.kind === 'unwrap' && e.finalized === false && (
                  <span className="chip chip-warning ml-1">pending</span>
                )}
              </td>
              <td
                className="py-1"
                data-label={
                  e.kind === 'out' || e.kind === 'unwrap' ? 'to' : 'from'
                }
              >
                {e.kind === 'wrap' && e.depositor === address ? (
                  <>
                    <Muted>for </Muted>
                    <Address address={e.counterparty} />
                  </>
                ) : e.kind === 'wrap' ? (
                  <>
                    <Muted>paid by </Muted>
                    {e.counterparty === address ? (
                      <Muted>itself</Muted>
                    ) : (
                      <Address address={e.counterparty} />
                    )}
                  </>
                ) : e.kind === 'unwrap' ? (
                  <>
                    <Muted>to </Muted>
                    {e.counterparty === address ? (
                      <Muted>itself</Muted>
                    ) : (
                      <Address address={e.counterparty} />
                    )}
                  </>
                ) : (
                  <Address address={e.counterparty} />
                )}
              </td>
              <td className="whitespace-nowrap py-1 text-right">
                {e.kind === 'unwrap' ? (
                  <a href={`#unwrap/${e.handle}`} title="where it came from">
                    <Amount a={e.amount} />
                  </a>
                ) : (
                  <a href={`#handle/${e.handle}`}>
                    <Amount a={e.amount} />
                  </a>
                )}
              </td>
              <td
                className="whitespace-nowrap py-1 text-right"
                data-label="balance"
              >
                {e.balance && e.balanceHandle ? (
                  <a href={`#handle/${e.balanceHandle}`}>
                    <Amount a={e.balance} />
                  </a>
                ) : null}
              </td>
              <td className="py-1">
                <Tx hash={e.tx} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!all && events.length > ROWS && (
        <button
          type="button"
          className="toggle mt-2 text-xs"
          onClick={() => setAll(true)}
        >
          expand all {events.length}
        </button>
      )}
    </Section>
  )
}
