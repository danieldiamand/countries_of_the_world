import { countries as allCountries, type Country } from '../data/countries';
import { checkGuess, checkGuessAgainstAll, normalize } from './matching';
import type {
  GameConfig,
  GameEvent,
  GameEventListener,
  GameEventType,
  GameResult,
  GuessResult,
  ModeAdapter,
  PromptData,
} from './types';

export class GameEngine {
  private config!: GameConfig;
  private adapter!: ModeAdapter;
  private pool: Country[] = [];
  private guessed: Set<string> = new Set(); // country ids
  private hintRevealed: number = 0;
  private hintsUsed: number = 0;
  private currentIndex: number = 0;
  private startTime: number = 0;
  private timerInterval: number = 0;
  private running: boolean = false;
  private listeners: Map<GameEventType, GameEventListener[]> = new Map();
  private nearMissCountry: Country | null = null;

  on(type: GameEventType, listener: GameEventListener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type)!.push(listener);
  }

  off(type: GameEventType, listener: GameEventListener): void {
    const list = this.listeners.get(type);
    if (list) {
      const idx = list.indexOf(listener);
      if (idx >= 0) list.splice(idx, 1);
    }
  }

  removeAllListeners(): void {
    this.listeners.clear();
  }

  private emit(event: GameEvent): void {
    const list = this.listeners.get(event.type);
    if (list) list.forEach((fn) => fn(event));
  }

  start(config: GameConfig, adapter: ModeAdapter): void {
    // Clean up any previous game timer
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = 0;
    }

    this.config = config;
    this.adapter = adapter;
    this.guessed = new Set();
    this.hintRevealed = 0;
    this.hintsUsed = 0;
    this.currentIndex = 0;
    this.nearMissCountry = null;
    this.running = true;

    // Filter countries by continent
    let filtered =
      config.continent === 'World'
        ? [...allCountries]
        : allCountries.filter((c) => c.continent === config.continent);

    // Shuffle
    for (let i = filtered.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [filtered[i], filtered[j]] = [filtered[j], filtered[i]];
    }
    this.pool = filtered;

    this.startTime = Date.now();

    // Timer
    if (config.timeLimit) {
      const totalMs = config.timeLimit * 60 * 1000;
      this.timerInterval = window.setInterval(() => {
        const elapsed = Date.now() - this.startTime;
        const remaining = Math.max(0, totalMs - elapsed);
        this.emit({
          type: 'tick',
          timeRemaining: Math.ceil(remaining / 1000),
        });
        if (remaining <= 0) {
          this.endGame();
        }
      }, 1000);
    } else {
      // Count up
      this.timerInterval = window.setInterval(() => {
        const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
        this.emit({ type: 'tick', timeRemaining: elapsed });
      }, 1000);
    }

    this.emit({ type: 'start' });
    this.emitNext();
  }

  get isRunning(): boolean {
    return this.running;
  }

  get currentCountry(): Country | undefined {
    return this.pool[this.currentIndex];
  }

  get totalCountries(): number {
    return this.pool.length;
  }

  get correctCount(): number {
    return this.guessed.size;
  }

  get remainingCountries(): Country[] {
    return this.pool.filter((c) => !this.guessed.has(c.id));
  }

  get elapsedSeconds(): number {
    return Math.floor((Date.now() - this.startTime) / 1000);
  }

  getPrompt(): PromptData | null {
    if (!this.running) return null;
    const country = this.currentCountry;
    if (!country) return null;
    return this.adapter.getPrompt(country, this.pool);
  }

  /**
   * Submit a guess. For Mode 2 (free type, no specific target),
   * checks against all unguessed countries.
   */
  submitGuess(input: string): GuessResult {
    if (!this.running || !input.trim()) {
      return { status: 'incorrect' };
    }

    const useCapitals = this.config.mode === 5;

    // If there's an active near-miss, check against that country first
    if (this.nearMissCountry) {
      const result = checkGuess(input, this.nearMissCountry, useCapitals);
      if (result.status === 'correct') {
        return this.handleCorrect(result);
      }
    }

    // Mode 2: check against all unguessed
    if (this.config.mode === 2) {
      const remaining = this.remainingCountries;
      const result = checkGuessAgainstAll(input, remaining, useCapitals);
      if (result.status === 'correct') {
        return this.handleCorrect(result);
      }
      if (result.status === 'near-miss') {
        this.nearMissCountry = result.country || null;
        this.emit({ type: 'near-miss', result, country: result.country });
        return result;
      }
      this.emit({ type: 'incorrect', result });
      return result;
    }

    // Modes 1, 3, 4, 5: check against current target
    const country = this.currentCountry;
    if (!country) return { status: 'incorrect' };

    const result = checkGuess(input, country, useCapitals);

    if (result.status === 'correct') {
      return this.handleCorrect(result);
    }

    if (result.status === 'near-miss') {
      this.nearMissCountry = country;
      this.emit({ type: 'near-miss', result, country });
      return result;
    }

    this.emit({ type: 'incorrect', result });
    return result;
  }

  private handleCorrect(result: GuessResult): GuessResult {
    const country = result.country!;
    this.guessed.add(country.id);
    this.hintRevealed = 0;
    this.nearMissCountry = null;
    this.emit({ type: 'correct', result, country });

    // Check if all done
    if (this.guessed.size >= this.pool.length) {
      this.endGame();
      return result;
    }

    // Advance to next
    this.advanceToNext(country);
    return result;
  }

  /**
   * Use a hint: reveals the next letter of the answer.
   * If there's a near-miss active, completes the answer.
   */
  useHint(): string | null {
    if (!this.running) return null;

    // If near-miss is active, auto-complete it
    if (this.nearMissCountry) {
      const country = this.nearMissCountry;
      const useCapitals = this.config.mode === 5;
      const displayAnswer = useCapitals ? country.capital : country.name;
      this.hintsUsed++;
      // Treat as correct
      this.guessed.add(country.id);
      this.hintRevealed = 0;
      this.nearMissCountry = null;
      this.emit({
        type: 'correct',
        result: { status: 'correct', country },
        country,
        hintText: displayAnswer,
      });
      if (this.guessed.size >= this.pool.length) {
        this.endGame();
        return displayAnswer;
      }
      this.advanceToNext(country);
      return displayAnswer;
    }

    // Normal hint: reveal next letter
    const country =
      this.config.mode === 2 ? null : this.currentCountry;
    if (!country) return null;

    const useCapitals = this.config.mode === 5;
    const displayAnswer = useCapitals ? country.capital : country.name;
    this.hintRevealed++;
    this.hintsUsed++;

    const revealed = displayAnswer.slice(0, this.hintRevealed);
    const hint =
      revealed +
      displayAnswer
        .slice(this.hintRevealed)
        .replace(/[a-zA-ZÀ-ÿ]/g, '_');

    this.emit({ type: 'hint', hintText: hint, country });
    return hint;
  }

  /**
   * Skip the current question in applicable modes.
   */
  skip(): void {
    if (!this.running) return;
    if (this.config.mode === 2) return; // Can't skip in free type

    this.hintRevealed = 0;
    this.nearMissCountry = null;

    // Move current to end
    const current = this.pool[this.currentIndex];
    if (current && !this.guessed.has(current.id)) {
      this.pool.splice(this.currentIndex, 1);
      this.pool.push(current);
    } else {
      this.currentIndex++;
    }

    this.emit({ type: 'skip' });
    this.emitNext();
  }

  /**
   * For Mode 1: select a country on the map.
   */
  selectCountry(countryId: string): boolean {
    if (!this.running || this.config.mode !== 1) return false;
    if (this.guessed.has(countryId)) return false;

    const idx = this.pool.findIndex((c) => c.id === countryId);
    if (idx < 0) return false;

    this.currentIndex = idx;
    this.hintRevealed = 0;
    this.nearMissCountry = null;
    this.emitNext();
    return true;
  }

  /**
   * End the game early or when time is up.
   */
  endGame(): GameResult {
    this.running = false;
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = 0;
    }

    const timeTaken = Math.floor((Date.now() - this.startTime) / 1000);
    const guessedCountries = this.pool.filter((c) =>
      this.guessed.has(c.id)
    );
    const missedCountries = this.pool.filter(
      (c) => !this.guessed.has(c.id)
    );

    const result: GameResult = {
      correct: guessedCountries.length,
      total: this.pool.length,
      timeTaken,
      hintsUsed: this.hintsUsed,
      guessedCountries,
      missedCountries,
    };

    this.emit({ type: 'end', gameResult: result });
    return result;
  }

  /**
   * Get the hint text so far (for displaying partial answer).
   */
  getHintText(): string | null {
    if (this.hintRevealed === 0) return null;
    const country = this.currentCountry;
    if (!country) return null;
    const useCapitals = this.config.mode === 5;
    const displayAnswer = useCapitals ? country.capital : country.name;
    const revealed = displayAnswer.slice(0, this.hintRevealed);
    return (
      revealed +
      displayAnswer.slice(this.hintRevealed).replace(/[a-zA-ZÀ-ÿ]/g, '_')
    );
  }

  private advanceToNext(lastCorrect: Country): void {
    if (this.config.mode === 2) {
      // In free type, no advancement needed
      this.emitNext();
      return;
    }

    // For Mode 1: try to find nearest unguessed country
    if (this.config.mode === 1) {
      const nearest = this.findNearestUnguessed(lastCorrect);
      if (nearest) {
        const idx = this.pool.indexOf(nearest);
        if (idx >= 0) this.currentIndex = idx;
      } else {
        this.findNextUnguessed();
      }
    } else {
      // For modes 3, 4, 5: just go to next in queue
      this.findNextUnguessed();
    }

    this.emitNext();
  }

  private findNextUnguessed(): void {
    for (let i = 0; i < this.pool.length; i++) {
      const idx = (this.currentIndex + i) % this.pool.length;
      if (!this.guessed.has(this.pool[idx].id)) {
        this.currentIndex = idx;
        return;
      }
    }
  }

  private findNearestUnguessed(lastCorrect: Country): Country | null {
    const remaining = this.pool.filter((c) => !this.guessed.has(c.id));
    if (remaining.length === 0) return null;

    // Prefer same continent for geographic flow
    const sameContinent = remaining.filter(
      (c) => c.continent === lastCorrect.continent
    );
    if (sameContinent.length > 0) {
      return sameContinent[Math.floor(Math.random() * sameContinent.length)];
    }

    // Fall back to any remaining
    return remaining[Math.floor(Math.random() * remaining.length)];
  }

  private emitNext(): void {
    const prompt = this.getPrompt();
    if (prompt) {
      this.emit({ type: 'next', prompt, country: this.currentCountry });
    }
  }

  /**
   * Handle choice selection for multiple-choice variants.
   */
  submitChoice(choiceIndex: number): GuessResult {
    if (!this.running) return { status: 'incorrect' };

    const country = this.currentCountry;
    if (!country) return { status: 'incorrect' };

    const prompt = this.getPrompt();
    if (!prompt) return { status: 'incorrect' };

    if (this.config.variant === 'choice' && prompt.choices) {
      const chosen = prompt.choices[choiceIndex];
      if (!chosen) return { status: 'incorrect' };
      const useCapitals = this.config.mode === 5;
      const correctAnswer = useCapitals ? country.capital : country.name;
      if (normalize(chosen) === normalize(correctAnswer)) {
        const result: GuessResult = { status: 'correct', country };
        return this.handleCorrect(result);
      }
      this.emit({
        type: 'incorrect',
        result: { status: 'incorrect' },
        country,
      });
      return { status: 'incorrect' };
    }

    if (this.config.variant === 'reverse' && prompt.choiceItems) {
      const chosenCountry = prompt.choiceItems[choiceIndex];
      if (!chosenCountry) return { status: 'incorrect' };
      if (chosenCountry.id === country.id) {
        const result: GuessResult = { status: 'correct', country };
        return this.handleCorrect(result);
      }
      this.emit({
        type: 'incorrect',
        result: { status: 'incorrect' },
        country,
      });
      return { status: 'incorrect' };
    }

    return { status: 'incorrect' };
  }
}
