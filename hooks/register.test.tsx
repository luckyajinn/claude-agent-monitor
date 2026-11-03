import { expect, test } from 'claude-code/testing'

import { applyStep, costOf, describe, newRow, prettyModel, progressOf } from './track'

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

test('the pure helpers classify, price and estimate', () => {
  expect(describe('Grep', { pattern: 'TODO' })).toEqual({
    activity: 'Researching',
    detail: 'Grep TODO',
  })
  expect(describe('Bash', { command: 'npm test' }).activity).toBe('Verifying')
  expect(describe('Bash', { command: 'ls' }).activity).toBe('Running commands')
  expect(describe('Edit', { file_path: 'C:\\a\\b.ts' }).detail).toBe('Edit b.ts')
  // 1000 in at $3/M + 500 out at $15/M for a sonnet.
  expect(Math.round(costOf(USAGE) * 1e6)).toBe(10500)

  expect(prettyModel('claude-sonnet-5-5')).toBe('Sonnet 5.5')
  expect(prettyModel('claude-opus-4-1-20250805')).toBe('Opus 4.1')
  expect(prettyModel('claude-sonnet-4-20250514')).toBe('Sonnet 4')
  expect(prettyModel('haiku')).toBe('Haiku')
  expect(prettyModel('some-other-model')).toBe('some-other-model')

  const row = applyStep(newRow('a', 'x', 'Explore', MODEL, 0), USAGE, [], 'report')
  expect(row.activity).toBe('Writing report')
  expect(progressOf(row)).toBe(14)
  expect(progressOf({ ...row, status: 'done' })).toBe(100)
})

test('a subagent appears, works and finishes in the pane', async ($, on) => {
  on('command.register', () => ({ value: { command: 'agent-monitor' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('clock.now', () => ({ value: 1000 }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: {}, rateLimits: [], cost: { usd: 12.34 } },
  }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('agent.spawn', () => ({ model: MODEL, agentId: 'a1' }))
  on('turn.step', async function* (_, e) {
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

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.agent.spawn({
    tool_use_id: 't1',
    prompt: 'look around',
    description: 'Scout the repo',
    subagentType: 'Explore',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: MODEL,
    background: true,
    fork: false,
  })
  for await (const _chunk of $.turn.step({
    turnId: 'turn-1',
    index: 0,
    model: MODEL,
    messageCount: 1,
    agentId: 'a1',
  })) {
    // The stream's chunks are not the test's concern: its result is.
  }

  let ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Scout the repo/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Researching/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Grep TODO/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Sonnet 5\.5/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /general-purpose/ })).toBeUndefined()
  expect(await ui.find({ type: 'Svg' })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /14%/ }))?.text).toContain('14%')
  expect(await ui.find({ type: 'Text', text: /\$0\.01 est\./ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /session \$12\.34/ })).toBeDefined()
  await ui.unmount()

  await $.turn.complete({
    answer: 'done',
    durationMs: 1000,
    isAborted: false,
    turnId: 'turn-1',
    agentId: 'a1',
    reason: 'answer',
  })

  ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /100%/ }))?.text).toContain('100%')
  await ui.unmount()
})

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

test('the band keeps what another plugin draws beneath it', async ($, on) => {
  on('command.register', () => ({ value: { command: 'agent-monitor' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('clock.now', () => ({ value: 1000 }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('agent.spawn', () => ({ model: MODEL, agentId: 'a1' }))
  // Stands for another plugin's band, the usage bar.
  on('ui.render', ($, e) => {
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
  on('command.register', () => ({ value: { command: 'agent-monitor' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('clock.now', () => ({ value: 1000 }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('agent.spawn', () => ({ model: MODEL, agentId: 'a1' }))
  on('turn.complete', () => ({ text: '' }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.agent.spawn(SPAWN)
  await $.turn.complete({
    answer: 'done',
    durationMs: 1000,
    isAborted: false,
    turnId: 'turn-9',
    agentId: 'a1',
    reason: 'answer',
    usage: USAGE,
  })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /\$0\.01 est\./ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /100%/ })).toBeDefined()
  await ui.unmount()
})

test('a new prompt clears finished work; other submissions do not', async ($, on) => {
  on('command.register', () => ({ value: { command: 'agent-monitor' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('clock.now', () => ({ value: 1000 }))
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [] } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('agent.spawn', () => ({ model: MODEL, agentId: 'a1' }))
  on('turn.complete', () => ({ text: '' }))
  on('prompt.submit', (_, e) => ({ text: e.text }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.agent.spawn(SPAWN)
  await $.turn.complete({
    answer: 'done',
    durationMs: 1000,
    isAborted: false,
    turnId: 'turn-1',
    agentId: 'a1',
    reason: 'answer',
    usage: USAGE,
  })

  const shown = async () => {
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    const has = (await ui.find({ type: 'Text', text: /Scout the repo/ })) !== undefined
    await ui.unmount()

    return has
  }

  // A background notification is not a new prompt: the card stays.
  await $.prompt.submit({ text: 'a task finished', origin: { kind: 'notification' } })
  expect(await shown()).toBe(true)

  // The person's own prompt starts the pane over.
  await $.prompt.submit({ text: 'next question', origin: { kind: 'composer' } })
  expect(await shown()).toBe(false)
})

test('the pane says so before any subagent starts', async ($, on) => {
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('clock.now', () => ({ value: 1000 }))
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [] } }))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text' }))?.text).toContain('No subagents yet')
  await ui.unmount()
})
