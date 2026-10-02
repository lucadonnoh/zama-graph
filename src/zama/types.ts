/** What Zama's relayer answers */

export interface PublicDecryption {
  handles: string[]
  /** ABI-encoded values, hex without 0x */
  result: string
  signatures: string[]
  extraData: string
}
