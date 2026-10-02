import { all, type Db, one, setSync } from '../db'
import { WILDCARD } from '../protocol'
import { MAX64, ZERO } from './model'
import type { Stats, TokenStats } from './types'

/**
 * The scoreboard: over all confidential tokens, how much of what is
 * "confidential" the public data reveals. Stored for the API by every
 * derive run.
 */
export function deriveStats(db: Db): Stats {
  const xfers = all<{
    token: string
    src: string
    dst: string
    lo: string | null
    hi: string | null
  }>(
    db,
    `select x.token, x.src, x.dst, b.lo, b.hi from xfer x
     left join bound b on b.handle = x.amount`,
  )
  const symbols = new Map(
    all<{ address: string; symbol: string }>(
      db,
      'select address, symbol from token order by since_block',
    ).map((t) => [t.address, t.symbol]),
  )
  const byToken = new Map<string, TokenStats>()
  for (const [token, symbol] of symbols) {
    byToken.set(token, {
      token,
      symbol,
      transfers: 0,
      exact: 0,
      wraps: 0,
      unwraps: 0,
      holders: 0,
    })
  }
  const transfers = { total: 0, exact: 0, zero: 0, narrow: 0, bounded: 0 }
  const accounts = new Set<string>()
  for (const x of xfers) {
    const t = byToken.get(x.token)
    if (x.src !== ZERO) accounts.add(x.src)
    if (x.dst !== ZERO) accounts.add(x.dst)
    if (x.src === ZERO) {
      if (t) t.wraps++
      continue
    }
    if (x.dst === ZERO) {
      if (t) t.unwraps++
      continue
    }
    const lo = x.lo === null ? 0n : BigInt(x.lo)
    const hi = x.hi === null ? MAX64 : BigInt(x.hi)
    transfers.total++
    if (t) t.transfers++
    if (lo === hi) {
      transfers.exact++
      if (t) t.exact++
      if (lo === 0n) transfers.zero++
    } else if (lo > 0n && hi <= 2n * lo) transfers.narrow++
    else transfers.bounded++
  }

  const unwrapRows = all<{ fin: number; lo: string | null; hi: string | null }>(
    db,
    `select u.fin_tx is not null fin, b.lo, b.hi from unwrap u
     left join bound b on b.handle = u.handle`,
  )
  const unwraps = {
    total: unwrapRows.length,
    finalized: 0,
    pendingKnown: 0,
    pendingDecryptable: 0,
  }
  for (const u of unwrapRows) {
    if (u.fin) unwraps.finalized++
    else if (u.lo !== null && u.lo === u.hi) unwraps.pendingKnown++
    else unwraps.pendingDecryptable++
  }

  // the latest balance handle of every (token, account)
  const balances = { accounts: 0, exact: 0, zero: 0 }
  const latest = all<{
    token: string
    account: string
    lo: string | null
    hi: string | null
  }>(
    db,
    `with e as (
       select token, dst account, dst_bal h, block, log from xfer where dst <> ?1 and dst_bal is not null
       union all select token, src, src_bal, block, log from xfer where src <> ?1 and src_bal is not null
     ), last as (
       select token, account, h, row_number() over (partition by token, account order by block desc, log desc) n from e
     )
     select l.token, l.account, b.lo, b.hi from last l left join bound b on b.handle = l.h where l.n = 1`,
    ZERO,
  )
  for (const b of latest) {
    balances.accounts++
    const t = byToken.get(b.token)
    if (b.lo !== null && b.lo === b.hi) {
      balances.exact++
      if (b.lo === '0') balances.zero++
      else if (t) t.holders++
    } else if (t) t.holders++
  }

  const traced = all<{
    origin: string
    lo: string
    sender: string | null
    sender_min: string | null
    burner: string
    receiver: string
  }>(db, 'select origin, lo, sender, sender_min, burner, receiver from trace')
  const links = { traced: 0, oneDepositor: 0, self: 0, viaHub: 0, several: 0 }
  for (const t of traced) {
    if (t.origin === 'empty') continue
    links.traced++
    if (t.sender_min !== null && t.sender_min === t.lo && t.lo !== '0') {
      links.oneDepositor++
      if (t.sender === t.burner || t.sender === t.receiver) links.self++
    } else if (t.origin === 'hub') links.viaHub++
    else links.several++
  }

  const now = Math.floor(Date.now() / 1000)
  const delegations = all<{
    delegator: string
    delegate: string
    contract: string
    expiry: string | null
  }>(
    db,
    'select delegator, delegate, contract, expiry from delegation order by block, log',
  )
  const active = new Map<string, (typeof delegations)[number]>()
  for (const d of delegations) {
    active.set(`${d.delegator}:${d.delegate}:${d.contract}`, d)
  }
  const live = [...active.values()].filter(
    (d) => d.expiry !== null && BigInt(d.expiry) > BigInt(now),
  )
  const count = (sql: string) => one<{ n: number }>(db, sql)?.n ?? 0
  const routerTxs = all<{ legs: number; zero: number }>(
    db,
    `select count(*) legs, sum(b.lo = b.hi and b.lo = '0') zero from xfer x
     left join bound b on b.handle = x.amount
     where x.src in (select address from hub where kind = 'router')
       and x.dst in (select address from hub where kind = 'batcher')
     group by x.tx`,
  )
  const router = {
    deposits: routerTxs.filter((t) => t.legs > 1).length,
    revealed: routerTxs.filter((t) => t.legs > 1 && t.zero === t.legs - 1)
      .length,
    legs: routerTxs.reduce((a, t) => a + t.legs, 0),
    zero: routerTxs.reduce((a, t) => a + t.zero, 0),
  }
  const named = new Set(
    all<{ address: string }>(
      db,
      'select address from name where ens is not null or gns is not null',
    ).map((r) => r.address),
  )
  const namedLinked = traced.filter(
    (t) =>
      t.sender_min !== null &&
      t.sender_min === t.lo &&
      t.lo !== '0' &&
      (named.has(t.burner) || named.has(t.receiver)),
  ).length
  const namedExact = new Set(
    latest
      .filter(
        (b) =>
          named.has(b.account) &&
          b.lo !== null &&
          b.lo === b.hi &&
          b.lo !== '0',
      )
      .map((b) => b.account),
  ).size
  const stats: Stats = {
    accounts: accounts.size,
    transfers,
    wraps: { total: count('select count(*) n from wrap') },
    unwraps,
    balances,
    links,
    readers: {
      delegations: live.length,
      delegates: new Set(live.map((d) => d.delegate)).size,
      wildcard: live.filter((d) => d.contract === WILDCARD).length,
      userDecryptions: count(
        'select count(*) n from gw_request where kind = 2',
      ),
    },
    gateway: {
      publicDecryptions: count(
        'select count(*) n from gw_request where kind = 1',
      ),
      userDecryptions: count(
        'select count(*) n from gw_request where kind = 2',
      ),
    },
    router,
    named: {
      accounts: [...named].filter((a) => accounts.has(a)).length,
      linked: namedLinked,
      exactBalance: namedExact,
    },
    byToken: [...byToken.values()].filter((t) => t.wraps > 0),
  }
  setSync(db, 'stats', JSON.stringify(stats))
  return stats
}
