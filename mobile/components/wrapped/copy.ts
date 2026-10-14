/**
 * Copy for the You page.
 *
 * Headings and labels are fixed: a heading names its content. The one-line
 * observations under a stat are picked from a short list by a seed derived
 * from the numbers the line is describing, so the same stats always render
 * the same words. No model calls, no randomness that reshuffles on render.
 */

function hashSeed(...parts: (string | number)[]): number {
  let h = 2166136261;
  const input = parts.join('|');
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pick<T>(list: readonly T[], ...seedParts: (string | number)[]): T {
  return list[hashSeed(...seedParts) % list.length];
}

/** Short enough to sit inside the clock face: "12am", "3pm". */
export function formatHourCompact(h: number): string {
  if (h === 0) return '12am';
  if (h === 12) return '12pm';
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}

/* ---------------------------------------------------------------- hero ---- */

/** Milestone bands. Each band states where the total stands. */
const MILESTONES: { min: number; lines: readonly string[] }[] = [
  {
    min: 500,
    lines: [
      'You have passed five hundred saves.',
      'Five hundred saves, and counting.',
    ],
  },
  {
    min: 250,
    lines: [
      'You have passed two hundred and fifty saves.',
      'More than two hundred and fifty saves so far.',
    ],
  },
  {
    min: 100,
    lines: [
      'You have passed one hundred saves.',
      'More than one hundred saves so far.',
    ],
  },
  {
    min: 50,
    lines: [
      'You have passed fifty saves.',
      'More than fifty saves so far.',
    ],
  },
  {
    min: 25,
    lines: [
      'You have passed twenty five saves.',
      'More than twenty five saves so far.',
    ],
  },
  {
    min: 10,
    lines: [
      'You have passed ten saves.',
      'More than ten saves so far.',
    ],
  },
  {
    min: 5,
    lines: [
      'Enough saves to start seeing a pattern.',
      'Your first few saves are in.',
    ],
  },
  {
    min: 2,
    lines: [
      'Your first saves are in.',
      'A small collection so far.',
    ],
  },
  {
    min: 1,
    lines: [
      'Your first save is in.',
      'One save so far.',
    ],
  },
];

const HERO_NOUN = 'saves';

export function milestoneLine(total: number): string {
  const band = MILESTONES.find((m) => total >= m.min);
  if (!band) return '';
  return pick(band.lines, 'milestone', band.min, total);
}

export function heroNoun(_total: number): string {
  return HERO_NOUN;
}

/** The stamp on the hero: the last milestone you actually cleared. */
export function milestoneBadge(total: number): string | null {
  if (total < 1) return null;
  if (total === 1) return 'First';
  const band = MILESTONES.find((m) => total >= m.min && m.min >= 5);
  return band ? `${band.min}+` : null;
}

/* ------------------------------------------------------------- sections ---- */

export function fieldsTitle(_seed: number): string {
  return 'Where you spend your attention';
}

export function topicsKicker(_seed: number): string {
  return 'Top topics';
}

// No calendar language: the list is a rolling window of recent discoveries,
// not a month, so "New this month" would be wrong most of the time.
export function newTopicsTitle(_seed: number): string {
  return 'New topics';
}

export function timelineTitle(_seed: number): string {
  return 'Saves over time';
}

/* --------------------------------------------------------------- rhythm ---- */

/** One sentence that names the hour, so the card does not print it twice. */
export function rhythmLine(hour: number): string {
  return `Most of your saves land around ${formatHourCompact(hour)}.`;
}

/* --------------------------------------------------------------- streak ---- */

// Every line is a function of the actual count, so the card never captions a
// 10-day record with the band minimum.
const STREAK_BANDS: { min: number; lines: readonly ((n: number) => string)[] }[] = [
  {
    min: 30,
    lines: [(n) => `Your longest streak was ${n} days.`, (n) => `${n} days in a row, your longest run.`],
  },
  {
    min: 14,
    lines: [(n) => `Your longest streak was ${n} days.`, (n) => `${n} days in a row, your longest run.`],
  },
  {
    min: 7,
    lines: [(n) => `Your longest streak was ${n} days.`, (n) => `${n} days in a row, your longest run.`],
  },
  {
    min: 4,
    lines: [(n) => `Your longest streak was ${n} days.`, (n) => `${n} days in a row, your longest run.`],
  },
  {
    min: 2,
    lines: [(n) => `Your longest streak was ${n} days.`, (n) => `${n} days in a row, your longest run.`],
  },
];

const CURRENT_STREAK_LINES: readonly ((n: number) => string)[] = [
  (n) => `${n} days in a row, as of today.`,
  (n) => `${n} days and counting.`,
];

export function longestStreakLine(longest: number): string {
  const band = STREAK_BANDS.find((b) => longest >= b.min);
  if (!band) return '';
  return pick(band.lines, 'streak', band.min, longest)(longest);
}

export function currentStreakLine(current: number): string {
  return pick(CURRENT_STREAK_LINES, 'current-streak', current)(current);
}

/** Where the user stands today when no run is live, stated plainly, so the
 * record above it can never be mistaken for something still going. */
export function dormantStreakLine(current: number): string {
  return current === 1
    ? 'Today is day one of the next one.'
    : 'No streak running right now. One save starts the next.';
}

/* ------------------------------------------------------------ archetype ---- */

export type ArchetypeFormat = 'link' | 'text' | 'image';

const FORMAT_NOUN: Record<ArchetypeFormat, string> = {
  link: 'links',
  text: 'notes',
  image: 'images',
};

function isArchetypeFormat(format: string): format is ArchetypeFormat {
  return format in FORMAT_NOUN;
}

/**
 * The share of saves in the leading format, as one sentence. No persona name
 * above it: "Link saver" and "Links make up most of your saves" said the same
 * thing twice, and the percentage says more than either.
 */
export function archetypeFor(
  format: string | undefined,
  count: number,
  total: number,
): { format: ArchetypeFormat; line: string } | null {
  if (!format || !isArchetypeFormat(format) || total <= 0) return null;
  const pct = Math.round((count / total) * 100);
  const noun = FORMAT_NOUN[format];
  const line = pct >= 99
    ? `Everything you have saved so far is a ${noun.slice(0, -1)}.`
    : `${capitalise(noun)} are ${pct}% of your saves.`;
  return { format, line };
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* --------------------------------------------------------------- social ---- */

export function noFollowLine(_seed: number): string {
  return 'You are not following anyone yet. Find people on Pulse.';
}

export function quietWeekLine(_seed: number): string {
  return 'Nobody you follow has saved anything this week.';
}
