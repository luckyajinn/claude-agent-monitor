import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentRow, AgentStatus } from '../types'
import { barSvg, crabAlt, crabSvg, crabText } from './crab'
import {
  addUsage,
  applyStep,
  etaOf,
  bar,
  capRows,
  childrenOf,
  clock,
  fill,
  finish,
  isKnownRate,
  newRow,
  ordered,
  patch,
  prettyModel,
  progressOf,
  revive,
  rootsOf,
  runningFor,
  stopwatch,
  survivors,
  tokenTotal,
  tokens,
  trailAfter,
  trunc,
  usd,
  validTrail,
  workInUse,
  workOf,
} from './track'

const PANE = 'agent-monitor'
const TITLE = 'Agents'
const MAX_ROWS = 30
const SHOWN_FINISHED = 8

const agents = atom({ plugin: 'agent-monitor', key: 'agents' } as const, [])
const path = atom({ plugin: 'agent-monitor', key: 'path' } as const, [])
const collapsed = atom({ plugin: 'agent-monitor', key: 'collapsed' } as const, false)

const COLORS: Record<AgentStatus, string> = {
  running: 'cyan',
  done: 'green',
  failed: 'red',
  stopped: 'yellow',
}

const FILLS: Record<AgentStatus, string> = {
  running: '#38bdf8',
  done: '#4ade80',
  failed: '#f87171',
  stopped: '#fbbf24',
}

const ICONS: Record<AgentStatus, string> = {
  running: '●',
  done: '✔',
  failed: '✖',
  stopped: '■',
}

// What the engine calls an agent that is still going.
const LIVE = new Set(['pending', 'running', 'waiting'])

type SvgElement = (props: {
  source: string
  alt: string
  width?: number
  height?: number
  isInteractive?: boolean
}) => never

