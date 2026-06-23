import type { Country } from '../data/countries';
import { countries } from '../data/countries';
import { territories, buildFullFeatureParentMap } from '../data/territories';
import type { GameConfig, GameEvent, GameEventType, GameResult, GuessResult } from './types';
import { checkGuess, findFreeMatch } from './matching';
import { selectNext, addToSkipHistory, type SelectionContext } from './selection';

type Listener = (event: GameEvent) => void;

export class GameEngine {
  private pool: Country[] = [];
  private guessedIds = new Set<string>();
  /** Countries guessed after a hint was used for them. */
  private hintedGuessIds = new Set<string>();
  private hintStates = new Map<string, number>(); // countryId → revealed char count
  private currentId: string | null = null;
  private listeners = new Map<GameEventType, Listener[]>();
  private hintsUsed = 0;
  private timerInterval: ReturnType<typeof setInterval> | null = null;
  private startTime = 0;
  private timeLimitMs = 0;
  private running = false;
  private paused = false;
  private pauseStart = 0;
  /** Total ms spent paused — subtracted from elapsed so pausing freezes the clock. */
  private pausedTotal = 0;

  // Selection context
  private selectionHistory: string[] = [];
  private skipHistory = new Set<string>();
  /** Territory click location — used as reference for auto-advance */
  private referenceGeo: [number, number] | null = null;

  // Centroid reference (set by main.ts from Globe)
  centroids = new Map<string, [number, number]>();

  // Territory parent mapping
  private territoryParentMap = new Map<string, string>();

  get currentCountryId(): string | null {
    return this.currentId;
  }

  get currentCountry(): Country | null {
    if (!this.currentId) return null;
    return this.pool.find(c => c.id === this.currentId) ?? null;
  }

  get score(): number {
    return this.guessedIds.size;
  }

  get total(): number {
    return this.pool.length;
  }

  get isRunning(): boolean {
    return this.running;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /** Returns all country IDs that should be active (in the game pool) */
  get activeIds(): Set<string> {
    return new Set(this.pool.map(c => c.id));
  }

  /** Get the country state for rendering */
  getCountryState(id: string): 'default' | 'correct' | 'selected' | 'complete-selected' {
    if (id === this.currentId) {
      if (this.guessedIds.has(id)) return 'complete-selected';
      return 'selected';
    }
    if (this.guessedIds.has(id)) return 'correct';
    return 'default';
  }

  /** Expose the feature→parent map for globe state propagation */
  get featureParentMap(): Map<string, string> {
    return this.territoryParentMap;
  }

  /** Resolve territory clicks to parent if disabled */
  resolveTerritory(clickedId: string): string {
    return this.territoryParentMap.get(clickedId) ?? clickedId;
  }

  // ── Lifecycle ──────────────────────────────────────────

  start(config: GameConfig): void {
    // Build pool
    const enabledTerritories = territories.filter(t => config.enabledTerritoryIds.has(t.id));
    const allCountries: Country[] = [...countries, ...enabledTerritories];

    this.pool = config.countryIds
      ? allCountries.filter(c => config.countryIds!.has(c.id))
      : config.continent === 'World'
        ? allCountries
        : allCountries.filter(c => c.continent === config.continent);

    // Shuffle
    for (let i = this.pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.pool[i], this.pool[j]] = [this.pool[j], this.pool[i]];
    }

    // Optional length cap (Flag mode question count).
    if (config.limit && config.limit > 0 && config.limit < this.pool.length) {
      this.pool = this.pool.slice(0, config.limit);
    }

    // Build territory parent map (disabled territories + unlisted features)
    this.territoryParentMap = buildFullFeatureParentMap(config.enabledTerritoryIds);

    // Reset state
    this.guessedIds.clear();
    this.hintedGuessIds.clear();
    this.hintStates.clear();
    this.selectionHistory = [];
    this.skipHistory.clear();
    this.hintsUsed = 0;
    this.currentId = null;
    this.running = true;
    this.paused = false;
    this.pausedTotal = 0;
    this.startTime = Date.now();

    // Timer
    if (config.timeLimit) {
      this.timeLimitMs = config.timeLimit * 60 * 1000;
      this.timerInterval = setInterval(() => this.tick(), 1000);
    } else {
      this.timeLimitMs = 0;
      this.timerInterval = setInterval(() => this.tick(), 1000);
    }

    this.emit('start', {});
  }

