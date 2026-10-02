import { keccak_256 } from '@noble/hashes/sha3'
import { all, type Db, getSync, Ids, setSync, transaction } from '../db'
import {
  dynamicAt,
  JsonRpc,
  type Log,
  word,
  wordAddress,
  wordBig,
} from '../eth/rpc'
import { log, sleep } from '../log'
import {
  ETHEREUM_CHAIN_ID,
  GATEWAY,
  GATEWAY_FROM_BLOCK,
  TOPICS,
} from '../protocol'
import { countSigners, kmsSigners } from '../zama/kms'

/** About a day and a half of Gateway blocks (6.5 s each) */
const CHUNK = 20_000
const CONFIRMATIONS = 20
const FOLLOW_POLL_MS = 60_000

/**
 * Indexes the Zama Gateway's Decryption contract. Every decryption anyone
 * asks the KMS for is a request event there, and every public result is
 * posted in clear when the KMS nodes agree on it. So the Gateway is a public
 * log of who looked at which ciphertext, and of every value ever made
 * public, including the ones nobody used on Ethereum afterwards.
 *
 * Kept: public requests and their results, user decryption requests with
 * the user, the handles and a digest of the user's public key (a reused key
 * links sessions). Only handles of Ethereum ciphertexts are kept; the
 * Gateway also serves Polygon. Skipped: the per-node responses, which are
 * re-encrypted shares or duplicates of the consensus result.
 */
export async function syncGateway(
  db: Db,
  rpc: JsonRpc,
  options: { follow: boolean; ethereumRpc?: string },
): Promise<void> {
  // results are checked against the KMS signers Ethereum accepts
  const kms = options.ethereumRpc
    ? await kmsSigners(new JsonRpc(options.ethereumRpc, 'ethereum'))
    : undefined
  for (;;) {
    const done = Number(getSync(db, 'gw_block') ?? GATEWAY_FROM_BLOCK - 1)
    const head = (await rpc.getBlockNumber()) - CONFIRMATIONS
    if (done >= head) {
      if (!options.follow) break
      await sleep(FOLLOW_POLL_MS)
      continue
    }
    const to = Math.min(done + CHUNK, head)
    const started = Date.now()
    const logs = await rpc.getLogs({
      address: GATEWAY.decryption,
      topics: [
        [
          TOPICS.PublicDecryptionRequest,
          TOPICS.PublicDecryptionResponse,
          TOPICS.UserDecryptionRequest,
        ],
      ],
      fromBlock: done + 1,
      toBlock: to,
    })
    const counts = store(db, logs, kms?.signers)
    setSync(db, 'gw_block', String(to))
    log('gateway sync', {
      from: done + 1,
      to,
      head,
      ...counts,
      ms: Date.now() - started,
    })
  }
}

function store(db: Db, logs: Log[], signers: Set<string> | undefined) {
  const ids = new Ids(db)
  const insReq = db.prepare(
    `insert into gw_request (id, kind, block, tx, time, user, key, handles)
     values (?, ?, ?, ?, ?, ?, ?, ?) on conflict do nothing`,
  )
  const insHandle = db.prepare(
    'insert into gw_handle (handle, request, idx) values (?, ?, ?) on conflict do nothing',
  )
  const insResp = db.prepare(
    `insert into gw_response (id, block, tx, time, result, signers) values (?, ?, ?, ?, ?, ?)
     on conflict (id) do update set signers = excluded.signers`,
  )
  const requestHandles = new Map<string, string[]>()
  let pub = 0
  let user = 0
  let results = 0
  const answered: string[] = []
  transaction(db, () => {
    for (const l of logs) {
      const id = (l.topics[1] ?? '').slice(2)
      const tx = l.transactionHash.slice(2)
      switch (l.topics[0]) {
        case TOPICS.PublicDecryptionRequest: {
          const handles = materialHandles(l.data, 0)
          requestHandles.set(id, handles)
          const ours = handles.filter(isEthereumHandle)
          if (ours.length === 0) break
          insReq.run(id, 1, l.blockNumber, tx, l.time, null, null, ours.length)
          // the result lists every handle of the request, in order
          handles.forEach((h, i) => {
            if (isEthereumHandle(h)) insHandle.run(ids.handle(h), id, i)
          })
          pub++
          break
        }
        case TOPICS.UserDecryptionRequest: {
          const handles = materialHandles(l.data, 0).filter(isEthereumHandle)
          if (handles.length === 0) break
          const userAddress = wordAddress(word(l.data, 1))
          const key = dynamicAt(l.data, Number(wordBig(word(l.data, 2))))
          const digest = Buffer.from(
            keccak_256(Buffer.from(key, 'hex')),
          ).toString('hex')
          insReq.run(
            id,
            2,
            l.blockNumber,
            tx,
            l.time,
            userAddress,
            digest.slice(0, 16),
            handles.length,
          )
          handles.forEach((h, i) => void insHandle.run(ids.handle(h), id, i))
          user++
          break
        }
        case TOPICS.PublicDecryptionResponse: {
          const result = dynamicAt(l.data, Number(wordBig(word(l.data, 0))))
          const handles = requestHandles.get(id) ?? storedHandles(db, id)
          if (!handles?.some(isEthereumHandle)) break
          let valid: number | null = null
          if (signers && handles) {
            const sigs = bytesArray(l.data, 1)
            const extra = dynamicAt(l.data, Number(wordBig(word(l.data, 2))))
            valid = countSigners(handles, result, sigs, extra, signers)
          }
          insResp.run(id, l.blockNumber, tx, l.time, result, valid)
          answered.push(id)
          results++
          break
        }
      }
    }
    resolve(db, answered)
  })
  return { public: pub, user, results }
}

