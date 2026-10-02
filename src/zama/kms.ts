import { secp256k1 } from '@noble/curves/secp256k1'
import { keccak_256 } from '@noble/hashes/sha3'
import type { JsonRpc } from '../eth/rpc'
import { GATEWAY, GATEWAY_CHAIN_ID, HOST } from '../protocol'

const enc = new TextEncoder()
const keccak = (data: Uint8Array) => keccak_256(data)
const hexBytes = (h: string) => Buffer.from(h.replace(/^0x/, ''), 'hex')
const word = (b: Uint8Array) => Buffer.concat([Buffer.alloc(32 - b.length), b])

/**
 * EIP-712 domain the KMS nodes sign public decryption results under, as
 * the host KMSVerifier checks them (`KMSVerifier.sol`, `eip712Domain()` on
 * Ethereum: name "Decryption", version "1", the Gateway chain and its
 * Decryption contract).
 */
const DOMAIN_SEPARATOR = keccak(
  Buffer.concat([
    keccak(
      enc.encode(
        'EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)',
      ),
    ),
    keccak(enc.encode('Decryption')),
    keccak(enc.encode('1')),
    word(Buffer.from(GATEWAY_CHAIN_ID.toString(16).padStart(8, '0'), 'hex')),
    word(hexBytes(GATEWAY.decryption)),
  ]),
)

const TYPEHASH = keccak(
  enc.encode(
    'PublicDecryptVerification(bytes32[] ctHandles,bytes decryptedResult,bytes extraData)',
  ),
)

/** The digest KMS nodes sign for a public decryption result */
export function decryptionDigest(
  handles: string[],
  result: string,
  extraData: string,
): Uint8Array {
  const struct = keccak(
    Buffer.concat([
      TYPEHASH,
      keccak(Buffer.concat(handles.map(hexBytes))),
      keccak(hexBytes(result)),
      keccak(hexBytes(extraData)),
    ]),
  )
  return keccak(
    Buffer.concat([Buffer.from([0x19, 0x01]), DOMAIN_SEPARATOR, struct]),
  )
}

/** The address that made a 65-byte (r, s, v) signature over `digest` */
export function recoverSigner(
  digest: Uint8Array,
  signature: string,
): string | undefined {
  const sig = hexBytes(signature)
  if (sig.length !== 65) return undefined
  const v = sig[64] as number
  const recovery = v >= 27 ? v - 27 : v
  try {
    const s = secp256k1.Signature.fromCompact(
      sig.subarray(0, 64),
    ).addRecoveryBit(recovery)
    const point = s.recoverPublicKey(digest).toRawBytes(false)
    const address = keccak(point.subarray(1)).subarray(12)
    return `0x${Buffer.from(address).toString('hex')}`
  } catch {
    return undefined
  }
}

/**
 * How many distinct KMS signers of `signers` signed this result. The host
 * accepts it when that number reaches the public decryption threshold.
 */
export function countSigners(
  handles: string[],
  result: string,
  signatures: string[],
  extraData: string,
  signers: Set<string>,
): number {
  const digest = decryptionDigest(handles, result, extraData)
  const found = new Set<string>()
  for (const s of signatures) {
    const a = recoverSigner(digest, s)
    if (a && signers.has(a)) found.add(a)
  }
  return found.size
}

/** The current KMS signer set and threshold, read from the host KMSVerifier */
export async function kmsSigners(
  rpc: JsonRpc,
): Promise<{ signers: Set<string>; threshold: number }> {
  const [signers, threshold] = await rpc.ethCalls([
    { to: HOST.kmsVerifier, data: '0x7eaac8f2' }, // getKmsSigners()
    { to: HOST.kmsVerifier, data: '0xe75235b8' }, // getThreshold()
  ])
  const words = (signers ?? '0x').slice(2).match(/.{64}/g) ?? []
  const n = Number(BigInt(`0x${words[1] ?? '0'}`))
  const list = words.slice(2, 2 + n).map((w) => `0x${w.slice(24)}`)
  return {
    signers: new Set(list),
    threshold: Number(BigInt(threshold ?? '0x0')),
  }
}
