import { all, type Db, handleId, one } from '../db'
import { wordBig } from '../eth/rpc'
import { KNOWN, Op, TOPICS } from '../protocol'
import { topicAddr, topicNum, words } from './hubs'
import { amounts, tokens } from './queries'
import type {
  Amount,
  BatchRow,
  HubDetail,
  IntentRow,
  PriceLevel,
} from './types'

/** Rows of a hub view: the newest batches, intents, price levels */
const MAX_ROWS = 60

/** What one pooling contract makes public about the funds that meet in it */
export function hubDetail(db: Db, address: string): HubDetail | undefined {
  const a = address.toLowerCase()
  const hub = one<{
    kind: string
    name: string | null
    counterparties: number
  }>(db, 'select kind, name, counterparties from hub where address = ?', a)
  const logs = all<{
    topic0: string
    topics: string
    data: string
    tx: number
    time: number
  }>(
    db,
    'select topic0, topics, data, tx, time from hub_log where address = ? order by block, log',
    a,
  )
  if (!hub && logs.length === 0 && !KNOWN[a]) return undefined
  const sym = new Map(tokens(db).map((t) => [t.address, t.symbol]))
  const major = (sql: string) => one<{ token: string }>(db, sql, a)?.token
  const fromToken = major(
    `select token from xfer where dst = ? and src <> '0x0000000000000000000000000000000000000000'
     group by token order by count(*) desc limit 1`,
  )
  // what it pays out, besides refunds in the token it collects
  const toToken =
    one<{ token: string }>(
      db,
      `select token from xfer where src = ? and dst <> '0x0000000000000000000000000000000000000000'
       and token <> ? group by token order by count(*) desc limit 1`,
      a,
      fromToken ?? '',
    )?.token ?? fromToken
  const detail: HubDetail = {
    address: a,
    kind: hub?.kind ?? null,
    name:
      hub?.name ??
      one<{ name: string | null }>(
        db,
        'select name from account where address = ?',
        a,
      )?.name ??
      null,
    label: KNOWN[a]?.label,
    counterparties: hub?.counterparties ?? 0,
    fromSymbol: fromToken ? sym.get(fromToken) : undefined,
    toSymbol: toToken ? sym.get(toToken) : undefined,
  }
  const has = (topic: string) => logs.some((l) => l.topic0 === topic)
  if (has(TOPICS.Joined)) detail.batches = batches(db, a, logs)
  if (has(TOPICS.BidSubmitted)) detail.auction = auction(db, a, logs)
  if (has(TOPICS.IntentCreated) || has(TOPICS.IntentSettled)) {
    detail.intents = intents(db, logs)
  }
  // an auction holding wallet: show the auction it serves
  if (!detail.auction && detail.name === 'AuctionWallet') {
    const auctionAddress = '0x04a5b8c32f9c38092b008a4939f1f91d550c4345'
    detail.auction = auction(
      db,
      auctionAddress,
      all(
        db,
        'select topic0, topics, data, tx, time from hub_log where address = ? order by block, log',
        auctionAddress,
      ),
    )
  }
  return detail
}

/** A member's deposit in a batch: the sum of its joins */
function deposit(joins: Amount[]): Amount {
  if (joins.length === 1) return joins[0] as Amount
  const lo = joins.reduce((a, j) => a + BigInt(j.lo), 0n)
  if (joins.some((j) => j.hi === undefined)) return { lo: String(lo) }
  const hi = joins.reduce((a, j) => a + BigInt(j.hi ?? 0), 0n)
  // a sum nobody published
  return lo === hi
    ? { lo: String(lo), hi: String(hi), source: 'inferred' }
    : { lo: String(lo), hi: String(hi) }
}

type HubLog = {
  topic0: string
  topics: string
  data: string
  tx: number
  time: number
}

