import { sleep } from '../log'

export interface Log {
  address: string
  topics: string[]
  data: string
  blockNumber: number
  /** seconds; the providers used here put it on every log */
  time: number
  transactionHash: string
  logIndex: number
}

export interface LogFilter {
  address?: string | string[]
  /** Each position is one topic or a list of alternatives; null = any */
  topics?: (string | string[] | null)[]
  fromBlock: number
  toBlock: number
}

export interface Tx {
  hash: string
  from: string
  to: string | null
  input: string
  blockNumber: number
}

interface RawLog {
  address: string
  topics: string[]
  data: string
  blockNumber: string
  blockTimestamp?: string
  transactionHash: string
  logIndex: string
}

/** Requests one client keeps in flight at most */
const MAX_IN_FLIGHT = 8

/** Minimal JSON-RPC client: what the indexers need, nothing else */
export class JsonRpc {
  private inFlight = 0
  private readonly waiting: (() => void)[] = []

  constructor(
    private readonly url: string,
    private readonly name = 'rpc',
  ) {}

  /** Waits for a free slot, so that parallel callers do not flood the provider */
  private async slot(): Promise<() => void> {
    if (this.inFlight >= MAX_IN_FLIGHT) {
      await new Promise<void>((resolve) => this.waiting.push(resolve))
    }
    this.inFlight++
    return () => {
      this.inFlight--
      this.waiting.shift()?.()
    }
  }

  async getBlockNumber(): Promise<number> {
    return Number(await this.call<string>('eth_blockNumber', []))
  }

  /**
   * Providers cap the size of a getLogs response. When a range is too dense
   * the request is split in half and retried, so callers can ask for large
   * ranges and stay simple.
   */
  async getLogs(filter: LogFilter): Promise<Log[]> {
    let raw: RawLog[]
    try {
      raw = await this.call<RawLog[]>('eth_getLogs', [
        {
          address: filter.address,
          topics: filter.topics,
          fromBlock: hex(filter.fromBlock),
          toBlock: hex(filter.toBlock),
        },
      ])
    } catch (e) {
      if (filter.fromBlock >= filter.toBlock || !isTooLarge(e)) throw e
      const mid = Math.floor((filter.fromBlock + filter.toBlock) / 2)
      const [a, b] = await Promise.all([
        this.getLogs({ ...filter, toBlock: mid }),
        this.getLogs({ ...filter, fromBlock: mid + 1 }),
      ])
      return [...a, ...b]
    }
    const logs = raw.map((l) => ({
      address: l.address.toLowerCase(),
      topics: l.topics.map((t) => t.toLowerCase()),
      data: l.data.toLowerCase(),
      blockNumber: Number(l.blockNumber),
      time: Number(l.blockTimestamp ?? 0),
      transactionHash: l.transactionHash.toLowerCase(),
      logIndex: Number(l.logIndex),
    }))
    const undated = [
      ...new Set(logs.filter((l) => !l.time).map((l) => l.blockNumber)),
    ]
    if (undated.length > 0) {
      const times = await this.getBlockTimestamps(undated)
      for (const l of logs) if (!l.time) l.time = times.get(l.blockNumber) ?? 0
    }
    return logs
  }

  /** Timestamps of many blocks in one batched request */
  async getBlockTimestamps(blocks: number[]): Promise<Map<number, number>> {
    const result = new Map<number, number>()
    for (let i = 0; i < blocks.length; i += 100) {
      const batch = blocks.slice(i, i + 100)
      const responses = await this.batch<{ timestamp: string }>(
        batch.map((b) => ({
          method: 'eth_getBlockByNumber',
          params: [hex(b), false],
        })),
      )
      batch.forEach((b, j) => {
        const r = responses[j]
        if (r) result.set(b, Number(r.timestamp))
      })
    }
    return result
  }

  /** Transactions by hash, batched, a few batches at a time */
  async getTxs(hashes: string[]): Promise<Map<string, Tx>> {
    const result = new Map<string, Tx>()
    const batches: string[][] = []
    for (let i = 0; i < hashes.length; i += 50)
      batches.push(hashes.slice(i, i + 50))
    let next = 0
    const worker = async () => {
      while (next < batches.length) {
        const batch = batches[next++] as string[]
        await this.txBatch(batch, result)
      }
    }
    await Promise.all(Array.from({ length: 6 }, worker))
    return result
  }

  private async txBatch(batch: string[], result: Map<string, Tx>) {
    const found = await this.batch<{
      hash: string
      from: string
      to: string | null
      input: string
      blockNumber: string
    } | null>(
      batch.map((t) => ({ method: 'eth_getTransactionByHash', params: [t] })),
    )
    for (const t of found) {
      if (!t) continue
      result.set(t.hash.toLowerCase(), {
        hash: t.hash.toLowerCase(),
        from: t.from.toLowerCase(),
        to: t.to?.toLowerCase() ?? null,
        input: t.input,
        blockNumber: Number(t.blockNumber),
      })
    }
  }

