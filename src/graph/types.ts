/**
 * Shapes of the JSON API, shared by the server and the web UI. Amounts are
 * decimal strings in the confidential token's smallest unit (6 decimals);
 * handles and hashes are hex without 0x; addresses are lowercase with 0x.
 */

/**
 * What the public data says an encrypted amount is: lo <= value <= hi.
 * Equal bounds mean the amount is public. `hi` is absent when nothing
 * bounds it from above.
 */
export interface Amount {
  lo: string
  hi?: string
  /** where an exact value comes from, when one source published it */
  source?: ClearSource
}

export type ClearSource =
  | 'wrap'
  | 'finalize'
  | 'disclose'
  | 'verified'
  | 'gateway'
  | 'relayer'
  | 'inferred'

export interface TokenInfo {
  address: string
  symbol: string
  underlying: string
  uSymbol: string | null
  uDecimals: number | null
  rate: string
  decimals: number
}

export interface Status {
  ethBlock: number | null
  gatewayBlock: number | null
  bounds: {
    ops: number
    pairs: number
    rounds: number
    contradictions: number
    at: number
  } | null
  traces: { count: number; at: number } | null
  tokens: TokenInfo[]
}

/** The scoreboard: what the public data reveals, over all tokens */
export interface Stats {
  accounts: number
  transfers: {
    total: number
    /** pinned to one value by the public data */
    exact: number
    /** of which provably zero (failed transfers, decoys) */
    zero: number
    /** known to within a factor of two */
    narrow: number
    /** some upper bound, wider than that */
    bounded: number
  }
  wraps: { total: number }
  unwraps: {
    total: number
    finalized: number
    /** not finalized, but the value is public anyway (Gateway or inferred) */
    pendingKnown: number
    /** not finalized and not yet decrypted: anyone may decrypt it */
    pendingDecryptable: number
  }
  balances: {
    accounts: number
    /** current balance known exactly */
    exact: number
    /** of which exactly zero */
    zero: number
  }
  links: {
    traced: number
    /** all of it provably from one depositor */
    oneDepositor: number
    /** that depositor is the withdrawing address itself */
    self: number
    viaHub: number
    several: number
  }
  readers: {
    delegations: number
    delegates: number
    wildcard: number
    userDecryptions: number
  }
  gateway: {
    publicDecryptions: number
    userDecryptions: number
  }
  /**
   * the vault router sends a leg to every vault to hide which one a user
   * picked; when every other leg is provably zero, the pick is public
   */
  router: { deposits: number; revealed: number; legs: number; zero: number }
  /** accounts with a primary ENS or GNS name */
  named: {
    accounts: number
    /** their withdrawals provably funded in full by one depositor */
    linked: number
    /** their current balance in some token known exactly and not zero */
    exactBalance: number
  }
  byToken: TokenStats[]
}

export interface TokenStats {
  token: string
  symbol: string
  transfers: number
  exact: number
  wraps: number
  unwraps: number
  holders: number
}

export type LiveKind = 'wrap' | 'transfer' | 'unwrap'

export interface LiveEvent {
  kind: LiveKind
  time: number
  tx: string
  token: string
  symbol: string
  from: string
  to: string
  amount: Amount
  handle: string
  /** unwraps: where the funds came from */
  trace?: TraceSummary
  /** unwraps: finalized or still pending */
  finalized?: boolean
}

export interface TraceSummary {
  /**
   * deposit: funded by wraps alone; several: by more than one depositor and
   * none of them provably all; hub: partly through a contract that pools
   * funds; limit: too large to walk; empty: the withdrawal was provably 0
   */
  origin: 'deposit' | 'several' | 'hub' | 'none' | 'limit' | 'empty'
  depositors: number
  sender?: string
  senderMin?: string
  senderMax?: string
  hubs: string[]
  /** pools it went through that return members their own funds */
  via: string[]
}

