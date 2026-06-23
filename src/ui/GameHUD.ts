export interface GameHUDCallbacks {
  onGuess: (input: string) => void;
  onHint: () => void;
  onSkip: () => void;
  onEnd: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  /** Toggle pause; receives the requested paused state. */
  onTogglePause: () => void;
}

export interface GameHUDOptions {
  /** Top-bar mode label. Default 'Click & Type'. */
  modeLabel?: string;
  /** Show the hint (lightbulb) button. Default true. */
  showHint?: boolean;
  /** Show the skip button (and enable Tab/Esc to skip). Default true. */
  showSkip?: boolean;
  /** Render the text guess input. Default true. Set false for click-to-answer modes. */
  showInput?: boolean;
  /** Optional extra action button on the right of the input row. */
  extraButton?: { title: string; svgHtml: string; onClick: () => void };
  /** If given, score/timer/End render into this shared top-bar slot instead of a standalone bar. */
  actionsSlot?: HTMLElement;
}

export class GameHUD {
  private el: HTMLElement;
  private callbacks: GameHUDCallbacks;
  private options: GameHUDOptions;

  private scoreEl!: HTMLSpanElement;
  private timerEl!: HTMLSpanElement;
  private inputEl: HTMLInputElement | null = null;
  private hintOverlayEl: HTMLSpanElement | null = null;
  private nearMissBar!: HTMLElement;
  private nearMissSuggestion = '';
  private _hintBase = '';
  private globalKeyHandler: ((e: KeyboardEvent) => void) | null = null;
  /** Wrapper for score/timer/End when rendered into the shared top-bar slot. */
  private actionsEl: HTMLElement | null = null;
  private pauseBtn!: HTMLButtonElement;

  constructor(container: HTMLElement, callbacks: GameHUDCallbacks, options: GameHUDOptions = {}) {
    this.callbacks = callbacks;
    this.options = options;
    this.el = container;
    this.build();
  }

