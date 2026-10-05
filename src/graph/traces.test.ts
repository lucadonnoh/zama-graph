import { DatabaseSync } from 'node:sqlite'
import { expect } from 'earl'
import { type Ev, type Ledger, ZERO } from './model'
import { LINKS, traceUnwrap } from './traces'

const T = '0x00000000000000000000000000000000000000c0'

/** A ledger from a list of transfers in time order */
function ledger(
  rows: {
    src: string
    dst: string
    lo: bigint
    hi: bigint
    srcAfter?: [bigint, bigint]
    dstAfter?: [bigint, bigint]
    depositor?: string
  }[],
  hubs: string[] = [],
): Ledger {
  const events: Ev[] = rows.map((r, i) => ({
    i,
    block: i + 1,
    log: 0,
    tx: i,
    time: 1000 + i,
    token: T,
    src: r.src,
    dst: r.dst,
    amount: 100 + i,
    lo: r.lo,
    hi: r.hi,
    srcAfter: r.src === ZERO ? undefined : bound(r.srcAfter),
    dstAfter: r.dst === ZERO ? undefined : bound(r.dstAfter),
  }))
  const byAccount = new Map<string, number[]>()
  for (const e of events) {
    for (const a of new Set([e.src, e.dst])) {
      if (a === ZERO) continue
      byAccount.set(`${T}:${a}`, [...(byAccount.get(`${T}:${a}`) ?? []), e.i])
    }
  }
  const l: Ledger = {
    events,
    byAccount,
    wraps: new Map(),
    unwraps: new Map(),
    hubs: new Set(hubs),
  }
  rows.forEach((r, i) => {
    const e = events[i] as Ev
    if (r.src === ZERO) {
      l.wraps.set(i, {
        block: e.block,
        log: 0,
        token: T,
        recipient: r.dst,
        depositor: r.depositor ?? r.dst,
        amount: r.lo,
        time: e.time,
      })
    }
    if (r.dst === ZERO) {
      l.unwraps.set(i, {
        handle: e.amount,
        token: T,
        burner: r.src,
        receiver: r.src,
        block: e.block,
        log: 0,
        time: e.time,
        clear: r.lo === r.hi ? r.lo : null,
      })
    }
  })
  return l
}

function bound(b: [bigint, bigint] | undefined) {
  return b ? { lo: b[0], hi: b[1] } : { lo: 0n, hi: 10n ** 18n }
}

const A = '0x000000000000000000000000000000000000000a'
const B = '0x000000000000000000000000000000000000000b'
const C = '0x000000000000000000000000000000000000000c'
const H = '0x00000000000000000000000000000000000000ff'

