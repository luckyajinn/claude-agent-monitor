import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { AgentRow, AgentStatus } from '../types'
import { barSvg, crabSvg } from './crab'
import {
  addUsage,
  applyStep,
  bar,
  clock,
  finish,
  newRow,
  patch,
  prettyModel,
  progressOf,
  tokens,
  usd,
} from './track'

const PANE = 'agent-monitor'
const TITLE = 'Agents'

const agents = atom({ plugin: 'agent-monitor', key: 'agents' } as const, [])

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

type SvgElement = (props: {
  source: string
  alt: string
  width?: number
  height?: number
  isInteractive?: boolean
}) => never

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

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
  // prompt, the cards of agents that have finished go. A slash command, a
  // background notification or another plugin's prompt is not a new prompt.
  on('prompt.submit', async ($, e, next) => {
    const isPerson = e.origin?.kind === 'composer' || e.origin?.kind === 'bridge'

    if (isPerson && e.command === undefined) {
      try {
        await update($, agents, list => list.filter(row => row.status === 'running'))
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
      const row = newRow(id, e.description, e.subagentType, started.model, now)

      await update($, agents, list =>
        list.some(one => one.id === id)
          ? patch(list, id, one => ({ ...one, status: 'running', endedAt: null }))
          : [...list, row].slice(-30),
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

  // One model request of a subagent: tokens, cost, model and what it asked for.
  on('turn.step', async function* ($, e, next) {
    const id = e.agentId
    const result = yield* next(e)

    if (id !== undefined) {
      try {
        await update($, agents, list =>
          patch(list, id, row =>
            applyStep(row, result.usage, result.toolUses, result.answer),
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
    // Only the desktop and editor draw pictures; the terminal gets text.
    const { Svg } = $.ui.resolve(e) as unknown as { Svg?: SvgElement }
    const list: AgentRow[] = await read($, agents)
    const now = await $.clock.now()

    if (list.length === 0) {
      return <Text dimColor>No subagents yet. They appear here as they start.</Text>
    }
    const running = list.filter(row => row.status === 'running').length
    const total = list.reduce((sum, row) => sum + row.costUsd, 0)
    // The one dollar figure the engine really keeps; it has none per agent.
    let session: number | undefined
    try {
      session = (await $.session.usage()).cost?.usd
    } catch {
      session = undefined
    }

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Box gap={2}>
            <Text weight="bold">{plural(list.length, 'agent')}</Text>
            <Text color="cyan">{running} running</Text>
          </Box>
          <Text dimColor>
            {usd(total)} est.{session === undefined ? '' : ` · session ${usd(session)}`}
          </Text>
        </Box>
        {running < list.length && (
          <Button
            key="clear"
            label="Clear finished"
            onPress={() =>
              update($, agents, rows => rows.filter(row => row.status === 'running'))
            }
          />
        )}
        {[...list].reverse().map(row => {
          const percent = progressOf(row)
          const color = COLORS[row.status]

          return (
            <Box flexDirection="column" borderStyle="round" borderColor={color} paddingX={1}>
              <Box justifyContent="space-between" gap={1}>
                <Text weight="bold">
                  {ICONS[row.status]} {row.name}
                </Text>
                <Text color={color}>{row.activity}</Text>
              </Box>
              <Text dimColor>
                {prettyModel(row.model)} · {clock((row.endedAt ?? now) - row.startedAt)} ·{' '}
                {plural(row.steps, 'step')}
              </Text>
              <Box gap={1} alignItems="center">
                {Svg === undefined ? (
                  <Text color={color}>{bar(percent, 12)}</Text>
                ) : (
                  <Svg
                    source={barSvg(percent, FILLS[row.status])}
                    alt={`${percent} percent done`}
                    width={150}
                    height={9}
                  />
                )}
                <Text color={color} weight="bold" tabular>
                  {percent}%
                </Text>
              </Box>
              <Text>
                {usd(row.costUsd)} est. ·{' '}
                {tokens(row.inputTokens + row.cacheReadTokens + row.cacheWriteTokens)} in ·{' '}
                {tokens(row.outputTokens)} out
              </Text>
              <Box gap={1} alignItems="center">
                {Svg === undefined ? (
                  <Text>🦀</Text>
                ) : (
                  <Svg
                    source={crabSvg(row.status)}
                    alt={`Crab, ${row.status}`}
                    width={48}
                    height={32}
                    isInteractive={row.status === 'running'}
                  />
                )}
                <Text dimColor>{row.detail}</Text>
              </Box>
            </Box>
          )
        })}
        <Text dimColor>Progress and cost are estimates.</Text>
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
            · {usd(total)} est. · {latest.name}: {latest.activity} {progressOf(latest)}%
          </Text>
        </Box>
        {below}
      </Box>
    )
  })
}
