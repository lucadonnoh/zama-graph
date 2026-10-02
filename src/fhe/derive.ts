import { all, type Db, setSync, transaction } from '../db'
import { memberPools, type Pools } from '../graph/hubs'
import { log } from '../log'
import { Op } from '../protocol'
import {
  type DagOp,
  type Fact,
  ledgerPairs,
  propagate,
  type Result,
} from './bounds'

export interface DeriveStats {
  /** the last block whose transfers this run covered */
  block: number
  ops: number
  handles: number
  facts: number
  caps: number
  pairs: number
  rounds: number
  contradictions: number
  ms: number
}

const ZERO = '0x0000000000000000000000000000000000000000'
const MAX64 = (1n << 64n) - 1n

/**
 * Runs the propagation over every indexed FHE operation with every clear
 * value as a fact, stores the bounds it finds, and links every transfer to
 * the balance handles it produced (`xfer.src_bal`, `xfer.dst_bal`).
 *
 * Two passes. The second adds one more fact per transfer: no amount and no
 * balance of a token exceeds its total supply at that moment, which is at
 * most what was minted so far (bounded by the first pass) minus what was
 * provably burned. Without it, bounds feed back through accounts that pass
 * funds around (a bid, a refund, a bid again) and grow without limit.
 */
export function deriveBounds(db: Db): DeriveStats {
  const started = Date.now()
  const rows = all<{
    kind: number
    a: number | null
    b: number | null
    c: number | null
    k: string | null
    r: number
    tx: number
    caller: string
  }>(
    db,
    `select o.kind, o.a, o.b, o.c, o.k, o.r, o.tx, c.address caller
     from op o join caller c on c.id = o.caller order by o.block, o.log`,
  )
  const ops: DagOp[] = rows.map((o) => ({
    kind: o.kind as Op,
    a: o.a,
    b: o.b,
    c: o.c,
    k: o.k === null ? null : BigInt(o.k),
    r: o.r,
  }))
  const maxId =
    all<{ m: number }>(db, 'select max(id) m from handle')[0]?.m ?? 0
  const types = new Uint8Array(maxId + 1).fill(5)
  for (const h of all<{ id: number; t: string }>(
    db,
    'select id, hex(substr(h, 31, 1)) t from handle',
  )) {
    types[h.id] = Number.parseInt(h.t, 16)
  }

  // the balance handles of each transfer, from the operations alone
  const producer = new Int32Array(maxId + 1).fill(-1)
  ops.forEach((o, i) => {
    if ((producer[o.r] ?? -1) < 0) producer[o.r] = i
  })
  const zeros = new Array<bigint>(maxId + 1).fill(0n)
  const ones = new Array<bigint>(maxId + 1).fill(MAX64)
  const kept = new Map<number, number>()
  for (const p of ledgerPairs(ops, producer, zeros, ones)) {
    kept.set(p.sent, p.kept)
  }
  const credit = new Map<string, number>()
  rows.forEach((o) => {
    if (o.kind === Op.Add && o.b !== null) {
      const key = `${o.tx}:${o.caller}:${o.b}`
      if (!credit.has(key)) credit.set(key, o.r)
    }
  })
  /** an empty sender's debit: select(eq(x, 0), x, 0) keeps the zero */
  const emptyKept = (sent: number): number | undefined => {
    const p = producer[sent] ?? -1
    const s = p >= 0 ? ops[p] : undefined
    if (s?.kind !== Op.Select || s.a === null) return undefined
    const pc = producer[s.a] ?? -1
    const c = pc >= 0 ? ops[pc] : undefined
    if (c?.kind === Op.Eq && c.k === 0n && c.a === s.b) return s.c ?? undefined
    return undefined
  }
  const xfers = all<{
    block: number
    log: number
    tx: number
    token: string
    src: string
    dst: string
    amount: number
  }>(
    db,
    'select block, log, tx, token, src, dst, amount from xfer order by block, log',
  ).map((x) => ({
    ...x,
    srcBal: kept.get(x.amount) ?? emptyKept(x.amount),
    dstBal: credit.get(`${x.tx}:${x.token}:${x.amount}`),
  }))

  const facts: Fact[] = [
    ...all<{ handle: number; value: string }>(
      db,
      'select handle, value from clear',
    ),
    ...all<{ handle: number; value: string }>(
      db,
      'select handle, amount value from wrap',
    ),
  ].map((f) => ({
    handle: f.handle,
    lo: BigInt(f.value),
    hi: BigInt(f.value),
  }))

  const dispatched = batchTotals(db, xfers, ops, producer)
  const first = propagate(ops, types, facts, 40, dispatched)
  const caps = supplyCaps(xfers, first)
  const pools = poolBalances(xfers, first, memberPools(db))
  const rounds = Number(process.env.BOUNDS_ROUNDS ?? 40)
  const result = propagate(
    ops,
    types,
    [...facts, ...caps, ...pools],
    rounds,
    dispatched,
  )
  if (result.rounds > rounds)
    log('bounds did not converge', { rounds: result.rounds })
  if (result.contradictions > 0) {
    log('contradictions', { at: result.contradicted.slice(0, 20).join(',') })
  }

  const informative = (h: number) =>
    (result.lo[h] ?? 0n) > 0n ||
    (result.hi[h] ?? MAX64) < (types[h] === 0 ? 1n : MAX64)
  transaction(db, () => {
    const upd = db.prepare(
      'update xfer set src_bal = ?, dst_bal = ? where block = ? and log = ?',
    )
    for (const x of xfers) {
      upd.run(x.srcBal ?? null, x.dstBal ?? null, x.block, x.log)
    }
    db.exec('delete from bound')
    const ins = db.prepare(
      'insert into bound (handle, lo, hi) values (?, ?, ?)',
    )
    for (let h = 1; h <= maxId; h++) {
      if (informative(h)) {
        ins.run(h, String(result.lo[h]), String(result.hi[h]))
      }
    }
  })
  const stats: DeriveStats = {
    block: xfers.at(-1)?.block ?? 0,
    ops: ops.length,
    handles: maxId,
    facts: facts.length,
    caps: caps.length + pools.length,
    pairs: result.pairs,
    rounds: result.rounds,
    contradictions: first.contradictions + result.contradictions,
    ms: Date.now() - started,
  }
  setSync(db, 'bounds', JSON.stringify({ ...stats, at: Date.now() }))
  log('bounds', { ...stats })
  return stats
}

