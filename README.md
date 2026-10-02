# zama-graph

Everything shown is derived from Ethereum, the Zama Gateway and what Zama's
KMS publishes to anyone who asks; nothing is inferred beyond what the data
supports.

An explorer for [Zama confidential tokens](https://l2beat.com/privacy/projects/zama-cw):
for every account, transfer and withdrawal it shows what the public data
reveals. In short: every link, and a good part of the amounts.

## Why this exists

Zama confidential tokens wrap ERC-20 tokens into ERC-7984 tokens whose
balances and transfer amounts are encrypted with FHE. The encryption hides
values, not structure:

- Every transfer emits `ConfidentialTransfer(from, to, amountHandle)`. Sender,
  recipient and time are public.
- A wrap publishes its amount in clear (`Wrap`, the ERC-20 transfer and the
  `TrivialEncrypt` plaintext); an unwrap publishes it when it is finalized,
  and the request alone makes the burned amount publicly decryptable.
- Every FHE operation is an `FHEVMExecutor` event that names its operands and
  its result, and a handle is a hash of exactly that. So every encrypted
  amount is a public formula over clear constants, user inputs and earlier
  handles. Only the inputs are secret, and only until someone decrypts them.
- Who can decrypt what (delegations, observers) is in the ACL, and every
  decryption anyone asks the KMS for is a public event on the Zama Gateway,
  with the requesting address.

This tool indexes all of it and computes, for every encrypted amount, the
range the public data pins it to, and for every withdrawal, the deposits
that can have funded it.

## What it finds (2026-10-02, Ethereum block 26,104,257)

- **Links.** All 36,809 transfers, 14,865 wraps and 13,754 unwraps name both
  sides. 9,938 of 10,792 non-empty withdrawals (92%) provably came in full
  from one depositor's wraps, 9,591 of them from the withdrawing address
  itself. Most of these went through the ZAMA auction, whose wallets only
  ever refund a bidder its own payments. 569 went through pools that do mix
  funds (vault claims, the swap's escrows), whose events still name who paid
  in and who took out. 1,508 of the accounts have a primary ENS name, and
  1,589 of their withdrawals are linked to one depositor this way.
- **Amounts.** Every wrap amount is public, and 13,696 of 13,754 unwrap
  amounts: 12,231 finalized, and 1,465 never finalized but public anyway,
  because somebody decrypted them on the Gateway or because the public data
  pins them (434 that nobody ever published). Of 36,809 hidden transfer
  amounts, 7,663 (21%) are pinned to one value (2,871 of them provably zero:
  failed transfers, refunds nobody needed, the vault router's decoy legs),
  1,608 more to within a factor of two.
- **Balances.** 9,008 of 11,829 current balances (account and token) are known
  exactly. The confidential total supply of cUSDC is known to within a few
  hundred cUSDC.
- **Readers.** 7 of 13 KMS operators can decrypt everything together. 256
  active delegations let 9 addresses decrypt other accounts' balances; one of
  them, `0xce32…7337`, holds delegations from 174 accounts and has asked the
  KMS for the balances of 148 of them. The Gateway logged 201,269 user
  decryption requests, each with the address that asked, the handles and the
  public key the answer is re-encrypted for.
- **Pools.** A contract page shows what the pooling contracts publish. The
  vault batchers name every member of every batch (`Joined`, `Claimed`) and
  unwrap each batch total in clear, so a member alone in a batch has a public
  deposit. The vault router hides which vault a user picks by sending a leg
  to every vault; a batch made of decoy legs alone unwraps a total of zero,
  which pins every leg in it to zero. In 172 of 301 router deposits every
  decoy is exposed that way and the pick is public. In the ZAMA auction, 21
  bidders were alone at their price, so the revealed per-price total is their
  quantity and their payment is public. In ConfidentialSwap one market maker,
  `0xa657…1e8a`, took all 121 settlements; it is also the busiest decryptor
  on the Gateway (66,733 requests). There the decoy orders hold: no leg of a
  settlement is pinned to zero.

A fresh sync and derive reproduces these numbers exactly.

The inference is checked against the KMS itself: 16 unwraps that were never
finalized and whose value nobody had published, which the tool pinned from
public data alone, were decrypted through Zama's relayer; all 16 values
agreed, signed by 7 of the 13 KMS signers.

## How amounts are pinned

[`src/fhe/bounds.ts`](src/fhe/bounds.ts) propagates intervals over the whole
operation DAG (715k operations), forward and backward, to a fixpoint. Facts
are every published value (wraps, finalized unwraps, Gateway results,
`PublicDecryptionVerified`, disclosures) and trivial plaintexts. Integer
arithmetic wraps modulo 2^64, so sums only propagate where the intervals rule
out wrapping; a select on an unknown condition gives the hull of its branches.

Plain intervals forget how a select's branches relate. These rules put back
what matters for these tokens, all sound for the executor's semantics:

- **Ledger pairs.** ERC-7984's `_update` debits with `ok = ge(bal, x);
  kept = select(ok, bal - x, bal); sent = select(ok, x, 0)`, so
  `kept + sent = bal` in both branches: the balance ledger.
- **Conditional branches.** A select's branch is refined by its own
  condition: under `ge(bal, x)`, `x <= bal` and `bal - x` does not wrap.
- **Identities and aliases.** `ge(x, x)`, `x - x`, the overflow check of every
  credit, and handles that are provably the same value (a select whose
  condition is decided, `x + 0`, a cast that fits).
- **Supply caps.** No amount or balance exceeds the token's supply at that
  moment, which is at most what was minted so far minus what was provably
  burned.
- **Batch totals.** A vault batcher dispatches with
  `select(ge(balance, total), total, 0)`, and its balance always covers the
  total, so the unwrapped amount is the total: a public zero pins every join.
- **Pool accounts.** A balance is exactly the sum of what the account
  received minus what it sent, and the ZAMA auction's wallets never return a
  bidder more than it paid in. So the auction's part of a bidder's balance is
  at most zero: a bidder who unwrapped what it wrapped holds nothing.

Every transfer is matched to the balance handles it produced, so each
account's balance after each event has a range too. The propagation found
50,418 ledger pairs and no contradiction with any published value. It does
not track relations between amounts beyond these rules, so where funds go
round through contracts the ranges are sound but loose.

## How links are traced

[`src/graph/traces.ts`](src/graph/traces.ts) walks back from each withdrawal
through every transfer that can have carried funds into it, to the wraps at
the start. Two proofs stop the walk early: a transfer whose amount is
provably zero carried nothing, and a balance provably empty after some event
cuts off everything before it. Contracts that pool many users' funds are not
entered ([`src/graph/hubs.ts`](src/graph/hubs.ts)); the vault router is,
because its balance is provably empty after every transaction. The ZAMA
auction's 32 wallets keep an account per bidder and only refund a bidder
what its own bids paid, less its allocation (`AuctionToken`: `refundUser`,
`finalizeRefund`), so a refund is followed back to the bidder's own
payments into the wallet, as if the wallet held one account per bidder.

Wraps are grouped by who paid for them. Each depositor gets a share: at most
what can reach the withdrawal from its wraps (each transfer and balance caps
what passes), at least what all other sources together could not cover. A
withdrawal is linked to a depositor when that minimum is the whole amount.

## Decrypting what is already public

Contracts make some handles publicly decryptable (`makePubliclyDecryptable`):
every unwrap request, batch totals, auction levels. Anyone may then ask the
KMS for their value, and the answer is posted on the Gateway with the KMS
signatures, where the Gateway indexer picks it up like any other result.
`pnpm dev decrypt` asks for the ones nobody has asked for yet (pending
unwraps first) through Zama's hosted relayer, which needs an API key
(`ZAMA_RELAYER_API_KEY`, from Zama's form). Each answer is checked against
the KMS signer set that Ethereum's KMSVerifier accepts
([`src/zama/kms.ts`](src/zama/kms.ts)) before it is stored; every Gateway
result is checked the same way while indexing. It is a command, not part of
the sync, because each request is a Gateway transaction; `--dry` lists what
it would ask for.

## Layout

```
src/protocol.ts       verified constants: contracts, topics, op codes, handle layout
src/eth/              JSON-RPC client, Ethereum indexer (both wrapper eras), contract names
src/gateway/          Zama Gateway indexer: public results (signatures checked), user decryptions
src/fhe/bounds.ts     interval propagation over the operation DAG
src/fhe/derive.ts     loads the DAG and facts, supply caps, balance handles per transfer
src/graph/            ledger model, hubs, traces and shares, stats, API queries, types
src/zama/             KMS signatures, Zama's relayer, decrypt
src/server.ts         JSON API (express)
src/check.ts          consistency checks
web/                  Vite + React UI: live, address, unwrap, tx, handle, readers, method
```

Storage is one SQLite file (`node:sqlite`), one table per kind of fact:
`token`, `xfer`, `wrap`, `unwrap`, `clear`, `op`, `input`, `decryptable`,
`delegation`, `hub_log`, `gw_request`, `gw_handle`, `gw_response`, and the
derived `bound`, `hub`, `trace` and `share`. Handles and transaction hashes
are interned as integers.

## Running

Requires Node 22.13 or later and pnpm.

```sh
pnpm install
cp .env.example .env        # set ETHEREUM_RPC_URL (and ETHERSCAN_API_KEY for contract names)
pnpm sync                   # full history, then derive; --follow keeps tailing and derives every 10 min
pnpm serve                  # API on :3021, serves dist/web when built
pnpm web                    # dev UI on :5173, proxies /api to :3021
pnpm dev:all                # all three above in one terminal
pnpm dev derive             # bounds, hubs, traces and stats now
pnpm dev check              # consistency checks
pnpm dev decrypt --dry      # publicly decryptable handles nobody decrypted
pnpm check                  # typecheck, lint, tests
```

The first sync takes about 20 minutes: the Ethereum logs of the ZAMA auction
in January 2026 are the bulk. A derive takes under a minute. Deployment (UI on GitHub Pages, API behind a Cloudflare
tunnel, systemd units) is in [`deploy/README.md`](deploy/README.md).

## Data sources

- Ethereum JSON-RPC: logs of the registry, the 26 wrappers, the underlying
  ERC-20 transfers into them, the FHEVMExecutor (filtered by the contracts
  that touch the wrappers, 217 so far), the ACL; transaction senders; code
  of every counterparty.
- Zama Gateway JSON-RPC (chain 261131, `https://rpc.mainnet.zama.org`):
  `PublicDecryptionRequest`, `PublicDecryptionResponse` and
  `UserDecryptionRequest` of the Decryption contract.
- Etherscan: verified names of the contracts that take part.
- Zama's relayer, with an API key: public decryptions nobody asked for yet.

## API

```
GET /api/status
GET /api/stats                  the scoreboard
GET /api/live?filter=all|exact|linked|unwraps
GET /api/search/:query          address, tx hash or handle
GET /api/address/:address       ledger with bounds, links, delegations, Gateway views
GET /api/unwrap/:handle         a withdrawal: shares by depositor and its history graph
GET /api/tx/:hash               transfers and the FHE program of a transaction
GET /api/handle/:handle         a handle: expression, bounds, clear values, decryptions
GET /api/readers                KMS, delegates, observers, who decrypts on the Gateway
GET /api/labels                 names of wrappers, hubs, Zama's accounts, verified contracts
```

Amounts are decimal strings in the confidential token's unit (6 decimals);
an amount is `{ lo, hi?, source? }`, exact when `lo = hi`. Hashes and handles
are hex without `0x`.
