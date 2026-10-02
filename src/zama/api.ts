import type { Config } from '../config'
import { sleep } from '../log'
import { ZAMA_RELAYER_URL } from '../protocol'
import type { PublicDecryption } from './types'

/** An answer of the relayer */
interface FetchResult {
  status: number
  body: string
}

/**
 * Zama's hosted relayer, with an API key (ZAMA_RELAYER_API_KEY, from Zama's
 * form). It forwards public decryption requests to the Gateway, where the
 * KMS answers in public.
 */
export class ZamaApi {
  constructor(private readonly config: Pick<Config, 'relayerKey'>) {}

  /**
   * Asks the KMS, through the hosted relayer, for the clear values of
   * handles that are publicly decryptable. The relayer answers with the
   * values and the KMS signatures, which src/zama/kms.ts checks against the
   * signer set on Ethereum. At most 2048 bits per request (32 euint64).
   */
  async publicDecrypt(handles: string[]): Promise<PublicDecryption> {
    const body = {
      ciphertextHandles: handles.map((h) => `0x${h.replace(/^0x/, '')}`),
      extraData: '0x00',
    }
    const post = await this.relayer('/v2/public-decrypt', body)
    const job = parse<{ result?: { jobId?: string } }>(post).result?.jobId
    if (!job)
      throw new Error(`relayer: ${post.status} ${post.body.slice(0, 200)}`)
    for (let i = 0; i < 60; i++) {
      await sleep(2000)
      const res = await this.relayer(`/v2/public-decrypt/${job}`)
      if (res.status === 202) continue
      const r = parse<{
        status: string
        result?: {
          decryptedValue: string
          signatures: string[]
          extraData: string
        }
        error?: unknown
      }>(res)
      if (!r.result) throw new Error(`relayer: ${res.body.slice(0, 300)}`)
      return {
        handles: body.ciphertextHandles.map((h) => h.slice(2)),
        result: r.result.decryptedValue.replace(/^0x/, ''),
        signatures: r.result.signatures.map((s) => s.replace(/^0x/, '')),
        extraData: (r.result.extraData ?? '0x').replace(/^0x/, ''),
      }
    }
    throw new Error(`relayer: job ${job} did not finish`)
  }

  private async relayer(path: string, body?: unknown): Promise<FetchResult> {
    if (!this.config.relayerKey) {
      throw new Error("Zama's relayer needs ZAMA_RELAYER_API_KEY")
    }
    const res = await fetch(`${ZAMA_RELAYER_URL}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.config.relayerKey,
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    return { status: res.status, body: await res.text() }
  }
}

function parse<T>(res: FetchResult): T {
  try {
    return JSON.parse(res.body) as T
  } catch {
    throw new Error(`${res.status}: ${res.body.slice(0, 200)}`)
  }
}