  /** Pause the clock and freeze interaction. */
  pause(): void {
    if (!this.running || this.paused) return;
    this.paused = true;
    this.pauseStart = Date.now();
  }

  /** Resume the clock. */
  resume(): void {
    if (!this.running || !this.paused) return;
    this.pausedTotal += Date.now() - this.pauseStart;
    this.paused = false;
  }

  private tick(): void {
    if (!this.running || this.paused) return;

    const elapsed = Date.now() - this.startTime - this.pausedTotal;

    if (this.timeLimitMs > 0) {
      const remaining = Math.max(0, this.timeLimitMs - elapsed);
      this.emit('tick', { timeRemaining: remaining });
      if (remaining <= 0) {
        this.endGame();
      }
    } else {
      this.emit('tick', { timeRemaining: elapsed });
    }
  }

  endGame(): void {
    this.running = false;
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }

    const guessed = this.pool.filter(c => this.guessedIds.has(c.id) && !this.hintedGuessIds.has(c.id));
    const hinted = this.pool.filter(c => this.hintedGuessIds.has(c.id));
    const missed = this.pool.filter(c => !this.guessedIds.has(c.id));
    const elapsed = Math.floor((Date.now() - this.startTime - this.pausedTotal) / 1000);

    const result: GameResult = {
      correct: this.guessedIds.size,
      total: this.pool.length,
      timeTaken: elapsed,
      hintsUsed: this.hintsUsed,
      guessedCountries: guessed,
      hintedCountries: hinted,
      missedCountries: missed,
    };

