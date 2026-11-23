import type { AgentRow, AgentStatus } from '../types'
import { crabAlt, crabSvg } from './crab'
import { workOf } from './track'
import type { WorkKind } from './track'

// A small 8-bit scene behind each card's crab, one per kind of work: the
// library for research, a night sky for the web, a desk for writing, a lab
// bench for verifying, a terminal for commands, a signpost for delegating and
// a quiet beach for anything else. A finished agent goes to the beach at
// sunset; a failed or stopped one keeps the scene it was in, faded.

// The scene's grid, in sprite pixels. The crab stands at the left, in the same
// place the model looks expect (x 1.5 to 16.5 with its accessory).
export const SCENE_W = 64
export const SCENE_H = 10
// A narrow pane shows only the left part of the scene: the crab and the props
// nearest it, at the same scale, so the card does not grow wider.
export const SCENE_NARROW_W = 40

export type SceneKind = WorkKind | 'done'

// Where the crab is, for a screen reader: "Sonnet crab, running, in the library".
export const SCENE_PLACES: Readonly<Record<SceneKind, string>> = {
  research: 'in the library',
  web: 'under the night sky',
  write: 'at the writing desk',
  verify: 'at the lab bench',
  commands: 'at the terminal',
  delegate: 'handing out tasks',
  other: 'on the beach',
  done: 'on the beach at sunset',
}

const R = (x: number, y: number, w: number, h: number, fill: string, extra = '') =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"${extra}/>`

// The animation pieces, only drawn while the agent works, so a finished
// card's scene is still.
type Anim = (svg: string) => string
const blinker = (live: Anim) => (dur: string, begin = '0s', values = '1;0.15;1') =>
  live(`<animate attributeName="opacity" values="${values}" dur="${dur}" begin="${begin}" repeatCount="indefinite"/>`)

const research = (live: Anim): string => {
  const colors = ['#22d3ee', '#f8fafc', '#f59e0b', '#f35b46', '#67e8f9', '#0e7490', '#fde68a']
  const books = (top: number, seed: number) => {
    let out = ''
    let x = 22
    let i = seed
    while (x < 60) {
      const w = i % 3 === 0 ? 2 : 1
      const h = [3, 2, 3, 3, 2, 3][i % 6]!
      // A gap on the top shelf: the book the crab is reading.
      if (!(top === 1 && x >= 36 && x <= 37)) out += R(x, top + (3 - h), w, h, colors[i % colors.length]!)
      x += w + (i % 5 === 0 ? 1 : 0)
      i++
    }

    return out
  }
  const book =
    R(16, 5, 3, 2, '#f8fafc') + R(17.4, 5, 0.2, 2, '#94a3b8') + R(16.3, 5.6, 0.9, 0.3, '#0891b2') + R(17.8, 5.6, 0.9, 0.3, '#0891b2')

  return (
    R(0, 0, 64, 10, '#123f48') +
    R(0, 9, 64, 1, '#0a2a31') +
    R(21, 0, 40, 9, '#0c2f37') +
    books(1, 0) +
    books(5, 3) +
    R(20, 4, 42, 1, '#8a5a2c') +
    R(20, 8, 42, 1, '#8a5a2c') +
    R(20, 0, 1, 9, '#8a5a2c') +
    R(61, 0, 1, 9, '#8a5a2c') +
    `<g>${book}${live('<animateTransform attributeName="transform" type="translate" values="0 0;0 -0.4;0 0" dur="1.6s" repeatCount="indefinite"/>')}</g>`
  )
}

const web = (live: Anim): string => {
  const blink = blinker(live)
  const stars = [[20, 1], [27, 3], [33, 0], [51, 6], [62, 1], [30, 7], [24, 5]]
    .map(([x, y], i) => `<rect x="${x}" y="${y}" width="0.6" height="0.6" fill="#e0f2fe">${blink('2.4s', `${i * 0.35}s`)}</rect>`)
    .join('')
  const globe = [[0, 40, 5], [1, 39, 7], [2, 38, 9], [3, 38, 9], [4, 38, 9], [5, 38, 9], [6, 38, 9], [7, 39, 7], [8, 40, 5]]
    .map(([y, x, w]) => R(x!, y!, w!, 1, '#3b82f6'))
    .join('')
  const land =
    R(40, 1, 2, 2, '#4ade80') + R(43, 3, 3, 2, '#4ade80') + R(39, 5, 2, 2, '#4ade80') + R(42, 7, 2, 1, '#4ade80') + R(45, 6, 1, 1, '#4ade80')
  const link = [48, 50, 52]
    .map((x, i) => `<rect x="${x}" y="5" width="1" height="0.5" fill="#93c5fd">${blink('1s', `${i * 0.25}s`, '0.2;1;0.2')}</rect>`)
    .join('')
  const arcs =
    `<g>${R(53, 0.5, 0.6, 1.6, '#93c5fd') + R(57.4, 0.5, 0.6, 1.6, '#93c5fd')}${blink('1.2s')}</g>` +
    `<g>${R(51.5, 0, 0.6, 2.6, '#bfdbfe') + R(58.9, 0, 0.6, 2.6, '#bfdbfe')}${blink('1.2s', '0.6s')}</g>`

  return (
    R(0, 0, 64, 10, '#172a6b') +
    R(0, 9, 64, 1, '#0f1d4a') +
    stars +
    globe +
    land +
    link +
    R(55, 3, 1, 6, '#cbd5e1') +
    R(54, 2, 3, 1, '#e2e8f0') +
    R(55, 1, 1, 1, '#e2e8f0') +
    R(53.5, 8, 4, 1, '#64748b') +
    arcs
  )
}