/**
 * Per token, in time order: what is in circulation at most, and a fact
 * capping every amount and balance of each transfer by it
 */
function supplyCaps(
  xfers: {
    token: string
    src: string
    dst: string
    amount: number
    srcBal: number | undefined
    dstBal: number | undefined
  }[],
  bounds: Result,
): Fact[] {
  const supply = new Map<string, bigint>()
  const facts: Fact[] = []
  for (const x of xfers) {
    let s = supply.get(x.token) ?? 0n
    if (x.src === ZERO) {
      const hi = bounds.hi[x.amount] ?? MAX64
      s = s + hi > MAX64 ? MAX64 : s + hi
      supply.set(x.token, s)
    }
    if (s >= MAX64) continue
    for (const h of [x.amount, x.srcBal, x.dstBal]) {
      if (h !== undefined) facts.push({ handle: h, lo: 0n, hi: s })
    }
    if (x.dst === ZERO) {
      const lo = bounds.lo[x.amount] ?? 0n
      supply.set(x.token, s > lo ? s - lo : 0n)
    }
  }
  return facts
}

/**
 * An upper bound for every balance of an account that dealt with a member
 * pool. A confidential balance is exactly the sum of the amounts the
 * account received minus those it sent (ERC-7984 `_update` moves the
 * transferred amount out of one balance and into the other), and what a
 * pool returned to the account never exceeds what the account paid into it.
 * So the pool's part of the sum is at most zero, which intervals added one
 * transfer at a time cannot see: a bidder who wrapped, bid, got refunds and
 * unwrapped what it wrapped holds exactly nothing.
 */
