import type { AgentStatus } from '../types'
import { CRAB } from './crabs'

// The crab for a card: animated while the agent works, still once it is done.
// A failed or stopped agent gets the still one, dimmed.
export const crabSvg = (status: AgentStatus): string =>
  status === 'running'
    ? CRAB.working
    : status === 'done'
      ? CRAB.done
      : CRAB.done.replace('<svg ', '<svg opacity="0.4" ')

// A rounded progress bar: a faint track and a filled run, `percent` of it.
export const barSvg = (percent: number, color: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 6" preserveAspectRatio="none"><rect width="100" height="6" rx="3" fill="#888" opacity="0.25"/><rect width="${Math.max(6, percent)}" height="6" rx="3" fill="${color}"/></svg>`
