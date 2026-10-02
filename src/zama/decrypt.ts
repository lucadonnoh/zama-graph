import type { Config } from '../config'
import { all, type Db, handleHex, transaction } from '../db'
import { JsonRpc, wordBig } from '../eth/rpc'
import { log } from '../log'
import { FHE_TYPE_BITS } from '../protocol'
import { ZamaApi } from './api'
import { countSigners, kmsSigners } from './kms'

/** The relayer and the Gateway accept at most this many bits per request */
const MAX_BITS = 2048

/**
 * Asks the KMS, through Zama's relayer, for the clear value of handles
 * that anyone may decrypt (their contract called `makePubliclyDecryptable`)
 * but nobody has: unwraps that were requested and never finalized, batch
 * totals, auction levels. This is what any visitor of the Zama app does
 * when it shows a pending unshield; the tool only asks for what the
 * protocol already made public. Every answer is checked against the KMS
 * signer set on Ethereum before it is stored, and it is also posted on the
 * Gateway, where the Gateway indexer finds it again.
 *
 * With `dry` nothing is sent: it lists what it would ask for.
 */
export async function decryptOpen(
  db: Db,
  config: Config,
  options: { limit: number; dry: boolean },
): Promise<void> {
  const open = all<{ handle: number }>(
    db,
    `select d.handle from decryptable d
     where d.handle not in (select handle from clear)
     order by d.block desc limit ?`,
    options.limit,
  ).map((r) => r.handle)
  const hex = handleHex(db, open)
  const handles = open.map((id) => ({ id, h: hex.get(id) ?? '' }))
  log('publicly decryptable, never decrypted', { selected: handles.length })
  if (options.dry || handles.length === 0) {
    for (const h of handles) process.stdout.write(`0x${h.h}\n`)
    return
  }
  if (!config.ethereumRpc) throw new Error('decrypt needs ETHEREUM_RPC_URL')
  const { signers, threshold } = await kmsSigners(
    new JsonRpc(config.ethereumRpc, 'ethereum'),
  )
  const zama = new ZamaApi(config)
  const ins = db.prepare(
    `insert into clear (handle, source, value, time, ref) values (?, 'relayer', ?, ?, ?)
     on conflict do nothing`,
  )
  for (const batch of batches(handles)) {
    const r = await zama.publicDecrypt(batch.map((b) => b.h))
    const valid = countSigners(
      r.handles,
      r.result,
      r.signatures,
      r.extraData,
      signers,
    )
    if (valid < threshold) {
      log('relayer answer not signed by enough KMS signers', {
        valid,
        threshold,
      })
      continue
    }
    const now = Math.floor(Date.now() / 1000)
    transaction(db, () => {
      batch.forEach((b, i) => {
        const w = r.result.slice(i * 64, (i + 1) * 64)
        if (w.length === 64) {
          ins.run(
            b.id,
            wordBig(w).toString(),
            now,
            `kms:${valid}/${signers.size}`,
          )
        }
      })
    })
    log('decrypted', { handles: batch.length, signers: valid })
  }
}

/** Groups of handles that fit one request */
function batches<T extends { h: string }>(handles: T[]): T[][] {
  const out: T[][] = []
  let current: T[] = []
  let bits = 0
  for (const h of handles) {
    const b = FHE_TYPE_BITS[Number.parseInt(h.h.slice(60, 62), 16)] ?? 256
    if (bits + b > MAX_BITS && current.length > 0) {
      out.push(current)
      current = []
      bits = 0
    }
    current.push(h)
    bits += b
  }
  if (current.length > 0) out.push(current)
  return out
}
