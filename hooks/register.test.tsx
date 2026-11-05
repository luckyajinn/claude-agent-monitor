import { expect, test } from 'claude-code/testing'

import { crabAlt, crabSvg, crabText, lookOf } from './crab'

import {
  applyStep,
  capRows,
  childrenOf,
  costOf,
  costParts,
  describe,
  ETA_IDLE_MS,
  ETA_MIN_MS,
  ETA_MIN_STEPS,
  etaOf,
  familyOf,
  fill,
  finish,
  isGoing,
  isKnownRate,
  MAIN_ID,
  newMain,
  newRow,
  rooted,
  treeOf,
  prettyModel,
  progressOf,
  revive,
  rootsOf,
  runningFor,
  stopwatch,
  survivors,
  tokenTotal,
  trailAfter,
  trunc,
  usd,
  validTrail,
  workColors,
  workInUse,
  workOf,
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
  more: { usage?: () => unknown; list?: () => unknown; model?: string } = {},
  ids = ['a1', 'b1'],
) => {
  let next = 0

  on('command.register', () => ({ value: { command: 'agent-monitor' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('clock.now', () => ({ value: 1000 }))
  on('session.usage', more.usage ?? (() => ({ value: { startedAt: 0, context: {}, rateLimits: [] } })))
  on('agent.list', more.list ?? (() => ({ value: [] })))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('agent.spawn', () => ({ model: more.model ?? MODEL, agentId: ids[next++] }))
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

test('the ETA waits for a basis, counts down between steps, and admits when it is no use', () => {
  // 6 steps is 50% on the curve; the latest step landed 50s in, so the total
  // is 100s: at 60s there are 40s left, which rounds to the nearest 30s.
  const row = { ...newRow('a', 'x', 'Explore', MODEL, 0), steps: 6, lastStepAt: 50_000 }
  expect(etaOf(row, 60_000)).toBe('~30s left')
  // Counting down between steps: 20s later the same row has 20s left.
  expect(etaOf(row, 80_000)).toBe('<30s left')
  // Reaching the total with a recent step: overdue.
  expect(etaOf(row, 100_000)).toBe('taking longer than expected')
  // No step for two minutes: the estimate has failed, even with time on the clock.
  const early = { ...row, steps: 3, lastStepAt: 60_000 }
  expect(etaOf(early, 60_000 + ETA_IDLE_MS)).toBe('taking longer than expected')
  expect(etaOf(early, 60_000 + ETA_IDLE_MS - 1)).toBe('<30s left')

  // Too few steps, too soon, finished, or a row with no step time: nothing.
  expect(etaOf({ ...row, steps: ETA_MIN_STEPS - 1 }, 60_000)).toBeNull()
  expect(etaOf(row, ETA_MIN_MS - 1)).toBeNull()
  expect(etaOf({ ...row, status: 'done' }, 60_000)).toBeNull()
  expect(etaOf({ ...row, lastStepAt: 0 }, 60_000)).toBeNull()
  expect(etaOf(fill({ id: 'old', steps: 6, startedAt: 0 }), 60_000)).toBeNull()

  // Near the flat end of the curve a number would mislead.
  expect(etaOf({ ...row, steps: 60 }, 60_000)).toBe('finishing')

  // Minutes: nearest 30s to five minutes, nearest minute after.
  const slow = { ...newRow('b', 'x', 'Explore', MODEL, 0), steps: 6, lastStepAt: 100_000 }
  expect(etaOf(slow, 100_000)).toBe('~1m 30s left')
  expect(etaOf({ ...slow, lastStepAt: 1_000_000 }, 1_000_000)).toBe('~17m left')

  // A step stamps its time; a revived agent starts the clock over.
  const stepped = applyStep(newRow('c', 'x', 'Explore', MODEL, 0), USAGE, [], '', { now: 7000 })
  expect(stepped.lastStepAt).toBe(7000)
  expect(revive({ ...stepped, status: 'done' }, 9000).lastStepAt).toBe(9000)
})

test('activities fall into kinds of work, each with its own colour', () => {
  const kindOf = (tool: string, args: Record<string, unknown> = {}) => workOf(describe(tool, args).activity).kind

  // Similar work shares a kind.
  expect(kindOf('Read', { file_path: 'a.ts' })).toBe('research')
  expect(kindOf('Grep', { pattern: 'x' })).toBe('research')
  expect(kindOf('Glob', { pattern: '*' })).toBe('research')
  expect(kindOf('WebSearch', { query: 'x' })).toBe('web')
  expect(kindOf('WebFetch', { url: 'x' })).toBe('web')
  expect(kindOf('Edit', { file_path: 'a.ts' })).toBe('write')
  expect(kindOf('Write', { file_path: 'a.ts' })).toBe('write')
  expect(workOf('Writing report').kind).toBe('write')
  expect(kindOf('Bash', { command: 'npm test' })).toBe('verify')
  expect(kindOf('Bash', { command: 'ls' })).toBe('commands')
  expect(kindOf('Agent', { description: 'x' })).toBe('delegate')
  // A connector, an unknown tool or a fresh start falls to the default.
  expect(kindOf('mcp__x__y')).toBe('other')
  expect(kindOf('SomeNewTool')).toBe('other')
  expect(workOf('Starting').kind).toBe('other')

  // Different kinds differ in both colours.
  const all = Object.values(workColors)
  expect(new Set(all.map(work => work.color)).size).toBe(all.length)
  expect(new Set(all.map(work => work.fill)).size).toBe(all.length)
  expect(workOf('Researching').fill).not.toBe(workOf('Writing').fill)

  // The key lists each kind a running agent is doing, once, and no finished one.
  const r = (activity: string, status: 'running' | 'done' = 'running') => ({
    ...newRow(activity, activity, 'x', MODEL, 0),
    activity,
    status,
  })
  expect(workInUse([r('Researching'), r('Researching'), r('Writing'), r('Verifying', 'done')]).map(w => w.kind)).toEqual([
    'research',
    'write',
  ])
  expect(workInUse([])).toEqual([])
})

test('agents doing similar work share a colour, and the key names what is on screen', async ($, on) => {
  engine(on)
  // Stands for whatever draws beneath the band.
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)

    return <Text>beneath</Text>
  })
  const row = (id: string, activity: string, status: 'running' | 'done' = 'running') => ({
    ...newRow(id, `Agent ${id}`, 'Explore', MODEL, 0),
    activity,
    status,
    steps: 2,
  })
  const rows = [row('r1', 'Researching'), row('r2', 'Researching'), row('w1', 'Writing'), row('d1', 'Done', 'done')]
  let trail: string[] = []
  on('state.get', (_: unknown, e: { key?: string }) => ({
    value: { value: e.key === 'path' ? trail : e.key === 'collapsed' ? false : rows, version: 1 },
  }))
  const colors = async (ui: any, text: RegExp) =>
    (await ui.findAll({ type: 'Text', text })).map((found: any) => found.props.color)
  // The progress bars, by the fill each one draws in.
  const bars = async (ui: any) =>
    (await ui.findAll({ type: 'Svg' }))
      .map((found: any) => String(found.props.source))
      .filter((source: string) => source.includes('viewBox="0 0 100 6"'))
  const count = (sources: string[], fill: string) => sources.filter(source => source.includes(fill)).length

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // Both researchers share a colour; the writer differs; the finished one keeps green.
  expect(await colors(ui, /^Researching$/)).toEqual([workColors.research.fill, workColors.research.fill])
  expect(await colors(ui, /^Writing$/)).toEqual([workColors.write.fill])
  expect(await colors(ui, /^Done$/)).toEqual(['green'])
  const drawn = await bars(ui)
  expect(count(drawn, workColors.research.fill)).toBe(2)
  expect(count(drawn, workColors.write.fill)).toBe(1)
  expect(count(drawn, '#4ade80')).toBe(1)
  // The key lists the two kinds in use, and nothing else.
  expect(await colors(ui, /^● Research$/)).toEqual([workColors.research.fill])
  expect(await colors(ui, /^● Writing$/)).toEqual([workColors.write.fill])
  expect(await ui.find({ type: 'Text', text: /^● Verifying$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Colour key/ })).toBeDefined()
  await ui.unmount()

  // The terminal draws the same colours by name.
  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await colors(term, /^Researching$/)).toEqual([workColors.research.color, workColors.research.color])
  expect(await colors(term, /^Writing$/)).toEqual([workColors.write.color])
  await term.unmount()

  // The band takes the latest running agent's colour.
  const band = await $.ui.mount({
    plugin: 'agent-monitor',
    component: 'AbovePrompt',
    requestId: 'band',
    props: { hasSurvey: false },
    surface: 'desktop',
  })
  expect(await colors(band, /3 agents running/)).toEqual([workColors.write.fill])
  await band.unmount()

  // An opened agent's detail view uses its card's colour.
  trail = ['w1']
  const detail = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await colors(detail, /^Writing$/)).toEqual([workColors.write.fill])
  expect(count(await bars(detail), workColors.write.fill)).toBe(1)
  await detail.unmount()
})

