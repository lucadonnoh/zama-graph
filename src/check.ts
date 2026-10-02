import { all, type Db, getSync, one } from './db'
import { TRUST } from './protocol'

const ZERO = '0x0000000000000000000000000000000000000000'

/**
 * Consistency checks of the index against the protocol's own rules. A
 * failure points at a decoding error, a missing event, or a wrong model.
 * Prints one line per check and returns whether all passed.
 */
export function check(db: Db): boolean {
  let ok = true
  const report = (name: string, pass: boolean, detail: string) => {
    if (!pass) ok = false
    process.stdout.write(`${pass ? 'ok  ' : 'FAIL'} ${name}: ${detail}\n`)
  }
  const n = (sql: string, ...p: (string | number)[]) =>
    (one<{ n: number }>(db, sql, ...p)?.n ?? 0) as number

  // every burn is an unwrap request, every unwrap request a burn
  const burns = n(`select count(*) n from xfer where dst = ?`, ZERO)
  const unwraps = n('select count(*) n from unwrap')
  report(
    'burns = unwrap requests',
    burns === unwraps,
    `${burns} burns, ${unwraps} requests`,
  )

  // every mint is a wrap with a payment found
  const mints = n(`select count(*) n from xfer where src = ?`, ZERO)
  const wraps = n('select count(*) n from wrap')
  report('mints = wraps', mints === wraps, `${mints} mints, ${wraps} wraps`)

  // the wrapper makes every burned amount publicly decryptable
  const notPublic = n(
    'select count(*) n from unwrap where handle not in (select handle from decryptable)',
  )
  report(
    'every unwrap request is publicly decryptable',
    notPublic === 0,
    `${notPublic} not`,
  )

  // every transfer amount was produced by an indexed FHE operation
  const orphan = n(
    'select count(*) n from xfer where amount not in (select r from op)',
  )
  report(
    'every transfer amount has its FHE operation',
    orphan === 0,
    `${orphan} of ${burns + mints + n(`select count(*) n from xfer where src <> ?1 and dst <> ?1`, ZERO)} without`,
  )

  // the ledger was matched for every transfer the last derive saw
  const derived = JSON.parse(getSync(db, 'bounds') ?? '{}') as {
    block?: number
  }
  const unmatched = n(
    `select count(*) n from xfer where block <= ?2
     and ((src <> ?1 and src_bal is null) or (dst <> ?1 and dst_bal is null))`,
    ZERO,
    derived.block ?? Number.MAX_SAFE_INTEGER,
  )
  report(
    'every transfer has its balance handles',
    unmatched === 0,
    `${unmatched} without`,
  )

  // independent sources of one clear value agree
  const disagree = all<{ handle: number }>(
    db,
    'select handle from clear group by handle having count(distinct value) > 1',
  )
  report(
    'clear values agree across sources',
    disagree.length === 0,
    `${disagree.length} handles disagree`,
  )

  // the propagation never contradicted a fact
  const bounds = JSON.parse(getSync(db, 'bounds') ?? '{}') as {
    contradictions?: number
  }
  report(
    'bounds never contradict a clear value',
    bounds.contradictions === 0,
    `${bounds.contradictions ?? 'not derived'} contradictions`,
  )

  // every value the Gateway published was signed by enough KMS signers
  const weak = n(
    'select count(*) n from gw_response where signers is not null and signers < ?',
    TRUST.publicThreshold,
  )
  const checked = n(
    'select count(*) n from gw_response where signers is not null',
  )
  report(
    `Gateway results signed by >= ${TRUST.publicThreshold} KMS signers`,
    weak === 0,
    `${checked - weak} of ${checked} checked`,
  )

  // finalized amounts match what the Gateway published for the same handle
  const mismatch = n(
    `select count(*) n from clear a join clear b on a.handle = b.handle
     where a.source = 'finalize' and b.source = 'gateway' and a.value <> b.value`,
  )
  report(
    'finalized amounts = Gateway results',
    mismatch === 0,
    `${mismatch} differ`,
  )
  return ok
}