describe('traceUnwrap', () => {
  it('follows only transfers that can have moved something', () => {
    const l = ledger([
      { src: ZERO, dst: A, lo: 100n, hi: 100n, dstAfter: [100n, 100n] },
      { src: ZERO, dst: B, lo: 50n, hi: 50n, dstAfter: [50n, 50n] },
      { src: A, dst: C, lo: 0n, hi: 100n, srcAfter: [0n, 100n] },
      // provably zero: a failed transfer, or a decoy leg
      { src: B, dst: C, lo: 0n, hi: 0n, srcAfter: [50n, 50n] },
      { src: C, dst: ZERO, lo: 60n, hi: 60n, srcAfter: [0n, 40n] },
    ])
    const t = traceUnwrap(l, 4, () => 'enter')
    expect(t.origin).toEqual('deposit')
    expect(t.shares.map((s) => [s.depositor, s.min, s.max])).toEqual([
      [A, 60n, 60n],
    ])
  })

  it('cuts the past off at a provably empty balance', () => {
    const l = ledger([
      {
        src: ZERO,
        dst: A,
        lo: 100n,
        hi: 100n,
        dstAfter: [100n, 100n],
        depositor: B,
      },
      // A withdraws everything: its balance is provably zero after
      { src: A, dst: ZERO, lo: 100n, hi: 100n, srcAfter: [0n, 0n] },
      {
        src: ZERO,
        dst: A,
        lo: 30n,
        hi: 30n,
        dstAfter: [30n, 30n],
        depositor: C,
      },
      { src: A, dst: ZERO, lo: 30n, hi: 30n, srcAfter: [0n, 0n] },
    ])
    const t = traceUnwrap(l, 3, () => 'enter')
    expect(t.cut).toEqual(true)
    expect(t.shares.map((s) => s.depositor)).toEqual([C])
    expect(t.shares[0]?.min).toEqual(30n)
  })

  it('leaves what a hub may have supplied open', () => {
    const l = ledger(
      [
        { src: ZERO, dst: A, lo: 10n, hi: 10n, dstAfter: [10n, 10n] },
        { src: H, dst: A, lo: 0n, hi: 50n, dstAfter: [0n, 60n] },
        { src: A, dst: ZERO, lo: 40n, hi: 40n, srcAfter: [0n, 20n] },
      ],
      [H],
    )
    const t = traceUnwrap(l, 2, (a) => (a === H ? 'stop' : 'enter'))
    expect(t.origin).toEqual('hub')
    expect(t.hubs).toEqual([H])
    expect(t.shares.map((s) => [s.min, s.max])).toEqual([[0n, 10n]])
  })

  it('follows a refund back to the bid it returns', () => {
    // A wraps 100 and bids it all into the auction wallet W, which later
    // refunds 60: W only returns a bidder its own payments
    const l = ledger(
      [
        { src: ZERO, dst: A, lo: 100n, hi: 100n, dstAfter: [100n, 100n] },
        { src: ZERO, dst: B, lo: 500n, hi: 500n, dstAfter: [500n, 500n] },
        { src: B, dst: H, lo: 0n, hi: 500n, srcAfter: [0n, 500n] },
        { src: A, dst: H, lo: 100n, hi: 100n, srcAfter: [0n, 0n] },
        { src: H, dst: A, lo: 60n, hi: 60n, dstAfter: [60n, 60n] },
        { src: A, dst: ZERO, lo: 60n, hi: 60n, srcAfter: [0n, 0n] },
      ],
      [H],
    )
    const t = traceUnwrap(l, 5, (a) => (a === H ? 'member' : 'enter'))
    expect(t.origin).toEqual('deposit')
    // B's funds in the same wallet cannot be in A's refund
    expect(t.shares.map((s) => [s.depositor, s.min, s.max])).toEqual([
      [A, 60n, 60n],
    ])
    // as a plain pool the refund's origin is unknown
    const stop = traceUnwrap(l, 5, (a) => (a === H ? 'stop' : 'enter'))
    expect(stop.origin).toEqual('hub')
  })

  it('proves a share where the other sources are too small', () => {
    const l = ledger(
      [
        { src: ZERO, dst: A, lo: 100n, hi: 100n, dstAfter: [100n, 100n] },
        { src: H, dst: A, lo: 0n, hi: 5n, dstAfter: [0n, 105n] },
        { src: A, dst: ZERO, lo: 90n, hi: 90n, srcAfter: [0n, 15n] },
      ],
      [H],
    )
    const t = traceUnwrap(l, 2, (a) => (a === H ? 'stop' : 'enter'))
    // the hub can have supplied at most 5 of the 90
    expect(t.shares[0]?.min).toEqual(85n)
  })
})

describe('LINKS', () => {
  it('sorts every traced withdrawal into exactly one kind', () => {
    const db = new DatabaseSync(':memory:')
    db.exec(`create table trace (
      handle integer, burner text, receiver text, lo text,
      origin text, sender text, sender_min text)`)
    const ins = db.prepare('insert into trace values (?, ?, ?, ?, ?, ?, ?)')
    const rows: [
      string,
      string,
      string,
      string,
      string | null,
      string | null,
    ][] = [
      // burner, receiver, lo, origin, sender, sender_min
      [A, A, '5', 'deposit', A, '5'], // self
      [A, B, '5', 'deposit', B, '5'], // self: the receiver's own wraps
      [A, A, '5', 'deposit', B, '5'], // other
      [A, A, '5', 'hub', B, '2'], // pool
      [A, A, '5', 'hub', null, null], // pool, no depositor at all
      [A, A, '5', 'several', B, '1'], // several
      [A, A, '5', 'limit', null, null], // several: too large to walk
      [A, A, '0', 'empty', null, null], // nothing to fund
    ]
    rows.forEach((r, i) => void ins.run(i, ...r))
    const kind = (where: string) =>
      (
        db
          .prepare(`select handle from trace t where ${where} order by handle`)
          .all() as { handle: number }[]
      ).map((r) => r.handle)
    expect(kind(LINKS.self)).toEqual([0, 1])
    expect(kind(LINKS.other)).toEqual([2])
    expect(kind(LINKS.linked)).toEqual([0, 1, 2])
    expect(kind(LINKS.pool)).toEqual([3, 4])
    expect(kind(LINKS.several)).toEqual([5, 6])
  })
})
