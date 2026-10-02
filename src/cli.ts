import { check } from './check'
import { loadConfig } from './config'
import { openDb } from './db'
import { deriveAll } from './derive'
import { syncContractNames } from './eth/contracts'
import { syncEthereum } from './eth/indexer'
import { syncNames } from './eth/names'
import { JsonRpc } from './eth/rpc'
import { deriveBounds } from './fhe/derive'
import { syncGateway } from './gateway/indexer'
import { log, sleep } from './log'
import { serve } from './server'
import { decryptOpen } from './zama/decrypt'

const USAGE = `zama-graph <command>

  sync [--follow] [--only eth|gateway]   index Ethereum and the Zama Gateway, then derive
  serve                                  start the API and web UI
  derive                                 bounds, hubs, traces and stats from the index
  bounds                                 only propagate bounds over the FHE operations
  names                                  ENS and GNS names, and contract names (with ETHERSCAN_API_KEY)
  check                                  consistency checks of the index
  decrypt [--limit n] [--dry]            ask Zama's relayer for publicly decryptable
                                         values nobody decrypted yet (see README)
`

/** How often follow mode derives everything again */
const DERIVE_EVERY_MS = 10 * 60_000

async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv
  const option = (name: string) => {
    const i = rest.indexOf(`--${name}`)
    return i >= 0 ? rest[i + 1] : undefined
  }

  const config = loadConfig()
  const db = openDb(config.dbPath)

  switch (command) {
    case 'sync': {
      const follow = rest.includes('--follow')
      const only = option('only')
      const jobs: Promise<void>[] = []
      if (only !== 'gateway') {
        if (!config.ethereumRpc) throw new Error('ETHEREUM_RPC_URL is not set')
        jobs.push(
          syncEthereum(db, new JsonRpc(config.ethereumRpc, 'ethereum'), {
            follow,
          }),
        )
        if (config.etherscanKey) {
          jobs.push(syncContractNames(db, config.etherscanKey, { follow }))
        }
        jobs.push(
          syncNames(db, new JsonRpc(config.ethereumRpc, 'ethereum'), {
            follow,
          }),
        )
      }
      if (only !== 'eth') {
        jobs.push(
          syncGateway(db, new JsonRpc(config.gatewayRpc, 'gateway'), {
            follow,
            ethereumRpc: config.ethereumRpc,
          }),
        )
      }
      if (follow) jobs.push(deriveLoop(db))
      // One source failing should not stop the others; report at the end.
      const results = await Promise.allSettled(jobs)
      for (const r of results) {
        if (r.status === 'rejected') {
          log('sync job failed', { error: String(r.reason) })
          process.exitCode = 1
        }
      }
      if (!follow && process.exitCode !== 1) deriveAll(db)
      break
    }
    case 'serve': {
      serve(db, config)
      break
    }
    case 'derive': {
      deriveAll(db)
      break
    }
    case 'bounds': {
      deriveBounds(db)
      break
    }
    case 'names': {
      if (!config.ethereumRpc) throw new Error('names needs ETHEREUM_RPC_URL')
      await syncNames(db, new JsonRpc(config.ethereumRpc, 'ethereum'), {
        follow: false,
      })
      if (config.etherscanKey) {
        await syncContractNames(db, config.etherscanKey, { follow: false })
      }
      break
    }
    case 'check': {
      process.exitCode = check(db) ? 0 : 1
      break
    }
    case 'decrypt': {
      const limit = Number(option('limit') ?? 64)
      await decryptOpen(db, config, { limit, dry: rest.includes('--dry') })
      break
    }
    default:
      process.stdout.write(USAGE)
      process.exitCode = command ? 1 : 0
  }
}

/** Derived tables follow the index while the sync runs */
async function deriveLoop(db: ReturnType<typeof openDb>): Promise<void> {
  for (;;) {
    await sleep(DERIVE_EVERY_MS)
    try {
      deriveAll(db)
    } catch (e) {
      log('derive failed', { error: String(e) })
    }
  }
}

main(process.argv.slice(2)).catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? e.stack : String(e)}\n`)
  process.exit(1)
})
