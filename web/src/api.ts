import type {
  AddressSummary,
  HandleDetail,
  HubDetail,
  LiveEvent,
  Names,
  ReadersSummary,
  Resolved,
  Stats,
  Status,
  TokenDetail,
  TxDetail,
  UnwrapDetail,
} from '../../src/graph/types'

/**
 * Where the API lives. Empty when the UI is served by the API server itself
 * (or proxied by Vite in development); the API's own origin when the UI is
 * hosted elsewhere, e.g. on GitHub Pages.
 */
const API_URL = (import.meta.env?.VITE_API_URL ?? '').replace(/\/$/, '')

async function get<T>(path: string): Promise<T> {
  const res = await fetch(API_URL + path)
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `${res.status} ${res.statusText}`)
  }
  return (await res.json()) as T
}

export type LiveFilter = 'all' | 'exact' | 'linked' | 'unwraps' | 'named'

export type Labels = Record<
  string,
  { label: string; kind?: string; zama?: boolean }
>

export const api = {
  status: () => get<Status>('/api/status'),
  stats: () => get<Stats>('/api/stats'),
  labels: () => get<Labels>('/api/labels'),
  search: (q: string) => get<Resolved>(`/api/search/${encodeURIComponent(q)}`),
  live: (filter: LiveFilter) => get<LiveEvent[]>(`/api/live?filter=${filter}`),
  address: (a: string) => get<AddressSummary>(`/api/address/${a}`),
  unwrap: (h: string) => get<UnwrapDetail>(`/api/unwrap/${h}`),
  handle: (h: string) => get<HandleDetail>(`/api/handle/${h}`),
  tx: (h: string) => get<TxDetail>(`/api/tx/${h}`),
  readers: () => get<ReadersSummary>('/api/readers'),
  hub: (a: string) => get<HubDetail>(`/api/hub/${a}`),
  token: (a: string) => get<TokenDetail>(`/api/token/${a}`),
  names: (addresses: string[]) => {
    const params = new URLSearchParams()
    for (const a of addresses) params.append('a', a)
    return get<Names>(`/api/names?${params}`)
  },
}