function poolBalances(
  xfers: {
    token: string
    src: string
    dst: string
    amount: number
    srcBal: number | undefined
    dstBal: number | undefined
  }[],
  bounds: Result,
  pools: Pools,
): Fact[] {
  const lo = (h: number) => bounds.lo[h] ?? 0n
  const hi = (h: number) => bounds.hi[h] ?? MAX64
  // accounts with a pool among their counterparties
  const members = new Set<string>()
  for (const x of xfers) {
    if (pools.member(x.dst, x.token, x.src)) members.add(`${x.token}:${x.src}`)
    if (pools.member(x.src, x.token, x.dst)) members.add(`${x.token}:${x.dst}`)
  }
  interface State {
    /** the sum of every other in and out, at most */
    other: bigint
    /** per pool: returns at most, payments at least */
    returned: Map<string, bigint>
    paid: Map<string, bigint>
  }
  const state = new Map<string, State>()
  const facts: Fact[] = []
  const bound = (st: State) => {
    let b = st.other
    // a pool's part is at most zero, and at most what the intervals allow
    for (const [pool, r] of st.returned) {
      const net = r - (st.paid.get(pool) ?? 0n)
      if (net < 0n) b += net
    }
    return b
  }
  const touch = (
    key: string,
    f: (st: State) => void,
    balance: number | undefined,
  ) => {
    if (!members.has(key)) return
    let st = state.get(key)
    if (!st) {
      st = { other: 0n, returned: new Map(), paid: new Map() }
      state.set(key, st)
    }
    f(st)
    if (balance === undefined) return
    const b = bound(st)
    if (b >= 0n && b < hi(balance))
      facts.push({ handle: balance, lo: 0n, hi: b })
  }
  for (const x of xfers) {
    const a = x.amount
    // the sender's side: an outflow
    if (x.src !== ZERO) {
      touch(
        `${x.token}:${x.src}`,
        (st) => {
          if (pools.has(x.dst))
            st.paid.set(x.dst, (st.paid.get(x.dst) ?? 0n) + lo(a))
          else st.other -= lo(a)
        },
        x.srcBal,
      )
    }
    // the recipient's side: an inflow
    if (x.dst !== ZERO) {
      touch(
        `${x.token}:${x.dst}`,
        (st) => {
          // a return, if the account had paid this pool before; anything
          // else a pool sends (the auction's proceeds to its treasury) is an
          // ordinary inflow
          if (pools.member(x.src, x.token, x.dst) && st.paid.has(x.src)) {
            st.returned.set(x.src, (st.returned.get(x.src) ?? 0n) + hi(a))
          } else st.other += hi(a)
        },
        x.dstBal,
      )
    }
  }
  return facts
}

/**
 * A vault batcher dispatches with `burned = select(ge(balance, total),
 * total, 0)`. Its balance always covers the batch total (every unit of the
 * total was credited to it, and only a dispatch or a quit takes it out), so
 * the burned amount, which the unwrap publishes, is the total itself. A
 * batch published as zero then pins every join in it to zero, decoys
 * included (BatcherConfidential.sol, dispatchBatch).
 */
function batchTotals(
  db: Db,
  xfers: { src: string; dst: string; amount: number }[],
  ops: DagOp[],
  producer: Int32Array,
): [number, number][] {
  const batchers = new Set(
    all<{ address: string }>(
      db,
      "select address from hub where kind = 'batcher'",
    ).map((r) => r.address),
  )
  const out: [number, number][] = []
  const op = (h: number | null) => {
    const p = h === null ? -1 : (producer[h] ?? -1)
    return p >= 0 ? ops[p] : undefined
  }
  for (const x of xfers) {
    if (x.dst !== ZERO || !batchers.has(x.src)) continue
    const s = op(x.amount)
    if (s?.kind !== Op.Select || s.b === null) continue
    const c = op(s.a)
    if (c?.kind === Op.Ge && c.b === s.b) out.push([x.amount, s.b])
  }
  return out
}
