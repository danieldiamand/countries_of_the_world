import type { GameMode, QuizVariant, TimeLimit, QuestionCount } from '../engine/types';
import { getDefaultEnabledIds } from './territories';

const STORAGE_KEY = 'cotw_settings';

export interface AppSettings {
  mode: GameMode;
  continent: string;
  timeLimit: TimeLimit;
  variant: QuizVariant;
  questionCount: QuestionCount;
  enabledTerritoryIds: string[];
}

const DEFAULTS: AppSettings = {
  mode: 1,
  continent: 'World',
  timeLimit: 15,
  variant: 'free',
  questionCount: 20,
  enabledTerritoryIds: [...getDefaultEnabledIds()],
};

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    return {
      mode: parsed.mode ?? DEFAULTS.mode,
      continent: parsed.continent ?? DEFAULTS.continent,
      timeLimit: parsed.timeLimit ?? DEFAULTS.timeLimit,
      variant: parsed.variant ?? DEFAULTS.variant,
      questionCount: parsed.questionCount ?? DEFAULTS.questionCount,
      enabledTerritoryIds: parsed.enabledTerritoryIds ?? DEFAULTS.enabledTerritoryIds,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // silent — localStorage may be unavailable
  }
}
