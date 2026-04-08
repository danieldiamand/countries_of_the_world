import type { Country } from '../data/countries';

export type GameMode = 1 | 2 | 3 | 4 | 5; // 4 is removed from UI but kept for type compat
export type QuizVariant = 'free' | 'choice' | 'reverse';
export type TimeLimit = 15 | 30 | null;

export interface GameConfig {
  mode: GameMode;
  continent: string; // 'World' or specific continent name
  timeLimit: TimeLimit;
  variant: QuizVariant;
}

export type GuessStatus = 'correct' | 'near-miss' | 'incorrect';

export interface GuessResult {
  status: GuessStatus;
  country?: Country;
  suggestion?: string;
  distance?: number;
}

export interface GameResult {
  correct: number;
  total: number;
  timeTaken: number; // seconds
  hintsUsed: number;
  guessedCountries: Country[];
  missedCountries: Country[];
}

export interface PromptData {
  type: 'flag' | 'map-highlight' | 'text' | 'click';
  country?: Country;
  text?: string;
  choices?: string[];      // for 'choice' variant
  choiceItems?: Country[]; // for 'reverse' variant
}

export interface ModeAdapter {
  readonly requiresMapClick: boolean;
  readonly modeName: string;
  getPrompt(country: Country, allCountries: Country[]): PromptData;
  getAnswer(country: Country): string[];
  getDisplayAnswer(country: Country): string;
}

export type GameEventType =
  | 'correct'
  | 'near-miss'
  | 'incorrect'
  | 'hint'
  | 'skip'
  | 'tick'
  | 'end'
  | 'next'
  | 'start';

export interface GameEvent {
  type: GameEventType;
  country?: Country;
  result?: GuessResult;
  timeRemaining?: number;
  hintText?: string;
  gameResult?: GameResult;
  prompt?: PromptData;
}

export type GameEventListener = (event: GameEvent) => void;