test('the card and the detail show the ETA of a running agent', async ($, on) => {
  engine(on)
  // The test clock stands at 1000: 60s in, 6 steps (50%), latest step 10s ago.
  const running = { ...newRow('r1', 'Slow scout', 'Explore', MODEL, -59_000), steps: 6, lastStepAt: -9000 }
  on('state.get', (_: unknown, e: { key?: string }) => ({
    value: { value: e.key === 'path' ? [] : [running], version: 1 },
  }))

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /~30s left/ })).toBeDefined()
  await ui.unmount()
})

test('the tree hangs every agent under the main one, with connectors and folded finished rows', () => {
  const r = (id: string, status: 'running' | 'done', parentId: string | null) => ({
    ...newRow(id, id, 'Explore', MODEL, 0, parentId),
    status,
  })
  // Rows with no parent (spawned before the main row existed) go under it.
  const list = rooted([newMain(0), r('p', 'running', null), r('k', 'running', 'p'), r('q', 'done', MAIN_ID)])
  expect(list.find(row => row.id === 'p')?.parentId).toBe(MAIN_ID)
  expect(list.find(row => row.id === MAIN_ID)?.parentId).toBeNull()

  const lines = treeOf(list, MAIN_ID, 8).map(item =>
    item.kind === 'row' ? `${item.lead}${item.row.id}|${item.body}` : `${item.lead}+${item.hidden}`,
  )
  expect(lines).toEqual(['├── p|│   │   ', '│   └── k|│           ', '└── q|        '])

  // Past `keep`, the earliest finished fold away; a finished one with a
  // running agent beneath it never does.
  const many = rooted([
    newMain(0),
    r('f1', 'done', null),
    r('f2', 'done', null),
    r('f3', 'done', null),
    r('kid', 'running', 'f1'),
  ])
  const shown = treeOf(many, MAIN_ID, 1).map(item => (item.kind === 'row' ? item.row.id : `+${item.hidden}`))
  expect(shown).toEqual(['f1', 'kid', 'f3', '+1'])
  // A parent loop does not hang the walk.
  expect(treeOf([r('x', 'done', 'y'), r('y', 'done', 'x')], 'x', 8).length).toBe(1)
})

