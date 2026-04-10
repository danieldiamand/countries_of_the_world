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
  private guessed: Set<string> = new Set();
  private hintRevealed: number = 0;
  private hintsUsed: number = 0;
  private currentIndex: number = 0;
  private startTime: number = 0;
  private timerInterval: number = 0;
  private running: boolean = false;
  private listeners: Map<GameEventType, GameEventListener[]> = new Map();
  private nearMissCountry: Country | null = null;
  private cachedPrompt: PromptData | null = null;
  private cachedPromptCountryId: string | null = null;

  // Per-country hint state: countryId -> number of revealed chars
  private hintStates: Map<string, number> = new Map();

  // Centroid lookup for geographic distance (set externally from WorldMap)
  private centroids: Map<string, [number, number]> = new Map();

  // Extra countries (territories) to include in the pool
  private extraCountries: Country[] = [];

  // Recently skipped country IDs — used to prevent skip cycles
  private skipHistory: string[] = [];

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

  setCentroids(centroids: Map<string, [number, number]>): void {
    this.centroids = centroids;
  }

  setExtraCountries(extras: Country[]): void {
    this.extraCountries = extras;
  }

  start(config: GameConfig, adapter: ModeAdapter): void {
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
    this.cachedPrompt = null;
    this.cachedPromptCountryId = null;
    this.hintStates = new Map();
    this.skipHistory = [];
    this.running = true;

    // Filter countries by continent
    const base = [...allCountries, ...this.extraCountries];
    let filtered =
      config.continent === 'World'
        ? [...base]
        : base.filter((c) => c.continent === config.continent);

    // Shuffle
    for (let i = filtered.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [filtered[i], filtered[j]] = [filtered[j], filtered[i]];
    }

    // Trim to questionCount if specified
    if (config.questionCount && config.questionCount < filtered.length) {
      filtered = filtered.slice(0, config.questionCount);
    }

    this.pool = filtered;
    this.startTime = Date.now();

    // Timer: for count-based modes (flag/capital with questionCount), always count UP
    if (config.timeLimit && !config.questionCount) {
      const totalMs = config.timeLimit * 60 * 1000;
      this.timerInterval = window.setInterval(() => {
        const elapsed = Date.now() - this.startTime;
        const remaining = Math.max(0, totalMs - elapsed);
        this.emit({ type: 'tick', timeRemaining: Math.ceil(remaining / 1000) });
        if (remaining <= 0) this.endGame();
      }, 1000);
    } else {
      // Count up
      this.timerInterval = window.setInterval(() => {
        const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
        this.emit({ type: 'tick', timeRemaining: elapsed });
      }, 1000);
    }

    this.emit({ type: 'start' });
    // Mode 1: start with no country selected (user clicks first)
    if (config.mode !== 1) {
      this.emitNext();
    }
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
    // Return cached prompt if still for the same country (prevents reshuffle)
    if (this.cachedPrompt && this.cachedPromptCountryId === country.id) {
      return this.cachedPrompt;
    }
    const prompt = this.adapter.getPrompt(country, this.pool);
    this.cachedPrompt = prompt;
    this.cachedPromptCountryId = country.id;
    return prompt;
  }

  private invalidatePromptCache(): void {
    this.cachedPrompt = null;
    this.cachedPromptCountryId = null;
  }

  submitGuess(input: string): GuessResult {
    if (!this.running || !input.trim()) return { status: 'incorrect' };

    const useCapitals = this.config.mode === 5;

    // If there's an active near-miss, check against that country first
    if (this.nearMissCountry) {
      const result = checkGuess(input, this.nearMissCountry, useCapitals);
      if (result.status === 'correct') return this.handleCorrect(result);
    }

    // Mode 2: check against all unguessed
    if (this.config.mode === 2) {
      const remaining = this.remainingCountries;
      const result = checkGuessAgainstAll(input, remaining, useCapitals);
      if (result.status === 'correct') return this.handleCorrect(result);
      if (result.status === 'near-miss') {
        this.nearMissCountry = result.country || null;
        this.emit({ type: 'near-miss', result, country: result.country });
        return result;
      }
      this.emit({ type: 'incorrect', result });
      return result;
    }

    // Modes 1, 3, 5: check against current target
    const country = this.currentCountry;
    if (!country) return { status: 'incorrect' };

    const result = checkGuess(input, country, useCapitals);

    if (result.status === 'correct') return this.handleCorrect(result);

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
    this.invalidatePromptCache();
    this.emit({ type: 'correct', result, country });

    if (this.guessed.size >= this.pool.length) {
      this.endGame();
      return result;
    }

    this.advanceToNext(country);
    return result;
  }

  /**
   * Use hint: reveals the next letter of the current country's answer.
   * Hints are per-country and persist when switching between countries.
   * Returns the hint text with revealed chars.
   */
  useHint(): string | null {
    if (!this.running) return null;

    const hintCountry = this.nearMissCountry ||
      (this.config.mode === 2 ? null : this.currentCountry);
    if (!hintCountry) return null;

    const useCapitals = this.config.mode === 5;
    const displayAnswer = useCapitals ? hintCountry.capital : hintCountry.name;

    // Get current hint level for this country
    const currentRevealed = this.hintStates.get(hintCountry.id) || 0;
    const newRevealed = Math.min(currentRevealed + 1, displayAnswer.length);
    this.hintStates.set(hintCountry.id, newRevealed);
    this.hintRevealed = newRevealed;
    this.hintsUsed++;

    const hint = displayAnswer.slice(0, newRevealed);
    this.emit({ type: 'hint', hintText: hint, country: hintCountry });
    return hint;
  }

  /**
   * Reveal the full answer for a near-miss (counts as 1 hint use).
   */
  revealNearMiss(): string | null {
    if (!this.running || !this.nearMissCountry) return null;

    const country = this.nearMissCountry;
    const useCapitals = this.config.mode === 5;
    const displayAnswer = useCapitals ? country.capital : country.name;

    this.hintStates.set(country.id, displayAnswer.length);
    this.hintRevealed = displayAnswer.length;
    this.hintsUsed++;

    this.emit({ type: 'hint', hintText: displayAnswer, country });
    return displayAnswer;
  }

  /**
   * Get the stored hint text for the current country (for restoring after switching).
   */
  getHintForCountry(countryId: string): string | null {
    const revealed = this.hintStates.get(countryId);
    if (!revealed || revealed === 0) return null;

    const country = this.pool.find((c) => c.id === countryId);
    if (!country) return null;

    const useCapitals = this.config.mode === 5;
    const displayAnswer = useCapitals ? country.capital : country.name;
    return displayAnswer.slice(0, revealed);
  }

  skip(): void {
    if (!this.running) return;
    if (this.config.mode === 2) return;

    this.hintRevealed = 0;
    this.nearMissCountry = null;

    const current = this.pool[this.currentIndex];

    // Track this skip to prevent short cycles
    if (current) {
      this.skipHistory.push(current.id);
      // Keep a window proportional to pool size (at least 5, up to 20% of pool)
      const maxHistory = Math.max(5, Math.floor(this.pool.length * 0.2));
      if (this.skipHistory.length > maxHistory) {
        this.skipHistory.splice(0, this.skipHistory.length - maxHistory);
      }
    }

    // Build exclusion set from recent skip history
    const skipExclusions = new Set(this.skipHistory);

    if (this.config.mode === 1 && current) {
      // Try nearest neighbor excluding recently skipped
      const nearest = this.findNearestGeographic(current, skipExclusions);
      if (nearest) {
        const idx = this.pool.indexOf(nearest);
        if (idx >= 0) this.currentIndex = idx;
      } else {
        // All neighbors were in skip history — relax and just exclude current
        const fallback = this.findNearestGeographic(current, new Set([current.id]));
        if (fallback) {
          const idx = this.pool.indexOf(fallback);
          if (idx >= 0) this.currentIndex = idx;
        } else {
          this.findNextUnguessed();
        }
      }
    } else {
      if (current && !this.guessed.has(current.id)) {
        this.pool.splice(this.currentIndex, 1);
        this.pool.push(current);
      } else {
        this.currentIndex++;
      }
    }

    this.invalidatePromptCache();
    this.emit({ type: 'skip' });
    this.emitNext();
  }

  selectCountry(countryId: string): boolean {
    if (!this.running) return false;
    if (this.config.mode !== 1 && !(this.config.mode === 5 && this.config.variant === 'free')) return false;
    if (this.guessed.has(countryId)) return false;

    const idx = this.pool.findIndex((c) => c.id === countryId);
    if (idx < 0) return false;

    this.currentIndex = idx;
    this.hintRevealed = this.hintStates.get(countryId) || 0;
    this.nearMissCountry = null;
    this.invalidatePromptCache();
    this.emitNext();
    return true;
  }

  endGame(): GameResult {
    this.running = false;
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = 0;
    }

    const timeTaken = Math.floor((Date.now() - this.startTime) / 1000);
    const guessedCountries = this.pool.filter((c) => this.guessed.has(c.id));
    const missedCountries = this.pool.filter((c) => !this.guessed.has(c.id));

    const result: GameResult = {
      correct: guessedCountries.length,
      total: this.pool.length,
      timeTaken,
      hintsUsed: this.hintsUsed,
      guessedCountries,
      missedCountries,
      modeName: this.adapter?.modeName,
    };

    this.emit({ type: 'end', gameResult: result });
    return result;
  }

  private advanceToNext(lastCorrect: Country): void {
    // Correct answer breaks any skip cycle
    this.skipHistory = [];

    if (this.config.mode === 2) {
      this.emitNext();
      return;
    }

    // For Mode 1: find nearest geographic neighbor using centroids
    if (this.config.mode === 1) {
      const nearest = this.findNearestGeographic(lastCorrect);
      if (nearest) {
        const idx = this.pool.indexOf(nearest);
        if (idx >= 0) this.currentIndex = idx;
      } else {
        this.findNextUnguessed();
      }
    } else {
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

  /**
   * Get a random unguessed country (for the 'Find' feature in free-type mode).
   */
  getRandomUnguessedCountry(): Country | null {
    const remaining = this.pool.filter((c) => !this.guessed.has(c.id));
    if (remaining.length === 0) return null;
    return remaining[Math.floor(Math.random() * remaining.length)];
  }

  /**
   * Find the nearest unguessed country by geographic distance using projected centroids.
   * Prefers same-continent countries. Within the same continent, picks the closest
   * by Euclidean distance in projected coordinates (which roughly maps to geographic
   * proximity, biased slightly rightward/eastward due to the projection).
   */
  private findNearestGeographic(lastCorrect: Country, excludeIds?: Set<string>): Country | null {
    const excluded = excludeIds || new Set<string>();
    const remaining = this.pool.filter((c) => !this.guessed.has(c.id) && !excluded.has(c.id));
    if (remaining.length === 0) return null;

    const lastCentroid = this.centroids.get(lastCorrect.id);
    if (!lastCentroid) {
      // Fallback: same continent first, then any
      const sameContinent = remaining.filter((c) => c.continent === lastCorrect.continent);
      return sameContinent.length > 0 ? sameContinent[0] : remaining[0];
    }

    // Score each remaining country: strongly prefer same continent, closest distance
    const scored = remaining.map((c) => {
      const centroid = this.centroids.get(c.id);
      if (!centroid) return { country: c, score: Infinity };
      const dx = centroid[0] - lastCentroid[0];
      const dy = centroid[1] - lastCentroid[1];
      let dist = Math.sqrt(dx * dx + dy * dy);
      // Strongly penalize cross-continent jumps so we finish a continent first
      if (c.continent !== lastCorrect.continent) dist += 50000;
      return { country: c, score: dist };
    });

    scored.sort((a, b) => a.score - b.score);
    return scored[0].country;
  }

  private emitNext(): void {
    const prompt = this.getPrompt();
    if (prompt) {
      this.emit({ type: 'next', prompt, country: this.currentCountry });
    }
  }

  submitChoice(choiceIndex: number): GuessResult {
    if (!this.running) return { status: 'incorrect' };

    const country = this.currentCountry;
    if (!country) return { status: 'incorrect' };

    const prompt = this.getPrompt();
    if (!prompt) return { status: 'incorrect' };

    if (this.config.variant === 'multiple-choice' && prompt.choices) {
      const chosen = prompt.choices[choiceIndex];
      if (!chosen) return { status: 'incorrect' };
      const useCapitals = this.config.mode === 5;
      const correctAnswer = useCapitals ? country.capital : country.name;
      if (normalize(chosen) === normalize(correctAnswer)) {
        return this.handleCorrect({ status: 'correct', country });
      }
      this.emit({ type: 'incorrect', result: { status: 'incorrect' }, country });
      return { status: 'incorrect' };
    }

    if (this.config.variant === 'match-flag' && prompt.choiceItems) {
      const chosenCountry = prompt.choiceItems[choiceIndex];
      if (!chosenCountry) return { status: 'incorrect' };
      if (chosenCountry.id === country.id) {
        return this.handleCorrect({ status: 'correct', country });
      }
      this.emit({ type: 'incorrect', result: { status: 'incorrect' }, country });
      return { status: 'incorrect' };
    }

    return { status: 'incorrect' };
  }
}
