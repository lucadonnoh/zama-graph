import { type ReactNode, useState } from 'react'
import type { Link, LinkedUnwrap } from '../../src/graph/types'
import { day, plural, units } from './format'
import { Address, Muted, Section } from './ui'

/** Height of one row and the band's distance to the boxes' edges */
const ROW = 44
const INSET = 6
/** Rows shown before "expand all" */
const ROWS = 5

/**
 * The withdrawals a page's address or transaction is part of, each drawn as
 * the unwrap page draws a full link: the depositor, a yellow band, the
 * withdrawal. The band leads to the unwrap's page.
 */
export function Linked({
  linked,
  here,
  through,
  partial,
}: {
  linked: { total: number; rows: LinkedUnwrap[] }
  /** the page's address; a transaction page passes none */
  here?: string
  /** how a transaction page's transaction takes part */
  through?: string
  /** links that are proven only in part */
  partial?: ReactNode
}) {
  const [all, setAll] = useState(false)
  if (linked.total === 0 && !partial) return null
  const shown = all ? linked.rows : linked.rows.slice(0, ROWS)
  return (
    <Section
      title="Links"
      note={
        linked.total > 0
          ? `part of ${plural(linked.total, 'linked unwrap')}`
          : undefined
      }
    >
      <div className="grid gap-2">
        {shown.map((l) => (
          <LinkRow key={l.handle} l={l} here={here} through={through} />
        ))}
        {!all && linked.rows.length > ROWS && (
          <div>
            <button
              type="button"
              className="toggle text-xs"
              onClick={() => setAll(true)}
            >
              expand all{' '}
              {linked.total > linked.rows.length
                ? `${linked.rows.length} newest`
                : linked.rows.length}
            </button>
          </div>
        )}
        {partial}
      </div>
    </Section>
  )
}

function Box({ color, children }: { color: string; children: ReactNode }) {
  return (
    <div
      className="flex flex-col justify-center overflow-hidden rounded-md px-2 text-xs"
      style={{
        height: ROW,
        border: `1.5px solid ${color}`,
        background: 'var(--surface)',
      }}
    >
      {children}
    </div>
  )
}

const THIS = <span className="chip chip-strong">this address</span>

function LinkRow({
  l,
  here,
  through = 'via this tx',
}: {
  l: LinkedUnwrap
  here?: string
  through?: string
}) {
  const self = l.depositor === l.burner || l.depositor === l.receiver
  const via =
    l.role === 'path' ? (here ? 'via this address' : through) : undefined
  return (
    <div
      className="grid max-w-[760px]"
      style={{
        gridTemplateColumns:
          'minmax(0, 15rem) minmax(48px, 1fr) minmax(0, 15rem)',
      }}
    >
      <Box color="var(--deposit)">
        <div className="truncate">
          {here && l.depositor === here ? (
            THIS
          ) : (
            <Address address={l.depositor} />
          )}
        </div>
        <div className="truncate" style={{ color: 'var(--muted)' }}>
          {self ? 'its own deposits' : 'deposits'}
        </div>
      </Box>
      <a
        href={`#unwrap/${l.handle}`}
        className="flex items-center justify-center gap-1 overflow-hidden whitespace-nowrap text-xs font-semibold"
        style={{
          margin: `${INSET}px 0`,
          background: 'var(--zama)',
          color: 'var(--on-zama)',
        }}
        title="this unwrap: where it came from, and its history"
      >
        100%
        {via && <span className="font-normal">· {via}</span>}
        {l.via.length > 0 && <span className="font-normal">· via pool</span>}
      </a>
      <Box color="var(--withdrawal)">
        <div className="truncate">
          <a href={`#unwrap/${l.handle}`} className="mono">
            {units(l.amount)}
          </a>{' '}
          <Muted>{l.symbol}</Muted> <Muted>· {day(l.time)}</Muted>
        </div>
        <div className="truncate">
          {here && l.burner === here ? (
            <>
              <Muted>unwrapped by </Muted>
              {THIS}
            </>
          ) : here && l.receiver === here ? (
            <>
              <Muted>unwrapped to </Muted>
              {THIS}
            </>
          ) : (
            <>
              <Muted>unwrapped by </Muted>
              <Address address={l.burner} />
            </>
          )}
        </div>
      </Box>
    </div>
  )
}

/** Links proven only in part, one line each way */
export function PartialLinks({
  fundedBy,
  funded,
  here,
  symbolOf,
}: {
  fundedBy: Link[]
  funded: Link[]
  here: string
  symbolOf: (token: string) => string
}) {
  if (fundedBy.length === 0 && funded.length === 0) return null
  const line = (links: Link[]) =>
    links.slice(0, 12).map((l, i) => (
      <span key={`${l.address}:${l.token}`}>
        {i > 0 && <Muted> · </Muted>}
        {l.address === here ? (
          <span className="chip chip-strong">itself</span>
        ) : (
          <Address address={l.address} />
        )}
        <span className="mono" style={{ color: 'var(--muted)' }}>
          {' '}
          {l.withdrawals === 1 ? '' : `${l.withdrawals}× `}≥ {units(l.min)}{' '}
          {symbolOf(l.token)}
        </span>
      </span>
    ))
  return (
    <div className="grid gap-1 text-xs">
      {fundedBy.length > 0 && (
        <div>
          <Muted>partly funded by </Muted>
          {line(fundedBy)}
        </div>
      )}
      {funded.length > 0 && (
        <div>
          <Muted>partly funded unwraps of </Muted>
          {line(funded)}
        </div>
      )}
    </div>
  )
}
