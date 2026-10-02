import { all, type Db, getSync, handleId } from '../db'
import { KNOWN } from '../protocol'
import { type Hub, hubModes, memberPools, type Pools } from './hubs'
import { type Ev, type Ledger, loadLedger, MAX64, ZERO } from './model'
import { history, type Mode } from './traces'
import type { Amount, HistoryEdge, HistoryGraph, HistoryNode } from './types'

/** Most account-to-account edges one graph shows */
const MAX_EDGES = 300

interface Cached {
  at: string
  ledger: Ledger
  hubs: Map<string, string>
  modeOf: (address: string) => Mode
  pools: Pools
}

let cached: Cached | undefined

/** The ledger in memory, reloaded when the sync derived a new state */
export function currentLedger(db: Db): Cached {
  const at = getSync(db, 'traces') ?? ''
  if (!cached || cached.at !== at) {
    const rows = all<Hub>(
      db,
      'select address, kind, name, counterparties from hub',
    )
    const hubs = new Map(rows.map((h) => [h.address, h.kind as string]))
    const pools = memberPools(db)
    cached = {
      at,
      ledger: loadLedger(db, new Set(hubs.keys())),
      hubs,
      modeOf: hubModes(rows, pools),
      pools,
    }
  }
  return cached
}

function amountOf(lo: bigint, hi: bigint): Amount {
  return hi >= MAX64 ? { lo: String(lo) } : { lo: String(lo), hi: String(hi) }
}

/**
 * The history of one withdrawal as a graph: accounts are nodes, transfers
 * between two accounts are merged into one edge (with the sum of their
 * bounds), each depositor is a node of its own, hubs are drawn as one node
 * each, and the withdrawal is the sink.
 */
export function historyGraph(db: Db, hex: string): HistoryGraph | undefined {
  const id = handleId(db, hex)
  if (id === undefined) return undefined
  const { ledger, hubs, modeOf, pools } = currentLedger(db)
  let at = -1
  for (const [i, u] of ledger.unwraps) {
    if (u.handle === id) {
      at = i
      break
    }
  }
  if (at < 0) return undefined
  const target = ledger.events[at] as Ev
  const h = history(ledger, at, modeOf, pools.member)
  const txHash = db.prepare('select hash from txn where id = ?')
  const hashOf = (tx: number) =>
    (txHash.get(tx) as { hash: string } | undefined)?.hash ?? ''

  const nodes = new Map<string, HistoryNode>()
  const node = (n: HistoryNode) => {
    if (!nodes.has(n.id)) nodes.set(n.id, n)
  }
  const edges = new Map<string, HistoryEdge & { lo: bigint; hi: bigint }>()
  const edge = (from: string, to: string, e: Ev) => {
    const key = `${from}>${to}`
    const prev = edges.get(key)
    if (prev) {
      prev.lo += e.lo
      prev.hi = prev.hi >= MAX64 || e.hi >= MAX64 ? MAX64 : prev.hi + e.hi
      prev.count++
      prev.time = Math.max(prev.time, e.time)
      return
    }
    edges.set(key, {
      from,
      to,
      lo: e.lo,
      hi: e.hi,
      amount: { lo: '0' },
      time: e.time,
      tx: hashOf(e.tx),
      count: 1,
    })
  }
  const label = (a: string) => KNOWN[a]?.label
  const outside = new Set(h.outside)
  const returns = new Set(h.returns)
  for (const i of h.events) {
    const e = ledger.events[i] as Ev
    if (e.hi === 0n || e.dst === ZERO) continue
    if (e.src === ZERO) {
      const w = ledger.wraps.get(i)
      const dep = w?.depositor ?? e.dst
      const id = `deposit:${dep}`
      node({
        id,
        account: dep,
        kind: 'deposit',
        depositor: dep,
        label: label(dep),
      })
      node({ id: e.dst, account: e.dst, kind: 'account', label: label(e.dst) })
      edge(id, e.dst, e)
      continue
    }
    // a pool that returns members their own funds: payments in, returns out
    if (h.members.has(e.dst) || returns.has(i)) {
      const pool = h.members.has(e.dst) ? e.dst : e.src
      const id = `hub:${pool}`
      node({
        id,
        account: pool,
        kind: 'hub',
        label: label(pool) ?? hubs.get(pool),
      })
      node({
        id: e.src === pool ? e.dst : e.src,
        account: e.src === pool ? e.dst : e.src,
        kind: 'account',
      })
      if (e.dst === pool) edge(e.src, id, e)
      else edge(id, e.dst, e)
      continue
    }
    // only inflows the walk followed matter for the picture, not what
    // left the history towards elsewhere
    const fromHub = outside.has(i)
    if (!h.accounts.has(e.dst) || (!fromHub && !h.accounts.has(e.src))) {
      continue
    }
    const from = fromHub ? `hub:${e.src}` : e.src
    node({
      id: from,
      account: e.src,
      kind: fromHub ? 'hub' : 'account',
      label: label(e.src) ?? (fromHub ? hubs.get(e.src) : undefined),
    })
    node({ id: e.dst, account: e.dst, kind: 'account', label: label(e.dst) })
    if (from !== e.dst) edge(from, e.dst, e)
  }
  const sink = `withdrawal:${target.amount}`
  node({
    id: target.src,
    account: target.src,
    kind: 'account',
    label: label(target.src),
  })
  node({
    id: sink,
    account: ledger.unwraps.get(at)?.receiver ?? target.src,
    kind: 'target',
    amount: amountOf(target.lo, target.hi),
    time: target.time,
  })
  edge(target.src, sink, target)
  // keep the edges into accounts that lead to the sink
  const list = [...edges.values()]
    .sort((a, b) => b.time - a.time)
    .slice(0, MAX_EDGES)
  const used = new Set(list.flatMap((e) => [e.from, e.to]))
  return {
    nodes: [...nodes.values()].filter((n) => used.has(n.id)),
    edges: list.map(({ lo, hi, ...e }) => ({ ...e, amount: amountOf(lo, hi) })),
    truncated: h.truncated || edges.size > MAX_EDGES,
  }
}
