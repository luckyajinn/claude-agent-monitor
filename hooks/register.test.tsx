import { expect, test } from 'claude-code/testing'

import {
  applyStep,
  capRows,
  childrenOf,
  costOf,
  costParts,
  describe,
  fill,
  finish,
  isKnownRate,
  newRow,
  prettyModel,
  progressOf,
  revive,
  rootsOf,
  trunc,
  usd,
  validTrail,
} from './track'

const PANE = {
  plugin: 'agent-monitor',
  component: 'Pane',
  requestId: 'agent-monitor',
  props: {
    title: 'Agents',
    isFocused: false,
    bodyColumns: 70,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const MODEL = 'claude-sonnet-5-5'

const USAGE = {
  model: MODEL,
  input_tokens: 1000,
  output_tokens: 500,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
}

const SPAWN = {
  tool_use_id: 't1',
  prompt: 'look around',
  description: 'Scout the repo',
  subagentType: 'Explore',
  provider: { plugin: 'engine', tier: 'core' },
  parentModel: MODEL,
  background: true,
  fork: false,
} as const

const CHILD = { ...SPAWN, tool_use_id: 't2', description: 'Read the docs', parentAgentId: 'a1' } as const

const STEP = { turnId: 'turn-1', index: 0, model: MODEL, messageCount: 1 } as const

const END = {
  answer: 'done',
  durationMs: 1000,
  isAborted: false,
  turnId: 'turn-1',
  reason: 'answer',
} as const

// What the engine beneath the mod does in every test: spawns hand out the
// ids in order, a step asks for a Grep, the clock stands still.
const engine = (
  on: (event: string, hook: (...args: any[]) => unknown) => unknown,
  more: { usage?: () => unknown; list?: () => unknown } = {},
  ids = ['a1', 'b1'],
) => {
  let next = 0

  on('command.register', () => ({ value: { command: 'agent-monitor' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('clock.now', () => ({ value: 1000 }))
  on('session.usage', more.usage ?? (() => ({ value: { startedAt: 0, context: {}, rateLimits: [] } })))
  on('agent.list', more.list ?? (() => ({ value: [] })))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('agent.spawn', () => ({ model: MODEL, agentId: ids[next++] }))
  on('turn.step', async function* (_: unknown, e: { turnId: string; index: number }) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [{ name: 'Grep', input: { pattern: 'TODO' } }],
      stopReason: 'tool_use',
      usage: USAGE,
    }
  })
  on('turn.complete', () => ({ text: '' }))
  on('prompt.submit', (_: unknown, e: { text: string }) => ({ text: e.text }))
}

test('the pure helpers classify, price, estimate and shape', () => {
  expect(describe('Grep', { pattern: 'TODO' })).toEqual({ activity: 'Researching', detail: 'Grep TODO' })
  expect(describe('Bash', { command: 'npm test' }).activity).toBe('Verifying')
  expect(describe('Bash', { command: 'ls' }).activity).toBe('Running commands')
  expect(describe('WebSearch', { query: 'x' }).activity).toBe('Researching the web')
  expect(describe('Agent', { description: 'sub' }).activity).toBe('Delegating')
  expect(describe('mcp__x__y', {}).activity).toBe('Using a connector')
  expect(describe('Edit', { file_path: 'C:\\a\\b.ts' }).detail).toBe('Edit b.ts')

  // 1000 in at $3/M + 500 out at $15/M for a sonnet.
  expect(Math.round(costOf(USAGE) * 1e6)).toBe(10500)
  // Cache reads cost 0.1x input, cache writes 1.25x.
  expect(Math.round(costOf({ ...USAGE, input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000 }) * 100)).toBe(30)
  expect(Math.round(costOf({ ...USAGE, input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 1_000_000 }) * 100)).toBe(375)
  // A model the table does not name uses the default (Sonnet) rate.
  expect(isKnownRate('claude-sonnet-5-5')).toBe(true)
  expect(isKnownRate('mystery-9')).toBe(false)
  expect(costOf({ ...USAGE, model: 'mystery-9' })).toBe(costOf(USAGE))

  expect(usd(0)).toBe('$0.00')
  expect(usd(0.004)).toBe('<$0.01')
  expect(usd(1.234)).toBe('$1.23')
  expect(trunc('abcdef', 4)).toBe('abc…')

  expect(prettyModel('claude-sonnet-5-5')).toBe('Sonnet 5.5')
  expect(prettyModel('claude-opus-4-1-20250805')).toBe('Opus 4.1')
  expect(prettyModel('claude-sonnet-4-20250514')).toBe('Sonnet 4')
  expect(prettyModel('haiku')).toBe('Haiku')
  expect(prettyModel('some-other-model')).toBe('some-other-model')

  const row = applyStep(newRow('a', 'x', 'Explore', MODEL, 0), USAGE, [], 'report')
  expect(row.activity).toBe('Writing report')
  expect(progressOf(row)).toBe(14)
  expect(progressOf({ ...row, steps: 1000 })).toBe(95)
  expect(progressOf({ ...row, status: 'done' })).toBe(100)

  // An ended agent that works again starts its run over and keeps its spend.
  const again = revive({ ...row, status: 'done', endedAt: 5 }, 9)
  expect(again.status).toBe('running')
  expect(again.steps).toBe(0)
  expect(again.costUsd).toBe(row.costUsd)
  expect(revive(row, 9)).toBe(row)

  // A row kept from an earlier version gets the newer fields' defaults.
  const old = fill({ id: 'old', name: 'Old', model: MODEL })
  expect(old.log).toEqual([])
  expect(old.effort).toBeNull()
  expect(old.parentId).toBeNull()
  expect(old.name).toBe('Old')

  // The cost split adds up to the whole, and every step lands in the log.
  const parts = costParts(USAGE)
  expect(Math.round((parts.input + parts.output + parts.cache) * 1e6)).toBe(10500)
  const stepped = applyStep(newRow('s', 's', 'x', MODEL, 0), USAGE, [{ name: 'Bash', input: { command: 'npm test' } }, { name: 'Read', input: {} }], '', {
    effort: 'high',
    messages: 7,
    stop: 'tool_use',
  })
  expect(stepped.log).toEqual(['1. Verifying · npm test (+1)'])
  expect(stepped.effort).toBe('high')
  expect(stepped.messages).toBe(7)
  expect(stepped.contextTokens).toBe(1000)
  expect(Math.round(stepped.costInUsd * 1e6)).toBe(3000)
  expect(Math.round(stepped.costOutUsd * 1e6)).toBe(7500)
  expect(finish(stepped, 'done', 5).status).toBe('done')
  // A failed request (no stop reason) keeps the last one known.
  expect(applyStep(stepped, null, [], '', { stop: null }).stop).toBe('tool_use')
  // The log keeps only the last eight steps.
  let long = newRow('l', 'l', 'x', MODEL, 0)
  for (let i = 0; i < 12; i += 1) {
    long = applyStep(long, null, [], 'text')
  }
  expect(long.log.length).toBe(8)
  expect(long.log[7]).toBe('12. Writing report')
})

test('the cap drops finished rows first, and the tree helpers walk parents', () => {
  const r = (id: string, status: 'running' | 'done', parentId: string | null = null) => ({
    ...newRow(id, id, 'x', MODEL, 0, parentId),
    status,
  })
  const rows = [r('a', 'running'), r('b', 'done'), r('c', 'running'), r('d', 'done')]

  expect(capRows(rows, 3).map(row => row.id)).toEqual(['a', 'c', 'd'])
  expect(capRows(rows, 2).map(row => row.id)).toEqual(['a', 'c'])
  expect(capRows([r('a', 'running'), r('c', 'running')], 1).map(row => row.id)).toEqual(['c'])

  const tree = [r('p', 'running'), r('k', 'running', 'p'), r('g', 'done', 'k'), r('q', 'running')]
  expect(rootsOf(tree).map(row => row.id)).toEqual(['p', 'q'])
  expect(childrenOf(tree, 'p').map(row => row.id)).toEqual(['k'])
  expect(validTrail(tree, ['p', 'k', 'g'])).toEqual(['p', 'k', 'g'])
  expect(validTrail(tree, ['p', 'g'])).toEqual(['p'])
  expect(validTrail(tree, ['gone', 'k'])).toEqual([])
})

test('a subagent appears, works and finishes in the pane', async ($, on) => {
  engine(on, {
    usage: () => ({ value: { startedAt: 0, context: {}, rateLimits: [], cost: { usd: 12.34 } } }),
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.agent.spawn(SPAWN)
  for await (const _chunk of $.turn.step({ ...STEP, agentId: 'a1' })) {
    // The stream's chunks are not the test's concern: its result is.
  }

  let ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Scout the repo/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Researching/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Grep TODO/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Sonnet 5\.5/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /general-purpose/ })).toBeUndefined()
  // Progress is an estimate, drawn with a "~".
  expect(await ui.find({ type: 'Text', text: /~14%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\$0\.01 est\./ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /session \$12\.34/ })).toBeDefined()
  expect(await ui.find({ type: 'Svg' })).toBeDefined()
  await ui.unmount()

  await $.turn.complete({ ...END, agentId: 'a1' })

  // Finished, it stays an expanded card: a tick, the name, 100% and the crab.
  ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /✔/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Scout the repo/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /100%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /~14%/ })).toBeUndefined()
  expect(await ui.find({ type: 'Svg' })).toBeDefined()
  await ui.unmount()
})