test('the main agent is tracked as the root of the tree, and the band leaves it out', async ($, on) => {
  engine(on)
  on('turn.start', (_: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  // Stands for what draws beneath the band: nothing else here.
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)

    return <Text>below</Text>
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  // The main loop's turn: no agent id.
  await $.turn.start({ text: 'look into the repo', turnId: 'main-1' })
  for await (const _chunk of $.turn.step({ ...STEP, turnId: 'main-1' })) {
    // Only the result matters.
  }

  const BAND = { plugin: 'agent-monitor', component: 'AbovePrompt', requestId: 'band', props: { hasSurvey: false } } as const
  let band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: /agent running/ })).toBeUndefined()
  await band.unmount()

  await $.agent.spawn(SPAWN)
  await $.agent.spawn(CHILD)

  await inPane(
    $,
    async ui => {
      expect(await shows(ui, /Main Claude Agent/)).toBe(true)
      expect(await shows(ui, /Sonnet 5\.5 · 0s · 1 step/)).toBe(true)
      // Scout hangs under the main agent, and its own child under it.
      expect(await shows(ui, /^└── $/)).toBe(true)
      expect(await shows(ui, /^ {4}└── $/)).toBe(true)
      // The main agent's body lines carry the │ down to its first child.
      expect(await shows(ui, /^│ {3}$/)).toBe(true)
    },
    'terminal',
  )

  band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: /2 agents running/ })).toBeDefined()
  await band.unmount()

  // The main turn ends: its row is done, and keeps its task and report.
  await $.turn.complete({ ...END, turnId: 'main-1', usage: USAGE })
  await inPane($, async ui => {
    expect((await ui.findAll({ type: 'Text', text: /^✔/ })).length).toBeGreaterThan(0)
  })
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

test('a clear keeps the active rows and every ancestor of one, and trims the trail only when needed', () => {
  const r = (id: string, status: 'running' | 'done', parentId: string | null = null) => ({
    ...newRow(id, id, 'x', MODEL, 0, parentId),
    status,
  })
  const isRunning = (row: { status: string }) => row.status === 'running'
  const ids = (rows: { id: string }[]) => rows.map(row => row.id)

  // p > k > g (running); q finished with a finished child; z running alone.
  const tree = [r('p', 'done'), r('k', 'done', 'p'), r('g', 'running', 'k'), r('q', 'done'), r('qc', 'done', 'q'), r('z', 'running')]
  expect(ids(survivors(tree, isRunning))).toEqual(['p', 'k', 'g', 'z'])
  // Nothing active: nothing stays. Everything active: everything stays.
  expect(survivors(tree, () => false)).toEqual([])
  expect(survivors(tree, () => true)).toEqual(tree)
  // Order and the rows themselves are kept.
  expect(survivors(tree, isRunning)[0]).toBe(tree[0])

  // A parent that is gone does not stop the walk; a parent loop cannot hang it.
  expect(ids(survivors([r('c', 'running', 'lost'), r('d', 'done')], isRunning))).toEqual(['c'])
  expect(ids(survivors([r('x', 'running', 'y'), r('y', 'done', 'x')], isRunning))).toEqual(['x', 'y'])
  // A row from an older version has no parent field at all.
  const old = { ...r('old', 'running'), parentId: undefined } as never
  expect(ids(survivors([old], isRunning))).toEqual(['old'])

  // The trail is left alone while every card it names is there, else cut back.
  const left = survivors(tree, isRunning)
  const same = ['p', 'k']
  expect(trailAfter(left, same)).toBe(same)
  expect(trailAfter(left, [])).toEqual([])
  expect(trailAfter(left, ['p', 'k', 'g'])).toEqual(['p', 'k', 'g'])
  expect(trailAfter(left, ['q'])).toEqual([])
  expect(trailAfter(left, ['p', 'q'])).toEqual(['p'])
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
  // The session cost the engine keeps is the Total Cost tile.
  expect(await ui.find({ type: 'Text', text: /^\$12\.34$/ })).toBeDefined()
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

  // At the top: the whole tree under the main agent, the parent with a count
  // of what is inside and the child hanging beneath it.
  await look(async ui => {
    expect(await ui.find({ type: 'Text', text: /Main Claude Agent/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Scout the repo/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /▸ 1/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Read the docs/ })).toBeDefined()
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
    expect(await view.find({ type: 'Text', text: /Main Claude Agent/ })).toBeDefined()
    expect(await view.find({ type: 'Button', key: 'crumb-root' })).toBeUndefined()
  })
})

// Helpers for the "Clear finished" tests. `$` is the kit's engine; it is typed
// loosely here so one helper serves every test.
const spawn = ($: any, description: string, parentAgentId?: string) =>
  $.agent.spawn({
    ...SPAWN,
    tool_use_id: `t-${description}`,
    description,
    ...(parentAgentId === undefined ? {} : { parentAgentId }),
  })

const end = ($: any, agentId: string, ending: 'done' | 'stopped' | 'failed' = 'done') =>
  $.turn.complete({
    ...END,
    agentId,
    usage: USAGE,
    ...(ending === 'stopped' ? { isAborted: true, reason: 'aborted' } : {}),
    ...(ending === 'failed' ? { reason: 'error' } : {}),
  })