const write = (live: Anim): string =>
  R(0, 0, 64, 10, '#4a1650') +
  R(0, 0, 64, 0.5, '#5d1d66') +
  R(54, 3, 12, 4, '#fde047', ' opacity="0.13"') +
  R(18, 7, 46, 1, '#a0652f') +
  R(18, 8, 46, 2, '#7a4a20') +
  // A page filling in, line by line.
  R(24, 3, 8, 4, '#fdf4ff') +
  R(25, 3.8, 6, 0.4, '#c026d3') +
  R(25, 4.8, 5, 0.4, '#c026d3') +
  live(
    `<rect x="25" y="5.8" width="0" height="0.4" fill="#c026d3"><animate attributeName="width" values="0;6;6" keyTimes="0;0.7;1" dur="3s" repeatCount="indefinite"/></rect>`,
  ) +
  // An ink pot and its quill.
  R(35, 5, 3, 2, '#1e1b4b') +
  R(36, 4, 1, 1, '#312e81') +
  R(38, 0, 2, 1, '#f5d0fe') +
  R(37, 1, 2, 1, '#f0abfc') +
  R(36.5, 2, 1.5, 1, '#e879f9') +
  R(36.3, 3, 0.8, 1, '#a21caf') +
  // A stack of books and a lamp.
  R(46, 4, 9, 1, '#d946ef') +
  R(47, 5, 8, 1, '#f0abfc') +
  R(46, 6, 9, 1, '#86198f') +
  R(58, 1, 4, 2, '#fde047') +
  R(59.5, 3, 1, 4, '#a3a3a3') +
  R(58.5, 6.5, 3, 0.5, '#737373')

const verify = (live: Anim): string => {
  const checked = (y: number) =>
    R(23, y, 1.5, 1.5, '#65a30d') + R(23.3, y + 0.6, 0.4, 0.4, '#ecfccb') + R(23.7, y + 0.9, 0.4, 0.3, '#ecfccb') + R(24.1, y + 0.3, 0.3, 0.7, '#ecfccb')
  // The last box on the list ticks itself off while the agent works.
  const pending = `<rect x="23" y="6" width="1.5" height="1.5" fill="#d9f99d">${live('<animate attributeName="fill" values="#d9f99d;#d9f99d;#65a30d" keyTimes="0;0.8;1" dur="2.5s" repeatCount="indefinite"/>')}</rect>`
  const bubbles = [[40.5, 0], [42.5, 0.8], [41.5, 1.6]]
    .map(([x, d]) =>
      live(
        `<rect x="${x}" y="7" width="0.7" height="0.7" fill="#ecfccb"><animate attributeName="y" values="7;3;3" keyTimes="0;0.8;1" dur="2.2s" begin="${d}s" repeatCount="indefinite"/><animate attributeName="opacity" values="1;1;0" keyTimes="0;0.75;1" dur="2.2s" begin="${d}s" repeatCount="indefinite"/></rect>`,
      ),
    )
    .join('')
  const tick = [[51, 5], [52, 6], [53, 7], [54, 6], [55, 5], [56, 4], [57, 3], [58, 2]].map(([x, y]) => R(x!, y!, 1.2, 1.2, '#bef264')).join('')
  const glass = ' opacity="0.85"'

  return (
    R(0, 0, 64, 10, '#253d0f') +
    R(0, 9, 64, 1, '#18290a') +
    // A clipboard checklist.
    R(21, 0.5, 12, 8.5, '#a16207') +
    R(22, 1.5, 10, 7, '#f7fee7') +
    R(25, 0, 4, 1.2, '#d6d3d1') +
    checked(2) +
    R(25.5, 2.5, 5.5, 0.5, '#4d7c0f') +
    checked(4) +
    R(25.5, 4.5, 4, 0.5, '#4d7c0f') +
    pending +
    R(25.5, 6.5, 5.5, 0.5, '#4d7c0f') +
    // A flask, bubbling.
    R(41, 1, 2, 3, '#e2e8f0', glass) +
    R(39, 4, 6, 1, '#e2e8f0', glass) +
    R(38, 5, 8, 3, '#e2e8f0', glass) +
    R(39, 8, 6, 1, '#e2e8f0', glass) +
    R(38.5, 6, 7, 2, '#a3e635') +
    R(39.5, 8, 5, 0.6, '#84cc16') +
    bubbles +
    tick
  )
}

