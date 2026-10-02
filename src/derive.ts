import type { Db } from './db'
import { deriveBounds } from './fhe/derive'
import { deriveHubs } from './graph/hubs'
import { loadLedger } from './graph/model'
import { deriveStats } from './graph/stats'
import { deriveTraces } from './graph/traces'

/**
 * Everything derived from the indexed facts, in order: the hubs, bounds
 * over the FHE operations, the history of every withdrawal, the scoreboard. Each step
 * replaces its tables in one transaction, so the server always reads a
 * consistent state.
 */
export function deriveAll(db: Db): void {
  // the hubs first: the bounds use the pools among them
  const hubs = deriveHubs(db)
  deriveBounds(db)
  const ledger = loadLedger(db, new Set(hubs.keys()))
  deriveTraces(db, ledger, hubs)
  deriveStats(db)
}
