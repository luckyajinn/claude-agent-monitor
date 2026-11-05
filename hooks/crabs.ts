// The crab on each card: a 12 x 8 pixel sprite, animated while an agent works
// and still, with squinting eyes and raised arms, once it is done.
export const CRAB = {
  working: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 12 8\" shape-rendering=\"crispEdges\"><rect x=\"2\" y=\"0\" width=\"8\" height=\"6\" fill=\"#F35B46\"/><rect x=\"0\" y=\"2\" width=\"2\" height=\"2\" fill=\"#F35B46\"><animateTransform attributeName=\"transform\" type=\"translate\" values=\"0 0;0 -1\" calcMode=\"discrete\" dur=\"0.8s\" repeatCount=\"indefinite\"/></rect><rect x=\"10\" y=\"2\" width=\"2\" height=\"2\" fill=\"#F35B46\"><animateTransform attributeName=\"transform\" type=\"translate\" values=\"0 -1;0 0\" calcMode=\"discrete\" dur=\"0.8s\" repeatCount=\"indefinite\"/></rect><rect x=\"2\" y=\"6\" width=\"1\" height=\"2\" fill=\"#F35B46\"><animate attributeName=\"height\" values=\"2;1\" calcMode=\"discrete\" dur=\"0.8s\" repeatCount=\"indefinite\"/></rect><rect x=\"4\" y=\"6\" width=\"1\" height=\"1\" fill=\"#F35B46\"><animate attributeName=\"height\" values=\"1;2\" calcMode=\"discrete\" dur=\"0.8s\" repeatCount=\"indefinite\"/></rect><rect x=\"7\" y=\"6\" width=\"1\" height=\"2\" fill=\"#F35B46\"><animate attributeName=\"height\" values=\"2;1\" calcMode=\"discrete\" dur=\"0.8s\" repeatCount=\"indefinite\"/></rect><rect x=\"9\" y=\"6\" width=\"1\" height=\"1\" fill=\"#F35B46\"><animate attributeName=\"height\" values=\"1;2\" calcMode=\"discrete\" dur=\"0.8s\" repeatCount=\"indefinite\"/></rect><rect x=\"3\" y=\"1\" width=\"1\" height=\"1\" fill=\"#0D0D0D\"><animate attributeName=\"height\" values=\"1;1;0.3;1\" keyTimes=\"0;0.9;0.95;1\" calcMode=\"discrete\" dur=\"3s\" repeatCount=\"indefinite\"/><animate attributeName=\"y\" values=\"1;1;1.7;1\" keyTimes=\"0;0.9;0.95;1\" calcMode=\"discrete\" dur=\"3s\" repeatCount=\"indefinite\"/></rect><rect x=\"8\" y=\"1\" width=\"1\" height=\"1\" fill=\"#0D0D0D\"><animate attributeName=\"height\" values=\"1;1;0.3;1\" keyTimes=\"0;0.9;0.95;1\" calcMode=\"discrete\" dur=\"3s\" repeatCount=\"indefinite\"/><animate attributeName=\"y\" values=\"1;1;1.7;1\" keyTimes=\"0;0.9;0.95;1\" calcMode=\"discrete\" dur=\"3s\" repeatCount=\"indefinite\"/></rect></svg>",
  done: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 12 8\" shape-rendering=\"crispEdges\"><rect x=\"2\" y=\"0\" width=\"8\" height=\"6\" fill=\"#F35B46\"/><rect x=\"0\" y=\"1\" width=\"2\" height=\"2\" fill=\"#F35B46\"/><rect x=\"10\" y=\"1\" width=\"2\" height=\"2\" fill=\"#F35B46\"/><rect x=\"2\" y=\"6\" width=\"1\" height=\"2\" fill=\"#F35B46\"/><rect x=\"4\" y=\"6\" width=\"1\" height=\"2\" fill=\"#F35B46\"/><rect x=\"7\" y=\"6\" width=\"1\" height=\"2\" fill=\"#F35B46\"/><rect x=\"9\" y=\"6\" width=\"1\" height=\"2\" fill=\"#F35B46\"/><rect x=\"3\" y=\"1.5\" width=\"1\" height=\"0.5\" fill=\"#0D0D0D\"/><rect x=\"8\" y=\"1.5\" width=\"1\" height=\"0.5\" fill=\"#0D0D0D\"/></svg>",
} as const

// A look per model family: a body colour, an accessory drawn in the two rows
// above the crab (y -2 and -1, so a family sprite uses a taller viewBox that
// keeps the 3:2 shape), and a small text crab for the terminal.
export type CrabLook = {
  readonly name: string
  readonly body: string
  readonly accessory: string
  readonly text: string
}

const px = (x: number, y: number, w: number, h: number, fill: string) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`

export const LOOKS = {
  // Haiku: a teal crab with a green sprout.
  haiku: {
    name: 'Haiku',
    body: '#2BB3A3',
    accessory: px(5.5, -1, 1, 1, '#3E8E2F') + px(4, -2, 1.5, 1, '#7ACC4C') + px(6.5, -2, 1.5, 1, '#7ACC4C'),
    text: '\\o.o/',
  },
  // Sonnet: a blue crab wearing headphones.
  sonnet: {
    name: 'Sonnet',
    body: '#4A7FE0',
    accessory:
      px(2, -2, 8, 1, '#D9DDE3') +
      px(2, -1, 1, 1, '#D9DDE3') +
      px(9, -1, 1, 1, '#D9DDE3') +
      px(1.5, 0, 1.5, 2, '#2B2B2B') +
      px(9, 0, 1.5, 2, '#2B2B2B'),
    text: '\\(o_o)/',
  },
  // Opus: a purple crab with a gold crown and a red gem.
  opus: {
    name: 'Opus',
    body: '#9B5DE5',
    accessory:
      px(3, -1, 6, 1, '#F2C12E') +
      px(3, -2, 1, 1, '#F2C12E') +
      px(5, -2, 2, 1, '#F2C12E') +
      px(8, -2, 1, 1, '#F2C12E') +
      px(5.5, -1, 1, 1, '#E0457B'),
    text: '\\O_O/',
  },
  // Fable: an amber crab in a wide indigo wizard hat with a yellow star.
  fable: {
    name: 'Fable',
    body: '#E8A33A',
    accessory: px(1, -1, 10, 1, '#3B3B98') + px(4, -2, 4, 1, '#3B3B98') + px(6, -2, 1, 1, '#FFE66D'),
    text: '\\o~o/',
  },
} as const satisfies Record<string, CrabLook>