const commands = (live: Anim): string => {
  const blink = blinker(live)
  const lights = [2, 4, 6]
    .map(
      (y, i) =>
        `<rect x="56" y="${y}" width="1" height="1" fill="${i === 1 ? '#f97316' : '#22c55e'}">${blink(i === 1 ? '0.7s' : '1.3s', `${i * 0.2}s`, '1;0.25;1')}</rect>` +
        R(58, y + 0.25, 2, 0.5, '#78716c'),
    )
    .join('')

  return (
    R(0, 0, 64, 10, '#3a1206') +
    R(0, 9, 64, 1, '#260b03') +
    // A monitor with a prompt, output and a blinking cursor.
    R(20, 0, 32, 8, '#57534e') +
    R(21, 1, 30, 6, '#0c0a09') +
    R(34, 8, 4, 1, '#44403c') +
    R(22, 1.6, 1, 0.8, '#fb923c') +
    R(24, 1.6, 8, 0.8, '#fdba74') +
    R(22, 3.0, 13, 0.8, '#fdba74', ' opacity="0.55"') +
    R(22, 4.2, 7, 0.8, '#fdba74', ' opacity="0.55"') +
    R(22, 5.6, 1, 0.8, '#fb923c') +
    `<rect x="24" y="5.6" width="1" height="0.8" fill="#fed7aa">${blink('1s', '0s', '1;1;0;0')}</rect>` +
    // A server rack with its status lights.
    R(55, 1, 6, 8, '#292524') +
    lights +
    R(51, 6.5, 4, 0.4, '#78716c')
  )
}

const delegate = (live: Anim): string => {
  const mini = (x: number, y: number) =>
    R(x, y, 4, 2, '#f35b46') +
    R(x - 1, y, 1, 1, '#f35b46') +
    R(x + 4, y, 1, 1, '#f35b46') +
    R(x, y + 2, 1, 1, '#f35b46') +
    R(x + 3, y + 2, 1, 1, '#f35b46') +
    R(x + 0.8, y + 0.4, 0.5, 0.5, '#0d0d0d') +
    R(x + 2.7, y + 0.4, 0.5, 0.5, '#0d0d0d')
  // Each small crab's task note; while the agent works they come and go in turn.
  const note = (x: number, delay: number) =>
    `<g>${R(x, 1.5, 4, 2.2, '#ede9fe') + R(x + 0.5, 2.3, 3, 0.4, '#7c3aed') + R(x + 0.5, 3.0, 2, 0.4, '#7c3aed')}${live(`<animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.2;0.85;1" dur="3s" begin="${delay}s" repeatCount="indefinite"/>`)}</g>`
  let path = ''
  for (let x = 22; x < 62; x += 2) path += R(x, 8.6, 1, 0.4, '#8b5cf6')

  return (
    R(0, 0, 64, 10, '#2a1059') +
    R(0, 9, 64, 1, '#1c0a3d') +
    `<g>${path}${live('<animateTransform attributeName="transform" type="translate" values="0 0;2 0" dur="0.6s" repeatCount="indefinite"/>')}</g>` +
    // A signpost pointing the way.
    R(18, 3, 1, 6, '#a78bfa') +
    R(17, 2, 5, 2, '#c4b5fd') +
    R(22, 2.5, 1, 1, '#c4b5fd') +
    R(18, 2.7, 3, 0.4, '#6d28d9') +
    mini(30, 6) +
    mini(42, 6) +
    mini(54, 6) +
    note(30, 0) +
    note(42, 0.6) +
    note(54, 1.2)
  )
}

