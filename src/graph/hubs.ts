import { all, type Db, transaction } from '../db'
import { KNOWN, TOPICS } from '../protocol'
import { ZERO } from './model'
import type { Mode } from './traces'

/**
 * A contract with this many counterparties pools the funds of unrelated
 * users. A smart wallet has one or a few.
 */
export const HUB_MIN_COUNTERPARTIES = 10

export type HubKind = 'batcher' | 'router' | 'auction' | 'swap' | 'contract'

/**
 * The vault router's legs, as a condition on `xfer x`: it sends one to
 * every vault's batcher to hide which one a user picked
 */
export const ROUTER_LEGS = `x.src in (select address from hub where kind = 'router')
  and x.dst in (select address from hub where kind = 'batcher')`

/**
 * The router deposits whose legs are all provably zero but one, which
 * makes the vault the user picked public, as a query for their tx ids
 */
export const ROUTER_REVEALED = `select x.tx from xfer x
  left join bound b on b.handle = x.amount
  where ${ROUTER_LEGS}
  group by x.tx
  having count(*) > 1 and sum(b.lo = b.hi and b.lo = '0') = count(*) - 1`

export interface Hub {
  address: string
  kind: HubKind
  name: string | null
  counterparties: number
}

/**
 * Pools that keep an account per member and only ever return a member what
 * it paid in, so that what a member gets back can be followed to its own
 * payments:
 *
 * - the ZAMA auction's wallets refund a bidder its cancelled bids and what
 *   its bids paid beyond its allocation (AuctionToken: refundUser,
 *   finalizeRefund); they also pay the sale proceeds to the treasury, which
 *   never paid in, so a return only counts as one to an account that paid
 *   the wallet before;
 * - a vault batcher, in the token it collects, gives back only a member's own
 *   deposit (quit, recover, the refund of a failed join). A member that ever
 *   joined through someone else (the vault router joins on behalf of its
 *   caller) is left out: its deposits did not come from itself.
 */
export interface Pools {
  has(pool: string): boolean
  member(pool: string, token: string, account: string): boolean
}

export function memberPools(db: Db): Pools {
  // the wallets bids are paid into (and their verified name, where known)
  const auction = new Set(
    all<{ address: string }>(
      db,
      `select address from account where kind = 'contract' and name = 'AuctionWallet'
       union select distinct x.dst from xfer x join hub_log h on h.tx = x.tx
       where h.topic0 = ?1 and x.src <> ?2 and x.dst <> ?2
         and x.dst in (select address from account where kind = 'contract')`,
      TOPICS.BidSubmitted,
      ZERO,
    ).map((r) => r.address),
  )
  const batchers = new Map<string, { token: string; excluded: Set<string> }>()
  for (const b of all<{ address: string }>(
    db,
    "select address from hub where kind = 'batcher'",
  )) {
    const token = all<{ token: string }>(
      db,
      `select token from xfer where dst = ? and src <> ?
       group by token order by count(*) desc limit 1`,
      b.address,
      ZERO,
    )[0]?.token
    if (!token) continue
    const excluded = new Set(
      all<{ account: string }>(
        db,
        `select distinct '0x' || substr(h.topics, 94, 40) account from hub_log h
         where h.address = ?1 and h.topic0 = ?2 and not exists (
           select 1 from xfer x where x.tx = h.tx and x.dst = ?1
             and x.src = '0x' || substr(h.topics, 94, 40) and x.token = ?3
         )`,
        b.address,
        TOPICS.Joined,
        token,
      ).map((r) => r.account),
    )
    batchers.set(b.address, { token, excluded })
  }
  return {
    has: (pool) => auction.has(pool) || batchers.has(pool),
    member: (pool, token, account) => {
      if (auction.has(pool)) return true
      const b = batchers.get(pool)
      return !!b && b.token === token && !b.excluded.has(account)
    },
  }
}

/**
 * How a history walk treats each address: the vault router is walked
 * through (its balance is provably empty after each of its transactions);
 * a member pool is followed through a member's own payments; every other
 * hub is a stop.
 */
export function hubModes(
  hubs: Iterable<Hub>,
  pools: Pools,
): (address: string) => Mode {
  const modes = new Map<string, Mode>()
  for (const h of hubs) {
    modes.set(
      h.address,
      h.kind === 'router' ? 'enter' : pools.has(h.address) ? 'member' : 'stop',
    )
  }
  return (a) => modes.get(a) ?? (pools.has(a) ? 'member' : 'enter')
}

/**
 * The contracts where many users' funds meet: vault batchers, the vault
 * router, the ZAMA auction and its holding wallets, the swap, and any other
 * contract with many counterparties. A trace does not walk through them:
 * their events still name who put in and who took out, but which deposit
 * paid for which withdrawal is decided inside them, in FHE.
 */
export function deriveHubs(db: Db): Map<string, Hub> {
  db.exec(`create table if not exists hub (
    address text primary key,
    kind text not null,
    name text,
    counterparties integer not null
  )`)
  const counts = all<{ address: string; n: number; name: string | null }>(
    db,
    `select a.address, a.name, count(distinct p.other) n from account a
     join (
       select src address, dst other from xfer where src <> ?1 and dst <> ?1
       union all select dst, src from xfer where src <> ?1 and dst <> ?1
     ) p on p.address = a.address
     where a.kind = 'contract'
     group by a.address`,
    ZERO,
  )
  const byTopic = (topic: string) =>
    new Set(
      all<{ address: string }>(
        db,
        'select distinct address from hub_log where topic0 = ?',
        topic,
      ).map((r) => r.address),
    )
  const batchers = byTopic(TOPICS.Joined)
  const auctions = byTopic(TOPICS.BidSubmitted)
  const swaps = byTopic(TOPICS.IntentCreated)
  const hubs = new Map<string, Hub>()
  for (const c of counts) {
    const kind: HubKind = batchers.has(c.address)
      ? 'batcher'
      : auctions.has(c.address)
        ? 'auction'
        : swaps.has(c.address)
          ? 'swap'
          : /router/i.test(KNOWN[c.address]?.label ?? '')
            ? 'router'
            : 'contract'
    if (kind === 'contract' && c.n < HUB_MIN_COUNTERPARTIES) continue
    hubs.set(c.address, {
      address: c.address,
      kind,
      name: c.name,
      counterparties: c.n,
    })
  }
  transaction(db, () => {
    db.exec('delete from hub')
    const ins = db.prepare(
      'insert into hub (address, kind, name, counterparties) values (?, ?, ?, ?)',
    )
    for (const h of hubs.values()) {
      ins.run(h.address, h.kind, h.name, h.counterparties)
    }
  })
  return hubs
}
