import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentRow, AgentStatus } from '../types'
import { barSvg, crabSvg } from './crab'
import {
  addUsage,
  applyStep,
  bar,
  capRows,
  childrenOf,
  clock,
  finish,
  isKnownRate,
  newRow,
  ordered,
  patch,
  prettyModel,
  progressOf,
  revive,
  rootsOf,
  tokens,
  trunc,
  usd,
  validTrail,
} from './track'

const PANE = 'agent-monitor'
const TITLE = 'Agents'
const MAX_ROWS = 30
const SHOWN_FINISHED = 8

const agents = atom({ plugin: 'agent-monitor', key: 'agents' } as const, [])
const path = atom({ plugin: 'agent-monitor', key: 'path' } as const, [])

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

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

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
  // prompt, finished cards go, and so does any "running" card the engine no
  // longer lists as going (a missed end must not leave one stuck for good). A
  // slash command, a background notification or another plugin's prompt is not
  // a new prompt.
  on('prompt.submit', async ($, e, next) => {
    const isPerson = e.origin?.kind === 'composer' || e.origin?.kind === 'bridge'

    if (isPerson && e.command === undefined) {
      try {
        let live: Set<string> | undefined
        try {
          live = new Set(
            (await $.agent.list()).filter(one => LIVE.has(one.status)).map(one => one.id),
          )
        } catch {
          live = undefined
        }
        await update($, agents, list =>
          list.filter(row => row.status === 'running' && (live === undefined || live.has(row.id))),
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
      const row = newRow(id, e.description, e.subagentType, started.model, now, parentId)

      await update($, agents, list =>
        list.some(one => one.id === id)
          ? patch(list, id, one =>
              revive({ ...one, name: e.description, type: e.subagentType, parentId, model: started.model }, now),
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
            applyStep(revive(row, now), result.usage, result.toolUses, result.answer),
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
    const all: AgentRow[] = await read($, agents)
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

    // A card with everything: the running ones, and the one that is open.
    const fullCard = (row: AgentRow, isOpen: boolean) => {
      const percent = progressOf(row)
      const color = COLORS[row.status]
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
            {isOpen ? (
              title
            ) : (
              <Button key={`open-${row.id}`} plain onPress={() => openTo(row)}>
                {title}
                <Text dimColor>{inside > 0 ? ` ▸ ${inside}` : ' ›'}</Text>
              </Button>
            )}
            {isNarrow ? null : activity}
          </Box>
          {isNarrow ? activity : null}
          <Text dimColor>
            {prettyModel(row.model) || 'model unknown'} · {spent(row)} · {plural(row.steps, 'step')}
          </Text>
          <Box gap={1} alignItems="center">
            {!hasSvg ? (
              <Text color={color}>{bar(percent, 12)}</Text>
            ) : (
              <Svg
                source={barSvg(percent, FILLS[row.status])}
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
              <Text color="red">{'\\o_o/'}</Text>
            ) : (
              <Svg
                source={crabSvg(row.status)}
                alt={`Crab, ${row.status}`}
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

    // A finished agent in one line, with a small still crab.
    const lineRow = (row: AgentRow) => {
      const inside = insideOf(row)

      return (
        <Box key={`row-${row.id}`} gap={1} alignItems="center">
          {!hasSvg ? (
            <Text color="red">{'\\o_o/'}</Text>
          ) : (
            <Svg source={crabSvg(row.status)} alt={`Crab, ${row.status}`} width={24} height={16} />
          )}
          <Button key={`open-${row.id}`} plain onPress={() => openTo(row)}>
            <Text color={COLORS[row.status]}>{ICONS[row.status]} </Text>
            <Text>{trunc(row.name, nameMax - 6)}</Text>
            <Text dimColor>
              {' '}
              · {spent(row)} · {usd(row.costUsd)}
              {inside > 0 ? ` · ▸ ${inside}` : ''}
            </Text>
          </Button>
        </Box>
      )
    }

    const level = ordered(current === undefined ? rootsOf(all) : childrenOf(all, current.id))
    const going = level.filter(row => row.status === 'running')
    const finished = level.filter(row => row.status !== 'running')
    const hidden = finished.length - SHOWN_FINISHED

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Box gap={2}>
            <Text weight="bold">{plural(all.length, 'agent')}</Text>
            <Text color="cyan">{running} running</Text>
          </Box>
          <Text dimColor>
            {usd(total)} est.{session === undefined ? '' : ` · session ${usd(session)}`}
          </Text>
        </Box>
        <Button
          key="clear"
          label="Clear all"
          onPress={async () => {
            await update($, agents, () => [])
            await update($, path, () => [])
          }}
        />
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
        {current === undefined ? null : fullCard(current, true)}
        {current === undefined ? null : (
          <Text dimColor>{level.length === 0 ? 'Nothing inside yet.' : `Inside · ${level.length}`}</Text>
        )}
        {going.map(row => fullCard(row, false))}
        {finished.slice(0, SHOWN_FINISHED).map(lineRow)}
        {hidden > 0 && <Text dimColor>+{hidden} earlier finished</Text>}
        <Text dimColor>Progress (~) and cost are estimates. Click an agent to open it.</Text>
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

    return (
      <Box flexDirection="column">
        <Box gap={1}>
          <Text color="cyan">▸ {plural(live.length, 'agent')} running</Text>
          <Text dimColor>
            · {usd(total)} est. · {latest.name}: {latest.activity} ~{progressOf(latest)}%
          </Text>
        </Box>
        {below}
      </Box>
    )
  })
}