function batches(db: Db, batcher: string, logs: HubLog[]): BatchRow[] {
  const byId = new Map<number, BatchRow>()
  const handles: number[] = []
  const handleOf = (hex: string) => {
    const id = handleId(db, hex) ?? -1
    handles.push(id)
    return id
  }
  const raw = new Map<
    number,
    {
      joined: number[]
      members: Map<
        string,
        {
          /** every join: its deposit is their sum */
          joins: number[]
          joinHex: string
          claim?: number
          claimHex?: string
          quit?: number
        }
      >
    }
  >()
  const batch = (id: number, time: number) => {
    let b = byId.get(id)
    if (!b) {
      b = { id, state: 'open', members: [], time }
      byId.set(id, b)
      raw.set(id, { joined: [], members: new Map() })
    }
    return b
  }
  const dispatchTx = new Map<number, number>()
  for (const l of logs) {
    const t = l.topics.split(',')
    const id = topicNum(t[0])
    switch (l.topic0) {
      case TOPICS.Joined: {
        batch(id, l.time)
        const account = topicAddr(t[1])
        const hex = words(l.data)[0] ?? ''
        const m = raw.get(id)?.members
        // a member can join a batch several times; each adds to its deposit
        const prev = m?.get(account)
        m?.set(account, {
          ...prev,
          joins: [...(prev?.joins ?? []), handleOf(hex)],
          joinHex: hex,
        })
        break
      }
      case TOPICS.Claimed: {
        batch(id, l.time)
        const account = topicAddr(t[1])
        const hex = words(l.data)[0] ?? ''
        const m = raw.get(id)?.members
        const e = m?.get(account)
        if (e && m)
          m.set(account, { ...e, claim: handleOf(hex), claimHex: hex })
        break
      }
      case TOPICS.Quit: {
        batch(id, l.time)
        const account = topicAddr(t[1])
        const e = raw.get(id)?.members.get(account)
        if (e) e.quit = handleOf(words(l.data)[0] ?? '')
        break
      }
      case TOPICS.BatchDispatched: {
        const b = batch(id, l.time)
        b.state = 'dispatched'
        dispatchTx.set(id, l.tx)
        break
      }
      case TOPICS.BatchFinalized: {
        const b = batch(id, l.time)
        b.state = 'finalized'
        b.rate = wordBig(words(l.data)[0] ?? '').toString()
        break
      }
      case TOPICS.BatchCanceled: {
        batch(id, l.time).state = 'canceled'
        break
      }
    }
  }
  // the batch total: what the batcher unwrapped in the dispatch transaction
  const totals = new Map<number, number>()
  for (const [id, tx] of dispatchTx) {
    const u = one<{ handle: number }>(
      db,
      'select handle from unwrap where burner = ? and tx = ?',
      batcher,
      tx,
    )
    if (u) {
      totals.set(id, u.handle)
      handles.push(u.handle)
    }
  }
  const amt = amounts(db, handles)
  const rows = [...byId.values()].sort((x, y) => y.id - x.id).slice(0, MAX_ROWS)
  for (const b of rows) {
    const r = raw.get(b.id)
    b.members = [...(r?.members.entries() ?? [])].map(([account, m]) => ({
      account,
      joined: deposit(m.joins.map((j) => amt.get(j) ?? { lo: '0' })),
      joinHandle: m.joinHex,
      claimed: m.claim !== undefined ? amt.get(m.claim) : undefined,
      claimHandle: m.claimHex,
      quit: m.quit !== undefined ? amt.get(m.quit) : undefined,
    }))
    const t = totals.get(b.id)
    if (t !== undefined) b.total = amt.get(t)
  }
  return rows
}

interface Bid {
  bidder: string
  price: string
  paid: number
  paidHex: string
  canceled: boolean
}

