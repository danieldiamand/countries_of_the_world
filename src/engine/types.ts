import type { Country } from '../data/countries';

export type CountryState = 'default' | 'unselectable' | 'correct' | 'selected' | 'complete-selected' | 'missed';

export type GuessStatus = 'correct' | 'near-miss' | 'incorrect';

export interface GameConfig {
  continent: string;          // 'World' or continent name
  timeLimit: 15 | 30 | null;
  enabledTerritoryIds: Set<string>;
  /** Explicit pool membership. When set, overrides continent filtering. */
  countryIds?: Set<string>;
  /** Cap the (shuffled) pool to this many countries. Used by Flag mode's question count. */
  limit?: number;
}

export interface GuessResult {
  status: GuessStatus;
  country?: Country;
  suggestion?: string;
  distance?: number;
}

export interface GameResult {
  correct: number;
  total: number;
  timeTaken: number;  // seconds
  hintsUsed: number;
  /** Guessed unaided (no hint used for that country). */
  guessedCountries: Country[];
  /** Guessed, but a hint was used for that country. */
  hintedCountries: Country[];
  missedCountries: Country[];
}

export type GameEventType =
  | 'start'
  | 'correct'
  | 'near-miss'
  | 'incorrect'
  | 'hint'
  | 'skip'
  | 'tick'
  | 'end'
  | 'next'
  | 'select';

export interface GameEvent {
  type: GameEventType;
  country?: Country;
  result?: GuessResult;
  timeRemaining?: number;
  hintText?: string;
  gameResult?: GameResult;
}