// Mounts the pane, hands it to `check`, unmounts.
const inPane = async ($: any, check: (ui: any) => Promise<unknown>, surface = 'desktop') => {
  const ui = await $.ui.mount({ ...PANE, surface })
  try {
    return await check(ui)
  } finally {
    await ui.unmount()
  }
}

const pressed = ($: any, key: string, surface = 'desktop') => inPane($, ui => ui.press({ key }), surface)

const shows = (ui: any, text: RegExp) => ui.find({ type: 'Text', text }).then((found: unknown) => found !== undefined)

// The Clear button as drawn: its label, whether it is dimmed, and the note
// beside it (undefined when there is none).
const clearButton = ($: any, surface = 'desktop') =>
  inPane(
    $,
    async ui => {
      const button = await ui.find({ type: 'Button', key: 'clear' })
      const note = await ui.find({ type: 'Text', text: /still running/ })

      return { label: button?.props.label, isDim: button?.props.dimColor === true, note: note?.text }
    },
    surface,
  ) as Promise<{ label: string | undefined; isDim: boolean; note: string | undefined }>

// Stands in for the engine's state store, so a test can read what the mod
// wrote (the test's `$` has no `state` of its own). Returns a reader by key.
const keepState = (on: (event: string, hook: (...args: any[]) => unknown) => unknown) => {
  const held = new Map<string, { value: unknown; version: number }>()
  const at = (e: { plugin: string; key: string }) => `${e.plugin}/${e.key}`

  on('state.get', (_: unknown, e: { plugin: string; key: string }) => ({
    value: held.get(at(e)) ?? { value: undefined, version: 0 },
  }))
  on('state.set', (_: unknown, e: { plugin: string; key: string; value: unknown; ifVersion?: number }) => {
    const now = held.get(at(e)) ?? { value: undefined, version: 0 }

    if (e.ifVersion !== undefined && e.ifVersion !== now.version) {
      return { value: { isSet: false, version: now.version } }
    }
    held.set(at(e), { value: e.value, version: now.version + 1 })

    return { value: { isSet: true, version: now.version + 1 } }
  })

  return (key: string) => held.get(`agent-monitor/${key}`)?.value
}

const START = { cwd: '/', surface: 'desktop', isInteractive: true } as const

test('the stats helpers read a stopwatch, add every token and time the agents going', () => {
  expect(stopwatch(47_000)).toBe('0:47')
  expect(stopwatch(725_000)).toBe('12:05')
  expect(stopwatch(3_729_000)).toBe('1:02:09')
  expect(stopwatch(-5)).toBe('0:00')

  const a = { ...newRow('a', 'x', 'Explore', MODEL, 100), inputTokens: 1, cacheReadTokens: 2, cacheWriteTokens: 3, outputTokens: 4 }
  const b = { ...newRow('b', 'y', 'Explore', MODEL, 400), outputTokens: 10 }
  const c = { ...newRow('c', 'z', 'Explore', MODEL, 0), status: 'done' as const }
  expect(tokenTotal([a, b, c])).toBe(20)
  // The earliest running agent sets the time; a finished one does not count.
  expect(runningFor([a, b, c], 1000)).toBe(900)
  expect(runningFor([c], 1000)).toBeNull()
  expect(runningFor([], 1000)).toBeNull()
})

test('while agents run, a stats row sits above them and a Running bar folds their cards', async ($, on) => {
  engine(on, { usage: () => ({ value: { startedAt: 0, context: {}, rateLimits: [], cost: { usd: 2.38 } } }) }, ['a1', 'b1', 'c1'])
  keepState(on)

  await $.session.start(START)
  await spawn($, 'Scout the repo')
  await spawn($, 'Write the tests')
  await spawn($, 'Lint the code')
  await end($, 'c1')

  await inPane($, async ui => {
    expect(await shows(ui, /^Total Cost$/)).toBe(true)
    expect(await shows(ui, /\$2\.38/)).toBe(true)
    expect(await shows(ui, /^Total Tokens$/)).toBe(true)
    expect(await shows(ui, /^Total time$/)).toBe(true)
    expect((await ui.find({ type: 'Button', key: 'running-toggle' }))?.props.label).toBe('▾ Running · 2')
    expect(await shows(ui, /Scout the repo/)).toBe(true)
  })

  // Folding hides the subagent tree under the main agent, finished ones too.
  await pressed($, 'running-toggle')
  await inPane($, async ui => {
    expect((await ui.find({ type: 'Button', key: 'running-toggle' }))?.props.label).toBe('▸ Running · 2')
    expect(await shows(ui, /Scout the repo/)).toBe(false)
    expect(await shows(ui, /Lint the code/)).toBe(false)
    expect(await shows(ui, /Main Claude Agent/)).toBe(true)
  })

  await pressed($, 'running-toggle')
  await inPane($, async ui => {
    expect(await shows(ui, /Scout the repo/)).toBe(true)
  })

  // Nothing running: no stats row and no bar.
  await end($, 'a1')
  await end($, 'b1')
  await inPane($, async ui => {
    expect(await shows(ui, /^Total Cost/)).toBe(false)
    expect(await ui.find({ type: 'Button', key: 'running-toggle' })).toBeUndefined()
  })
})