// A card's accent (border, activity line, bar): the kind of work while it
// runs, so similar work shares a colour; the outcome once it ends. The
// terminal takes colour names, a picture-drawing surface the hex.
const accentOf = (row: AgentRow, hasSvg: boolean): { color: string; fill: string } => {
  if (row.status !== 'running') {
    return { color: COLORS[row.status], fill: FILLS[row.status] }
  }
  const work = workOf(row.activity)

  return { color: hasSvg ? work.fill : work.color, fill: work.fill }
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

// The ids the engine lists as still going (pending, running or waiting);
// undefined when its list cannot be read.
const goingIds = async ($: EngineInterface): Promise<Set<string> | undefined> => {
  try {
    return new Set((await $.agent.list()).filter(one => LIVE.has(one.status)).map(one => one.id))
  } catch {
    return undefined
  }
}

// An agent is active when its card says it is running or the engine lists it
// as going: the engine can call an agent pending or waiting where the card has
// only "running" or an end. With no list to ask, the card alone decides.
const activeIn = (going: Set<string> | undefined) => (row: AgentRow) =>
  LIVE.has(row.status) || going?.has(row.id) === true

// "Clear finished": drops the cards of agents that are done, stopped or failed
// and keeps every active agent, with the parents it sits under. The rows are
// judged inside the write, so one that came alive since the pane was drawn
// stays. The breadcrumb is cut back only if a card it names went.
const clearFinished = async ($: EngineInterface) => {
  const isActive = activeIn(await goingIds($))

  await update($, agents, list => {
    const kept = survivors(list, isActive)

    return kept.length === list.length ? list : kept
  })
  const left = await read($, agents)
  await update($, path, trail => trailAfter(left, trail))
}

// A step or an end can reach us before, or without, the spawn that announces
// an agent: make its card from what the engine lists, so no event is lost.
const ensure = async ($: EngineInterface, id: string, model: string, now: number) => {
  if ((await read($, agents)).some(row => row.id === id)) {
    return
  }
  let info: { description?: string; type?: string; parentId?: string } = {}
  try {
    info = (await $.agent.list()).find(one => one.id === id) ?? {}
  } catch {
    // The list is a courtesy: a bare card is better than none.
  }
  const row = newRow(id, info.description || 'Subagent', info.type ?? 'agent', model, now, info.parentId ?? null)

  await update($, agents, list =>
    list.some(one => one.id === id) ? list : capRows([...list, row], MAX_ROWS),
  )
}

export const register: Register = on => {
  let isShown = false
  // The task an agent was given and its final report are free text: they stay
  // in this module, not in `$.state`, which any plugin in the session can read.
  // A reload of the mod forgets them; the pane then says so.
  const notes = new Map<string, { prompt: string; report: string }>()

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'agent-monitor',
      description: 'Show the subagent monitor pane',
    })

    return next(e)
  })

  on('command.run', { command: 'agent-monitor' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: 'Subagent monitor opened.' }
  })

  // The pane keeps the latest prompt's work only: when the person sends a new
  // prompt, finished cards go (all but a parent of a card still going), and so
  // does any "running" card the engine no longer lists as going (a missed end
  // must not leave one stuck for good). A slash command, a background
  // notification or another plugin's prompt is not a new prompt.
  on('prompt.submit', async ($, e, next) => {
    const isPerson = e.origin?.kind === 'composer' || e.origin?.kind === 'bridge'

    if (isPerson && e.command === undefined) {
      try {
        const live = await goingIds($)
        // A finished parent with one of these beneath it stays, so a running
        // agent is never left without the card it is shown inside.
        await update($, agents, list =>
          survivors(list, row => row.status === 'running' && (live === undefined || live.has(row.id))),
        )
        await update($, path, () => [])
      } catch {
        // A card left over is better than a prompt that fails.
      }
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  // A subagent is born: add its card and show the pane the first time.
  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)

    if (!('agentId' in started) || started.agentId === undefined) {
      return started
    }
    // The agent has started: nothing below may fail the spawn.
    try {
      const id = started.agentId
      const now = await $.clock.now()
      const parentId = e.parentAgentId ?? null
      const given = { isBackground: e.background, isFork: e.fork }
      const row = newRow(id, e.description, e.subagentType, started.model, now, parentId, given)
      notes.set(id, { prompt: trunc(e.prompt, 400), report: '' })

      await update($, agents, list =>
        list.some(one => one.id === id)
          ? patch(list, id, one =>
              revive(
                { ...one, ...given, name: e.description, type: e.subagentType, parentId, model: started.model },
                now,
              ),
            )
          : capRows([...list, row], MAX_ROWS),
      )
      if (!isShown) {
        isShown = true
        void $.ui.open({ id: PANE, title: TITLE })
      }
    } catch {
      // The card is lost, the agent is not.
    }

    return started
  }).catch(($, e, next) => next(e))

  // A run of an agent's loop begins: a resumed agent is running again.
  on('turn.start', async ($, e, next) => {
    const id = e.agentId

    if (id !== undefined) {
      try {
        const now = await $.clock.now()
        await ensure($, id, '', now)
        await update($, agents, list => patch(list, id, row => revive(row, now)))
      } catch {
        // Tracking never breaks a turn.
      }
    }

    return next(e)
  })

  // One model request of a subagent: tokens, cost, model and what it asked for.
  on('turn.step', async function* ($, e, next) {
    const id = e.agentId
    const result = yield* next(e)

    if (id !== undefined) {
      try {
        const now = await $.clock.now()
        await ensure($, id, e.model, now)
        await update($, agents, list =>
          patch(list, id, row =>
            applyStep(revive(row, now), result.usage, result.toolUses, result.answer, {
              effort: e.effort,
              messages: e.messageCount,
              stop: result.stopReason,
              now,
            }),
          ),
        )
      } catch {
        // Tracking never breaks the agent's request.
      }
    }

    return result
  })

  on('turn.complete', async ($, e, next) => {
    const id = e.agentId

    if (id !== undefined) {
      try {
        const status: AgentStatus =
          e.reason === 'answer' ? 'done' : e.reason === 'aborted' ? 'stopped' : 'failed'
        const now = await $.clock.now()
        await ensure($, id, e.usage?.model ?? '', now)
        // Set before the write below, which redraws the pane.
        notes.set(id, { prompt: notes.get(id)?.prompt ?? '', report: trunc(e.answer, 500) })
        // The turn's own summed usage stands in when no step of it was heard.
        await update($, agents, list =>
          patch(list, id, row =>
            finish(row.steps === 0 ? addUsage(row, e.usage) : row, status, now),
          ),
        )
      } catch {
        // The card may stay at "running"; the turn still ends.
      }
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    // Only the desktop and editor draw pictures; the terminal gets text (its
    // table hands out an `Svg` that draws nothing).
    const { Svg } = $.ui.resolve(e) as unknown as { Svg: SvgElement }
    const hasSvg = e.surface !== 'terminal'
    // Rows kept from an earlier version lack the newer fields: fill them in.
    const all: AgentRow[] = (await read($, agents)).map(fill)
    const now = await $.clock.now()

    if (all.length === 0) {
      return <Text dimColor>No subagents yet. They appear here as they start.</Text>
    }
    const trail = validTrail(all, await read($, path))
    const current = trail.length === 0 ? undefined : all.find(row => row.id === trail[trail.length - 1])
    const isNarrow = (e.props.bodyColumns ?? 30) < 40
    const nameMax = isNarrow ? 18 : 28
    const running = all.filter(row => row.status === 'running').length
    const total = all.reduce((sum, row) => sum + row.costUsd, 0)
    // What "Clear finished" would do now, so the button can say so: active
    // agents stay, and so does a finished parent that has one beneath it.
    const isActive = activeIn(await goingIds($))
    const active = all.filter(isActive).length
    const clearable = all.length - survivors(all, isActive).length
    const parents = all.length - clearable - active
    const staying =
      active === 0
        ? ''
        : `${active} still running ${active === 1 ? 'stays' : 'stay'}${parents > 0 ? `, with ${plural(parents, 'finished parent')}` : ''}`
    // The one dollar figure the engine really keeps; it has none per agent.
    let session: number | undefined
    try {
      session = (await $.session.usage()).cost?.usd
    } catch {
      session = undefined
    }

    const openTo = (row: AgentRow) => update($, path, () => [...trail, row.id])
    const insideOf = (row: AgentRow) => childrenOf(all, row.id).length
    const spent = (row: AgentRow) => clock((row.endedAt ?? now) - row.startedAt)

    // Every agent is a card with the essentials; clicking its name opens it.
    const card = (row: AgentRow) => {
      const percent = progressOf(row)
      const { color, fill } = accentOf(row, hasSvg)
      const inside = insideOf(row)
      const title = (
        <Text weight="bold">
          {ICONS[row.status]} {trunc(row.name, nameMax)}
        </Text>
      )
      const activity = <Text color={color}>{row.activity}</Text>

      return (
        <Box key={`card-${row.id}`} flexDirection="column" borderStyle="round" borderColor={color} paddingX={1}>
          <Box justifyContent="space-between" gap={1}>
            <Button key={`open-${row.id}`} plain onPress={() => openTo(row)}>
              {title}
              <Text dimColor>{inside > 0 ? ` ▸ ${inside}` : ' ›'}</Text>
            </Button>
            {isNarrow ? null : activity}
          </Box>
          {isNarrow ? activity : null}
          <Text dimColor>
            {prettyModel(row.model) || 'model unknown'} · {spent(row)} · {plural(row.steps, 'step')}
            {etaOf(row, now) === null ? '' : ` · ${etaOf(row, now)}`}
          </Text>
          <Box gap={1} alignItems="center">
            {!hasSvg ? (
              <Text color={color}>{bar(percent, 12)}</Text>
            ) : (
              <Svg
                source={barSvg(percent, fill)}
                alt={`${row.status}, about ${percent} percent`}
                width={110}
                height={9}
              />
            )}
            <Text color={color} weight="bold" tabular>
              {row.status === 'done' ? '' : '~'}
              {percent}%
            </Text>
          </Box>
          <Text>
            {usd(row.costUsd)} est.
            {row.model === '' || isKnownRate(row.model) ? '' : ' · default rate'} ·{' '}
            {tokens(row.inputTokens + row.cacheReadTokens + row.cacheWriteTokens)} in ·{' '}
            {tokens(row.outputTokens)} out
          </Text>
          <Box gap={1} alignItems="center">
            {!hasSvg ? (
              <Text color="red">{crabText(row.model)}</Text>
            ) : (
              <Svg
                source={crabSvg(row.status, row.model)}
                alt={crabAlt(row.status, row.model)}
                width={48}
                height={32}
                isInteractive={row.status === 'running'}
              />
            )}
            <Text dimColor>{trunc(row.detail, isNarrow ? 22 : 40)}</Text>
          </Box>
        </Box>
      )
    }

    const kv = (label: string, value: string) => (
      <Box justifyContent="space-between" gap={1}>
        <Text dimColor>{label}</Text>
        <Text>{value}</Text>
      </Box>
    )

    // The open agent in depth: its task, model, progress, tokens, cost and
    // what it has been doing, line by line.
    const detailCard = (row: AgentRow) => {
      const percent = progressOf(row)
      const { color, fill } = accentOf(row, hasSvg)
      const modelNote = row.model === '' || isKnownRate(row.model) ? '' : ' (default rate)'
      const note = notes.get(row.id)
      // Rows kept from an earlier version have a total but no split.
      const hasSplit = row.costInUsd + row.costOutUsd + row.costCacheUsd > 0

      return (
        <Box key={`detail-${row.id}`} flexDirection="column" gap={1} borderStyle="round" borderColor={color} paddingX={1}>
          <Box gap={1} alignItems="center">
            {!hasSvg ? (
              <Text color="red">{crabText(row.model)}</Text>
            ) : (
              <Svg
                source={crabSvg(row.status, row.model)}
                alt={crabAlt(row.status, row.model)}
                width={48}
                height={32}
                isInteractive={row.status === 'running'}
              />
            )}
            <Box flexDirection="column">
              <Text weight="bold">
                {ICONS[row.status]} {trunc(row.name, nameMax)}
              </Text>
              <Text color={color}>
                {row.activity}
                {row.detail === '' ? '' : ` · ${row.detail}`}
              </Text>
            </Box>
          </Box>
          <Box gap={1} alignItems="center">
            {!hasSvg ? (
              <Text color={color}>{bar(percent, 12)}</Text>
            ) : (
              <Svg
                source={barSvg(percent, fill)}
                alt={`${row.status}, about ${percent} percent`}
                width={110}
                height={9}
              />
            )}
            <Text color={color} weight="bold" tabular>
              {row.status === 'done' ? '' : '~'}
              {percent}%
            </Text>
          </Box>
          <Box flexDirection="column">
            <Text weight="bold">Task</Text>
            <Text dimColor>
              {note === undefined || note.prompt === ''
                ? 'Task not seen: the mod did not see this agent start.'
                : note.prompt}
            </Text>
          </Box>
          <Box flexDirection="column">
            <Text weight="bold">Model</Text>
            {kv('Name', prettyModel(row.model) || 'unknown')}
            {kv('Id', row.model || 'unknown')}
            {kv('Agent type', row.type)}
            {row.effort === null ? null : kv('Effort', row.effort)}
            {kv('Runs', `${row.isBackground ? 'in the background' : 'in the foreground'}${row.isFork ? ', as a fork' : ''}`)}
          </Box>
          <Box flexDirection="column">
            <Text weight="bold">Progress</Text>
            {kv('Status', row.status)}
            {kv('Steps', String(row.steps))}
            {kv('Time', spent(row))}
            {etaOf(row, now) === null ? null : kv('ETA', etaOf(row, now)!)}
            {kv('Messages', String(row.messages))}
            {kv('Last stop', row.stop ?? 'none yet')}
          </Box>
          <Box flexDirection="column">
            <Text weight="bold">Tokens</Text>
            {kv('Input (uncached)', tokens(row.inputTokens))}
            {kv('Cache read', tokens(row.cacheReadTokens))}
            {kv('Cache write', tokens(row.cacheWriteTokens))}
            {kv('Total in', tokens(row.inputTokens + row.cacheReadTokens + row.cacheWriteTokens))}
            {kv('Output', tokens(row.outputTokens))}
            {kv('Context now', tokens(row.contextTokens))}
          </Box>
          <Box flexDirection="column">
            <Text weight="bold">Cost (est.)</Text>
            {hasSplit ? kv('Input', usd(row.costInUsd)) : null}
            {hasSplit ? kv('Cache', usd(row.costCacheUsd)) : null}
            {hasSplit ? kv('Output', usd(row.costOutUsd)) : null}
            {kv('Total', `${usd(row.costUsd)}${modelNote}`)}
          </Box>
          {row.log.length === 0 ? null : (
            <Box flexDirection="column">
              <Text weight="bold">Recent</Text>
              {row.log.map(line => (
                <Text dimColor>{line}</Text>
              ))}
            </Box>
          )}
          {row.status === 'running' || note === undefined || note.report === '' ? null : (
            <Box flexDirection="column">
              <Text weight="bold">Report</Text>
              <Text dimColor>{note.report}</Text>
            </Box>
          )}
        </Box>
      )
    }

    const level = ordered(current === undefined ? rootsOf(all) : childrenOf(all, current.id))
    const going = level.filter(row => row.status === 'running')
    const finished = level.filter(row => row.status !== 'running')
    const hidden = finished.length - SHOWN_FINISHED
    const folded = (await read($, collapsed)) === true
    const elapsed = runningFor(all, now)
    // The colour key: each kind of work a running card on screen is doing.
    const inUse = workInUse([...(current === undefined ? [] : [current]), ...(folded ? [] : going)])

    // One stat: a small label over a value.
    const tile = (label: string, value: string) => (
      <Box key={`tile-${label}`} flexDirection="column" borderStyle="round" paddingX={1}>
        <Text dimColor>{label}</Text>
        <Text weight="bold" color="yellow" tabular>
          {value}
        </Text>
      </Box>
    )

    return (
      <Box flexDirection="column" gap={1}>
        {running === 0 ? null : (
          <Box gap={1} flexWrap="wrap">
            {tile(session === undefined ? 'Total Cost (est.)' : 'Total Cost', usd(session ?? total))}
            {tile('Total Tokens', tokens(tokenTotal(all)))}
            {tile('Total time', stopwatch(elapsed ?? 0))}
          </Box>
        )}
        {going.length === 0 ? null : (
          <Box backgroundColor="green" paddingX={1}>
            <Button
              key="running-toggle"
              plain
              label={`${folded ? '▸' : '▾'} Running · ${going.length}`}
              onPress={() => update($, collapsed, value => !value)}
            />
          </Box>
        )}
        <Box gap={1} flexWrap="wrap" alignItems="center">
          <Button
            key="clear"
            label={clearable === 0 ? 'Clear finished' : `Clear finished (${clearable})`}
            dimColor={clearable === 0}
            onPress={() => clearFinished($)}
          />
          {staying === '' ? null : <Text dimColor>{staying}</Text>}
        </Box>
        {trail.length > 0 && (
          <Box gap={1} flexWrap="wrap">
            <Button key="crumb-root" plain label="Agents" onPress={() => update($, path, () => [])} />
            {trail.map((id, i) => {
              const name = trunc(all.find(row => row.id === id)?.name ?? id, 16)

              return (
                <Box key={`crumb-${i}`} gap={1}>
                  <Text dimColor>›</Text>
                  {i === trail.length - 1 ? (
                    <Text weight="bold">{name}</Text>
                  ) : (
                    <Button key={`goto-${i}`} plain label={name} onPress={() => update($, path, () => trail.slice(0, i + 1))} />
                  )}
                </Box>
              )
            })}
          </Box>
        )}
        {inUse.length === 0 ? null : (
          <Box gap={1} flexWrap="wrap">
            <Text dimColor>Colour key:</Text>
            {inUse.map(work => (
              <Text key={`work-${work.kind}`} color={hasSvg ? work.fill : work.color}>
                ● {work.label}
              </Text>
            ))}
          </Box>
        )}
        {current === undefined ? null : detailCard(current)}
        {current === undefined ? null : (
          <Text dimColor>{level.length === 0 ? 'Nothing inside yet.' : `Inside · ${level.length}`}</Text>
        )}
        {folded ? null : going.map(card)}
        {finished.slice(0, SHOWN_FINISHED).map(card)}
        {hidden > 0 && <Text dimColor>+{hidden} earlier finished</Text>}
        <Text dimColor>Progress (~), time left and cost are estimates. Click an agent to open it.</Text>
      </Box>
    )
  })

  // A one-line summary above the prompt, only while an agent is running. What
  // another plugin draws there (a usage bar, say) stays, beneath this line.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    const list: AgentRow[] = await read($, agents)
    const live = list.filter(row => row.status === 'running')
    const latest = live[live.length - 1]

    if (e.props.hasSurvey || latest === undefined) {
      return below
    }
    const { Box, Text } = $.ui.resolve(e)
    const total = live.reduce((sum, row) => sum + row.costUsd, 0)
    // The colour of the latest running agent's kind of work, as on its card.
    const work = workOf(latest.activity)

    return (
      <Box flexDirection="column">
        <Box gap={1}>
          <Text color={e.surface === 'terminal' ? work.color : work.fill}>
            ▸ {plural(live.length, 'agent')} running
          </Text>
          <Text dimColor>
            · {usd(total)} est. · {latest.name}: {latest.activity} ~{progressOf(latest)}%
          </Text>
        </Box>
        {below}
      </Box>
    )
  })
}