const other = (live: Anim): string => {
  const waves = [6, 18, 30, 42, 54].map(x => R(x, 6.2, 3, 0.4, '#a5b4c6')).join('')

  return (
    R(0, 0, 64, 6, '#3f4a5a') +
    R(0, 6, 64, 1, '#5b6b80') +
    `<g>${waves}${live('<animateTransform attributeName="transform" type="translate" values="0 0;2 0;0 0" dur="3s" repeatCount="indefinite"/>')}</g>` +
    R(0, 7, 64, 3, '#a8a29e') +
    R(0, 7, 64, 0.4, '#d6d3d1') +
    // A moon, a shell and a bucket.
    R(50, 1, 3, 3, '#e2e8f0') +
    R(49.5, 1.5, 4, 2, '#e2e8f0') +
    R(30, 8, 2, 1, '#e7e5e4') +
    R(30.5, 7.5, 1, 0.5, '#e7e5e4') +
    R(42, 6.5, 3, 2.5, '#78716c') +
    R(41.6, 6.3, 3.8, 0.4, '#57534e') +
    R(44.6, 5.5, 0.4, 1, '#57534e')
  )
}

const done = (): string =>
  R(0, 0, 64, 3, '#4c1d95') +
  R(0, 3, 64, 2, '#9d174d') +
  R(0, 5, 64, 2, '#ea580c') +
  // The sun going down over the sea.
  R(45, 3, 6, 1, '#fde68a') +
  R(44, 4, 8, 3, '#fcd34d') +
  R(46, 2.5, 4, 0.5, '#fef3c7') +
  R(0, 7, 64, 1, '#1e3a8a') +
  R(40, 7, 16, 0.4, '#fcd34d', ' opacity="0.6"') +
  R(0, 8, 64, 2, '#d6c7a1') +
  // A green flag planted in the sand, and a shell.
  R(58, 2, 0.5, 6, '#e5e7eb') +
  R(58.5, 2, 3, 2, '#22c55e') +
  R(26, 8.5, 2, 0.8, '#e7e5e4')

const SCENES: Readonly<Record<SceneKind, (live: Anim) => string>> = {
  research,
  web,
  write,
  verify,
  commands,
  delegate,
  other,
  done,
}

// The kind of work in a log line such as "4. Researching · Read track.ts (+1)".
const activityOfLine = (line: string): string =>
  line
    .replace(/^\d+\.\s*/u, '')
    .replace(/\s\(\+\d+\)$/u, '')
    .split(' · ')[0]!

// The scene a card shows. A running agent is in the scene for the work it is
// doing now. A finished one goes to the sunset beach. A failed or stopped one
// stays where its last real work was (the newest step in its log that names a
// kind of work), or on the plain beach when none does.
export const sceneOf = (row: Pick<AgentRow, 'status' | 'activity' | 'log'>): SceneKind => {
  if (row.status === 'running') {
    return workOf(row.activity).kind
  }
  if (row.status === 'done') {
    return 'done'
  }
  for (let i = row.log.length - 1; i >= 0; i--) {
    const kind = workOf(activityOfLine(row.log[i]!)).kind
    if (kind !== 'other') {
      return kind
    }
  }

  return 'other'
}

// The crab sprite's drawing without its own <svg> wrapper, so it can stand in
// a scene. Both crab shapes put the body at the same place once moved to
// (3, 2): the classic one's viewBox starts at 0 0, the model looks' at -1.5 -2.
const crabInScene = (status: AgentStatus, model: string): string => {
  const svg = crabSvg(status, model)
  const inner = svg.replace(/^<svg[^>]*>/u, '').replace(/<\/svg>$/u, '')
  const faded = status === 'failed' || status === 'stopped'

  return `<g transform="translate(3 2)"${faded ? ' opacity="0.45"' : ''}>${inner}</g>`
}

// The whole picture for a card: the scene with the crab in it, `width` sprite
// pixels of it from the left. Animated only while the agent works. A failed or stopped scene is greyed and washed red
// or yellow, the outcome colours the card already uses.
export const sceneSvg = (kind: SceneKind, status: AgentStatus, model = '', width = SCENE_W): string => {
  const isLive = status === 'running'
  const live: Anim = svg => (isLive ? svg : '')
  const art = SCENES[kind](live)
  const wash =
    status === 'failed'
      ? R(0, 0, SCENE_W, SCENE_H, '#6b7280', ' opacity="0.55"') + R(0, 0, SCENE_W, SCENE_H, '#dc2626', ' opacity="0.22"')
      : status === 'stopped'
        ? R(0, 0, SCENE_W, SCENE_H, '#6b7280', ' opacity="0.55"') + R(0, 0, SCENE_W, SCENE_H, '#ca8a04', ' opacity="0.22"')
        : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${SCENE_H}" shape-rendering="crispEdges">${art}${wash}${crabInScene(status, model)}</svg>`
}

// What the picture says to a screen reader: the crab, then where it is.
export const sceneAlt = (kind: SceneKind, status: AgentStatus, model = ''): string =>
  `${crabAlt(status, model)}, ${SCENE_PLACES[kind]}`