export interface AddressEvent {
  time: number
  tx: string
  block: number
  log: number
  token: string
  symbol: string
  kind: 'wrap' | 'unwrap' | 'in' | 'out'
  /** the other party: sender, recipient, depositor or receiver */
  counterparty: string
  amount: Amount
  handle: string
  /** the account's balance after this event */
  balance: Amount | null
  balanceHandle: string | null
  /** unwraps: request finalized */
  finalized?: boolean
  /** wraps: who paid for it when not this account */
  depositor?: string
  /** unwraps: who receives the underlying */
  receiver?: string
}

export interface Counterparty {
  address: string
  sent: number
  received: number
  label?: string
}

export interface Link {
  address: string
  /** how many withdrawals */
  withdrawals: number
  /** provably at least this much in total */
  min: string
  token: string
}

export interface Delegation {
  delegator: string
  delegate: string
  contract: string
  expiry: string | null
  time: number
  tx: string
  active: boolean
}

export interface UserDecryption {
  id: string
  time: number
  tx: string
  user: string
  key: string
  handles: string[]
  /** what the handles are, when the index knows them */
  known: { handle: string; what: string; amount: Amount }[]
}

export interface TokenDetail {
  token: TokenInfo
  wraps: { count: number; amount: string }
  unwraps: { count: number; finalized: string; pending: number }
  transfers: number
  holders: number
  /** confidentialTotalSupply() now, and what the public data pins it to */
  supply: { handle: string; amount: Amount } | null
  /** inferredTotalSupply(): the underlying it holds / rate, in clear */
  escrow: string | null
}

export interface AccountInfo {
  address: string
  /** set when the address is a confidential token */
  token?: boolean
  kind: 'eoa' | 'delegated' | 'contract' | 'unknown'
  delegate?: string | null
  name?: string | null
  label?: string
  hub?: string
}

/** A withdrawal that provably came in full from one depositor */
export interface LinkedUnwrap {
  handle: string
  token: string
  symbol: string
  /** the amount, exact */
  amount: string
  time: number
  depositor: string
  burner: string
  receiver: string
  /** pools on the way that only return members their own funds */
  via: string[]
  /** how the page's address or transaction takes part in it */
  role: 'depositor' | 'path' | 'unwrapper' | 'receiver' | 'unwrap'
}

export interface AddressSummary {
  account: AccountInfo
  events: AddressEvent[]
  /** current balance per token */
  balances: { token: string; symbol: string; balance: Amount | null }[]
  counterparties: Counterparty[]
  /** withdrawals linked in full that it is part of, newest first */
  linked: { total: number; rows: LinkedUnwrap[] }
  /** depositors whose wraps provably funded part of its withdrawals */
  fundedBy: Link[]
  /** withdrawals elsewhere this address's wraps provably funded in part */
  funded: Link[]
  /** who can decrypt this account's balances besides itself */
  delegations: Delegation[]
  /** decryptions this address asked the KMS for, on the Gateway (latest) */
  userDecryptions: UserDecryption[]
  /** all of them: requests, and whose balances they were */
  reads: { requests: number; accounts: number; first: number | null }
  /** decryptions of this account's handles asked for by others */
  viewedBy: { user: string; requests: number; last: number }[]
}

export interface ShareRow {
  depositor: string
  wraps: number
  min: string
  max: string | null
  first: number
  last: number
}

export interface UnwrapDetail {
  handle: string
  token: string
  symbol: string
  burner: string
  receiver: string
  time: number
  tx: string
  amount: Amount
  finalized: boolean
  finTx?: string
  finTime?: number
  finalizer?: string | null
  decryptable: boolean
  trace?: TraceSummary & { truncated: boolean; cut: boolean; events: number }
  shares: ShareRow[]
  /** the history as a graph, for drawing */
  graph?: HistoryGraph
}

export interface HistoryNode {
  /** `${account}` */
  id: string
  account: string
  kind: 'account' | 'deposit' | 'hub' | 'target'
  label?: string
  /** deposits: depositor and amount */
  depositor?: string
  amount?: Amount
  time?: number
}

export interface HistoryEdge {
  from: string
  to: string
  amount: Amount
  time: number
  tx: string
  count: number
}