test('clicking an agent opens its detail: task, model, progress, tokens, cost, log', async ($, on) => {
  engine(on)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.agent.spawn({ ...SPAWN, prompt: 'Find every TODO in the repo and list them' })
  for await (const _chunk of $.turn.step({ ...STEP, effort: 'high', agentId: 'a1' })) {
    // Drained for its effect on the card.
  }

  // The card at the top level has no detail rows yet.
  let ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Cache read/ })).toBeUndefined()
  await ui.press({ key: 'open-a1' })
  await ui.unmount()

  ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  for (const text of [
    /Task/,
    /Find every TODO in the repo/,
    /Sonnet 5\.5/,
    /claude-sonnet-5-5/,
    /Explore/,
    /Effort/,
    /high/,
    /in the background/,
    /Steps/,
    /Messages/,
    /Last stop/,
    /tool_use/,
    /Input \(uncached\)/,
    /Cache read/,
    /Cache write/,
    /Total in/,
    /Context now/,
    /Cost \(est\.\)/,
    /1\. Researching · Grep TODO/,
  ]) {
    expect(await ui.find({ type: 'Text', text })).toBeDefined()
  }
  // Nothing is inside it, and the crumbs show where we are.
  expect(await ui.find({ type: 'Text', text: /Nothing inside yet/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'crumb-root' })).toBeDefined()
  await ui.unmount()

  // Once it finishes its report is there too.
  await $.turn.complete({ ...END, agentId: 'a1', answer: 'Found 3 TODOs.', usage: USAGE })
  ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Report/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Found 3 TODOs\./ })).toBeDefined()
  await ui.unmount()
})