    this.emit('end', { gameResult: result });
  }

  // ── Selection ──────────────────────────────────────────

  selectCountry(id: string, referenceGeo?: [number, number]): void {
    if (!this.running || this.paused) return;
    this.currentId = id;
    this.referenceGeo = referenceGeo ?? null;
    this.selectionHistory.push(id);

    const country = this.pool.find(c => c.id === id);
    this.emit('select', { country });
  }

  // ── Guessing ───────────────────────────────────────────

  submitGuess(input: string): GuessResult {
    if (!this.running || this.paused || !this.currentId) {
      return { status: 'incorrect' };
    }

    const country = this.pool.find(c => c.id === this.currentId);
    if (!country) return { status: 'incorrect' };

    // Already guessed
    if (this.guessedIds.has(this.currentId)) {
      return { status: 'incorrect' };
    }

    const result = checkGuess(input, country);

    if (result.status === 'correct') {
      this.guessedIds.add(this.currentId);
      // If a hint was revealed for this country, it counts as "guessed with hint".
      if ((this.hintStates.get(this.currentId) ?? 0) > 0) this.hintedGuessIds.add(this.currentId);
      this.skipHistory.clear(); // Reset skip history on correct answer
      this.emit('correct', { country, result });

      // Check if all done
      if (this.guessedIds.size === this.pool.length) {
        this.endGame();
        return result;
      }

      // Auto-advance
      this.autoAdvance();
    } else if (result.status === 'near-miss') {
      this.emit('near-miss', { country, result });
    } else {
      this.emit('incorrect', { country, result });
    }

    return result;
  }

  // ── Free-Type guessing ─────────────────────────────────

  /**
   * Free-Type mode: the player types country names freely with no prior
   * selection. The input is matched against all not-yet-completed countries.
   * Returns the match result (with `ambiguous` set when a fuzzy match could
   * mean more than one country, so we deliberately reveal nothing).
   */
  submitFreeGuess(input: string): GuessResult & { ambiguous?: boolean } {
    if (!this.running || this.paused) return { status: 'incorrect' };

    const remaining = this.pool.filter(c => !this.guessedIds.has(c.id));
    const result = findFreeMatch(input, remaining);

    if (result.status === 'correct' && result.country) {
      this.guessedIds.add(result.country.id);
      this.emit('correct', { country: result.country, result });
      if (this.guessedIds.size === this.pool.length) {
        this.endGame();
      }
    } else if (result.status === 'near-miss' && result.country) {
      this.emit('near-miss', { country: result.country, result });
    } else {
      this.emit('incorrect', { result });
    }

    return result;
  }

  /**
   * Free-Type "Reveal a country": highlight a random not-yet-completed country
   * so the player can see which one to name next. Emits 'select'.
   */
  selectRandomUncompleted(): Country | null {
    if (!this.running || this.paused) return null;
    const remaining = this.pool.filter(c => !this.guessedIds.has(c.id));
    if (remaining.length === 0) return null;
    const pick = remaining[Math.floor(Math.random() * remaining.length)];
    this.currentId = pick.id;
    this.emit('select', { country: pick });
    return pick;
  }

  // ── Hints ──────────────────────────────────────────────

  useHint(): string | null {
    if (!this.running || this.paused || !this.currentId) return null;

    const country = this.pool.find(c => c.id === this.currentId);
    if (!country || this.guessedIds.has(this.currentId)) return null;

    const current = this.hintStates.get(this.currentId) ?? 0;
    const name = country.name;
    if (current >= name.length) return name;

    const next = current + 1;
    this.hintStates.set(this.currentId, next);
    this.hintsUsed++;

    const hintText = name.substring(0, next);
    this.emit('hint', { country, hintText });
    return hintText;
  }

  /** Get current hint text for the current country */
  getHintText(): string {
    if (!this.currentId) return '';
    const count = this.hintStates.get(this.currentId) ?? 0;
    if (count === 0) return '';
    const country = this.pool.find(c => c.id === this.currentId);
    return country ? country.name.substring(0, count) : '';
  }

  // ── Skip ───────────────────────────────────────────────

  skip(): void {
    if (!this.running || this.paused || !this.currentId) return;

    addToSkipHistory(this.skipHistory, this.currentId, this.pool.length);
    this.emit('skip', { country: this.currentCountry ?? undefined });
    this.autoAdvance();
  }

  // ── Auto-advance ───────────────────────────────────────

  private autoAdvance(): void {
    const remaining = this.pool.filter(c => !this.guessedIds.has(c.id));
    if (remaining.length === 0) return;

    // Look up the current country's continent from the full pool (it may already be guessed)
    const currentCountry = this.pool.find(c => c.id === this.currentId);

    const ctx: SelectionContext = {
      centroids: this.centroids,
      selectionHistory: this.selectionHistory,
      skipHistory: this.skipHistory,
      referenceGeo: this.referenceGeo ?? undefined,
      currentContinent: currentCountry?.continent,
    };

    const next = selectNext(this.currentId!, remaining, ctx);
    if (next) {
      this.currentId = next.id;
      this.referenceGeo = null; // Clear after advancing
      this.selectionHistory.push(next.id);
      this.emit('next', { country: next });
    }
  }

  // ── Events ─────────────────────────────────────────────

  on(type: GameEventType, listener: Listener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type)!.push(listener);
  }

  off(type: GameEventType, listener: Listener): void {
    const list = this.listeners.get(type);
    if (list) {
      const idx = list.indexOf(listener);
      if (idx >= 0) list.splice(idx, 1);
    }
  }

  private emit(type: GameEventType, data: Partial<GameEvent>): void {
    const event: GameEvent = { type, ...data };
    const list = this.listeners.get(type);
    if (list) {
      for (const listener of list) listener(event);
    }
  }
}