function auction(
  db: Db,
  address: string,
  logs: HubLog[],
): HubDetail['auction'] {
  const bids = new Map<number, Bid>()
  const revealed = new Map<string, string>()
  let settlementPrice: string | null = null
  let allocated: string | null = null
  let winners = 0
  const handles: number[] = []
  for (const l of logs) {
    const t = l.topics.split(',')
    const w = words(l.data)
    switch (l.topic0) {
      case TOPICS.BidSubmitted: {
        const paidHex = w[2] ?? ''
        const paid = handleId(db, paidHex) ?? -1
        handles.push(paid)
        bids.set(topicNum(t[0]), {
          bidder: topicAddr(t[1]),
          price: wordBig(w[1] ?? '').toString(),
          paid,
          paidHex,
          canceled: false,
        })
        break
      }
      case TOPICS.BidCanceled: {
        const b = bids.get(topicNum(t[0]))
        if (b) b.canceled = true
        break
      }
      case TOPICS.PriceLevelRevealed:
        revealed.set(
          wordBig((t[0] ?? '').slice(2)).toString(),
          wordBig(w[0] ?? '').toString(),
        )
        break
      case TOPICS.AuctionSettled:
        settlementPrice = wordBig(w[0] ?? '').toString()
        allocated = wordBig(w[1] ?? '').toString()
        break
      case TOPICS.ZamaTokenDistributed:
        winners++
        break
    }
  }
  const amt = amounts(db, handles)
  const byPrice = new Map<string, Bid[]>()
  for (const b of bids.values()) {
    if (b.canceled) continue
    byPrice.set(b.price, [...(byPrice.get(b.price) ?? []), b])
  }
  const levels: PriceLevel[] = [...byPrice.entries()]
    .map(([price, list]) => {
      const first = list[0]
      return {
        price,
        total: revealed.get(price) ?? null,
        bids: list.length,
        bidders: new Set(list.map((b) => b.bidder)).size,
        solo:
          list.length === 1 && first
            ? {
                bidder: first.bidder,
                paid: amt.get(first.paid) ?? { lo: '0' },
                paidHandle: first.paidHex,
                external: !!one(
                  db,
                  'select 1 from op where r = ? and kind = ?',
                  first.paid,
                  Op.Trivial,
                ),
              }
            : undefined,
      }
    })
    .sort((x, y) => Number(BigInt(y.price) - BigInt(x.price)))
  return {
    address,
    bids: bids.size,
    bidders: new Set([...bids.values()].map((b) => b.bidder)).size,
    canceled: [...bids.values()].filter((b) => b.canceled).length,
    settlementPrice,
    allocated,
    winners,
    levels,
  }
}

/** Static tuples of (pairId, direction, flag, assetIn, assetOut, eAmountIn) */
function orders(data: string): { assetIn: string; assetOut: string }[] {
  const w = words(data)
  const offset = Number(wordBig(w[0] ?? '')) / 32
  const n = Number(wordBig(w[offset] ?? ''))
  const out: { assetIn: string; assetOut: string }[] = []
  for (let i = 0; i < n; i++) {
    const base = offset + 1 + i * 6
    out.push({
      assetIn: `0x${(w[base + 3] ?? '').slice(24)}`,
      assetOut: `0x${(w[base + 4] ?? '').slice(24)}`,
    })
  }
  return out
}

/** (address[] assets, bytes32[] amounts) at the offsets in words i and j */
function assetAmounts(data: string, i: number, j: number) {
  const w = words(data)
  const list = (k: number) => {
    const at = Number(wordBig(w[k] ?? '')) / 32
    const n = Number(wordBig(w[at] ?? ''))
    return w.slice(at + 1, at + 1 + n)
  }
  const assets = list(i).map((x) => `0x${x.slice(24)}`)
  const handles = list(j)
  return assets.map((asset, k) => ({ asset, handle: handles[k] ?? '' }))
}

function intents(db: Db, logs: HubLog[]): IntentRow[] {
  const rows = new Map<string, IntentRow>()
  const pending: {
    row: IntentRow
    legs: { asset: string; handle: string }[]
  }[] = []
  for (const l of logs) {
    const t = l.topics.split(',')
    const id = wordBig((t[0] ?? '').slice(2)).toString()
    if (l.topic0 === TOPICS.IntentCreated) {
      rows.set(id, {
        id,
        maker: topicAddr(t[1]),
        time: l.time,
        candidates: orders(l.data),
        outcome: 'open',
        legs: [],
      })
    } else if (l.topic0 === TOPICS.IntentSettled) {
      // (eSucceed, assets[], eAmountIns[], eAmountOuts[]); maker, taker indexed
      const row = rows.get(id)
      if (!row) continue
      row.outcome = 'settled'
      row.taker = topicAddr(t[2])
      pending.push({ row, legs: assetAmounts(l.data, 1, 2) })
    } else if (l.topic0 === TOPICS.IntentReclaimed) {
      // (eSucceed, assets[], eTransferred[]); maker indexed
      const row = rows.get(id)
      if (!row) continue
      row.outcome = 'reclaimed'
      pending.push({ row, legs: assetAmounts(l.data, 1, 2) })
    }
  }
  const ids = pending.flatMap((p) =>
    p.legs.map((l) => handleId(db, l.handle) ?? -1),
  )
  const amt = amounts(db, ids)
  for (const p of pending) {
    p.row.legs = p.legs.map((l) => ({
      asset: l.asset,
      handle: l.handle,
      amount: amt.get(handleId(db, l.handle) ?? -1) ?? { lo: '0' },
    }))
  }
  return [...rows.values()].sort((x, y) => y.time - x.time).slice(0, MAX_ROWS)
}