test('the band keeps what another plugin draws beneath it', async ($, on) => {
  engine(on)
  // Stands for another plugin's band, the usage bar.
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)

    return <Text>5-hour 72%</Text>
  })

  const BAND = {
    plugin: 'agent-monitor',
    component: 'AbovePrompt',
    requestId: 'band',
    props: { hasSurvey: false },
  } as const

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  let ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /5-hour 72%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /agent running/ })).toBeUndefined()
  await ui.unmount()

  await $.agent.spawn(SPAWN)

  ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /1 agent running/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /5-hour 72%/ })).toBeDefined()
  await ui.unmount()
})

test('a turn with no heard steps still lands its cost at the end', async ($, on) => {
  engine(on)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.agent.spawn(SPAWN)
  await $.turn.complete({ ...END, turnId: 'turn-9', agentId: 'a1', usage: USAGE })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /\$0\.01/ })).toBeDefined()
  await ui.unmount()
})

test('a new prompt clears finished work; other submissions do not', async ($, on) => {
  engine(on)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.agent.spawn(SPAWN)
  await $.turn.complete({ ...END, agentId: 'a1', usage: USAGE })

  const shown = async () => {
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    const has = (await ui.find({ type: 'Text', text: /Scout the repo/ })) !== undefined
    await ui.unmount()

    return has
  }

  // A background notification is not a new prompt: the card stays.
  await $.prompt.submit({ text: 'a task finished', origin: { kind: 'notification' } })
  expect(await shown()).toBe(true)

  // A slash command is not one either.
  await $.prompt.submit({ text: '/agent-monitor', command: { name: 'agent-monitor', args: '' }, origin: { kind: 'composer' } })
  expect(await shown()).toBe(true)

  // The person's own prompt starts the pane over.
  await $.prompt.submit({ text: 'next question', origin: { kind: 'composer' } })
  expect(await shown()).toBe(false)
})

test('a card the engine no longer lists as going is dropped at the next prompt', async ($, on) => {
  let listed: { id: string; status: string }[] = []
  engine(on, { list: () => ({ value: listed }) })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.agent.spawn(SPAWN)

  const shown = async () => {
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    const has = (await ui.find({ type: 'Text', text: /Scout the repo/ })) !== undefined
    await ui.unmount()

    return has
  }

  // Still going by the engine's list: it stays through a new prompt.
  listed = [{ id: 'a1', status: 'running' }]
  await $.prompt.submit({ text: 'again', origin: { kind: 'composer' } })
  expect(await shown()).toBe(true)

  // The end was missed and the engine says it is over: the stuck card goes.
  listed = [{ id: 'a1', status: 'completed' }]
  await $.prompt.submit({ text: 'and again', origin: { kind: 'composer' } })
  expect(await shown()).toBe(false)
})

