import type { Country } from '../data/countries';

export type GameMode = 1 | 2 | 3 | 5;
export type QuizVariant = 'free' | 'multiple-choice' | 'match-flag';
export type TimeLimit = 15 | 30 | null;
export type QuestionCount = 10 | 20 | 50 | 100 | null; // null = all

export interface GameConfig {
  mode: GameMode;
  continent: string; // 'World' or specific continent name
  timeLimit: TimeLimit;
  variant: QuizVariant;
  questionCount: QuestionCount; // for Flag/Capital quiz modes
}

export type GuessStatus = 'correct' | 'near-miss' | 'incorrect';

export interface GuessResult {
  status: GuessStatus;
  country?: Country;
  suggestion?: string; // display name suggestion for near-miss
  distance?: number;
}

export interface GameResult {
  correct: number;
  total: number;
  timeTaken: number; // seconds
  hintsUsed: number;
  guessedCountries: Country[];
  missedCountries: Country[];
  modeName?: string;
}

export interface PromptData {
  type: 'flag' | 'map-highlight' | 'text' | 'click';
  country?: Country;
  text?: string;
  choices?: string[];      // for 'multiple-choice' variant
  choiceItems?: Country[]; // for 'match-flag' variant
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
