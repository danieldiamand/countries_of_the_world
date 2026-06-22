import type { Country } from '../data/countries';

/** What the player is shown. */
export type QuizPromptKind = 'flag' | 'outline' | 'globe-highlight' | 'name';

/** How the player answers. */
export type QuizAnswerKind = 'type' | 'pick-name' | 'pick-flag' | 'locate';

export type QuizStyleId =
  | 'flag-name'
  | 'flag-pick-name'
  | 'name-pick-flag'
  | 'flag-locate'
  | 'outline-name'
  | 'outline-pick-name'
  | 'globe-name'
  | 'name-locate';

export type QuizCategory = 'Type the answer' | 'Multiple choice' | 'Find on the globe';

export interface QuizStyleDef {
  id: QuizStyleId;
  label: string;
  category: QuizCategory;
  description: string;
  prompt: QuizPromptKind;
  answer: QuizAnswerKind;
}

/** All quiz styles, in setup-display order. */
export const QUIZ_STYLES: QuizStyleDef[] = [
  { id: 'flag-name', label: 'Flag', category: 'Type the answer', description: 'A flag is shown — type the country name.', prompt: 'flag', answer: 'type' },
  { id: 'outline-name', label: 'Outline', category: 'Type the answer', description: 'A country outline is shown — type the country name.', prompt: 'outline', answer: 'type' },
  { id: 'globe-name', label: 'Highlighted on globe', category: 'Type the answer', description: 'A country is highlighted on the globe — type its name.', prompt: 'globe-highlight', answer: 'type' },
  { id: 'flag-pick-name', label: 'Flag → choose name', category: 'Multiple choice', description: 'See a flag, choose the matching country name.', prompt: 'flag', answer: 'pick-name' },
  { id: 'name-pick-flag', label: 'Name → choose flag', category: 'Multiple choice', description: 'See a country name, choose the matching flag.', prompt: 'name', answer: 'pick-flag' },
  { id: 'outline-pick-name', label: 'Outline → choose name', category: 'Multiple choice', description: 'See a country outline, choose the matching name.', prompt: 'outline', answer: 'pick-name' },
  { id: 'flag-locate', label: 'Flag → click country', category: 'Find on the globe', description: 'See a flag, click the country on the globe.', prompt: 'flag', answer: 'locate' },
  { id: 'name-locate', label: 'Name → click country', category: 'Find on the globe', description: 'See a country name, click it on the globe.', prompt: 'name', answer: 'locate' },
];

export const QUIZ_CATEGORIES: QuizCategory[] = ['Type the answer', 'Multiple choice', 'Find on the globe'];

export const ALL_QUIZ_STYLE_IDS: QuizStyleId[] = QUIZ_STYLES.map(s => s.id);

/** Styles used by the standalone Flag mode. */
export const FLAG_STYLE_IDS: Record<'type' | 'click' | 'both', QuizStyleId[]> = {
  type: ['flag-name'],
  click: ['flag-locate'],
  both: ['flag-name', 'flag-locate'],
};

const STYLE_BY_ID = new Map(QUIZ_STYLES.map(s => [s.id, s]));

export function getStyle(id: QuizStyleId): QuizStyleDef {
  return STYLE_BY_ID.get(id)!;
}

export interface QuizQuestion {
  style: QuizStyleDef;
  target: Country;
  /** Multiple-choice options (includes the target), shuffled. Only for pick-* answers. */
  options?: Country[];
}

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Build multiple-choice options for a target, preferring same-continent
 * distractors (more plausible) and falling back to the rest of the pool.
 */
export function buildOptions(target: Country, pool: Country[], count = 4): Country[] {
  const sameContinent = shuffle(pool.filter(c => c.id !== target.id && c.continent === target.continent));
  const others = shuffle(pool.filter(c => c.id !== target.id && c.continent !== target.continent));
  const distractors: Country[] = [];
  for (const c of sameContinent) {
    if (distractors.length >= count - 1) break;
    distractors.push(c);
  }
  for (const c of others) {
    if (distractors.length >= count - 1) break;
    distractors.push(c);
  }
  return shuffle([target, ...distractors]);
}
