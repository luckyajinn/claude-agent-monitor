export type AgentStatus = 'running' | 'done' | 'failed' | 'stopped'

export type AgentRow = {
  id: string
  name: string
  type: string
  model: string
  status: AgentStatus
  steps: number
  activity: string
  detail: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  costUsd: number
  startedAt: number
  endedAt: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'agent-monitor': { agents: AgentRow[] }
  }
}
