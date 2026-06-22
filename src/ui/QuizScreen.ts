import type { Feature, Geometry } from 'geojson';
import type { Country } from '../data/countries';
import { CountryShape } from '../globe/CountryShape';
import type { QuizQuestion } from '../engine/quizStyles';

export interface QuizScreenCallbacks {
  onSubmitText: (input: string) => void;
  onChoose: (countryId: string) => void;
  onSkip: () => void;
  /** Reveal one more leading character; returns the revealed prefix. */
  onHint: () => string | null;
  onNext: () => void;
  onEnd: () => void;
  getFeature: (id: string) => Feature<Geometry> | undefined;
}

export class QuizScreen {
  private el: HTMLElement;
  private callbacks: QuizScreenCallbacks;
  private modeLabel: string;

  private progressEl!: HTMLElement;
  private scoreEl!: HTMLElement;
  private streakEl!: HTMLElement;
  private timerEl!: HTMLElement;
  private promptEl!: HTMLElement;
  private answerEl!: HTMLElement;
  private feedbackEl!: HTMLElement;

  private current: QuizQuestion | null = null;
  private answered = false;
  private inputEl: HTMLInputElement | null = null;
  private optionButtons = new Map<string, HTMLButtonElement>();
  private lastChosenId: string | null = null;
  private controlsEl: HTMLElement | null = null;
  private hintLineEl: HTMLElement | null = null;
  private shape = new CountryShape();
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  private score = 0;
  private streak = 0;

  constructor(container: HTMLElement, callbacks: QuizScreenCallbacks, modeLabel = 'Quiz') {
    this.callbacks = callbacks;
    this.modeLabel = modeLabel;
    this.el = document.createElement('div');
    this.el.className = 'quiz-screen';
    container.appendChild(this.el);
    this.build();
  }

  get element(): HTMLElement {
    return this.el;
  }

  private build(): void {
    const top = document.createElement('div');
    top.className = 'quiz-top';

    const label = document.createElement('span');
    label.textContent = this.modeLabel;

    this.progressEl = document.createElement('span');
    this.progressEl.className = 'quiz-progress';

    this.scoreEl = document.createElement('span');
    this.scoreEl.className = 'quiz-score';
    this.scoreEl.textContent = '0';

    this.streakEl = document.createElement('span');
    this.streakEl.className = 'quiz-streak';

    this.timerEl = document.createElement('span');
    this.timerEl.className = 'quiz-timer';
    this.timerEl.textContent = '0:00';

    const endBtn = document.createElement('button');
    endBtn.className = 'hud-end-btn';
    endBtn.textContent = 'End';
    endBtn.type = 'button';
    endBtn.addEventListener('click', () => this.callbacks.onEnd());

    top.append(label, this.progressEl, this.scoreEl, this.streakEl, this.timerEl, endBtn);
    this.el.appendChild(top);

    const stage = document.createElement('div');
    stage.className = 'quiz-stage';
    this.promptEl = document.createElement('div');
    this.promptEl.className = 'quiz-prompt';
    this.answerEl = document.createElement('div');
    this.answerEl.className = 'quiz-answer';
    this.feedbackEl = document.createElement('div');
    this.feedbackEl.className = 'quiz-feedback';
    stage.append(this.promptEl, this.answerEl, this.feedbackEl);
    this.el.appendChild(stage);

    // Enter advances during feedback (unless a button is focused — it handles it).
    this.keyHandler = (e: KeyboardEvent) => {
      if (this.answered && e.key === 'Enter') {
        const active = document.activeElement as HTMLElement | null;
        if (active && (active.tagName === 'BUTTON' ||
            (active.tagName === 'INPUT' && active !== this.inputEl))) return;
        e.preventDefault();
        this.callbacks.onNext();
      }
    };
    window.addEventListener('keydown', this.keyHandler);
  }

  // ── Question presentation ──────────────────────────────