test('Clear finished empties a pane of finished agents', async ($, on) => {
  engine(on, {}, ['a1', 'b1', 'c1'])

  await $.session.start(START)
  await spawn($, 'Scout the repo')
  await spawn($, 'Lint the code')
  await spawn($, 'Stop the build')
  await end($, 'a1')
  await end($, 'b1', 'failed')
  await end($, 'c1', 'stopped')

  // Nothing is going, so the button is live and says how many it will clear.
  expect(await clearButton($)).toEqual({ label: 'Clear finished (3)', isDim: false, note: undefined })

  await pressed($, 'clear')

  await inPane($, async ui => {
    expect((await ui.find({ type: 'Text' }))?.text).toContain('No subagents yet')
  })
})

test('Clear finished never removes a running agent; finished ones go', async ($, on) => {
  engine(on, {}, ['a1', 'b1', 'c1', 'd1'])

  await $.session.start(START)
  await spawn($, 'Scout the repo')
  await spawn($, 'Write the tests')
  await spawn($, 'Lint the code')
  await spawn($, 'Stop the build')
  await end($, 'b1')
  await end($, 'c1', 'failed')
  await end($, 'd1', 'stopped')

  await pressed($, 'clear')

  await inPane($, async ui => {
    expect(await shows(ui, /Scout the repo/)).toBe(true)
    expect(await shows(ui, /Write the tests/)).toBe(false)
    expect(await shows(ui, /Lint the code/)).toBe(false)
    expect(await shows(ui, /Stop the build/)).toBe(false)
    expect((await ui.find({ type: 'Button', key: 'running-toggle' }))?.props.label).toBe('▾ Running · 1')
  })

  // Pressing it again changes nothing: it is still running.
  await pressed($, 'clear')
  await inPane($, async ui => {
    expect(await shows(ui, /Scout the repo/)).toBe(true)
  })

  // Once it ends, the next clear takes it.
  await end($, 'a1')
  await pressed($, 'clear')
  await inPane($, async ui => {
    expect((await ui.find({ type: 'Text' }))?.text).toContain('No subagents yet')
  })
})

test('Clear finished keeps an agent the engine lists as pending or waiting', async ($, on) => {
  let listed: { id: string; status: string }[] = []
  engine(on, { list: () => ({ value: listed }) }, ['a1', 'b1', 'c1', 'd1', 'e1'])

  await $.session.start(START)
  for (const name of ['Pending one', 'Waiting one', 'Completed one', 'Idle one', 'Killed one']) {
    await spawn($, name)
  }
  // Every card has ended; the engine still has two of them going.
  for (const id of ['a1', 'b1', 'c1', 'd1', 'e1']) {
    await end($, id)
  }
  listed = [
    { id: 'a1', status: 'pending' },
    { id: 'b1', status: 'waiting' },
    { id: 'c1', status: 'completed' },
    { id: 'd1', status: 'idle' },
    { id: 'e1', status: 'killed' },
  ]

  // The button counts the three it will clear and names the two that stay.
  expect(await clearButton($)).toEqual({
    label: 'Clear finished (3)',
    isDim: false,
    note: '2 still running stay',
  })

  await pressed($, 'clear')

  await inPane($, async ui => {
    expect(await shows(ui, /Pending one/)).toBe(true)
    expect(await shows(ui, /Waiting one/)).toBe(true)
    expect(await shows(ui, /Completed one/)).toBe(false)
    expect(await shows(ui, /Idle one/)).toBe(false)
    expect(await shows(ui, /Killed one/)).toBe(false)
  })

  // When the engine says they are over, they clear like any finished card.
  listed = []
  await pressed($, 'clear')
  await inPane($, async ui => {
    expect((await ui.find({ type: 'Text' }))?.text).toContain('No subagents yet')
  })
})

test('with no list from the engine, Clear finished goes by the cards alone', async ($, on) => {
  engine(
    on,
    {
      list: () => {
        throw new Error('no list')
      },
    },
    ['a1', 'b1'],
  )

  await $.session.start(START)
  await spawn($, 'Scout the repo')
  await spawn($, 'Write the tests')
  await end($, 'b1')

  await pressed($, 'clear')

  await inPane($, async ui => {
    expect(await shows(ui, /Scout the repo/)).toBe(true)
    expect(await shows(ui, /Write the tests/)).toBe(false)
  })
})

test('a finished parent of an active agent stays; finished siblings and strays go', async ($, on) => {
  engine(on, {}, ['a1', 'b1', 'c1', 'd1', 'e1'])

  await $.session.start(START)
  await spawn($, 'Scout the repo') // a1, a root
  await spawn($, 'Read the docs', 'a1') // b1, inside a1
  await spawn($, 'Open the file', 'b1') // c1, inside b1: still running
  await spawn($, 'Unrelated job') // d1, another root
  await spawn($, 'Old helper', 'a1') // e1, inside a1
  for (const id of ['a1', 'b1', 'd1', 'e1']) {
    await end($, id)
  }

  // Three stay: the running agent and the two parents above it.
  expect(await clearButton($)).toEqual({
    label: 'Clear finished (2)',
    isDim: false,
    note: '1 still running stays, with 2 finished parents',
  })

  await pressed($, 'clear')

  // At the top: the finished parent is still there, with one agent inside.
  await inPane($, async ui => {
    expect(await shows(ui, /Scout the repo/)).toBe(true)
    expect(await shows(ui, /▸ 1/)).toBe(true)
    expect(await shows(ui, /Unrelated job/)).toBe(false)
  })

  // Walk down to the running agent: every folder on the way is still there.
  await pressed($, 'open-a1')
  await inPane($, async ui => {
    expect(await shows(ui, /Read the docs/)).toBe(true)
    expect(await shows(ui, /Old helper/)).toBe(false)
    expect(await shows(ui, /Inside · 1/)).toBe(true)
  })
  await pressed($, 'open-b1')
  await inPane($, async ui => {
    expect(await shows(ui, /Open the file/)).toBe(true)
    expect(await shows(ui, /Inside · 1/)).toBe(true)
  })

  // When the running one ends, everything above it is clearable too.
  await end($, 'c1')
  await pressed($, 'clear')
  await inPane($, async ui => {
    expect((await ui.find({ type: 'Text' }))?.text).toContain('No subagents yet')
  })
})

