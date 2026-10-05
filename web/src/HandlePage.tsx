import type { HandleDetail, OpNode } from '../../src/graph/types'
import { api, useApi } from './api'
import { gatewayTxUrl, shortHex, units } from './format'
import {
  Address,
  Amount,
  Handle,
  Loading,
  Muted,
  Section,
  SOURCE,
  Time,
  Tx,
} from './ui'

/**
 * One ciphertext handle. Its 32 bytes are mostly a hash of the operation
 * that made it, its operands and the block, so its whole expression is
 * public: the tree below goes down to clear constants, inputs and values
 * somebody decrypted.
 */
export function HandlePage({ handle }: { handle: string }) {
  const { data: d, error } = useApi(api.handle, handle)
  if (!d) return <Loading error={error} />
  return (
    <>
      <section className="card grid gap-2 p-3">
        <Layout d={d} />
        <div className="flex flex-wrap items-baseline gap-x-3 text-base">
          <span className="font-semibold">
            <Amount a={d.amount} handle={d.handle} />
          </span>
          {d.role && <span className="text-ink-2">{d.role}</span>}
        </div>
        <div className="grid gap-1 text-xs text-ink-2">
          {d.clear.map((c) => (
            <div key={c.source}>
              {SOURCE[c.source] ?? c.source}:{' '}
              <span className="mono">{units(c.value)}</span>{' '}
              <Muted>
                <Time t={c.time} />{' '}
              </Muted>
              {c.ref &&
                (c.source === 'gateway' ? (
                  <Muted>decryption {shortHex(c.ref, 4)}</Muted>
                ) : c.source === 'relayer' ? (
                  <Muted>
                    {c.ref.replace('kms:', 'signed by ')} KMS signers
                  </Muted>
                ) : (
                  <Tx hash={c.ref.replace(/^0x/, '')} />
                ))}
            </div>
          ))}
          {d.decryptable && (
            <div>
              <span className="chip chip-warning">publicly decryptable</span>{' '}
              since <Time t={d.decryptable.time} />, by{' '}
              <Address address={d.decryptable.caller} /> in{' '}
              <Tx hash={d.decryptable.tx} />
            </div>
          )}
          {d.input && (
            <div>
              encrypted input of <Address address={d.input.user} /> for{' '}
              <Address address={d.input.caller} /> in <Tx hash={d.input.tx} />
            </div>
          )}
        </div>
      </section>
      {d.expression.length > 0 && (
        <Section title="Computation" note="from FHEVMExecutor events">
          <Tree nodes={d.expression} root={d.handle} />
        </Section>
      )}
      {d.usedBy.length > 0 && (
        <Section title="Used by">
          <OpList ops={d.usedBy} />
        </Section>
      )}
      {d.gateway.length > 0 && (
        <Section title="Decryptions" note="on the Zama Gateway">
          <table className="stack">
            <tbody>
              {d.gateway.map((g) => (
                <tr key={g.id}>
                  <td>
                    <Time t={g.time} />
                  </td>
                  <td>
                    <span className="chip">{g.kind}</span>
                  </td>
                  <td>
                    {g.user ? (
                      <Address address={g.user} />
                    ) : (
                      <Muted>anyone</Muted>
                    )}
                  </td>
                  <td>
                    <a
                      href={gatewayTxUrl(g.tx)}
                      target="_blank"
                      rel="noreferrer"
                      className="mono"
                    >
                      {shortHex(g.tx, 4)} ↗
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}
    </>
  )
}

/** The handle's bytes, by what each part means (FHEVMExecutor.sol:874-899) */
function Layout({ d }: { d: HandleDetail }) {
  const h = d.handle
  const parts: [string, string, string][] = [
    [
      h.slice(0, 42),
      'hash of the operation, its operands, the ACL, chain, parent block and time',
      'var(--ink-2)',
    ],
    [
      h.slice(42, 44),
      d.computed
        ? 'computed by an operation'
        : `input #${Number.parseInt(h.slice(42, 44), 16)}`,
      'var(--mark-line)',
    ],
    [h.slice(44, 60), `chain ${d.chainId}`, 'var(--hub)'],
    [h.slice(60, 62), d.type, 'var(--deposit)'],
    [h.slice(62, 64), 'version', 'var(--muted)'],
  ]
  return (
    <div className="mono break-all text-xs">
      0x
      {parts.map(([hex, title, color]) => (
        <span key={title} title={title} style={{ color }}>
          {hex}
        </span>
      ))}
      <span className="ml-2 text-muted">
        {d.type}, {d.computed ? 'computed' : 'input'}, chain {d.chainId}
      </span>
    </div>
  )
}

function Tree({ nodes, root }: { nodes: OpNode[]; root: string }) {
  const by = new Map(nodes.map((n) => [n.handle, n]))
  const seen = new Set<string>()
  /** `path` is the operand positions from the root: a unique key */
  const render = (h: string, path: string): React.ReactNode => {
    const n = by.get(h)
    if (!n) return null
    const again = seen.has(h)
    seen.add(h)
    return (
      <div key={path} style={{ marginLeft: path ? 16 : 0 }}>
        <div className="flex flex-wrap items-baseline gap-x-2 py-0.5">
          <span className="mono font-semibold">{n.op}</span>
          <Handle h={n.handle} />
          <Amount a={n.amount} handle={n.handle} />
          {n.role && <Muted>{n.role}</Muted>}
          {n.op === 'trivial' || n.args.some((a) => 'value' in a) ? (
            <span className="mono" style={{ color: 'var(--public)' }}>
              clear{' '}
              {n.args
                .filter((a) => 'value' in a)
                .map((a) => ('value' in a ? a.value : ''))
                .join(', ')}
            </span>
          ) : null}
          {again && <Muted>(above)</Muted>}
        </div>
        {!again &&
          withRoles(n.args).map(({ a, role }) =>
            'handle' in a && by.has(a.handle) ? (
              render(a.handle, `${path}/${role}`)
            ) : 'handle' in a ? (
              <div
                key={`${path}/${role}`}
                style={{ marginLeft: 16 }}
                className="py-0.5"
              >
                <Handle h={a.handle} /> <Muted>…</Muted>
              </div>
            ) : null,
          )}
      </div>
    )
  }
  return <div className="text-xs">{render(root, '')}</div>
}

const ROLES = ['lhs', 'rhs', 'third', 'clear']

/** Operands keyed by their position, which is what they mean */
function withRoles(args: OpNode['args']) {
  return args.map((a, j) => ({ a, role: ROLES[j] ?? `arg${j}` }))
}

export function OpList({ ops }: { ops: OpNode[] }) {
  return (
    <table className="stack">
      <tbody>
        {ops.map((o) => (
          <tr key={o.at}>
            <td className="mono font-semibold">{o.op}</td>
            <td className="wide">
              {withRoles(o.args).map(({ a, role }) => (
                <span key={role} className="mr-2">
                  {'handle' in a ? (
                    <Handle h={a.handle} />
                  ) : (
                    <span className="mono">{a.value}</span>
                  )}
                </span>
              ))}
              <Muted>→ </Muted>
              <Handle h={o.handle} />
            </td>
            <td className="whitespace-nowrap text-right">
              <Amount a={o.amount} handle={o.handle} />
            </td>
            <td className="text-ink-2">{o.role}</td>
            <td>
              <Address address={o.caller} />
            </td>
            <td>
              <Tx hash={o.tx} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
