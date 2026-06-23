import type { Country } from '../data/countries';
import { countries } from '../data/countries';
import { territories } from '../data/territories';
import type { GameResult } from './types';
import { checkGuess } from './matching';
import {
  buildOptions,
  getStyle,
  shuffle,
  type QuizQuestion,
  type QuizStyleDef,
  type QuizStyleId,
} from './quizStyles';

export interface QuizConfig {
  continent: string;
  enabledTerritoryIds: Set<string>;
  /** Explicit pool membership. When set, overrides continent filtering. */
  countryIds?: Set<string>;
  styleIds: QuizStyleId[];
  format: 'fixed' | 'adaptive';
  /** Number of questions, or 'all' = one per pool country. */
  length: number | 'all';
  timeLimit: 15 | 30 | null;
  /** Optional predicate: can this country be drawn as an outline / shape? */
  shapeAvailable?: (countryId: string) => boolean;
}

export type QuizEventType = 'question' | 'answered' | 'tick' | 'end';

export interface QuizEvent {
  type: QuizEventType;
  question?: QuizQuestion;
  index?: number;
  total?: number;
  correct?: boolean;
  correctCountry?: Country;
  timeRemaining?: number;
  result?: GameResult;
}

type Listener = (event: QuizEvent) => void;

export class QuizEngine {
  private pool: Country[] = [];
  private styles: QuizStyleDef[] = [];
  private format: 'fixed' | 'adaptive' = 'fixed';
  private targetCount = 20;
  private shapeAvailable?: (id: string) => boolean;

  private queue: QuizQuestion[] = [];
  private current: QuizQuestion | null = null;
  private answeredCurrent = false;
  private currentHinted = false;
  private hintCount = 0;

  /** Real answer attempts (correct or wrong) — drives the fixed-length target. Skips don't count. */
  private answeredCount = 0;
  private correctCount = 0;
  private hintsUsed = 0;
  private correctIds = new Set<string>();
  private missedIds = new Set<string>();
  private masteredIds = new Set<string>();

  private running = false;
  private startTime = 0;
  private timeLimitMs = 0;
  private timerInterval: ReturnType<typeof setInterval> | null = null;

  private listeners = new Map<QuizEventType, Listener[]>();

  get currentQuestion(): QuizQuestion | null {
    return this.current;
  }

  get isRunning(): boolean {
    return this.running;
  }

  // ── Lifecycle ──────────────────────────────────────────

  start(config: QuizConfig): void {
    const enabledTerritories = territories.filter(t => config.enabledTerritoryIds.has(t.id));
    const all: Country[] = [...countries, ...enabledTerritories];
    this.pool = config.countryIds
      ? all.filter(c => config.countryIds!.has(c.id))
      : config.continent === 'World'
        ? all
        : all.filter(c => c.continent === config.continent);

    this.styles = config.styleIds.map(getStyle).filter(Boolean);
    if (this.styles.length === 0) this.styles = [getStyle('flag-name')];

    this.format = config.format;
    this.shapeAvailable = config.shapeAvailable;
    // 'all' = one question per pool country; adaptive is also capped at pool size.
    const requested = config.length === 'all' ? this.pool.length : config.length;
    this.targetCount = Math.max(1, this.format === 'adaptive'
      ? Math.min(requested, this.pool.length)
      : requested);

    this.queue = [];
    this.current = null;
    this.answeredCount = 0;
    this.correctCount = 0;
    this.hintsUsed = 0;
    this.correctIds.clear();
    this.missedIds.clear();
    this.masteredIds.clear();

    // Build the initial question order (cycling the pool if length > pool size).
    const order: Country[] = [];
    const wanted = this.format === 'fixed' ? this.targetCount : this.pool.length;
    let src = shuffle(this.pool);
    while (order.length < wanted) {
      if (src.length === 0) src = shuffle(this.pool);
      order.push(src.pop()!);
    }
    this.queue = order.map(c => this.makeQuestion(c));

    this.running = true;
    this.startTime = Date.now();
    this.timeLimitMs = config.timeLimit ? config.timeLimit * 60 * 1000 : 0;
    this.timerInterval = setInterval(() => this.tick(), 1000);

    this.nextQuestion();
  }

  private tick(): void {
    if (!this.running) return;
    const elapsed = Date.now() - this.startTime;
    if (this.timeLimitMs > 0) {
      const remaining = Math.max(0, this.timeLimitMs - elapsed);
      this.emit('tick', { timeRemaining: remaining });
      if (remaining <= 0) this.endQuiz();
    } else {
      this.emit('tick', { timeRemaining: elapsed });
    }
  }