test('Clear finished keeps the breadcrumb pointing at cards that are still there', async ($, on) => {
  engine(on, {}, ['a1', 'b1', 'c1'])
  const held = keepState(on)

  await $.session.start(START)
  await spawn($, 'Scout the repo') // a1
  await spawn($, 'Read the docs', 'a1') // b1: finished, nothing running beneath it
  await spawn($, 'Open the file', 'a1') // c1: running
  await end($, 'a1')
  await end($, 'b1')

  // Open a1, then b1: the breadcrumb is a1 › b1.
  await pressed($, 'open-a1')
  await pressed($, 'open-b1')
  expect(held('path')).toEqual(['a1', 'b1'])

  // b1 goes (finished, a leaf); a1 stays for c1. The crumbs shrink to a1.
  await pressed($, 'clear')
  expect(held('path')).toEqual(['a1'])
  await inPane($, async ui => {
    expect(await ui.find({ type: 'Button', key: 'crumb-root' })).toBeDefined()
    expect(await shows(ui, /Open the file/)).toBe(true)
    expect(await shows(ui, /Read the docs/)).toBe(false)
  })

  // Nothing the crumbs name went this time, so they stay as they are.
  await pressed($, 'clear')
  expect(held('path')).toEqual(['a1'])

  // Once c1 ends everything clears, and the crumbs are emptied with it.
  await end($, 'c1')
  await pressed($, 'clear')
  expect(held('path')).toEqual([])
  await inPane($, async ui => {
    expect((await ui.find({ type: 'Text' }))?.text).toContain('No subagents yet')
  })
})

test('the Clear button is dimmed, and says what stays, when nothing can be cleared', async ($, on) => {
  engine(on, {}, ['a1', 'b1', 'c1'])

  await $.session.start(START)
  await spawn($, 'Scout the repo')
  await spawn($, 'Write the tests')

  // Two running, nothing finished: the button is dimmed, the note says why.
  expect(await clearButton($)).toEqual({
    label: 'Clear finished',
    isDim: true,
    note: '2 still running stay',
  })
  // The terminal draws the same button and the same note as text.
  expect(await clearButton($, 'terminal')).toEqual({
    label: 'Clear finished',
    isDim: true,
    note: '2 still running stay',
  })

  // Pressing the dimmed button does nothing.
  await pressed($, 'clear')
  await inPane($, async ui => {
    expect(await shows(ui, /Scout the repo/)).toBe(true)
    expect(await shows(ui, /Write the tests/)).toBe(true)
    expect((await ui.find({ type: 'Button', key: 'running-toggle' }))?.props.label).toBe('▾ Running · 2')
  })

  // One ends: the button wakes up with a count, and the note shrinks.
  await end($, 'a1')
  expect(await clearButton($)).toEqual({
    label: 'Clear finished (1)',
    isDim: false,
    note: '1 still running stays',
  })
  expect(await clearButton($, 'terminal')).toEqual({
    label: 'Clear finished (1)',
    isDim: false,
    note: '1 still running stays',
  })

  // A parent that is finished but holds a running agent counts as staying:
  // only a1 can be cleared, and the note names the parent that stays.
  await spawn($, 'Nested', 'b1')
  await end($, 'b1')
  expect(await clearButton($)).toEqual({
    label: 'Clear finished (1)',
    isDim: false,
    note: '1 still running stays, with 1 finished parent',
  })
})

test('pressing Clear finished looks at the agents as they are now, not as drawn', async ($, on) => {
  engine(on, {}, ['a1'])

  await $.session.start(START)
  await spawn($, 'Scout the repo')

  // Drawn while it runs: the button is dimmed. The agent ends, then the press
  // arrives: the press looks at the agents as they are now, not as drawn.
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Button', key: 'clear' }))?.props.dimColor).toBe(true)
  await end($, 'a1')
  await ui.press({ key: 'clear' })
  await ui.unmount()

  await inPane($, async view => {
    expect((await view.find({ type: 'Text' }))?.text).toContain('No subagents yet')
  })
})

test('a new prompt and a lost card are cleared as before, and Clear finished leaves the lost one', async ($, on) => {
  let listed: { id: string; status: string }[] = []
  engine(on, { list: () => ({ value: listed }) }, ['a1', 'b1', 'c1', 'd1'])
  const held = keepState(on)

  await $.session.start(START)
  await spawn($, 'Scout the repo') // a1: running, and the engine agrees
  await spawn($, 'Write the tests') // b1: finished
  await spawn($, 'Lint the code') // c1: says running, but the engine lost it
  await end($, 'b1')
  listed = [{ id: 'a1', status: 'running' }]

  // Clear finished takes the finished card only: a card that says "running"
  // stays even when the engine no longer lists it, until the next prompt.
  await pressed($, 'clear')
  await inPane($, async ui => {
    expect(await shows(ui, /Scout the repo/)).toBe(true)
    expect(await shows(ui, /Write the tests/)).toBe(false)
    expect(await shows(ui, /Lint the code/)).toBe(true)
  })

  // Another finished card, and a breadcrumb that points somewhere.
  await spawn($, 'Old report')
  await end($, 'd1')
  await pressed($, 'open-a1')
  expect(held('path')).toEqual(['a1'])

  // The person's next prompt, as before: finished work goes, the card the
  // engine lost goes, the one it still has going stays, and the breadcrumb
  // starts over.
  await $.prompt.submit({ text: 'next question', origin: { kind: 'composer' } })
  expect(held('path')).toEqual([])
  await inPane($, async ui => {
    expect(await shows(ui, /Scout the repo/)).toBe(true)
    expect(await shows(ui, /Old report/)).toBe(false)
    expect(await shows(ui, /Lint the code/)).toBe(false)
  })
})

