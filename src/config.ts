import { existsSync } from 'node:fs'
import { GATEWAY_RPC_URL } from './protocol'

export interface Config {
  dbPath: string
  ethereumRpc: string | undefined
  gatewayRpc: string
  host: string
  port: number
  /**
   * The one browser origin allowed to call the API, e.g. the Pages site, or
   * `*`. Sent on every response rather than echoing the request's origin,
   * because a CDN cache does not vary by origin.
   */
  corsOrigin: string | undefined
  etherscanKey: string | undefined
  /** Zama's hosted relayer, for `decrypt` */
  relayerKey: string | undefined
}

export function loadConfig(): Config {
  if (existsSync('.env')) {
    process.loadEnvFile('.env')
  }
  const env = process.env
  return {
    dbPath: env.ZAMA_GRAPH_DB ?? 'data/zama-graph.sqlite',
    ethereumRpc: env.ETHEREUM_RPC_URL || undefined,
    gatewayRpc: env.ZAMA_RPC_URL || GATEWAY_RPC_URL,
    // only the tunnel (or a local proxy) should reach the server
    host: env.HOST ?? '127.0.0.1',
    port: Number(env.PORT ?? 3021),
    corsOrigin: env.CORS_ORIGIN || undefined,
    etherscanKey: env.ETHERSCAN_API_KEY || undefined,
    relayerKey: env.ZAMA_RELAYER_API_KEY || undefined,
  }
}
