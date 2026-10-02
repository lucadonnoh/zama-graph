import { all, type Db } from '../db'

export const ZERO = '0x0000000000000000000000000000000000000000'
export const MAX64 = (1n << 64n) - 1n

/** One ConfidentialTransfer with what the bounds say about it */
export interface Ev {
  /** position in time order */
  i: number
  block: number
  log: number
  tx: number
  time: number
  token: string
  src: string
  dst: string
  amount: number
  lo: bigint
  hi: bigint
  /** the sender's balance after it, as bounded (undefined for mints) */
  srcAfter?: { lo: bigint; hi: bigint }
  /** the recipient's balance after it (undefined for burns) */
  dstAfter?: { lo: bigint; hi: bigint }
}

export interface WrapRow {
  block: number
  log: number
  token: string
  recipient: string
  depositor: string
  amount: bigint
  time: number
}

export interface UnwrapRow {
  handle: number
  token: string
  burner: string
  receiver: string
  block: number
  log: number
  time: number
  clear: bigint | null
}

/**
 * Every confidential transfer in time order, indexed by account, with the
 * bounds the propagation found for amounts and balances. Small enough to
 * hold in memory: tens of thousands of transfers.
 */
export interface Ledger {
  events: Ev[]
  /** `${token}:${account}`: indices of its events, in time order */
  byAccount: Map<string, number[]>
  /** mint event index -> wrap */
  wraps: Map<number, WrapRow>
  /** burn event index -> unwrap */
  unwraps: Map<number, UnwrapRow>
  /** the contracts that pool many users' funds (src/graph/hubs.ts) */
  hubs: Set<string>
}

export function loadLedger(db: Db, hubs: Set<string>): Ledger {
  const rows = all<{
    block: number
    log: number
    tx: number
    time: number
    token: string
    src: string
    dst: string
    amount: number
    lo: string | null
    hi: string | null
    slo: string | null
    shi: string | null
    dlo: string | null
    dhi: string | null
    src_bal: number | null
    dst_bal: number | null
  }>(
    db,
    `select x.block, x.log, x.tx, x.time, x.token, x.src, x.dst, x.amount,
            b.lo, b.hi, sb.lo slo, sb.hi shi, db.lo dlo, db.hi dhi, x.src_bal, x.dst_bal
     from xfer x
     left join bound b on b.handle = x.amount
     left join bound sb on sb.handle = x.src_bal
     left join bound db on db.handle = x.dst_bal
     order by x.block, x.log`,
  )
  const events: Ev[] = rows.map((r, i) => ({
    i,
    block: r.block,
    log: r.log,
    tx: r.tx,
    time: r.time,
    token: r.token,
    src: r.src,
    dst: r.dst,
    amount: r.amount,
    lo: r.lo === null ? 0n : BigInt(r.lo),
    hi: r.hi === null ? MAX64 : BigInt(r.hi),
    srcAfter:
      r.src === ZERO
        ? undefined
        : r.src_bal === null
          ? { lo: 0n, hi: MAX64 }
          : {
              lo: r.slo === null ? 0n : BigInt(r.slo),
              hi: r.shi === null ? MAX64 : BigInt(r.shi),
            },
    dstAfter:
      r.dst === ZERO
        ? undefined
        : r.dst_bal === null
          ? { lo: 0n, hi: MAX64 }
          : {
              lo: r.dlo === null ? 0n : BigInt(r.dlo),
              hi: r.dhi === null ? MAX64 : BigInt(r.dhi),
            },
  }))
  const byAccount = new Map<string, number[]>()
  const push = (k: string, i: number) => {
    const list = byAccount.get(k)
    if (list) list.push(i)
    else byAccount.set(k, [i])
  }
  const at = new Map<string, number>()
  for (const e of events) {
    at.set(`${e.block}:${e.log}`, e.i)
    if (e.src !== ZERO) push(`${e.token}:${e.src}`, e.i)
    if (e.dst !== ZERO && e.dst !== e.src) push(`${e.token}:${e.dst}`, e.i)
  }
  const wraps = new Map<number, WrapRow>()
  for (const w of all<{
    block: number
    log: number
    token: string
    recipient: string
    depositor: string
    amount: string
    time: number
  }>(
    db,
    'select block, log, token, recipient, depositor, amount, time from wrap',
  )) {
    const i = at.get(`${w.block}:${w.log}`)
    if (i !== undefined) wraps.set(i, { ...w, amount: BigInt(w.amount) })
  }
  const burnAt = new Map<number, number>()
  for (const e of events) if (e.dst === ZERO) burnAt.set(e.amount, e.i)
  const unwraps = new Map<number, UnwrapRow>()
  for (const u of all<{
    handle: number
    token: string
    burner: string
    receiver: string
    block: number
    log: number
    time: number
    clear: string | null
  }>(
    db,
    'select handle, token, burner, receiver, block, log, time, clear from unwrap',
  )) {
    const i = burnAt.get(u.handle)
    if (i !== undefined) {
      unwraps.set(i, { ...u, clear: u.clear === null ? null : BigInt(u.clear) })
    }
  }
  return { events, byAccount, wraps, unwraps, hubs }
}

/** Amount of an event known exactly, if it is */
export function exact(e: Ev): bigint | undefined {
  return e.lo === e.hi ? e.lo : undefined
}
