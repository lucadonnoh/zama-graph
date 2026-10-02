import { useEffect, useState } from 'react'
import type { TokenDetail } from '../../src/graph/types'
import { api } from './api'
import { plural, units } from './format'
import { Amount, Handle, Muted, Section } from './ui'

/**
 * A confidential token: what went in and out in clear, and its total
 * supply, which the token keeps encrypted and the public data pins anyway
 */
export function TokenPanel({ address }: { address: string }) {
  const [d, setD] = useState<TokenDetail>()
  useEffect(() => {
    api
      .token(address)
      .then(setD)
      .catch(() => undefined)
  }, [address])
  if (!d) return null
  const t = d.token
  const width =
    d.supply?.amount.hi !== undefined
      ? BigInt(d.supply.amount.hi) - BigInt(d.supply.amount.lo)
      : undefined
  return (
    <Section
      title={t.symbol}
      note={`wraps ${t.uSymbol ?? t.underlying} · rate ${t.rate} · ${t.decimals} decimals`}
    >
      <div className="grid gap-1 text-sm">
        <div>
          <Muted>in: </Muted>
          {plural(d.wraps.count, 'wrap')},{' '}
          <span className="mono">{units(d.wraps.amount)}</span> {t.symbol} in
          clear
        </div>
        <div>
          <Muted>out: </Muted>
          {plural(d.unwraps.count, 'unwrap')},{' '}
          <span className="mono">{units(d.unwraps.finalized)}</span> {t.symbol}{' '}
          finalized in clear
          {d.unwraps.pending > 0 && (
            <Muted>, {d.unwraps.pending} never finalized</Muted>
          )}
        </div>
        <div>
          <Muted>between: </Muted>
          {plural(d.transfers, 'confidential transfer')},{' '}
          {plural(d.holders, 'holder')}
        </div>
        {d.supply && (
          <div>
            <Muted>supply: </Muted>
            <Amount a={d.supply.amount} symbol={t.symbol} />{' '}
            <Handle h={d.supply.handle} />
            {width !== undefined && width > 0n && (
              <Muted> · within {units(width)}</Muted>
            )}
          </div>
        )}
        {d.escrow && (
          <div>
            <Muted>escrow, in clear: </Muted>
            <span className="mono">{units(d.escrow)}</span> {t.symbol}{' '}
            <Muted>(incl. pending unwraps)</Muted>
          </div>
        )}
      </div>
    </Section>
  )
}