test('an ended agent that works again is running again', async ($, on) => {
  engine(on)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.agent.spawn(SPAWN)
  await $.turn.complete({ ...END, agentId: 'a1', usage: USAGE })

  let ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /✔/ })).toBeDefined()
  await ui.unmount()

  for await (const _chunk of $.turn.step({ ...STEP, turnId: 'turn-2', agentId: 'a1' })) {
    // Drained for its effect on the card.
  }

  ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /~14%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /✔/ })).toBeUndefined()
  await ui.unmount()
})

test('a step from an agent no spawn announced still gets a card', async ($, on) => {
  engine(on)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  for await (const _chunk of $.turn.step({ ...STEP, agentId: 'zz' })) {
    // Drained for its effect on the card.
  }

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Subagent/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /~14%/ })).toBeDefined()
  await ui.unmount()
})

test('clicking an agent opens it like a folder, with a breadcrumb back', async ($, on) => {
  engine(on)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.agent.spawn(SPAWN)
  await $.agent.spawn(CHILD)

  const look = async (check: (ui: Awaited<ReturnType<typeof $.ui.mount>>) => Promise<void>) => {
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await check(ui)
    await ui.unmount()
  }

  // At the top: the parent, with a count of what is inside; the child waits.
  await look(async ui => {
    expect(await ui.find({ type: 'Text', text: /Scout the repo/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /▸ 1/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Read the docs/ })).toBeUndefined()
  })

  // Open it: the child takes its place and a breadcrumb shows where we are.
  let ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'open-a1' })
  await ui.unmount()

  await look(async view => {
    expect(await view.find({ type: 'Text', text: /Read the docs/ })).toBeDefined()
    expect(await view.find({ type: 'Text', text: /Inside · 1/ })).toBeDefined()
    expect(await view.find({ type: 'Button', key: 'crumb-root' })).toBeDefined()
  })

  // The root crumb goes back up.
  ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'crumb-root' })
  await ui.unmount()

  await look(async view => {
    expect(await view.find({ type: 'Text', text: /Read the docs/ })).toBeUndefined()
    expect(await view.find({ type: 'Button', key: 'crumb-root' })).toBeUndefined()
  })
})

test('Clear all empties the pane', async ($, on) => {
  engine(on)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.agent.spawn(SPAWN)

  let ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'clear' })
  await ui.unmount()

  ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text' }))?.text).toContain('No subagents yet')
  await ui.unmount()
})

test('state saved by an older version still draws, in a narrow pane too', async ($, on) => {
  engine(on)
  // The shape the first version stored: no parent, log, effort or cost split.
  const legacy = {
    id: 'old1',
    name: 'Legacy agent',
    type: 'Explore',
    model: MODEL,
    status: 'done',
    steps: 3,
    activity: 'Done',
    detail: '',
    inputTokens: 10,
    outputTokens: 20,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0.5,
    startedAt: 0,
    endedAt: 4000,
  }
  on('state.get', (_: unknown, e: { key?: string }) => ({
    value: { value: e.key === 'path' ? [] : [legacy], version: 1 },
  }))

  for (const bodyColumns of [30, 70]) {
    const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns }, surface: 'desktop' })
    expect(await ui.find({ type: 'Text', text: /Legacy agent/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\$0\.50 est\./ })).toBeDefined()
    await ui.unmount()
  }
})

test('the task and report stay out of shared state', async ($, on) => {
  engine(on)
  const written: unknown[] = []
  on('state.set', (_: unknown, e: unknown) => {
    written.push(e)

    return { value: { version: 1 } }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.agent.spawn({ ...SPAWN, prompt: 'SECRET-TASK-TEXT' })
  await $.turn.complete({ ...END, agentId: 'a1', answer: 'SECRET-REPORT-TEXT', usage: USAGE })

  expect(written.length).toBeGreaterThan(0)
  expect(JSON.stringify(written)).not.toContain('SECRET-TASK-TEXT')
  expect(JSON.stringify(written)).not.toContain('SECRET-REPORT-TEXT')
})

test('the terminal draws the same cards as text', async ($, on) => {
  engine(on)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.agent.spawn(SPAWN)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Scout the repo/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /o_o/ })).toBeDefined()
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  await ui.unmount()
})

test('the pane says so before any subagent starts', async ($, on) => {
  engine(on)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text' }))?.text).toContain('No subagents yet')
  await ui.unmount()
})
