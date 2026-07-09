/**
 * Deterministic copy variation for the You page.
 *
 * Every line is picked from a list by a seed derived from the numbers the line
 * is describing. Same stats render the same words; save or delete something and
 * the page finds different words for the new total. No model calls, no
 * randomness that reshuffles on every render.
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

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function monthYear(iso: string): string {
  const d = new Date(iso);
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function formatHour(h: number): string {
  if (h === 0) return 'midnight';
  if (h === 12) return 'noon';
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}

/* ---------------------------------------------------------------- hero ---- */

const EMPTY_TITLES = ['Nothing here yet', 'An empty shelf', 'A blank page, for now'];

const EMPTY_BODIES = [
  'Save one thing and this whole page turns into your greatest hits. No pressure. Fine, a little pressure.',
  'Right now this is a page about nobody. One save fixes that.',
  'Everything below wakes up the moment you keep something.',
];

/** Milestone bands. Each band gets its own voice, so 3 saves never reads like 300. */
const MILESTONES: { min: number; lines: readonly string[] }[] = [
  {
    min: 500,
    lines: [
      'Five hundred. Somebody get this person a card catalogue.',
      'You have saved enough to be studied.',
      'This is a personal library now. Behave accordingly.',
    ],
  },
  {
    min: 250,
    lines: [
      'Two hundred and fifty. Librarians have started with less.',
      'You archive faster than you forget, which is rare.',
      'This stopped being a habit. It is a temperament.',
    ],
  },
  {
    min: 100,
    lines: [
      'Triple digits. There is no going back from here.',
      'One hundred. Your future self owes you a drink.',
      'Some of these you will never open again, and that is completely fine.',
    ],
  },
  {
    min: 50,
    lines: [
      'Fifty small acts of refusing to forget.',
      'You have a body of work and you did not even mean to.',
      'This stopped being casual somewhere around save thirty.',
    ],
  },
  {
    min: 25,
    lines: [
      'Twenty five deep. A habit in a trench coat.',
      'You save more than you reread. Classic.',
      'A quarter of a hundred, and nobody made you do any of it.',
    ],
  },
  {
    min: 10,
    lines: [
      'Double digits. The shelf has a shape now.',
      'Somewhere in this pile is a theme you have not named yet.',
      "You have out-saved most people's good intentions.",
    ],
  },
  {
    min: 5,
    lines: [
      'Enough to spot a pattern, not enough to explain it.',
      'Single digits, plural obsessions.',
      'You are officially the kind of person who saves things.',
    ],
  },
  {
    min: 2,
    lines: [
      'Early days. You can still remember every single one.',
      'A small pile. Piles grow.',
      'Barely a collection. Give it a week.',
    ],
  },
  {
    min: 1,
    lines: [
      'One. Apparently the hardest one.',
      'Your first save. We are not emotional, you are emotional.',
      'It begins. Somewhere a browser tab breathes easier.',
    ],
  },
];

const HERO_NOUNS = [
  'things worth keeping',
  'things you refused to lose',
  'saves, all yours',
  'kept on purpose',
  'small rescues',
  'still here because of you',
];

const SINCE_LINES = [
  (m: string) => `All of it since ${m}.`,
  (m: string) => `Started ${m}, never quite stopped.`,
  (m: string) => `${m} is where this began.`,
  (m: string) => `Every one of them since ${m}.`,
];

export function emptyTitle(seed: number): string {
  return pick(EMPTY_TITLES, 'empty-title', seed);
}

export function emptyBody(seed: number): string {
  return pick(EMPTY_BODIES, 'empty-body', seed);
}

export function milestoneLine(total: number): string {
  const band = MILESTONES.find((m) => total >= m.min);
  if (!band) return '';
  return pick(band.lines, 'milestone', band.min, total);
}

export function heroNoun(total: number): string {
  return pick(HERO_NOUNS, 'noun', total);
}

export function sinceLine(firstCaptureIso: string, total: number): string {
  return pick(SINCE_LINES, 'since', total)(monthYear(firstCaptureIso));
}

/* ------------------------------------------------------------- sections ---- */

const FIELD_TITLES = [
  'The fields you live in',
  'Where your head goes',
  'Your home territory',
  'The neighbourhoods you keep walking back to',
  'Your centre of gravity',
];

const TOPIC_TITLES: readonly ((t: string) => string)[] = [
  (t) => `You cannot stop thinking about ${t}.`,
  (t) => `${t} has a hold on you.`,
  (t) => `Lately it is mostly ${t}.`,
  (t) => `If you only had one subject, it would be ${t}.`,
  (t) => `${t}, again. And again.`,
];

const NEW_TOPIC_TITLES = [
  'Fresh rabbit holes',
  'New this month',
  'Doors you opened recently',
  'Territory you did not have last month',
];

const TIMELINE_TITLES = [
  'Your shape over time',
  'The rhythm, in little bars',
  'How the pile grew',
  'You, plotted',
];

export function fieldsTitle(seed: number): string {
  return pick(FIELD_TITLES, 'fields', seed);
}

