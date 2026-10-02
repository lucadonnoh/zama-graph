import { useEffect, useState } from 'react'
import type { ReadersSummary } from '../../src/graph/types'
import { api } from './api'
import { day, plural } from './format'
import { Address, Muted, Section } from './ui'

/** KMS operators, as Zama lists them (docs: protocol apps, operator staking) */
const KMS_OPERATORS =
  'Zama, Dfns, Figment, Fireblocks, InfStones, Unit410, LayerZero, Ledger, Omakase, Stake Capital, OpenZeppelin, Etherscan and Conduit'

/**
 * Who besides an account can read its balances: the KMS, which can read
 * everything; addresses an account delegated decryption to; observers a
 * token owner appoints. And who actually asks, from the Gateway's log.
 */
export function Readers() {
  const [r, setR] = useState<ReadersSummary>()
  useEffect(() => {
    api
      .readers()
      .then(setR)
      .catch(() => undefined)
  }, [])
  if (!r) return <Muted>Loading…</Muted>
  return (
    <>
      <Section title="KMS">
        <ul className="lead grid gap-1 text-sm">
          <li>
            One FHE key encrypts everything, its secret split across{' '}
            {r.trust.kmsNodes} nodes: {KMS_OPERATORS}.
          </li>
          <li>
            <mark>
              Any {r.trust.publicThreshold} can decrypt the whole history,
              undetectably.
            </mark>
          </li>
          <li>
            {r.trust.coprocessors === 1
              ? 'One coprocessor, run by Zama,'
              : `${r.trust.coprocessors} coprocessors`}{' '}
            computes every result.
          </li>
        </ul>
      </Section>
      <Section title="Delegations" note="who else an account lets decrypt it">
        {r.delegates.length === 0 ? (
          <Muted>No delegations.</Muted>
        ) : (
          <table className="stack w-full text-left text-xs">
            <thead style={{ color: 'var(--muted)' }}>
              <tr>
                <th className="py-1 font-normal">Delegate</th>
                <th className="py-1 text-right font-normal">Accounts</th>
                <th className="py-1 text-right font-normal">Contracts</th>
                <th className="py-1 text-right font-normal">Active</th>
                <th className="py-1 text-right font-normal">Wildcard</th>
                <th className="py-1 font-normal">Since</th>
                <th
                  className="py-1 text-right font-normal"
                  title="user decryption requests this address sent to the Gateway"
                >
                  Decryptions
                </th>
                <th
                  className="py-1 text-right font-normal"
                  title="accounts whose balance handles it asked the KMS to decrypt, from the Gateway's log"
                >
                  Balances read
                </th>
              </tr>
            </thead>
            <tbody>
              {r.delegates.map((d) => (
                <tr key={d.delegate} className="row hairline border-t">
                  <td className="py-1">
                    <Address address={d.delegate} />
                  </td>
                  <td className="mono py-1 text-right">{d.delegators}</td>
                  <td className="mono py-1 text-right">{d.contracts}</td>
                  <td className="mono py-1 text-right">{d.active}</td>
                  <td className="mono py-1 text-right">{d.wildcard || ''}</td>
                  <td className="mono py-1">
                    {day(d.first)}
                    {day(d.last) !== day(d.first) && ` – ${day(d.last)}`}
                  </td>
                  <td className="mono py-1 text-right">
                    {d.userDecryptions || ''}
                  </td>
                  <td className="mono py-1 text-right">
                    {d.viewedAccounts || ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
      <Section
        title="Observers"
        note="the token owner can appoint them, for all balances"
      >
        {r.observers.length === 0 ? (
          <Muted>None so far; the owner can add one without delay.</Muted>
        ) : (
          r.observers.map((o) => (
            <div key={`${o.token}:${o.observer}`} className="text-sm">
              <Address address={o.observer} /> on <Address address={o.token} />{' '}
              since {day(o.added)}
              {o.removed && `, removed ${day(o.removed)}`}
            </div>
          ))
        )}
      </Section>
      <Section
        title="Requests"
        note="user decryptions on the Zama Gateway, a public chain"
      >
        <table className="stack w-full text-left text-xs">
          <thead style={{ color: 'var(--muted)' }}>
            <tr>
              <th className="py-1 font-normal">Address</th>
              <th className="py-1 text-right font-normal">Requests</th>
              <th className="py-1 text-right font-normal">Handles</th>
              <th
                className="py-1 text-right font-normal"
                title="distinct public keys: one key across requests links them"
              >
                Keys
              </th>
              <th className="py-1 font-normal">Last</th>
            </tr>
          </thead>
          <tbody>
            {r.decryptors.map((d) => (
              <tr key={d.user} className="row hairline border-t">
                <td className="py-1">
                  <Address address={d.user} />
                </td>
                <td className="mono py-1 text-right">
                  {d.requests.toLocaleString('en-US')}
                </td>
                <td className="mono py-1 text-right">
                  {d.handles.toLocaleString('en-US')}
                </td>
                <td className="mono py-1 text-right">{d.keys}</td>
                <td className="mono py-1">{day(d.last)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs" style={{ color: 'var(--muted)' }}>
          {plural(r.decryptors.length, 'busiest address', 'busiest addresses')}.
          Each request names who looked at which balance, and when.
        </p>
      </Section>
    </>
  )
}
