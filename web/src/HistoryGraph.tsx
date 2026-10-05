import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  HistoryGraph as Graph,
  HistoryNode,
  UnwrapDetail,
} from '../../src/graph/types'
import { compact, date, shortHex } from './format'
import { labelOf, useLabels } from './labels'
import { nameOf, useNames } from './names'
import { Section, visibility } from './ui'

const W = 164
const H = 34
const COL = 76
const ROW = 12
const PAD = 16
/** Room on the left for edges that come back into the first column */
const LEFT = 48
/** Distance between two edges that run side by side */
const LANE = 4
/** Graphs with more edges show amounts on hover only: they would overlap */
const LABELS = 30

/** Every transfer that can have funded a withdrawal, as a graph */
export function History({ d }: { d: UnwrapDetail }) {
  if (!d.graph || d.graph.edges.length <= 1) return null
  return (
    <Section
      title="History"
      note={`every transfer that can have funded it${d.graph.truncated ? ', newest part' : ''}`}
    >
      <HistoryGraph graph={d.graph} />
    </Section>
  )
}

interface Route {
  d: string
  /** where the label goes */
  lx: number
  ly: number
  /** against the flow of the layout: back into a column on the left */
  back: boolean
}

interface Placed {
  node: HistoryNode
  x: number
  y: number
  col: number
}

/**
 * A withdrawal's history drawn left to right: the withdrawal on the right,
 * every account and deposit in the column of how many transfers it is away
 * from it. Transfers between two accounts are one edge with the sum of
 * their bounds. Hubs are drawn once; the walk does not enter them. Edges
 * that go back (loops) are on request: every node already reaches the
 * withdrawal without them.
 */
export function HistoryGraph({ graph }: { graph: Graph }) {
  useLabels()
  const names = useNames(graph.nodes.map((n) => n.account))
  const [hover, setHover] = useState<string>()
  const layout = useMemo(() => place(graph), [graph])
  const routed = useMemo(() => route(graph, layout), [graph, layout])
  const [loops, setLoops] = useState(false)
  const back = [...routed.routes.values()].filter((r) => r.back).length
  const shown = graph.edges.length - (loops ? 0 : back)
  const scroller = useRef<HTMLDivElement>(null)
  // too wide to show at once: start at the withdrawal, on the right
  useEffect(() => {
    const el = scroller.current
    if (el && graph && el.scrollWidth > el.clientWidth) {
      el.scrollLeft = el.scrollWidth
    }
  }, [graph])
  const width = LEFT + (layout.cols + 1) * (W + COL) - COL + PAD
  const height = (loops ? routed.bottom : routed.nodesBottom) + PAD + 18
  return (
    <div className="grid gap-2">
      <div className="overflow-x-auto" ref={scroller}>
        <svg
          width={width}
          height={height}
          role="img"
          aria-label="history of the withdrawal"
          style={{ fontSize: 11 }}
        >
          <title>History of the withdrawal</title>
          {graph.edges.map((e) => {
            const r = routed.routes.get(`${e.from}>${e.to}`)
            if (!r || (r.back && !loops)) return null
            const v = visibility(e.amount)
            const zero = e.amount.hi === '0'
            const on = hover === e.from || hover === e.to
            const label =
              v === 'public' || v === 'derived'
                ? compact(e.amount.lo)
                : e.amount.hi !== undefined
                  ? `≤${compact(e.amount.hi)}`
                  : ''
            return (
              <g key={`${e.from}>${e.to}`} opacity={hover && !on ? 0.25 : 1}>
                <path
                  d={r.d}
                  fill="none"
                  strokeDasharray={r.back ? '4 3' : undefined}
                  strokeLinejoin="round"
                  stroke={
                    zero
                      ? 'var(--hairline)'
                      : v === 'derived'
                        ? 'var(--mark-line)'
                        : 'var(--axis)'
                  }
                  strokeWidth={Math.min(4, 1 + Math.log10(e.count))}
                >
                  <title>
                    {`${e.count} transfer${e.count === 1 ? '' : 's'}, last ${date(e.time)}`}
                  </title>
                </path>
                {/* edges going back cross others: their labels on hover */}
                {label && (on || (!r.back && shown <= LABELS)) && (
                  <text
                    x={r.lx}
                    y={r.ly}
                    textAnchor="middle"
                    fill="var(--muted)"
                    className="mono"
                  >
                    {label}
                    {e.count > 1 ? ` ×${e.count}` : ''}
                  </text>
                )}
              </g>
            )
          })}
          {layout.nodes.map((p) => (
            <NodeBox
              key={p.node.id}
              p={p}
              name={nameOf(names, p.node.account)}
              dim={!!hover && hover !== p.node.id}
              onHover={setHover}
            />
          ))}
        </svg>
      </div>
      {back > 0 && (
        <div>
          <button
            type="button"
            className={`toggle text-xs ${loops ? 'on' : ''}`}
            onClick={() => setLoops((x) => !x)}
            title="transfers back towards earlier accounts: funds that went round, often through a pool; no account depends on them to reach the withdrawal"
          >
            loops ({back})
          </button>
        </div>
      )}
    </div>
  )
}

