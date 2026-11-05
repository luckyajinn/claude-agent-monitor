export type AgentStatus = 'running' | 'done' | 'failed' | 'stopped'

export type AgentRow = {
  id: string
  /** The agent that spawned this one; null when the main conversation did. */
  parentId: string | null
  name: string
  type: string
  model: string
  status: AgentStatus
  steps: number
  activity: string
  detail: string
  /** The thinking effort of its latest request, when the model has one. */
  effort: string | null
  isBackground: boolean
  isFork: boolean
  /** How many messages its latest request carried. */
  messages: number
  /** Tokens its latest request read: the size of its context now. */
  contextTokens: number
  /** Why its latest response stopped (end_turn, tool_use, ...). */
  stop: string | null
  /** What it did, one line per step, newest last (the last few). */
  log: string[]
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  costUsd: number
  costInUsd: number
  costOutUsd: number
  costCacheUsd: number
  startedAt: number
  endedAt: number | null
  /** When its latest step landed; the ETA counts down from it. 0 on rows from an earlier version. */
  lastStepAt: number
}

declare module 'claude-code' {
  interface PluginState {
    'agent-monitor': {
      agents: AgentRow[]
      /** Ids from the top down: the agent whose children the pane shows. */
      path: string[]
      /** True while the pane's "Running" group is folded away. */
      collapsed: boolean
      /** The pane's crab toggle: true for model skins, false for the classic crab, null to follow /config. */
      skins: boolean | null
    }
  }
}