  /** Logs of one transaction, from its receipt */
  async getReceiptLogs(tx: string): Promise<Log[]> {
    const r = await this.call<{ logs: RawLog[] } | null>(
      'eth_getTransactionReceipt',
      [tx],
    )
    return (r?.logs ?? []).map((l) => ({
      address: l.address.toLowerCase(),
      topics: l.topics.map((t) => t.toLowerCase()),
      data: l.data.toLowerCase(),
      blockNumber: Number(l.blockNumber),
      time: Number(l.blockTimestamp ?? 0),
      transactionHash: l.transactionHash.toLowerCase(),
      logIndex: Number(l.logIndex),
    }))
  }

  /** Deployed code of many addresses, batched ('0x' for an EOA) */
  async getCodes(
    addresses: string[],
    block: number | 'latest' = 'latest',
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>()
    const tag = block === 'latest' ? block : hex(block)
    for (let i = 0; i < addresses.length; i += 100) {
      const batch = addresses.slice(i, i + 100)
      const codes = await this.batch<string>(
        batch.map((a) => ({ method: 'eth_getCode', params: [a, tag] })),
      )
      batch.forEach((a, j) => void result.set(a, codes[j] ?? '0x'))
    }
    return result
  }

  /**
   * Read-only contract calls at the latest block, batched in one request.
   * A call that reverts gives undefined instead of failing the batch.
   */
  async ethCalls(
    calls: { to: string; data: string }[],
  ): Promise<(string | undefined)[]> {
    const out: (string | undefined)[] = []
    for (let i = 0; i < calls.length; i += 100) {
      out.push(
        ...(await this.batch<string>(
          calls
            .slice(i, i + 100)
            .map((c) => ({ method: 'eth_call', params: [c, 'latest'] })),
          { reverts: true },
        )),
      )
    }
    return out
  }

  private async call<T>(method: string, params: unknown[]): Promise<T> {
    const [result] = await this.batch<T>([{ method, params }])
    if (result === undefined) throw new Error(`empty response for ${method}`)
    return result
  }

  private async batch<T>(
    calls: { method: string; params: unknown[] }[],
  ): Promise<T[]>
  private async batch<T>(
    calls: { method: string; params: unknown[] }[],
    options: { reverts: true },
  ): Promise<(T | undefined)[]>
  private async batch<T>(
    calls: { method: string; params: unknown[] }[],
    options?: { reverts: true },
  ): Promise<(T | undefined)[]> {
    const body = calls.map((c, id) => ({ jsonrpc: '2.0', id, ...c }))
    let lastError: unknown
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const json =
          await this.post<
            { id: number; result?: T; error?: { message: string } }[]
          >(body)
        const byId = new Map(json.map((r) => [r.id, r]))
        return calls.map((c, id) => {
          const r = byId.get(id)
          if (r?.error && options?.reverts && /revert/i.test(r.error.message)) {
            return undefined
          }
          if (!r || r.error) {
            throw new Error(`${c.method}: ${r?.error?.message ?? 'missing'}`)
          }
          return r.result as T
        })
      } catch (e) {
        lastError = e
        if (isTooLarge(e)) break
        await sleep(1000 * 2 ** attempt)
      }
    }
    throw new Error(`${this.name} failed: ${String(lastError)}`)
  }

  /** One HTTP request, holding a slot until its body is read */
  private async post<T>(body: unknown): Promise<T> {
    const release = await this.slot()
    try {
      const res = await fetch(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      })
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      return (await res.json()) as T
    } finally {
      release()
    }
  }
}

function isTooLarge(e: unknown): boolean {
  return /size exceeded|too many|limit|more than|range|too large/i.test(
    String(e),
  )
}

export function hex(n: number): string {
  return `0x${n.toString(16)}`
}

/** 32-byte word `i` of a data field, hex without 0x */
export function word(data: string, i: number): string {
  return data.slice(2 + 64 * i, 2 + 64 * (i + 1))
}

export function topicAddress(topic: string | undefined): string {
  if (!topic) throw new Error('missing topic')
  return `0x${topic.slice(26)}`
}

export function wordAddress(w: string): string {
  return `0x${w.slice(24)}`
}

export function wordBig(w: string): bigint {
  return w ? BigInt(`0x${w}`) : 0n
}

/** The dynamic `bytes` or array that starts at byte offset `offset` of data */
export function dynamicAt(data: string, offset: number): string {
  const len = Number(
    BigInt(`0x${data.slice(2 + offset * 2, 2 + offset * 2 + 64)}`),
  )
  return data.slice(2 + offset * 2 + 64, 2 + offset * 2 + 64 + len * 2)
}
