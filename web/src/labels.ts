import { useEffect, useState } from 'react'
import { api, type Labels } from './api'

let labels: Labels = {}
let loading: Promise<void> | undefined
const listeners = new Set<() => void>()

/**
 * Names of the wrappers, hubs, Zama's accounts and verified contracts,
 * loaded once and shared by every component
 */
export function useLabels(): Labels {
  const [, setTick] = useState(0)
  useEffect(() => {
    const update = () => setTick((t) => t + 1)
    listeners.add(update)
    if (!loading) {
      loading = api
        .labels()
        .then((l) => {
          labels = l
          for (const f of listeners) f()
        })
        .catch(() => undefined)
    }
    return () => {
      listeners.delete(update)
    }
  }, [])
  return labels
}

export function labelOf(address: string): Labels[string] | undefined {
  return labels[address.toLowerCase()]
}