export interface HistoryGraph {
  nodes: HistoryNode[]
  edges: HistoryEdge[]
  truncated: boolean
}

export interface OpNode {
  /** block and log index of the executor event */
  at: string
  handle: string
  op: string
  /** operands: handles, or a clear value */
  args: ({ handle: string } | { value: string })[]
  caller: string
  tx: string
  time: number
  amount: Amount
  /** what the handle is: a transfer amount, a balance, ... */
  role?: string
}

export interface HandleDetail {
  handle: string
  type: string
  chainId: number
  computed: boolean
  amount: Amount
  clear: {
    source: ClearSource
    value: string
    time: number
    ref: string | null
  }[]
  /** the operation that produced it and its operands, a few levels deep */
  expression: OpNode[]
  /** what uses it */
  usedBy: OpNode[]
  role: string | null
  decryptable: { caller: string; time: number; tx: string } | null
  input: { user: string; caller: string; tx: string } | null
  gateway: {
    id: string
    kind: 'public' | 'user'
    user: string | null
    time: number
    tx: string
  }[]
}

export interface TxDetail {
  hash: string
  block: number
  time: number
  sender: string | null
  target: string | null
  transfers: {
    log: number
    token: string
    symbol: string
    from: string
    to: string
    amount: Amount
    handle: string
  }[]
  ops: OpNode[]
  /** unwraps requested or finalized in it (handles) */
  unwraps: string[]
  /** linked withdrawals whose path goes through it */
  linked: { total: number; rows: LinkedUnwrap[] }
}

export interface ReadersSummary {
  trust: {
    kmsNodes: number
    publicThreshold: number
    userThreshold: number
    coprocessors: number
  }
  delegates: {
    delegate: string
    delegators: number
    contracts: number
    wildcard: number
    active: number
    first: number
    last: number
    userDecryptions: number
    /** accounts whose balance handles it asked the KMS to decrypt */
    viewedAccounts: number
    label?: string
  }[]
  observers: {
    token: string
    observer: string
    added: number
    removed: number | null
  }[]
  decryptors: {
    user: string
    requests: number
    handles: number
    keys: number
    last: number
  }[]
}

/** ENS and GNS primary names by address */
export type Names = Record<string, { ens?: string; gns?: string }>

export interface Resolved {
  type: 'address' | 'tx' | 'handle' | 'unknown'
  value: string
}

/** Pooling contracts: what their own events make public */
export interface BatchMember {
  account: string
  joined: Amount
  joinHandle: string
  claimed?: Amount
  claimHandle?: string
  quit?: Amount
}

export interface BatchRow {
  id: number
  state: 'open' | 'dispatched' | 'finalized' | 'canceled'
  members: BatchMember[]
  /** what the batch unwrapped at dispatch, public */
  total?: Amount
  /** BatchFinalized: to-token units per 10^6 from-token units, public */
  rate?: string
  time: number
}

export interface PriceLevel {
  price: string
  /** PriceLevelRevealed: the sum of the quantities bid at this price */
  total: string | null
  bids: number
  bidders: number
  /** with a single bid, its quantity is the level's total */
  solo?: {
    bidder: string
    paid: Amount
    paidHandle: string
    /** a clear bid placed for an escrow, paid outside the auction */
    external: boolean
  }
}

export interface IntentRow {
  id: string
  maker: string
  time: number
  /** candidate orders: one is real, which one is encrypted */
  candidates: { assetIn: string; assetOut: string }[]
  taker?: string
  outcome: 'settled' | 'reclaimed' | 'open'
  /** what moved per asset at settlement or reclaim */
  legs: { asset: string; amount: Amount; handle: string }[]
}

export interface HubDetail {
  address: string
  kind: string | null
  name: string | null
  label?: string
  counterparties: number
  fromSymbol?: string
  toSymbol?: string
  batches?: BatchRow[]
  auction?: {
    address: string
    bids: number
    bidders: number
    canceled: number
    settlementPrice: string | null
    allocated: string | null
    winners: number
    levels: PriceLevel[]
  }
  intents?: IntentRow[]
}