export function topicsTitle(topTopic: string, seed: number): string {
  return pick(TOPIC_TITLES, 'topics', seed, topTopic)(topTopic.toLowerCase());
}

export function newTopicsTitle(seed: number): string {
  return pick(NEW_TOPIC_TITLES, 'new-topics', seed);
}

export function timelineTitle(seed: number): string {
  return pick(TIMELINE_TITLES, 'timeline', seed);
}

/* --------------------------------------------------------------- rhythm ---- */

const HOUR_BANDS: { max: number; lines: readonly string[] }[] = [
  {
    max: 4,
    lines: [
      'You do your best thinking when you should be asleep.',
      'The small hours belong to you.',
    ],
  },
  {
    max: 8,
    lines: ['Awake before the world is. Suspicious.', 'You catch thoughts before breakfast.'],
  },
  {
    max: 11,
    lines: ['Morning brain, fully operational.', 'You front-load your curiosity.'],
  },
  {
    max: 16,
    lines: ['Afternoon is when it lands.', 'You peak after lunch, like a reasonable person.'],
  },
  {
    max: 20,
    lines: ['Evenings are where the good ones show up.', 'You save things while dinner gets cold.'],
  },
  {
    max: 23,
    lines: ['Late and wide awake.', 'Almost nothing gets saved before 9pm around here.'],
  },
];

export function rhythmLine(hour: number, weekday: string): string {
  const band = HOUR_BANDS.find((b) => hour <= b.max) ?? HOUR_BANDS[HOUR_BANDS.length - 1];
  return pick(band.lines, 'rhythm', hour, weekday);
}

/* --------------------------------------------------------------- streak ---- */

const STREAK_BANDS: { min: number; lines: readonly string[] }[] = [
  {
    min: 30,
    lines: ['A month without missing. Genuinely absurd.', 'Thirty days. Who hurt you.'],
  },
  {
    min: 14,
    lines: ['Two weeks straight. That streak has a personality.', 'Fourteen days of showing up.'],
  },
  {
    min: 7,
    lines: ['A full week, unbroken.', 'Seven days. The rare kind of consistent.'],
  },
  {
    min: 4,
    lines: ['Most habits die before day four. Yours did not.', 'Four days is where it gets real.'],
  },
  {
    min: 2,
    lines: ['Two days in a row counts, and we are counting it.', 'A tiny streak is still a streak.'],
  },
];

const CURRENT_STREAK_LINES: readonly ((n: number) => string)[] = [
  (n) => `${n} days deep right now. Do not look down.`,
  (n) => `${n} in a row, as of today.`,
  (n) => `${n} days and counting.`,
];

export function longestStreakLine(longest: number): string {
  const band = STREAK_BANDS.find((b) => longest >= b.min);
  if (!band) return '';
  return pick(band.lines, 'streak', band.min, longest);
}

export function currentStreakLine(current: number): string {
  return pick(CURRENT_STREAK_LINES, 'current-streak', current)(current);
}

/* ------------------------------------------------------------ archetype ---- */

export type ArchetypeFormat = 'link' | 'text' | 'image';

const ARCHETYPES: Record<ArchetypeFormat, { name: string; lines: readonly string[] }> = {
  link: {
    name: 'The Link Hoarder',
    lines: [
      'Every tab open, forever, just in case.',
      'You collect doors more than you walk through them.',
      'The internet is your notebook.',
    ],
  },
  text: {
    name: 'The Note-Taker',
    lines: [
      'You type the thought before it can run off.',
      'If it is not written down, it did not happen.',
      'You trust the page more than your memory, correctly.',
    ],
  },
  image: {
    name: 'The Screenshotter',
    lines: [
      'Why write it down when you can just screenshot it.',
      'Your camera roll is a second brain with poor filing.',
      'Proof first, context later.',
    ],
  },
};

function isArchetypeFormat(format: string): format is ArchetypeFormat {
  return format in ARCHETYPES;
}

export function archetypeFor(
  format: string | undefined,
  seed: number,
): { format: ArchetypeFormat; name: string; line: string } | null {
  if (!format || !isArchetypeFormat(format)) return null;
  const a = ARCHETYPES[format];
  return { format, name: a.name, line: pick(a.lines, 'archetype', format, seed) };
}

/* --------------------------------------------------------------- social ---- */

const NO_FOLLOW_LINES = [
  'Nobody yet. Pulse is full of people worth watching.',
  'Your orbit is empty. Go find someone.',
];

const FIRST_FOLLOW_CAPTIONS = ['your first follow', 'you found them first', 'where it started'];

const QUIET_WEEK_LINES = ['Quiet week in your orbit.', 'Everyone you follow is being mysterious.'];

export function noFollowLine(seed: number): string {
  return pick(NO_FOLLOW_LINES, 'no-follow', seed);
}

export function firstFollowCaption(handle: string): string {
  return pick(FIRST_FOLLOW_CAPTIONS, 'first-follow', handle);
}

export function quietWeekLine(seed: number): string {
  return pick(QUIET_WEEK_LINES, 'quiet', seed);
}
