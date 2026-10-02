import { all, type Db } from '../db'
import { log, sleep } from '../log'

/** Etherscan allows a few calls per second on a free key */
const CALL_GAP_MS = 250
const FOLLOW_POLL_MS = 10 * 60_000

/**
 * The verified contract name of every contract that took part, from
 * Etherscan, once. Names are what tells a vault batcher, the auction's
 * holding wallets and the swap's escrows apart from a user's smart wallet.
 * A proxy is named after its implementation.
 */
export async function syncContractNames(
  db: Db,
  key: string,
  options: { follow: boolean },
): Promise<void> {
  for (;;) {
    const todo = all<{ address: string }>(
      db,
      "select address from account where kind = 'contract' and checked = 0",
    )
    for (const { address } of todo) {
      let name: string | null = null
      try {
        name = await contractName(key, address)
      } catch (e) {
        log('etherscan failed', { address, error: String(e) })
        break
      }
      db.prepare(
        'update account set name = ?, checked = ? where address = ?',
      ).run(name, Math.floor(Date.now() / 1000), address)
      await sleep(CALL_GAP_MS)
    }
    if (todo.length > 0) log('contract names', { checked: todo.length })
    if (!options.follow) return
    await sleep(FOLLOW_POLL_MS)
  }
}

async function contractName(
  key: string,
  address: string,
): Promise<string | null> {
  const get = async (a: string) => {
    const res = await fetch(
      `https://api.etherscan.io/v2/api?chainid=1&module=contract&action=getsourcecode&address=${a}&apikey=${key}`,
    )
    const json = (await res.json()) as {
      status: string
      result: { ContractName?: string; Implementation?: string }[] | string
    }
    if (typeof json.result === 'string') throw new Error(json.result)
    return json.result[0]
  }
  const r = await get(address)
  if (!r?.ContractName) return null
  if (r.Implementation && /proxy/i.test(r.ContractName)) {
    await sleep(CALL_GAP_MS)
    const impl = await get(r.Implementation)
    return impl?.ContractName || r.ContractName
  }
  return r.ContractName
}