  showQuestion(q: QuizQuestion, index: number, total: number): void {
    this.current = q;
    this.answered = false;
    this.inputEl = null;
    this.lastChosenId = null;
    this.controlsEl = null;
    this.hintLineEl = null;
    this.optionButtons.clear();
    this.promptEl.innerHTML = '';
    this.answerEl.innerHTML = '';
    this.feedbackEl.innerHTML = '';
    this.feedbackEl.className = 'quiz-feedback';

    // Globe layout: you look at / click the globe (locate answers, or a country
    // highlighted on the globe). Otherwise an artifact (flag/outline/name) is the
    // focus and the globe is hidden behind a solid background.
    const globeLayout = q.style.answer === 'locate' || q.style.prompt === 'globe-highlight';
    this.el.classList.toggle('layout-globe', globeLayout);
    this.el.classList.toggle('layout-artifact', !globeLayout);

    this.progressEl.textContent = `${index} / ${total}`;
    this.renderPrompt(q, globeLayout);
    this.renderAnswer(q);
  }

  private renderPrompt(q: QuizQuestion, globeLayout: boolean): void {
    if (globeLayout) {
      // Compact chip so the globe stays visible / clickable.
      const chip = document.createElement('div');
      chip.className = 'quiz-chip';
      if (q.style.prompt === 'flag') {
        const img = document.createElement('img');
        img.src = `./flags/${q.target.alpha2}.svg`;
        img.alt = '';
        const cap = document.createElement('span');
        cap.textContent = 'Find this country';
        chip.append(img, cap);
      } else if (q.style.prompt === 'name') {
        chip.textContent = `Find ${q.target.name}`;
      } else {
        chip.textContent = 'Name the highlighted country';
      }
      this.promptEl.appendChild(chip);
      return;
    }

    switch (q.style.prompt) {
      case 'flag': {
        const img = document.createElement('img');
        img.className = 'quiz-flag';
        img.src = `./flags/${q.target.alpha2}.svg`;
        img.alt = 'Flag';
        this.promptEl.appendChild(img);
        break;
      }
      case 'outline': {
        const feature = this.callbacks.getFeature(q.target.id);
        const wrap = document.createElement('div');
        wrap.className = 'quiz-outline';
        if (feature) {
          this.shape.render(feature, 280);
          wrap.appendChild(this.shape.element);
        }
        this.promptEl.appendChild(wrap);
        break;
      }
      case 'name': {
        const name = document.createElement('div');
        name.className = 'quiz-name-prompt';
        name.textContent = q.target.name;
        this.promptEl.appendChild(name);
        break;
      }
    }
  }