  private build(): void {
    this.scoreEl = document.createElement('span');
    this.scoreEl.className = 'hud-score';
    this.scoreEl.textContent = '0 / 0';

    this.timerEl = document.createElement('span');
    this.timerEl.className = 'hud-timer';
    this.timerEl.textContent = '0:00';

    this.pauseBtn = document.createElement('button');
    this.pauseBtn.className = 'hud-pause-btn';
    this.pauseBtn.textContent = 'Pause';
    this.pauseBtn.type = 'button';
    this.pauseBtn.addEventListener('click', () => this.callbacks.onTogglePause());

    const endBtn = document.createElement('button');
    endBtn.className = 'hud-end-btn';
    endBtn.textContent = 'End';
    endBtn.type = 'button';
    endBtn.addEventListener('click', () => this.callbacks.onEnd());

    // Score / timer / Pause / End live in the shared app top bar (the brand title
    // is the bar's label), falling back to a standalone .hud-top bar if no slot.
    const actions = document.createElement('div');
    actions.className = 'hud-actions';
    actions.appendChild(this.scoreEl);
    actions.appendChild(this.timerEl);
    actions.appendChild(this.pauseBtn);
    actions.appendChild(endBtn);
    if (this.options.actionsSlot) {
      this.options.actionsSlot.appendChild(actions);
    } else {
      const top = document.createElement('div');
      top.className = 'hud-top';
      const label = document.createElement('span');
      label.textContent = this.options.modeLabel ?? 'Click & Type';
      top.appendChild(label);
      top.appendChild(actions);
      this.el.appendChild(top);
    }
    this.actionsEl = actions;

    // Bottom bar
    const bottom = document.createElement('div');
    bottom.className = 'hud-bottom';

    // Near-miss bar
    this.nearMissBar = document.createElement('div');
    this.nearMissBar.className = 'near-miss-bar';
    this.nearMissBar.addEventListener('click', () => {
      if (this.nearMissSuggestion) {
        this.revealNearMiss();
      }
    });
    bottom.appendChild(this.nearMissBar);

    // Input row
    const inputRow = document.createElement('div');
    inputRow.className = 'input-row';

    const showInput = this.options.showInput !== false;
    const showHint = this.options.showHint !== false && showInput;
    const showSkip = this.options.showSkip !== false;

    let hintBtn: HTMLButtonElement | null = null;
    if (showHint) {
      hintBtn = document.createElement('button');
      hintBtn.className = 'hud-btn';
      hintBtn.type = 'button';
      hintBtn.title = 'Hint';
      hintBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color: #B8863A"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/></svg>`;
      hintBtn.addEventListener('click', () => { this.callbacks.onHint(); this.inputEl?.focus(); });
    }

    let guessWrapper: HTMLElement | null = null;
    if (showInput) {
      guessWrapper = document.createElement('div');
      guessWrapper.className = 'guess-wrapper';

      const hintOverlay = document.createElement('span');
      hintOverlay.className = 'hint-overlay';
      this.hintOverlayEl = hintOverlay;

      const input = document.createElement('input');
      this.inputEl = input;
      input.className = 'guess-input';
      input.type = 'text';
      input.placeholder = 'Click a country to begin...';
      input.autocomplete = 'off';
      input.autocapitalize = 'off';
      input.spellcheck = false;
      input.setAttribute('data-1p-ignore', '');
      input.setAttribute('data-lpignore', 'true');

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const val = input.value.trim();
          if (val) this.callbacks.onGuess(val);
        } else if ((e.key === 'Tab' || e.key === 'Escape') && showSkip) {
          e.preventDefault();
          this.callbacks.onSkip();
        }
      });

      // Prevent hint text from being deleted; update overlay with typed portion
      input.addEventListener('input', () => {
        const base = this._hintBase;
        if (base) {
          if (input.value.length < base.length) {
            input.value = base;
            input.setSelectionRange(base.length, base.length);
          }
          const typed = input.value.slice(base.length);
          hintOverlay.innerHTML = `<span class="hint-base">${base}</span>${typed ? `<span class="hint-typed">${typed}</span>` : ''}`;
        }
      });

      guessWrapper.appendChild(hintOverlay);
      guessWrapper.appendChild(input);
    }

    let skipBtn: HTMLButtonElement | null = null;
    if (showSkip) {
      skipBtn = document.createElement('button');
      skipBtn.className = 'hud-btn';
      skipBtn.type = 'button';
      skipBtn.title = 'Skip';
      skipBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color: #6BBCB0"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/></svg>`;
      skipBtn.addEventListener('click', () => { this.callbacks.onSkip(); this.inputEl?.focus(); });
    }

    let extraBtn: HTMLButtonElement | null = null;
    if (this.options.extraButton) {
      const cfg = this.options.extraButton;
      extraBtn = document.createElement('button');
      extraBtn.className = 'hud-btn';
      extraBtn.type = 'button';
      extraBtn.title = cfg.title;
      extraBtn.innerHTML = cfg.svgHtml;
      extraBtn.addEventListener('click', () => { cfg.onClick(); this.inputEl?.focus(); });
    }

    if (hintBtn) inputRow.appendChild(hintBtn);
    if (guessWrapper) inputRow.appendChild(guessWrapper);
    if (skipBtn) inputRow.appendChild(skipBtn);
    if (extraBtn) inputRow.appendChild(extraBtn);
    bottom.appendChild(inputRow);
    this.el.appendChild(bottom);

    // Zoom controls
    const zoomControls = document.createElement('div');
    zoomControls.className = 'zoom-controls';

    const zoomIn = document.createElement('button');
    zoomIn.className = 'zoom-btn';
    zoomIn.textContent = '+';
    zoomIn.type = 'button';
    zoomIn.addEventListener('click', () => this.callbacks.onZoomIn());

    const zoomOut = document.createElement('button');
    zoomOut.className = 'zoom-btn';
    zoomOut.textContent = '−';
    zoomOut.type = 'button';
    zoomOut.addEventListener('click', () => this.callbacks.onZoomOut());

    zoomControls.appendChild(zoomIn);
    zoomControls.appendChild(zoomOut);
    this.el.appendChild(zoomControls);

    // Global keydown: if input isn't focused, forward Enter/typing to it
    this.globalKeyHandler = (e: KeyboardEvent) => {
      const active = document.activeElement;

      // No text input (click-to-answer mode): Tab/Esc still skips globally.
      if (!this.inputEl) {
        if ((e.key === 'Tab' || e.key === 'Escape') && showSkip &&
            (!active || (active as HTMLElement).tagName !== 'INPUT')) {
          e.preventDefault();
          this.callbacks.onSkip();
        }
        return;
      }

      // Ignore if a modal/other input has focus
      if (active && active !== this.inputEl && active !== document.body &&
          (active as HTMLElement).tagName === 'INPUT') return;

      if (active !== this.inputEl) {
        if (e.key === 'Enter') {
          e.preventDefault();
          const val = this.inputEl.value.trim();
          if (val) this.callbacks.onGuess(val);
          this.inputEl.focus();
        } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          // Printable character — redirect to input
          this.inputEl.focus();
        }
      }
    };
    window.addEventListener('keydown', this.globalKeyHandler);
  }

  updateScore(correct: number, total: number): void {
    this.scoreEl.textContent = `${correct} / ${total}`;
  }

  /** Reflect paused state on the pause button and lock the guess input. */
  setPaused(paused: boolean): void {
    this.pauseBtn.textContent = paused ? 'Resume' : 'Pause';
    this.pauseBtn.classList.toggle('active', paused);
    if (this.inputEl) this.inputEl.disabled = paused;
  }

  updateTimer(ms: number, isCountdown: boolean): void {
    const totalSec = Math.floor(Math.abs(ms) / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    this.timerEl.textContent = `${min}:${sec.toString().padStart(2, '0')}`;
  }

  setPlaceholder(text: string): void {
    if (this.inputEl) this.inputEl.placeholder = text;
  }

  clearInput(): void {
    if (!this.inputEl || !this.hintOverlayEl) return;
    this.inputEl.value = '';
    this.inputEl.disabled = false;
    this.inputEl.readOnly = false;
    this.inputEl.classList.remove('input-completed');
    this.inputEl.classList.remove('input-revealed');
    this.inputEl.style.color = '';
    this.inputEl.style.caretColor = '';
    this._hintBase = '';
    this.hintOverlayEl.innerHTML = '';
  }

  showCompleted(countryName: string): void {
    if (!this.inputEl || !this.hintOverlayEl) return;
    this.inputEl.value = countryName;
    this.inputEl.disabled = true;
    this.inputEl.style.color = '';
    this.inputEl.classList.add('input-completed');
    this._hintBase = '';
    this.hintOverlayEl.innerHTML = '';
  }

  setHintText(text: string): void {
    if (!this.inputEl || !this.hintOverlayEl) return;
    this._hintBase = text;
    if (text) {
      this.inputEl.value = text;
      this.inputEl.setSelectionRange(text.length, text.length);
      this.inputEl.style.color = 'transparent';
      this.inputEl.style.caretColor = 'var(--color-text)';
      this.hintOverlayEl.innerHTML = `<span class="hint-base">${text}</span>`;
    } else {
      this.inputEl.style.color = '';
      this.inputEl.style.caretColor = '';
      this.hintOverlayEl.innerHTML = '';
    }
  }

  showNearMiss(suggestion: string): void {
    this.nearMissSuggestion = suggestion;
    this.nearMissBar.innerHTML = `<svg class="near-miss-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/></svg> Almost there, reveal answer?`;
    this.nearMissBar.classList.add('visible');
  }

  private revealNearMiss(): void {
    const name = this.nearMissSuggestion;
    if (!name || !this.inputEl || !this.hintOverlayEl) return;
    this.hideNearMiss();
    this._hintBase = '';
    this.hintOverlayEl.innerHTML = '';
    this.inputEl.style.color = '';
    this.inputEl.style.caretColor = '';
    this.inputEl.value = name;
    this.inputEl.classList.add('input-revealed');
    this.inputEl.readOnly = true;
    this.inputEl.focus();
  }

  hideNearMiss(): void {
    this.nearMissSuggestion = '';
    this.nearMissBar.classList.remove('visible');
  }

  focusInput(): void {
    this.inputEl?.focus();
  }

  destroy(): void {
    if (this.globalKeyHandler) {
      window.removeEventListener('keydown', this.globalKeyHandler);
      this.globalKeyHandler = null;
    }
    // Remove HUD elements (top, bottom, zoom) + the shared-bar actions wrapper
    const toRemove = this.el.querySelectorAll('.hud-top, .hud-bottom, .zoom-controls');
    toRemove.forEach(el => el.remove());
    if (this.actionsEl) { this.actionsEl.remove(); this.actionsEl = null; }
  }
}
