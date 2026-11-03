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

export const costOf = (u: Usage): number => {
  const [, input, output] = RATES.find(([pattern]) => pattern.test(u.model)) ?? [
    /./,
    ...DEFAULT_RATE,
  ]

  return (
    (u.input_tokens * input +
      u.output_tokens * output +
      u.cache_read_input_tokens * input * 0.1 +
      u.cache_creation_input_tokens * input * 1.25) /
    1_000_000
  )
}

const short = (text: string, max = 48) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text

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

// The engine knows no percent-complete, so this is a curve over steps taken:
// quick at first, flattening toward 95 until the agent finishes.
export const progressOf = (row: AgentRow): number =>
  row.status === 'done'
    ? 100
    : Math.min(95, Math.round((100 * row.steps) / (row.steps + 6)))

export const newRow = (
  id: string,
  name: string,
  type: string,
  model: string,
  now: number,
): AgentRow => ({
  id,
  name,
  type,
  model,
  status: 'running',
  steps: 0,
  activity: 'Starting',
  detail: '',
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: 0,
  startedAt: now,
  endedAt: null,
})

export const patch = (
  list: AgentRow[],
  id: string,
  fn: (row: AgentRow) => AgentRow,
): AgentRow[] => list.map(row => (row.id === id ? fn(row) : row))

export const addUsage = (row: AgentRow, usage: Usage | null | undefined): AgentRow =>
  usage
    ? {
        ...row,
        model: usage.model,
        inputTokens: row.inputTokens + usage.input_tokens,
        outputTokens: row.outputTokens + usage.output_tokens,
        cacheReadTokens: row.cacheReadTokens + usage.cache_read_input_tokens,
        cacheWriteTokens: row.cacheWriteTokens + usage.cache_creation_input_tokens,
        costUsd: row.costUsd + costOf(usage),
      }
    : row

export const applyStep = (
  row: AgentRow,
  usage: Usage | null,
  toolUses: ReadonlyArray<{ name: string; input: unknown }>,
  answer: string,
): AgentRow => {
  const first = toolUses[0]
  const next = first
    ? describe(first.name, (first.input ?? {}) as Record<string, unknown>)
    : answer !== ''
      ? { activity: 'Writing report', detail: '' }
      : { activity: row.activity, detail: row.detail }

  return addUsage({ ...row, ...next, steps: row.steps + 1 }, usage)
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

export const bar = (percent: number, width = 20): string => {
  const filled = Math.round((percent / 100) * width)

  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

export const usd = (value: number): string =>
  value < 0.01 ? '<$0.01' : `$${value.toFixed(2)}`

export const clock = (ms: number): string => {
  const seconds = Math.max(0, Math.round(ms / 1000))

  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

export const tokens = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)
