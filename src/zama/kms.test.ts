import { expect } from 'earl'
import { countSigners } from './kms'

/** KMSVerifier.getKmsSigners() on Ethereum, 2026-10-02 */
const SIGNERS = new Set([
  '0xe9f7ecff21a2e0ca58ea26ae869fef38ab49ed6f',
  '0xdc472efa1642d5afb684aaaa546e22fb24aab965',
  '0xbf05c17beb0bf2f2c78cd491a53a148e035279c3',
  '0x915055c5f05c0d88bcdf1e3dfba18abd2a18350f',
  '0x41b19eb4585450db79ac03ba9503106ec7895905',
  '0x6e5f02cd4b33f0cf4ed5326ac9ee25e5aa8c4921',
  '0x966188a1f697f6a1b5cfa51495dd8a8a7b5cdb8d',
  '0x5d0e7033774dd43ee546d49b72bd0b561e52f7c8',
  '0xdfc9dcb3d206aa164770874f36a4b5ad2ee5194f',
  '0x7c5eeb4d8ced0101799b8cc212ee874097364f58',
  '0x7c17be232e5968bda9516478b798b9e90d013fcc',
  '0x6016dca5e91e62826e3fea1fb0a763602dc1e385',
  '0xb7978e602d2af68258da614af949e014bf0de0eb',
])

describe('KMS signatures', () => {
  // the relayer's answer for a cUSDC unwrap of 1 USDC (finalized in
  // 0x8845271d…eb59), as Zama's relayer returned it on 2026-10-02
  const handle =
    'e771963a650c211c12560dea88432ea98c72237d63ff00000000000000010500'
  const value =
    '00000000000000000000000000000000000000000000000000000000000f4240'
  const signatures = [
    '12face71d2ddb6d3d6f23700dcd7e23f6bc3b2147a319ff841bb0346e8ff8c972949d8fc508ba9bd52fff958fe067d59263c829b7e894975c2a2cb75cd16fa8b1b',
    'cec10e8e3fdaf6cfd67e004e0d661814bedc1473ed832c45d22ad52a452d0e783fe2912ec93d0d686348f88f1d7a45b5fffe7a361bd839c7d4d124f094f65e151b',
    'fbfbd8ccdcfa703922bbe2b4c4f57b318426d9c55dd0b3f266605ee03a890ecf3beb390a9a31f0d3f3cad0d8d7e5f6b2d47e25203105f8eab6695284321d88901c',
    '3a7cf7631992022d8776aeab862d912e67fb2bab3e13e4803038bf1e89c0b4307278bb35a3d08c600ac43ce52b656630459254b17ef6370a6774a2aa45b0afbe1c',
    '8d47b4df7f5dff2132d09563d6ebd4bd1b9607a520724243a20321e4419aa2894aedd7001e53e65c33569fce12cf396dcdd3a44a26e276bd054d3f119c4b1f791c',
    '5f83217b41759c3b5b19a8f4371f378f568d973ac7be36d237e1d530e41142425497238cf8da8f52909adeebe45fd6fc8d7393a854ce05176d744b8e0929f15f1b',
    '26c5429623eeb06a0a9f14734b33849348d4f347ed85a1ddfcaee6a1273fd5ac14bd6975cf58d5bff1237b70270e0f95235069af95aab6e0a6c5cd08ffc76a201b',
  ]

  it('counts the KMS signers of a public decryption', () => {
    expect(countSigners([handle], value, signatures, '', SIGNERS)).toEqual(7)
  })

  it('finds no signer for another value', () => {
    const other = `${value.slice(0, -1)}1`
    expect(countSigners([handle], other, signatures, '', SIGNERS)).toEqual(0)
  })

  it('counts a signer once', () => {
    const twice = [signatures[0] as string, signatures[0] as string]
    expect(countSigners([handle], value, twice, '', SIGNERS)).toEqual(1)
  })
})