test('isGoing: a running card the engine names as ended is stuck; one it does not name stays', () => {
  const running = newRow('a', 'x', 'Explore', MODEL, 0)
  const done = finish(newRow('b', 'y', 'Explore', MODEL, 0), 'done', 5)
  const main = newMain(0)
  const listed = (status: string, id = 'a') => new Map([[id, status]])

  // The engine names it with an ended status: the card is stuck, so it can go.
  for (const status of ['completed', 'failed', 'killed', 'idle']) {
    expect(isGoing(running, listed(status))).toBe(false)
  }
  // The engine has it going: it stays.
  for (const status of ['pending', 'running', 'waiting']) {
    expect(isGoing(running, listed(status))).toBe(true)
  }
  // Not named, or no list at all: the card decides, and it says running.
  expect(isGoing(running, new Map())).toBe(true)
  expect(isGoing(running, listed('completed', 'other'))).toBe(true)
  expect(isGoing(running, undefined)).toBe(true)
  // A finished card stays only while the engine has it going.
  expect(isGoing(done, listed('waiting', 'b'))).toBe(true)
  expect(isGoing(done, listed('completed', 'b'))).toBe(false)
  expect(isGoing(done, undefined)).toBe(false)
  // The main agent's running row never goes, whatever a list says of its id.
  expect(isGoing(main, listed('completed', MAIN_ID))).toBe(true)
  expect(isGoing(main, new Map())).toBe(true)
  expect(isGoing(finish(main, 'done', 5), new Map())).toBe(false)
})

test('Clear finished clears a stuck card the engine lists as ended, never a real one', async ($, on) => {
  let listed: { id: string; status: string }[] = []
  let isBroken = false
  const list = () => {
    if (isBroken) {
      throw new Error('no list')
    }

    return { value: listed }
  }
  engine(on, { list }, ['a1', 'b1', 'c1', 'd1', 'e1'])
  on('turn.start', (_: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))

  await $.session.start(START)
  // The main agent's loop is running too; the engine never lists it.
  await $.turn.start({ turnId: 'main-1', text: 'go' })
  await spawn($, 'Stuck one') // a1: says running, the engine says completed
  await spawn($, 'Real one') // b1: says running, the engine agrees
  await spawn($, 'Unlisted one') // c1: says running, the engine does not name it
  await spawn($, 'Stuck parent') // d1: says running, the engine says killed
  await spawn($, 'Finished child', 'd1') // e1: finished, inside d1
  await end($, 'e1')
  listed = [
    { id: 'a1', status: 'completed' },
    { id: 'b1', status: 'running' },
    { id: 'd1', status: 'killed' },
    { id: 'e1', status: 'completed' },
    { id: MAIN_ID, status: 'completed' },
  ]

  // The two stuck cards and the finished child count as clearable; the real
  // one, the unlisted one and the main agent are the three still running.
  expect(await clearButton($)).toEqual({
    label: 'Clear finished (3)',
    isDim: false,
    note: '3 still running stay',
  })

  await pressed($, 'clear')

  await inPane($, async ui => {
    expect(await shows(ui, /Main Claude Agent/)).toBe(true)
    expect(await shows(ui, /Real one/)).toBe(true)
    expect(await shows(ui, /Unlisted one/)).toBe(true)
    expect(await shows(ui, /Stuck one/)).toBe(false)
    expect(await shows(ui, /Stuck parent/)).toBe(false)
    expect(await shows(ui, /Finished child/)).toBe(false)
  })
  expect(await clearButton($)).toEqual({ label: 'Clear finished', isDim: true, note: '3 still running stay' })

  // With no list to read, a card that says running is trusted again.
  listed = [{ id: 'b1', status: 'completed' }]
  isBroken = true
  await pressed($, 'clear')
  await inPane($, async ui => {
    expect(await shows(ui, /Real one/)).toBe(true)
  })
})

