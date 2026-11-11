// Markdown has no columns, so a heading pair is spaced out to line its second half up with a chart column.
// Advance widths approximate SF Pro Bold, calibrated against how Raycast renders a level-2 heading.
const HEADING_FONT_PT = 20.5;
const NBSP = String.fromCharCode(0xa0);
const NBSP_EM = 0.268;
const MIN_SPACES = 2;
const DEFAULT_EM = 0.6;
const DIGIT_EM = 0.62;

const CHAR_EM: Record<string, number> = {
  " ": 0.26,
  ".": 0.27,
  "↓": 0.6,
  "↑": 0.6,
  G: 0.75,
  J: 0.45,
  L: 0.55,
  M: 0.88,
  P: 0.65,
  U: 0.72,
  a: 0.55,
  b: 0.62,
  c: 0.53,
  d: 0.62,
  e: 0.56,
  g: 0.62,
  i: 0.26,
  l: 0.26,
  m: 0.92,
  n: 0.6,
  p: 0.62,
  r: 0.38,
  s: 0.52,
  t: 0.36,
  u: 0.6,
  v: 0.53,
  y: 0.53,
};

export function headingWidth(text: string): number {
  let em = 0;
  for (const char of text) {
    em += CHAR_EM[char] ?? (char >= "0" && char <= "9" ? DIGIT_EM : DEFAULT_EM);
  }
  return em * HEADING_FONT_PT;
}

export function headingPair(left: string, right: string, rightColumnPt: number): string {
  const gap = rightColumnPt - headingWidth(left);
  const spaces = Math.max(MIN_SPACES, Math.round(gap / (NBSP_EM * HEADING_FONT_PT)));
  return `## ${left}${NBSP.repeat(spaces)}${right}`;
}
