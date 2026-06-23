import { territories } from './territories';
import { countries, continents } from './countries';
import { ALL_QUIZ_STYLE_IDS, type QuizStyleId } from '../engine/quizStyles';

const STORAGE_KEY = 'cotw2_settings';

export type GameMode = 'click-type' | 'free-type' | 'flag' | 'quiz';

/** Number of questions, or 'all' = one per selected country. */
export type QuizLength = number | 'all';

export interface QuizSettings {
  styles: Record<QuizStyleId, boolean>;
  format: 'fixed' | 'adaptive';
  length: QuizLength;
}

export interface FlagSettings {
  answer: 'type' | 'click';
  format: 'fixed' | 'adaptive';
  length: QuizLength;
}

export interface AppSettings {
  mode: GameMode;
  /** Region preset label (World or a continent) — drives bulk selection & centering. */
  continent: string;
  /** Explicit set of country IDs to play. */
  selectedCountryIds: string[];
  timeLimit: 15 | 30 | null;
  enabledTerritoryIds: string[];
  /** Realistic "real Earth" view: guessed countries fill in with satellite imagery. */
  realistic: boolean;
  quiz: QuizSettings;
  flag: FlagSettings;
}

/** Country IDs belonging to a region ('World' = all). */
export function countryIdsForRegion(region: string): string[] {
  if (region === 'World') return countries.map(c => c.id);
  return countries.filter(c => c.continent === region).map(c => c.id);
}

function getDefaultEnabledIds(): string[] {
  return territories.filter(t => t.enabledByDefault).map(t => t.id);
}

function allStylesEnabled(): Record<QuizStyleId, boolean> {
  const r = {} as Record<QuizStyleId, boolean>;
  for (const id of ALL_QUIZ_STYLE_IDS) r[id] = true;
  return r;
}

const DEFAULTS: AppSettings = {
  mode: 'click-type',
  continent: 'World',
  selectedCountryIds: countryIdsForRegion('World'),
  timeLimit: null,
  enabledTerritoryIds: getDefaultEnabledIds(),
  realistic: false,
  quiz: { styles: allStylesEnabled(), format: 'fixed', length: 25 },
  flag: { answer: 'type', format: 'fixed', length: 25 },
};

function normalizeLength(v: unknown, fallback: QuizLength): QuizLength {
  if (v === 'all') return 'all';
  if (typeof v === 'number' && v > 0) return v;
  return fallback;
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return cloneDefaults();
    const parsed = JSON.parse(raw);
    const validIds = new Set(countries.map(c => c.id));
    const selected: string[] = Array.isArray(parsed.selectedCountryIds)
      ? parsed.selectedCountryIds.filter((id: unknown): id is string => typeof id === 'string' && validIds.has(id))
      : countryIdsForRegion(parsed.continent ?? DEFAULTS.continent);
    return {
      mode: parsed.mode ?? DEFAULTS.mode,
      continent: parsed.continent ?? DEFAULTS.continent,
      selectedCountryIds: selected.length > 0 ? selected : countryIdsForRegion('World'),
      timeLimit: parsed.timeLimit ?? DEFAULTS.timeLimit,
      enabledTerritoryIds: parsed.enabledTerritoryIds ?? DEFAULTS.enabledTerritoryIds,
      realistic: parsed.realistic ?? DEFAULTS.realistic,
      quiz: {
        // Merge so newly-added styles default to enabled even on old saves.
        styles: { ...allStylesEnabled(), ...(parsed.quiz?.styles ?? {}) },
        format: parsed.quiz?.format ?? DEFAULTS.quiz.format,
        length: normalizeLength(parsed.quiz?.length, DEFAULTS.quiz.length),
      },
      // Flag mode is always fixed (no adaptive). 'both' was removed → fall back to type.
      flag: {
        answer: parsed.flag?.answer === 'click' ? 'click' : 'type',
        format: 'fixed',
        length: normalizeLength(parsed.flag?.length, DEFAULTS.flag.length),
      },
    };
  } catch {
    return cloneDefaults();
  }
}

function cloneDefaults(): AppSettings {
  return {
    ...DEFAULTS,
    selectedCountryIds: [...DEFAULTS.selectedCountryIds],
    enabledTerritoryIds: [...DEFAULTS.enabledTerritoryIds],
    quiz: { ...DEFAULTS.quiz, styles: { ...DEFAULTS.quiz.styles } },
    flag: { ...DEFAULTS.flag },
  };
}

export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // silent
  }
}

// Re-export for convenience where region lists are needed.
export { continents };