test('a new prompt keeps a finished parent of an agent still going, so the child is not orphaned', async ($, on) => {
  let listed: { id: string; status: string }[] = []
  engine(on, { list: () => ({ value: listed }) }, ['a1', 'b1', 'c1', 'd1', 'e1'])
  const held = keepState(on)

  await $.session.start(START)
  await spawn($, 'Scout the repo') // a1: a root, finished
  await spawn($, 'Read the docs', 'a1') // b1: inside a1, finished, a parent
  await spawn($, 'Open the file', 'b1') // c1: inside b1, still going
  await spawn($, 'Old helper', 'a1') // d1: inside a1, finished
  await spawn($, 'Unrelated job') // e1: another root, finished
  for (const id of ['a1', 'b1', 'd1', 'e1']) {
    await end($, id)
  }
  listed = [{ id: 'c1', status: 'running' }]

  // Open a1 first, so the breadcrumb has something to start over from.
  await pressed($, 'open-a1')
  expect(held('path')).toEqual(['a1'])

  await $.prompt.submit({ text: 'next question', origin: { kind: 'composer' } })

  // The breadcrumb starts over, as it always did.
  expect(held('path')).toEqual([])

  // At the top: the finished parent is there with one agent inside, and the
  // stats row still sees the running agent beneath it.
  await inPane($, async ui => {
    expect(await shows(ui, /Scout the repo/)).toBe(true)
    expect(await shows(ui, /▸ 1/)).toBe(true)
    expect(await shows(ui, /Unrelated job/)).toBe(false)
    expect(await shows(ui, /^Total Cost/)).toBe(true)
  })

  // Walk down: every folder on the way to the running agent is still there,
  // and the finished sibling beside the parent is gone.
  await pressed($, 'open-a1')
  await inPane($, async ui => {
    expect(await shows(ui, /Read the docs/)).toBe(true)
    expect(await shows(ui, /Old helper/)).toBe(false)
  })
  await pressed($, 'open-b1')
  await inPane($, async ui => {
    expect(await shows(ui, /Open the file/)).toBe(true)
  })

  // When the engine no longer lists the running one, the stuck-card rule takes
  // it, and the parents above it, which hold nothing going now, go with it.
  listed = []
  await $.prompt.submit({ text: 'and again', origin: { kind: 'composer' } })
  await inPane($, async ui => {
    expect((await ui.find({ type: 'Text' }))?.text).toContain('No subagents yet')
  })
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

const FAMILIES = [
  ['claude-haiku-5-5', 'Haiku', '\\o.o/', '#2BB3A3'],
  ['claude-sonnet-5-5', 'Sonnet', '\\(o_o)/', '#4A7FE0'],
  ['claude-opus-5-5', 'Opus', '\\O_O/', '#9B5DE5'],
  ['claude-fable-5-5', 'Fable', '\\o~o/', '#E8A33A'],
] as const

test('each model family has its own crab, and an unknown model keeps the default', () => {
  expect(familyOf('claude-sonnet-5-5')).toBe('sonnet')
  expect(familyOf('HAIKU')).toBe('haiku')
  expect(familyOf('opus[1m]')).toBe('opus')
  expect(familyOf('claude-fable-5-5-20261001')).toBe('fable')
  expect(familyOf('')).toBeNull()
  expect(familyOf('mystery-9')).toBeNull()

  const sprites = new Set<string>()
  const texts = new Set<string>()
  for (const [model, name, text, body] of FAMILIES) {
    expect(lookOf(model)?.name).toBe(name)
    expect(crabText(model)).toBe(text)
    expect(crabAlt('running', model)).toBe(`${name} crab, running`)
    expect(crabSvg('running', model)).toContain(body)
    expect(crabSvg('running', model)).not.toContain('#F35B46')
    // Still animated while working, still once done, dimmed when it failed.
    expect(crabSvg('running', model)).toContain('<animate')
    expect(crabSvg('done', model)).not.toContain('<animate')
    expect(crabSvg('failed', model)).toContain('opacity="0.4"')
    sprites.add(crabSvg('running', model))
    texts.add(crabText(model))
  }
  expect(sprites.size).toBe(4)
  expect(texts.size).toBe(4)

  // An empty or unknown model keeps today's coral crab and `\o_o/`.
  for (const model of ['', 'mystery-9']) {
    expect(lookOf(model)).toBeNull()
    expect(crabSvg('running', model)).toContain('#F35B46')
    expect(crabSvg('running', model)).toContain('viewBox="0 0 12 8"')
    expect(crabText(model)).toBe('\\o_o/')
    expect(crabAlt('done', model)).toBe('Crab, done')
  }
  expect(crabSvg('running')).toBe(crabSvg('running', ''))
})

const crabOf = async (ui: any) =>
  ((await ui.findAll({ type: 'Svg' })) as any[]).find(svg => / crab, |^Crab, /.test(svg.props.alt))

for (const [model, name, text, body] of FAMILIES) {
  test(`a running ${name} agent draws the ${name} crab, as a sprite and as text`, async ($, on) => {
    engine(on, { model })

    await $.session.start(START)
    await $.agent.spawn(SPAWN)
    let ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    const crab = await crabOf(ui)
    expect(crab?.props.alt).toBe(`${name} crab, running`)
    expect(crab?.props.source).toContain(body)
    await ui.unmount()

    await $.session.start({ ...START, surface: 'terminal' })
    ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await ui.find({ type: 'Text', text })).toBeDefined()
    expect(await ui.find({ type: 'Svg' })).toBeUndefined()
    await ui.unmount()
  })
}

test('the crab follows the model the agent is using now', async ($, on) => {
  // Spawned as Opus; its next step reports a Sonnet model.
  engine(on, { model: 'claude-opus-5-5' })

  await $.session.start(START)
  await $.agent.spawn(SPAWN)
  let ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await crabOf(ui))?.props.alt).toBe('Opus crab, running')
  await ui.unmount()

  for await (const _chunk of $.turn.step({ ...STEP, agentId: 'a1' })) {
    // Only the step's model matters here.
  }
  ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await crabOf(ui))?.props.alt).toBe('Sonnet crab, running')
  await ui.unmount()
})

test('an unknown model keeps the default crab', async ($, on) => {
  engine(on, { model: 'mystery-9' })

  await $.session.start(START)
  await $.agent.spawn(SPAWN)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await crabOf(ui))?.props.alt).toBe('Crab, running')
  expect((await crabOf(ui))?.props.source).toContain('#F35B46')
  await ui.unmount()
})