  private makeQuestion(target: Country, excludeStyleId?: QuizStyleId): QuizQuestion {
    let styles = this.styles;
    // Outline styles need drawable geometry.
    if (this.shapeAvailable && !this.shapeAvailable(target.id)) {
      const filtered = styles.filter(s => s.prompt !== 'outline');
      if (filtered.length > 0) styles = filtered;
    }
    if (excludeStyleId && styles.length > 1) {
      const filtered = styles.filter(s => s.id !== excludeStyleId);
      if (filtered.length > 0) styles = filtered;
    }
    const style = styles[Math.floor(Math.random() * styles.length)];
    const q: QuizQuestion = { style, target };
    if (style.answer === 'pick-name' || style.answer === 'pick-flag') {
      q.options = buildOptions(target, this.pool, Math.min(4, this.pool.length));
    }
    return q;
  }

  private nextQuestion(): void {
    if (!this.running) return;

    const done = this.format === 'fixed'
      ? this.answeredCount >= this.targetCount
      : this.masteredIds.size >= this.targetCount;
    if (done || this.queue.length === 0) {
      this.endQuiz();
      return;
    }

    this.current = this.queue.shift()!;
    this.answeredCurrent = false;
    this.currentHinted = false;
    this.hintCount = 0;
    this.emit('question', {
      question: this.current,
      index: (this.format === 'fixed' ? this.answeredCount : this.masteredIds.size) + 1,
      total: this.targetCount,
    });
  }

  // ── Answering ──────────────────────────────────────────

  /** Check a typed answer against the current target. Records the result. */
  checkTypedAnswer(input: string): boolean {
    if (!this.current) return false;
    const correct = checkGuess(input, this.current.target).status === 'correct';
    this.recordAnswer(correct);
    return correct;
  }

  /** Check a chosen country id (multiple-choice or globe click). Records the result. */
  chooseAnswer(countryId: string): boolean {
    if (!this.current) return false;
    const correct = countryId === this.current.target.id;
    this.recordAnswer(correct);
    return correct;
  }

  private recordAnswer(correct: boolean): void {
    if (!this.current || this.answeredCurrent) return;
    this.answeredCurrent = true;
    this.answeredCount++;
    const target = this.current.target;

    if (correct) {
      this.correctCount++;
      this.correctIds.add(target.id);
      if (this.format === 'adaptive') {
        // A hinted correct answer doesn't count as mastery — it comes back around.
        if (this.currentHinted) this.queue.push(this.makeQuestion(target, this.current.style.id));
        else this.masteredIds.add(target.id);
      }
    } else {
      this.missedIds.add(target.id);
      // Re-ask this country later in a different style until mastered (adaptive).
      if (this.format === 'adaptive') {
        this.queue.push(this.makeQuestion(target, this.current.style.id));
      }
    }

    this.emit('answered', { correct, question: this.current, correctCountry: target });
  }

  /** Skip the current question — it comes back around later (both formats). */
  skip(): void {
    if (!this.current || this.answeredCurrent) return;
    this.queue.push(this.makeQuestion(this.current.target));
    this.nextQuestion();
  }

  /** Reveal one more leading character of the answer (typing questions only).
   *  On adaptive, using a hint means the question returns until mastered unaided. */
  useHint(): string | null {
    if (!this.current || this.answeredCurrent) return null;
    if (this.current.style.answer !== 'type') return null;
    const name = this.current.target.name;
    this.hintCount = Math.min(this.hintCount + 1, name.length);
    this.currentHinted = true;
    this.hintsUsed++;
    return name.substring(0, this.hintCount);
  }

  /** Advance to the next question (call after showing feedback). */
  advance(): void {
    this.nextQuestion();
  }

  endQuiz(): void {
    if (!this.running) return;
    this.running = false;
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }

    const guessed = this.pool.filter(c => this.correctIds.has(c.id));
    const missed = this.pool.filter(c => this.missedIds.has(c.id) && !this.correctIds.has(c.id));
    const elapsed = Math.floor((Date.now() - this.startTime) / 1000);

    const result: GameResult = {
      correct: this.format === 'adaptive' ? this.masteredIds.size : this.correctCount,
      total: this.targetCount,
      timeTaken: elapsed,
      hintsUsed: this.hintsUsed,
      guessedCountries: guessed,
      hintedCountries: [],
      missedCountries: missed,
    };

    this.emit('end', { result });
  }

  // ── Events ─────────────────────────────────────────────

  on(type: QuizEventType, listener: Listener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type)!.push(listener);
  }

  private emit(type: QuizEventType, data: Partial<QuizEvent>): void {
    const event: QuizEvent = { type, ...data };
    const list = this.listeners.get(type);
    if (list) for (const l of list) l(event);
  }
}
