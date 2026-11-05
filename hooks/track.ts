import type { AgentRow, AgentStatus } from '../types'

type Usage = {
  model: string
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

// Dollars per million tokens: [model name pattern, input, output]. These are
// assumptions, not a price list: edit them to match what you pay. Cache reads
// are billed at 0.1x input and cache writes at 1.25x.
const RATES: ReadonlyArray<readonly [RegExp, number, number]> = [
  [/haiku/i, 1, 5],
  [/sonnet/i, 3, 15],
  [/opus/i, 5, 25],
  [/fable/i, 15, 75],
]
const DEFAULT_RATE = [3, 15] as const

// False for a model the table does not name: its cost uses the default rate.
export const isKnownRate = (model: string): boolean =>
  RATES.some(([pattern]) => pattern.test(model))

// What a request cost, split as the detail view shows it.
export const costParts = (u: Usage): { input: number; output: number; cache: number } => {
  const [, input, output] = RATES.find(([pattern]) => pattern.test(u.model)) ?? [
    /./,
    ...DEFAULT_RATE,
  ]

  return {
    input: (u.input_tokens * input) / 1_000_000,
    output: (u.output_tokens * output) / 1_000_000,
    cache:
      (u.cache_read_input_tokens * input * 0.1 + u.cache_creation_input_tokens * input * 1.25) /
      1_000_000,
  }
}

export const costOf = (u: Usage): number => {
  const parts = costParts(u)

  return parts.input + parts.output + parts.cache
}

export const trunc = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text

const short = (text: string, max = 48) => trunc(text, max)

const base = (path: unknown) => String(path ?? '').split(/[\\/]/).pop() ?? ''

const VERIFY = /\b(test|tests|pytest|jest|vitest|mocha|tsc|typecheck|eslint|lint|validate|check|build)\b/i

// What a tool call says the agent is doing, from the tool and its arguments.
export const describe = (
  tool: string,
  args: Record<string, unknown>,
): { activity: string; detail: string } => {
  switch (tool) {
    case 'Read':
    case 'NotebookRead':
      return { activity: 'Researching', detail: `Read ${base(args.file_path)}` }
    case 'Grep':
    case 'Glob':
      return { activity: 'Researching', detail: `${tool} ${short(String(args.pattern ?? ''))}` }
    case 'WebSearch':
      return { activity: 'Researching the web', detail: short(String(args.query ?? '')) }
    case 'WebFetch':
      return { activity: 'Researching the web', detail: short(String(args.url ?? '')) }
    case 'Edit':
    case 'Write':
    case 'NotebookEdit':
      return { activity: 'Writing', detail: `${tool} ${base(args.file_path)}` }
    case 'Bash': {
      const command = String(args.command ?? '')

      return {
        activity: VERIFY.test(command) ? 'Verifying' : 'Running commands',
        detail: short(command),
      }
    }
    case 'Agent':
      return { activity: 'Delegating', detail: short(String(args.description ?? '')) }
    default:
      return { activity: tool.startsWith('mcp__') ? 'Using a connector' : 'Working', detail: tool }
  }
}

// The kinds of work an activity falls into: agents doing similar work share a
// colour. `color` is a terminal colour name, `fill` a desktop hex; both are
// mid tones, readable on light and dark themes. Green, yellow and red mean an
// outcome once an agent ends, so the desktop hues here keep clear of them.
export type WorkKind = 'research' | 'web' | 'write' | 'verify' | 'commands' | 'delegate' | 'other'

export type Work = { kind: WorkKind; label: string; color: string; fill: string }

export const workColors: Readonly<Record<WorkKind, Work>> = {
  research: { kind: 'research', label: 'Research', color: 'cyan', fill: '#06b6d4' },
  web: { kind: 'web', label: 'Web research', color: 'blue', fill: '#3b82f6' },
  write: { kind: 'write', label: 'Writing', color: 'magenta', fill: '#d946ef' },
  verify: { kind: 'verify', label: 'Verifying', color: 'green', fill: '#84cc16' },
  commands: { kind: 'commands', label: 'Commands', color: 'yellow', fill: '#f97316' },
  delegate: { kind: 'delegate', label: 'Delegating', color: 'blueBright', fill: '#8b5cf6' },
  other: { kind: 'other', label: 'Other work', color: 'gray', fill: '#64748b' },
}

const WORK_OF: Readonly<Record<string, WorkKind>> = {
  Researching: 'research',
  'Researching the web': 'web',
  Writing: 'write',
  'Writing report': 'write',
  Verifying: 'verify',
  'Running commands': 'commands',
  Delegating: 'delegate',
}

// The kind of work an activity line (from `describe`) names; anything else
// (a connector, an unknown tool, a fresh start) is other work.
export const workOf = (activity: string): Work => workColors[WORK_OF[activity] ?? 'other']

// The kinds of work the given running agents are doing, each once, in the
// table's order: what the pane's colour key lists.
export const workInUse = (rows: readonly AgentRow[]): Work[] => {
  const kinds = new Set(rows.filter(row => row.status === 'running').map(row => workOf(row.activity).kind))

  return Object.values(workColors).filter(work => kinds.has(work.kind))
}

// The engine knows no percent-complete, and an agent's step limit is not in
// any event, so this is a curve over steps taken: quick at first, flattening
// toward 95 until the agent finishes. The pane draws it with a "~".
export const progressOf = (row: AgentRow): number =>
  row.status === 'done'
    ? 100
    : Math.min(95, Math.round((100 * row.steps) / (row.steps + 6)))

// The ETA shows only once there is some basis for it.
export const ETA_MIN_STEPS = 3
export const ETA_MIN_MS = 20_000
// No step for this long: the estimate has failed, so say so.
export const ETA_IDLE_MS = 120_000
// Past this progress the curve is flat, so a number would only mislead.
export const ETA_FINISHING = 90

// Coarse on purpose: nearest 30s up to five minutes, nearest minute after.
const etaClock = (ms: number): string => {
  const seconds = ms <= 300_000 ? Math.round(ms / 30_000) * 30 : Math.round(ms / 60_000) * 60
  const m = Math.floor(seconds / 60)
  const s = seconds % 60

  return m === 0 ? `${s}s` : s === 0 ? `${m}m` : `${m}m ${s}s`
}

// A rough time left for a running agent, from the progress curve: the pace up
// to its latest step gives a total, and the clock counts that total down
// between steps. Null while there is no basis (too few steps, too soon, or a
// row from an earlier version with no step time); a plain phrase when the
// estimate is no use (nearly through the curve, or overdue).
export const etaOf = (row: AgentRow, now: number): string | null => {
  if (
    row.status !== 'running' ||
    row.steps < ETA_MIN_STEPS ||
    now - row.startedAt < ETA_MIN_MS ||
    row.lastStepAt <= row.startedAt
  ) {
    return null
  }
  const percent = progressOf(row)

  if (now - row.lastStepAt >= ETA_IDLE_MS) {
    return 'taking longer than expected'
  }
  if (percent >= ETA_FINISHING) {
    return 'finishing'
  }
  const left = ((row.lastStepAt - row.startedAt) * 100) / percent - (now - row.startedAt)

  return left <= 0 ? 'taking longer than expected' : left < 30_000 ? '<30s left' : `~${etaClock(left)} left`
}

export const newRow = (
  id: string,
  name: string,
  type: string,
  model: string,
  now: number,
  parentId: string | null = null,
  extra: Partial<AgentRow> = {},
): AgentRow => ({
  id,
  parentId,
  name,
  type,
  model,
  status: 'running',
  steps: 0,
  activity: 'Starting',
  detail: '',
  effort: null,
  isBackground: false,
  isFork: false,
  messages: 0,
  contextTokens: 0,
  stop: null,
  log: [],
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: 0,
  costInUsd: 0,
  costOutUsd: 0,
  costCacheUsd: 0,
  startedAt: now,
  endedAt: null,
  lastStepAt: now,
  ...extra,
})

// A row from an earlier version of the mod lacks the newer fields: give it
// their defaults, so state that outlives a reload still draws.
export const fill = (row: Partial<AgentRow> & { id: string }): AgentRow => ({
  ...newRow(row.id, 'Subagent', 'agent', '', 0),
  ...row,
})

export const patch = (
  list: AgentRow[],
  id: string,
  fn: (row: AgentRow) => AgentRow,
): AgentRow[] => list.map(row => (row.id === id ? fn(fill(row)) : row))

// An agent that was done or stopped is working again (it was resumed, or a
// step arrived that no spawn announced): its run starts over, its spend stays.
export const revive = (row: AgentRow, now: number): AgentRow =>
  row.status === 'running'
    ? row
    : {
        ...row,
        status: 'running',
        endedAt: null,
        startedAt: now,
        lastStepAt: now,
        steps: 0,
        activity: 'Starting',
        detail: '',
        log: [],
      }

// At most `max` rows: when over, the oldest finished ones go first, then the
// oldest of any.
export const capRows = (list: AgentRow[], max: number): AgentRow[] => {
  let rows = list

  while (rows.length > max) {
    const at = rows.findIndex(row => row.status !== 'running')
    rows = rows.filter((_, i) => i !== (at === -1 ? 0 : at))
  }

  return rows
}

// The main conversation's own loop has a row too, at the root of the tree:
// every agent it spawns hangs beneath it.
export const MAIN_ID = 'main'
export const MAIN_NAME = 'Main Claude Agent'

export const newMain = (now: number): AgentRow => newRow(MAIN_ID, MAIN_NAME, 'main', '', now, null)

// Rows the main agent spawned before it had a row of its own (or saved by an
// earlier version) have no parent: hang them under the main row.
export const rooted = (list: AgentRow[]): AgentRow[] =>
  list.map(row => (row.id !== MAIN_ID && (row.parentId ?? null) === null ? { ...row, parentId: MAIN_ID } : row))

// True when `id` has a running agent anywhere beneath it.
const runsBelow = (list: AgentRow[], id: string, seen = new Set<string>()): boolean =>
  !seen.has(id) &&
  (seen.add(id), childrenOf(list, id).some(row => row.status === 'running' || runsBelow(list, row.id, seen)))

// One line of the tree beneath a root: a row with the connector its title
// line draws (`lead`, ending in ├── or └──), the one its other lines draw
// (`body`, carrying the │ down to its own children when it has any) and the
// one its children start from (`rest`); or a count of earlier finished rows
// folded away in a sibling group.
export type TreeItem =
  | { kind: 'row'; row: AgentRow; lead: string; body: string; hasKids: boolean }
  | { kind: 'more'; hidden: number; lead: string }

// The descendants of `rootId`, depth first in the order they started. In each
// sibling group, every running row stays, and so does each finished one with
// something running beneath it; past `keep` finished, the earliest fold into
// one "+N earlier finished" line.
export const treeOf = (list: AgentRow[], rootId: string, keep: number): TreeItem[] => {
  const out: TreeItem[] = []
  const seen = new Set<string>([rootId])

  const walk = (parentId: string, prefix: string) => {
    const kids = childrenOf(list, parentId).filter(row => !seen.has(row.id))
    const foldable = kids.filter(row => row.status !== 'running' && !runsBelow(list, row.id))
    const folded = new Set(foldable.slice(0, Math.max(0, foldable.length - keep)).map(row => row.id))
    const shown = kids.filter(row => !folded.has(row.id))
    const count = shown.length + (folded.size > 0 ? 1 : 0)

    shown.forEach((row, i) => {
      seen.add(row.id)
      const last = i === count - 1
      const rest = prefix + (last ? '    ' : '│   ')
      const hasKids = childrenOf(list, row.id).length > 0

      out.push({ kind: 'row', row, lead: prefix + (last ? '└── ' : '├── '), body: rest + (hasKids ? '│   ' : '    '), hasKids })
      walk(row.id, rest)
    })
    if (folded.size > 0) {
      out.push({ kind: 'more', hidden: folded.size, lead: `${prefix}└── ` })
    }
  }

  walk(rootId, '')

  return out
}

export const rootsOf = (list: AgentRow[]): AgentRow[] =>
  list.filter(row => (row.parentId ?? null) === null)

export const childrenOf = (list: AgentRow[], id: string): AgentRow[] =>
  list.filter(row => row.parentId === id)

// The longest prefix of `trail` that still names real rows, each one a child
// of the one before it: a cleared or evicted agent shortens the trail.
export const validTrail = (list: AgentRow[], trail: readonly string[]): string[] => {
  const kept: string[] = []

  for (const id of trail) {
    const row = list.find(one => one.id === id)
    const parent = kept[kept.length - 1] ?? null
    const from = row?.parentId ?? null
    // The first step starts at the top: the main agent, or one beneath it.
    const fits = parent === null ? from === null || from === 'main' : from === parent

    if (row === undefined || !fits) {
      break
    }
    kept.push(id)
  }

  return kept
}

// What a clear leaves behind: every row `isActive` calls going, and every
// ancestor of one, so no card ever sits in the tree without the parent it was
// opened from. The rest (finished, with nothing going beneath) is what goes.
export const survivors = (list: AgentRow[], isActive: (row: AgentRow) => boolean): AgentRow[] => {
  const byId = new Map(list.map(row => [row.id, row]))
  const keep = new Set<string>()

  for (const row of list) {
    if (!isActive(row)) {
      continue
    }
    let at: AgentRow | undefined = row

    // An ancestor already kept has its own ancestors kept: stop there (this
    // also ends a loop, should a parent ever name a child).
    while (at !== undefined && !keep.has(at.id)) {
      keep.add(at.id)
      at = at.parentId == null ? undefined : byId.get(at.parentId)
    }
  }

  return list.filter(row => keep.has(row.id))
}

// The breadcrumb after rows went: untouched while every card it names is still
// there, else cut back to the longest part that is.
export const trailAfter = (list: AgentRow[], trail: string[]): string[] =>
  trail.every(id => list.some(row => row.id === id)) ? trail : validTrail(list, trail)

// Running agents first, then finished ones; newest first within each.
export const ordered = (rows: AgentRow[]): AgentRow[] => {
  const newest = [...rows].reverse()

  return [...newest.filter(row => row.status === 'running'), ...newest.filter(row => row.status !== 'running')]
}

export const addUsage = (row: AgentRow, usage: Usage | null | undefined): AgentRow => {
  if (!usage) {
    return row
  }
  const parts = costParts(usage)

  return {
    ...row,
    model: usage.model,
    inputTokens: row.inputTokens + usage.input_tokens,
    outputTokens: row.outputTokens + usage.output_tokens,
    cacheReadTokens: row.cacheReadTokens + usage.cache_read_input_tokens,
    cacheWriteTokens: row.cacheWriteTokens + usage.cache_creation_input_tokens,
    costInUsd: row.costInUsd + parts.input,
    costOutUsd: row.costOutUsd + parts.output,
    costCacheUsd: row.costCacheUsd + parts.cache,
    costUsd: row.costUsd + parts.input + parts.output + parts.cache,
  }
}

const LOG_LINES = 8

// One model request of the agent: what it asked for, what it cost, how big
// its context is, and a line in its log.
export const applyStep = (
  row: AgentRow,
  usage: Usage | null,
  toolUses: ReadonlyArray<{ name: string; input: unknown }>,
  answer: string,
  meta: { effort?: string | number | null; messages?: number; stop?: string | null; now?: number } = {},
): AgentRow => {
  const first = toolUses[0]
  const next = first
    ? describe(first.name, (first.input ?? {}) as Record<string, unknown>)
    : answer !== ''
      ? { activity: 'Writing report', detail: '' }
      : { activity: row.activity, detail: row.detail }
  const more = toolUses.length > 1 ? ` (+${toolUses.length - 1})` : ''
  const line = `${row.steps + 1}. ${next.activity}${next.detail === '' ? '' : ` · ${next.detail}`}${more}`

  return addUsage(
    {
      ...row,
      ...next,
      steps: row.steps + 1,
      lastStepAt: meta.now ?? row.lastStepAt,
      log: [...row.log, line].slice(-LOG_LINES),
      effort: meta.effort === undefined || meta.effort === null ? row.effort : String(meta.effort),
      messages: meta.messages ?? row.messages,
      // A request that failed has no stop reason: keep the last known one.
      stop: meta.stop ?? row.stop,
      contextTokens: usage
        ? usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens
        : row.contextTokens,
    },
    usage,
  )
}

export const finish = (row: AgentRow, status: AgentStatus, now: number): AgentRow => ({
  ...row,
  status,
  endedAt: now,
  activity: status === 'done' ? 'Done' : status === 'failed' ? 'Failed' : 'Stopped',
  detail: '',
})

// `claude-sonnet-5-5` reads "Sonnet 5.5"; `sonnet` reads "Sonnet"; an id this
// does not know stays as the API spells it.
export const prettyModel = (id: string): string => {
  const m = /^(?:claude-)?(opus|sonnet|haiku|fable)(?:-(\d{1,2}))?(?:-(\d{1,2}))?(?:-\d{8})?(?:\[.*\])?$/i.exec(id)

  if (m === null) {
    return id
  }
  const family = `${m[1]!.charAt(0).toUpperCase()}${m[1]!.slice(1).toLowerCase()}`

  return m[2] === undefined ? family : `${family} ${m[2]}${m[3] === undefined ? '' : `.${m[3]}`}`
}

export type ModelFamily = 'haiku' | 'sonnet' | 'opus' | 'fable'

// The family of a model id, matched as the cost table does: `claude-opus-5-5`,
// `OPUS` and `opus[1m]` are all Opus. Null for an empty or unknown id.
export const familyOf = (model: string): ModelFamily | null => {
  const m = /haiku|sonnet|opus|fable/i.exec(model)

  return m === null ? null : (m[0].toLowerCase() as ModelFamily)
}

export const bar = (percent: number, width = 20): string => {
  const filled = Math.round((percent / 100) * width)

  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

export const usd = (value: number): string =>
  value === 0 ? '$0.00' : value < 0.01 ? '<$0.01' : `$${value.toFixed(2)}`

export const clock = (ms: number): string => {
  const seconds = Math.max(0, Math.round(ms / 1000))

  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

// A stopwatch reading, as the stats tiles show it: 0:47, 12:05, 1:02:09.
export const stopwatch = (ms: number): string => {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = String(seconds % 60).padStart(2, '0')

  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

// Every token the agents have used: input, cache reads and writes, and output.
export const tokenTotal = (rows: AgentRow[]): number =>
  rows.reduce((sum, row) => sum + row.inputTokens + row.cacheReadTokens + row.cacheWriteTokens + row.outputTokens, 0)

// How long the agents going now have been at it: since the earliest of them
// began. Null when none is running.
export const runningFor = (rows: AgentRow[], now: number): number | null => {
  const started = rows.filter(row => row.status === 'running').map(row => row.startedAt)

  return started.length === 0 ? null : now - Math.min(...started)
}

export const tokens = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)
