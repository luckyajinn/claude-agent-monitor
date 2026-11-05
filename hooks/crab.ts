import type { AgentStatus } from '../types'
import { CRAB, LOOKS } from './crabs'
import type { CrabLook } from './crabs'
import { familyOf } from './track'

const BODY = '#F35B46'

// The look of a model's family, or null for an empty or unknown model, which
// keeps the default coral crab.
export const lookOf = (model: string): CrabLook | null => {
  const family = familyOf(model)

  return family === null ? null : LOOKS[family]
}

// A sprite in a family's look: its body colour, and room above for its
// accessory. The poses and animations are the default crab's own.
const dress = (svg: string, look: CrabLook | null): string =>
  look === null
    ? svg
    : svg
        .replace('viewBox="0 0 12 8"', 'viewBox="-1.5 -2 15 10"')
        .split(`fill="${BODY}"`)
        .join(`fill="${look.body}"`)
        .replace('</svg>', `${look.accessory}</svg>`)

// The crab for a card: animated while the agent works, still once it is done.
// A failed or stopped agent gets the still one, dimmed. It wears the look of
// the agent's current model.
export const crabSvg = (status: AgentStatus, model = ''): string => {
  const look = lookOf(model)

  return status === 'running'
    ? dress(CRAB.working, look)
    : status === 'done'
      ? dress(CRAB.done, look)
      : dress(CRAB.done, look).replace('<svg ', '<svg opacity="0.4" ')
}

// What the crab says to a screen reader: "Opus crab, running", or
// "Crab, running" for a model the mod does not know.
export const crabAlt = (status: AgentStatus, model = ''): string => {
  const look = lookOf(model)

  return look === null ? `Crab, ${status}` : `${look.name} crab, ${status}`
}

// The crab as text, for the terminal: `\o_o/`, or the family's own variant.
export const crabText = (model = ''): string => lookOf(model)?.text ?? '\\o_o/'

// The tree's connectors as a picture, for the surfaces that draw them: each
// four-character step of `prefix` (`│   `, `├── `, `└── ` or blank) is a column
// `WIRE_STEP` pixels wide. A drawn line spans the whole `height`, so the lines of
// one card meet those of the next with no gap, as text glyphs cannot promise.
export const WIRE_STEP = 20

export const wireSvg = (prefix: string, height: number, color = '#8a8780'): string => {
  const steps = prefix.match(/.{1,4}/gu) ?? []
  const x = 7.5
  const mid = Math.round(height / 2) + 0.5
  const parts = steps.map((step, i) => {
    const at = i * WIRE_STEP + x
    const end = i * WIRE_STEP + WIRE_STEP - 2

    switch (step[0]) {
      case '│':
        return `<path d="M${at} 0V${height}"/>`
      case '├':
        return `<path d="M${at} 0V${height}M${at} ${mid}H${end}"/>`
      case '└':
        return `<path d="M${at} 0V${mid}H${end}"/>`
      default:
        return ''
    }
  })
  const width = steps.length * WIRE_STEP

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><g fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="square" shape-rendering="crispEdges">${parts.join('')}</g></svg>`
}

// A rounded progress bar: a faint track and a filled run, `percent` of it.
export const barSvg = (percent: number, color: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 6" preserveAspectRatio="none"><rect width="100" height="6" rx="3" fill="#888" opacity="0.25"/><rect width="${Math.max(6, percent)}" height="6" rx="3" fill="${color}"/></svg>`