/** A path through these points, its corners rounded */
function rounded(points: [number, number][], radius = 6): string {
  const [first, ...rest] = points
  if (!first) return ''
  let d = `M${first[0]},${first[1]}`
  for (let i = 0; i < rest.length; i++) {
    const p = rest[i] as [number, number]
    const prev = points[i] as [number, number]
    const next = rest[i + 1]
    if (!next) {
      d += ` L${p[0]},${p[1]}`
      break
    }
    const towards = (q: [number, number], r: number): [number, number] => {
      const dx = q[0] - p[0]
      const dy = q[1] - p[1]
      const len = Math.hypot(dx, dy) || 1
      const k = Math.min(r, len / 2) / len
      return [p[0] + dx * k, p[1] + dy * k]
    }
    const a = towards(prev, radius)
    const b = towards(next, radius)
    d += ` L${a[0]},${a[1]} Q${p[0]},${p[1]} ${b[0]},${b[1]}`
  }
  return d
}

/**
 * Where each edge runs. Edges to the right are curves from side to side.
 * Edges that go back (the funds went round, through a pool) never cross
 * a node: they run in the gaps between columns, and under the whole graph
 * to reach a column on the left.
 */
function route(
  graph: Graph,
  layout: ReturnType<typeof place>,
): { routes: Map<string, Route>; bottom: number; nodesBottom: number } {
  const byId = new Map(layout.nodes.map((p) => [p.node.id, p]))
  const nodesBottom = Math.max(0, ...layout.nodes.map((p) => p.y + H))
  const routes = new Map<string, Route>()
  let lanes = 0
  let brackets = 0
  for (const e of graph.edges) {
    const a = byId.get(e.from)
    const b = byId.get(e.to)
    if (!a || !b) continue
    const key = `${e.from}>${e.to}`
    const ya = a.y + H / 2
    const yb = b.y + H / 2
    if (a.x < b.x) {
      const x1 = a.x + W
      const x2 = b.x
      const mx = (x1 + x2) / 2
      routes.set(key, {
        d: `M${x1},${ya} C${mx},${ya} ${mx},${yb} ${x2},${yb}`,
        lx: mx,
        ly: (ya + yb) / 2 - 3,
        back: false,
      })
    } else if (a.x === b.x) {
      // within a column: a bracket in the gap on its right
      const k = brackets++ % 8
      const cx = a.x + W + 8 + k * LANE
      routes.set(key, {
        d: rounded([
          [a.x + W, ya],
          [cx, ya],
          [cx, yb],
          [b.x + W, yb],
        ]),
        lx: cx + 18,
        ly: (ya + yb) / 2,
        back: true,
      })
    } else {
      // to a column on the left: down the gap, under everything, up the gap
      const k = lanes++
      const offset = (k % 8) * LANE
      const right = a.x + W + 8 + offset
      const left = b.x - 8 - offset
      const ly = nodesBottom + 14 + k * LANE
      routes.set(key, {
        d: rounded([
          [a.x + W, ya],
          [right, ya],
          [right, ly],
          [left, ly],
          [left, yb],
          [b.x, yb],
        ]),
        lx: (right + left) / 2,
        ly: ly - 3,
        back: true,
      })
    }
  }
  return {
    routes,
    bottom: lanes > 0 ? nodesBottom + 14 + lanes * LANE : nodesBottom,
    nodesBottom,
  }
}