  private renderAnswer(q: QuizQuestion): void {
    switch (q.style.answer) {
      case 'type': {
        const input = document.createElement('input');
        input.className = 'guess-input quiz-input';
        input.type = 'text';
        input.placeholder = 'Type the country name...';
        input.autocomplete = 'off';
        input.autocapitalize = 'off';
        input.spellcheck = false;
        input.setAttribute('data-1p-ignore', '');
        input.setAttribute('data-lpignore', 'true');
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !this.answered) {
            e.preventDefault();
            const val = input.value.trim();
            if (val) this.callbacks.onSubmitText(val);
          }
        });
        this.inputEl = input;
        this.answerEl.appendChild(input);
        setTimeout(() => input.focus(), 0);
        break;
      }
      case 'pick-name':
      case 'pick-flag': {
        const grid = document.createElement('div');
        grid.className = q.style.answer === 'pick-flag' ? 'quiz-options flags' : 'quiz-options names';
        for (const opt of q.options ?? []) {
          const btn = document.createElement('button');
          btn.className = 'quiz-option';
          btn.type = 'button';
          if (q.style.answer === 'pick-flag') {
            const img = document.createElement('img');
            img.src = `./flags/${opt.alpha2}.svg`;
            img.alt = opt.name;
            btn.appendChild(img);
          } else {
            btn.textContent = opt.name;
          }
          btn.addEventListener('click', () => {
            if (this.answered) return;
            this.lastChosenId = opt.id;
            this.callbacks.onChoose(opt.id);
          });
          this.optionButtons.set(opt.id, btn);
          grid.appendChild(btn);
        }
        this.answerEl.appendChild(grid);
        break;
      }
      case 'locate':
        // No answer widget — the player clicks the globe; the chip carries the prompt.
        break;
    }

    this.renderControls(q);
  }

  /** Hint (typing only) + Skip buttons; hidden once the question is answered. */
  private renderControls(q: QuizQuestion): void {
    const isType = q.style.answer === 'type';

    if (isType) {
      this.hintLineEl = document.createElement('div');
      this.hintLineEl.className = 'quiz-hint-line';
      this.answerEl.appendChild(this.hintLineEl);
    }

    const controls = document.createElement('div');
    controls.className = 'quiz-controls';

    if (isType) {
      const hintBtn = document.createElement('button');
      hintBtn.type = 'button';
      hintBtn.className = 'quiz-ctrl-btn';
      hintBtn.textContent = 'Hint';
      hintBtn.addEventListener('click', () => {
        if (this.answered) return;
        const revealed = this.callbacks.onHint();
        if (revealed != null) this.showHint(revealed);
        this.inputEl?.focus();
      });
      controls.appendChild(hintBtn);
    }

    const skipBtn = document.createElement('button');
    skipBtn.type = 'button';
    skipBtn.className = 'quiz-ctrl-btn';
    skipBtn.textContent = 'Skip →';
    skipBtn.addEventListener('click', () => {
      if (this.answered) return;
      this.callbacks.onSkip();
    });
    controls.appendChild(skipBtn);

    this.controlsEl = controls;
    this.answerEl.appendChild(controls);
  }

  /** Show the answer with the first `revealed.length` letters shown, rest masked. */
  private showHint(revealed: string): void {
    if (!this.hintLineEl || !this.current) return;
    const name = this.current.target.name;
    let out = '';
    for (let i = 0; i < name.length; i++) {
      const ch = name[i];
      out += i < revealed.length ? ch : (ch === ' ' ? '  ' : '_');
      out += ' ';
    }
    this.hintLineEl.textContent = out.trim();
  }

  // ── Feedback (compact) ─────────────────────────────────

  showFeedback(correct: boolean, target: Country): void {
    if (this.answered) return;
    this.answered = true;
    if (correct) { this.score++; this.streak++; } else { this.streak = 0; }
    this.scoreEl.textContent = String(this.score);
    this.streakEl.textContent = this.streak >= 2 ? `🔥 ${this.streak}` : '';

    const isMC = this.optionButtons.size > 0;

    // Remove skip/hint controls once answered.
    this.controlsEl?.remove();
    this.controlsEl = null;

    if (this.inputEl) {
      this.inputEl.readOnly = true;
      this.inputEl.classList.add(correct ? 'input-completed' : 'input-wrong');
    }
    if (isMC) {
      if (!correct && this.lastChosenId) {
        this.optionButtons.get(this.lastChosenId)?.classList.add('wrong');
      }
      this.optionButtons.get(target.id)?.classList.add('correct');
      for (const btn of this.optionButtons.values()) btn.disabled = true;
    }

    this.feedbackEl.className = `quiz-feedback visible ${correct ? 'correct' : 'wrong'}`;

    // Show the answer line except when a correct MC pick already makes it obvious.
    if (!(isMC && correct)) {
      const msg = document.createElement('div');
      msg.className = 'quiz-feedback-msg';
      const flag = `<img class="quiz-feedback-flag" src="./flags/${target.alpha2}.svg" alt="">`;
      msg.innerHTML = correct
        ? `<span class="quiz-feedback-label">Correct!</span> ${flag} <span>${target.name}</span>`
        : `<span class="quiz-feedback-label">Answer:</span> ${flag} <span>${target.name}</span>`;
      this.feedbackEl.appendChild(msg);
    }

    const nextBtn = document.createElement('button');
    nextBtn.className = 'quiz-next-btn';
    nextBtn.type = 'button';
    nextBtn.textContent = 'Next →';
    nextBtn.addEventListener('click', () => this.callbacks.onNext());
    this.feedbackEl.appendChild(nextBtn);
    setTimeout(() => nextBtn.focus(), 0);
  }

  updateTimer(ms: number): void {
    const totalSec = Math.floor(Math.abs(ms) / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    this.timerEl.textContent = `${min}:${sec.toString().padStart(2, '0')}`;
  }

  get isAwaitingLocate(): boolean {
    return !!this.current && !this.answered && this.current.style.answer === 'locate';
  }

  destroy(): void {
    if (this.keyHandler) {
      window.removeEventListener('keydown', this.keyHandler);
      this.keyHandler = null;
    }
    this.el.remove();
  }
}