/**
 * Clear values from the public results: the result is the ABI encoding of
 * the request's handles' values, one word each, in request order
 */
function resolve(db: Db, ids: string[]): void {
  const ins = db.prepare(
    `insert into clear (handle, source, value, time, ref) values (?, 'gateway', ?, ?, ?)
     on conflict do nothing`,
  )
  for (const id of ids) {
    const response = all<{ result: string; time: number }>(
      db,
      'select result, time from gw_response where id = ?',
      id,
    )[0]
    if (!response) continue
    for (const h of all<{ handle: number; idx: number }>(
      db,
      'select handle, idx from gw_handle where request = ?',
      id,
    )) {
      const w = response.result.slice(h.idx * 64, (h.idx + 1) * 64)
      if (w.length === 64)
        ins.run(h.handle, wordBig(w).toString(), response.time, id)
    }
  }
}

/**
 * The full handle list of a public request indexed in an earlier step.
 * Only its Ethereum handles were stored, with their positions; that is
 * enough when the request named nothing else.
 */
function storedHandles(db: Db, id: string): string[] | undefined {
  const rows = all<{ h: Uint8Array; idx: number }>(
    db,
    'select h.h, g.idx from gw_handle g join handle h on h.id = g.handle where g.request = ? order by g.idx',
    id,
  )
  if (rows.length === 0 || rows.some((r, i) => r.idx !== i)) return undefined
  return rows.map((r) => Buffer.from(r.h).toString('hex'))
}

/** The bytes[] whose offset is in word `i` of data, each as hex */
function bytesArray(data: string, i: number): string[] {
  const base = Number(wordBig(word(data, i)))
  const at = (byte: number) => data.slice(2 + byte * 2, 2 + byte * 2 + 64)
  const n = Number(wordBig(at(base)))
  const out: string[] = []
  for (let j = 0; j < n; j++) {
    const offset = Number(wordBig(at(base + 32 + j * 32)))
    out.push(dynamicAt(`0x${data.slice(2 + (base + 32) * 2)}`, offset))
  }
  return out
}

/**
 * ctHandle of each SnsCiphertextMaterial in the array whose offset is in
 * word `i`. The struct has a dynamic member, so the array holds offsets.
 */
export function materialHandles(data: string, i: number): string[] {
  const base = Number(wordBig(word(data, i)))
  const at = (byte: number) => data.slice(2 + byte * 2, 2 + byte * 2 + 64)
  const n = Number(wordBig(at(base)))
  const out: string[] = []
  for (let j = 0; j < n; j++) {
    const offset = Number(wordBig(at(base + 32 + j * 32)))
    out.push(at(base + 32 + offset))
  }
  return out
}

/** Bytes 22..29 of a handle are the chain id of the ciphertext */
export function isEthereumHandle(h: string): boolean {
  return BigInt(`0x${h.slice(44, 60)}`) === BigInt(ETHEREUM_CHAIN_ID)
}