const STROKE: Record<HistoryNode['kind'], string> = {
  account: 'var(--axis)',
  deposit: 'var(--deposit)',
  hub: 'var(--hub)',
  target: 'var(--withdrawal)',
}

function NodeBox({
  p,
  name: ens,
  dim,
  onHover,
}: {
  p: Placed
  name: string | undefined
  dim: boolean
  onHover: (id: string | undefined) => void
}) {
  const n = p.node
  const l = labelOf(n.account)
  const title =
    n.kind === 'deposit'
      ? 'wraps paid by'
      : n.kind === 'target'
        ? 'withdrawal to'
        : n.kind === 'hub'
          ? 'pooling contract'
          : ''
  const name = l?.label ?? ens ?? shortHex(n.account, 5)
  return (
    <a
      href={`#${n.account}`}
      onMouseEnter={() => onHover(n.id)}
      onMouseLeave={() => onHover(undefined)}
    >
      <g transform={`translate(${p.x},${p.y})`} opacity={dim ? 0.5 : 1}>
        <rect
          width={W}
          height={H}
          rx={6}
          fill="var(--surface)"
          stroke={STROKE[n.kind]}
          strokeWidth={n.kind === 'account' ? 1 : 1.5}
        />
        <text x={8} y={13} fill="var(--muted)" style={{ fontSize: 9 }}>
          {title}
        </text>
        <text
          x={8}
          y={title ? 27 : 21}
          fill="var(--ink)"
          className={l ? '' : 'mono'}
        >
          {clip(
            name,
            n.kind === 'target' && n.amount ? ` · ${compact(n.amount.lo)}` : '',
          )}
        </text>
        <title>{`${n.account}${l ? `\n${l.label}` : ''}`}</title>
      </g>
    </a>
  )
}

/** A name and its suffix in the width of a node */
function clip(name: string, suffix: string): string {
  const room = 22 - suffix.length
  return `${name.length > room ? `${name.slice(0, room - 1)}…` : name}${suffix}`
}

/**
 * Columns by distance to the withdrawal (fewest transfers away), rows by
 * the mean row of each node's neighbours on the right, a few sweeps
 */
function place(graph: Graph): { nodes: Placed[]; cols: number; rows: number } {
  const out = new Map<string, string[]>()
  const into = new Map<string, string[]>()
  for (const e of graph.edges) {
    out.set(e.from, [...(out.get(e.from) ?? []), e.to])
    into.set(e.to, [...(into.get(e.to) ?? []), e.from])
  }
  const target = graph.nodes.find((n) => n.kind === 'target')
  const dist = new Map<string, number>()
  if (target) {
    dist.set(target.id, 0)
    const queue = [target.id]
    while (queue.length > 0) {
      const id = queue.shift() as string
      for (const from of into.get(id) ?? []) {
        if (!dist.has(from)) {
          dist.set(from, (dist.get(id) ?? 0) + 1)
          queue.push(from)
        }
      }
    }
  }
  const max = Math.max(0, ...dist.values())
  const cols = new Map<number, HistoryNode[]>()
  for (const n of graph.nodes) {
    const c = max - (dist.get(n.id) ?? max)
    cols.set(c, [...(cols.get(c) ?? []), n])
  }
  // order: right to left by the mean position of the successors
  const row = new Map<string, number>()
  const order = [...cols.keys()].sort((a, b) => b - a)
  for (let sweep = 0; sweep < 3; sweep++) {
    for (const c of order) {
      const list = cols.get(c) ?? []
      const key = (n: HistoryNode) => {
        const next = (out.get(n.id) ?? [])
          .map((m) => row.get(m))
          .filter((x): x is number => x !== undefined)
        return next.length
          ? next.reduce((a, b) => a + b, 0) / next.length
          : (row.get(n.id) ?? 0)
      }
      list.sort((a, b) => key(a) - key(b))
      list.forEach((n, i) => void row.set(n.id, i))
    }
  }
  const rows = Math.max(1, ...[...cols.values()].map((l) => l.length))
  const nodes: Placed[] = []
  for (const [c, list] of cols) {
    const offset = ((rows - list.length) * (H + ROW)) / 2
    list.forEach((n, i) => {
      nodes.push({
        node: n,
        col: c,
        x: LEFT + c * (W + COL),
        y: PAD + offset + i * (H + ROW),
      })
    })
  }
  return { nodes, cols: max, rows }
}
