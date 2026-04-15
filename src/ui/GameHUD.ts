import type { Country } from '../data/countries';
import type { GameConfig, PromptData } from '../engine/types';

export class GameHUD {
  private container: HTMLElement;
  private topBar: HTMLElement;
  private bottomBar: HTMLElement;
  private promptArea: HTMLElement;
  private nearMissBar: HTMLElement;
  private inputRow: HTMLElement;
  private input: HTMLInputElement;
  private inputWrapper: HTMLElement;
  private hintOverlay: HTMLElement;
  private choicesRow: HTMLElement;
  private choiceSkipBtn: HTMLButtonElement;
  private toastContainer: HTMLElement;
  private scoreEl: HTMLElement;
  private timerEl: HTMLElement;
  private modeLabelEl: HTMLElement;
  private isMobile: boolean;
  private viewportCleanup: (() => void) | null = null;


  private onGuess: (input: string) => void;
  private onHint: () => void;
  private onSkip: () => void;
  private onEnd: () => void;
  private onChoice: (index: number) => void;
  private onRevealNearMiss: (() => void) | null = null;
  private onZoom: ((factor: number) => void) | null = null;
  private onFind: (() => void) | null = null;

  private config: GameConfig;

  // Hint state: the locked-in hint prefix (orange, undeletable)
  private hintPrefix: string = '';

  constructor(
    parent: HTMLElement,
    config: GameConfig,
    callbacks: {
      onGuess: (input: string) => void;
      onHint: () => void;
      onSkip: () => void;
      onEnd: () => void;
      onChoice: (index: number) => void;
      onRevealNearMiss?: () => void;
      onZoom?: (factor: number) => void;
      onFind?: () => void;
    }
  ) {
    this.config = config;
    this.onGuess = callbacks.onGuess;
    this.onHint = callbacks.onHint;
    this.onSkip = callbacks.onSkip;
    this.onEnd = callbacks.onEnd;
    this.onChoice = callbacks.onChoice;
    this.onRevealNearMiss = callbacks.onRevealNearMiss || null;
    this.onZoom = callbacks.onZoom || null;
    this.onFind = callbacks.onFind || null;
    this.isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
      (navigator.maxTouchPoints > 0 && window.innerWidth < 1024);

    this.container = document.createElement('div');
    this.container.className = 'game-hud';
    parent.appendChild(this.container);

    // Toast container
    this.toastContainer = document.createElement('div');
    this.toastContainer.className = 'toast-container';
    parent.appendChild(this.toastContainer);

    // Top bar
    this.topBar = document.createElement('div');
    this.topBar.className = 'hud-top';
    this.container.appendChild(this.topBar);

    this.modeLabelEl = document.createElement('span');
    this.modeLabelEl.className = 'hud-mode-label';
    this.topBar.appendChild(this.modeLabelEl);

    this.scoreEl = document.createElement('span');
    this.scoreEl.className = 'hud-score';
    this.topBar.appendChild(this.scoreEl);

    this.timerEl = document.createElement('span');
    this.timerEl.className = 'hud-timer';
    this.topBar.appendChild(this.timerEl);

    const endBtn = document.createElement('button');
    endBtn.className = 'hud-end-btn';
    endBtn.textContent = 'End';
    // Prevent button from stealing focus (keeps mobile keyboard open)
    endBtn.addEventListener('mousedown', (e) => e.preventDefault());
    endBtn.addEventListener('touchstart', (e) => e.preventDefault());
    endBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onEnd();
    });
    this.topBar.appendChild(endBtn);



    // Bottom area
    this.bottomBar = document.createElement('div');
    this.bottomBar.className = 'hud-bottom';
    this.container.appendChild(this.bottomBar);

    // Prompt area (flags go here, centered)
    this.promptArea = document.createElement('div');
    this.promptArea.className = 'prompt-area';
    this.bottomBar.appendChild(this.promptArea);

    // Near-miss bar (clickable)
    this.nearMissBar = document.createElement('div');
    this.nearMissBar.className = 'near-miss-bar';
    this.bottomBar.appendChild(this.nearMissBar);

    // Choices row wrapper (choices + skip button side by side)
    const choicesWrapper = document.createElement('div');
    choicesWrapper.className = 'choices-wrapper';
    choicesWrapper.style.display = 'none';
    this.bottomBar.appendChild(choicesWrapper);

    // Choices row
    this.choicesRow = document.createElement('div');
    this.choicesRow.className = 'choices-row';
    this.choicesRow.style.display = 'none';
    choicesWrapper.appendChild(this.choicesRow);

    // Skip button for choice-based modes (to the right of choices)
    this.choiceSkipBtn = document.createElement('button');
    this.choiceSkipBtn.className = 'skip-btn choice-skip-btn';
    this.choiceSkipBtn.textContent = 'Skip';
    this.choiceSkipBtn.title = 'Skip this question';
    this.choiceSkipBtn.style.display = 'none';
    this.choiceSkipBtn.addEventListener('mousedown', (e) => e.preventDefault());
    this.choiceSkipBtn.addEventListener('touchstart', (e) => e.preventDefault());
    this.choiceSkipBtn.addEventListener('click', (e) => {
      e.preventDefault();
      this.onSkip();
    });
    choicesWrapper.appendChild(this.choiceSkipBtn);

    // Input row
    this.inputRow = document.createElement('div');
    this.inputRow.className = 'input-row';
    this.bottomBar.appendChild(this.inputRow);

    // Input wrapper (for hint overlay)
    const inputWrapper = document.createElement('div');
    inputWrapper.className = 'input-wrapper';
    this.inputRow.appendChild(inputWrapper);
    this.inputWrapper = inputWrapper;

    this.hintOverlay = document.createElement('span');
    this.hintOverlay.className = 'hint-overlay';
    inputWrapper.appendChild(this.hintOverlay);

    this.input = document.createElement('input');
    this.input.type = 'search';
    this.input.className = 'guess-input';
    this.input.placeholder = this.getPlaceholder();
    this.input.autocomplete = 'off';
    this.input.autocapitalize = 'none';
    this.input.spellcheck = false;
    this.input.inputMode = 'text';
    // Suppress mobile keyboard suggestions/autocorrect/password managers
    this.input.setAttribute('autocorrect', 'off');
    this.input.setAttribute('autocomplete', 'one-time-code');
    this.input.setAttribute('data-form-type', 'other');
    this.input.setAttribute('data-lpignore', 'true');
    this.input.setAttribute('data-1p-ignore', 'true');
    this.input.setAttribute('enterkeyhint', 'go');
    this.input.setAttribute('aria-autocomplete', 'none');
    inputWrapper.appendChild(this.input);

    // Prevent keyboard from closing when tapping the map canvas on mobile.
    // We intercept touchstart on the map canvas and re-focus the input.
    this.setupMobileKeyboardPersistence();

    // Hint button (not for Mode 2 — no target country for hints)
    if (config.mode !== 2) {
      const hintBtn = document.createElement('button');
      hintBtn.className = 'hint-btn';
      hintBtn.textContent = 'Hint';
      hintBtn.title = 'Reveal a letter';
      // Prevent keyboard dismiss on mobile
      hintBtn.addEventListener('mousedown', (e) => e.preventDefault());
      hintBtn.addEventListener('touchstart', (e) => e.preventDefault());
      hintBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.onHint();
        // Restore cursor to end of input without re-triggering keyboard open/close
        requestAnimationFrame(() => {
          this.input.focus();
          const len = this.input.value.length;
          this.input.setSelectionRange(len, len);
        });
      });
      this.inputRow.appendChild(hintBtn);
    }

    // Skip button (not for Mode 2)
    if (config.mode !== 2) {
      const skipBtn = document.createElement('button');
      skipBtn.className = 'skip-btn';
      skipBtn.textContent = 'Skip';
      skipBtn.title = 'Skip this country';
      // Prevent keyboard dismiss on mobile
      skipBtn.addEventListener('mousedown', (e) => e.preventDefault());
      skipBtn.addEventListener('touchstart', (e) => e.preventDefault());
      skipBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.onSkip();
        requestAnimationFrame(() => {
          this.input.focus();
          const len = this.input.value.length;
          this.input.setSelectionRange(len, len);
        });
      });
      this.inputRow.appendChild(skipBtn);
    }

    // Find button (mode 2 only — pan to an unguessed country)
    if (config.mode === 2) {
      const findBtn = document.createElement('button');
      findBtn.className = 'skip-btn';
      findBtn.textContent = 'Find';
      findBtn.title = 'Pan to an unguessed country';
      // Prevent keyboard dismiss on mobile
      findBtn.addEventListener('mousedown', (e) => e.preventDefault());
      findBtn.addEventListener('touchstart', (e) => e.preventDefault());
      findBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.onFind?.();
        requestAnimationFrame(() => {
          this.input.focus();
          const len = this.input.value.length;
          this.input.setSelectionRange(len, len);
        });
      });
      this.inputRow.appendChild(findBtn);
    }

    // Zoom controls (bottom-right)
    const zoomControls = document.createElement('div');
    zoomControls.className = 'zoom-controls';
    this.container.appendChild(zoomControls);

    const zoomIn = document.createElement('button');
    zoomIn.className = 'zoom-btn';
    zoomIn.textContent = '+';
    zoomIn.title = 'Zoom in';
    zoomIn.addEventListener('mousedown', (e) => e.preventDefault());
    zoomIn.addEventListener('touchstart', (e) => e.preventDefault());
    zoomIn.addEventListener('click', (e) => { e.preventDefault(); this.onZoom?.(1.5); });
    zoomControls.appendChild(zoomIn);

    const zoomOut = document.createElement('button');
    zoomOut.className = 'zoom-btn';
    zoomOut.textContent = '\u2212';
    zoomOut.title = 'Zoom out';
    zoomOut.addEventListener('mousedown', (e) => e.preventDefault());
    zoomOut.addEventListener('touchstart', (e) => e.preventDefault());
    zoomOut.addEventListener('click', (e) => { e.preventDefault(); this.onZoom?.(1 / 1.5); });
    zoomControls.appendChild(zoomOut);

    // Input events
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const val = this.input.value.trim();
        if (val) this.onGuess(val);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        if (this.config.mode !== 2) this.onHint();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (config.mode !== 2) this.onSkip();
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        // Prevent deleting the hint prefix
        if (this.hintPrefix && this.input.selectionStart !== null) {
          if (e.key === 'Backspace' && this.input.selectionStart <= this.hintPrefix.length) {
            e.preventDefault();
          }
          if (e.key === 'Delete' && this.input.selectionStart !== null && this.input.selectionStart < this.hintPrefix.length) {
            e.preventDefault();
          }
        }
      }
    });

    // Prevent selecting/modifying hint prefix
    this.input.addEventListener('input', () => {
      if (this.hintPrefix && !this.input.value.startsWith(this.hintPrefix)) {
        this.input.value = this.hintPrefix;
        this.input.setSelectionRange(this.hintPrefix.length, this.hintPrefix.length);
      }
      this.updateHintOverlay();
    });

    // Keep input focused
    document.addEventListener('keydown', () => {
      if (document.activeElement !== this.input && this.inputRow.style.display !== 'none') {
        this.input.focus();
      }
    });

    // On mobile, use visualViewport API to keep the HUD within the visible area
    // when the keyboard is open. This ensures the top bar and bottom bar stay visible.
    this.setupVisualViewportTracking();

    requestAnimationFrame(() => this.input.focus());
  }

  private getPlaceholder(): string {
    switch (this.config.mode) {
      case 1: return 'Select a country on the map';
      case 2: return 'Type any country name...';
      case 3: return 'Name this country...';
      case 5: return 'Type the capital city...';
      default: return 'Type your answer...';
    }
  }

  updateScore(correct: number, total: number): void {
    this.scoreEl.textContent = `${correct} / ${total}`;
  }

  updateScoreDetailed(correct: number, incorrect: number, remaining: number): void {
    this.scoreEl.innerHTML =
      `<span style="color:var(--color-correct)">${correct} correct</span>` +
      ` <span style="color:var(--color-missed)">${incorrect} incorrect</span>` +
      ` <span>${remaining} remaining</span>`;
  }

  updateTimer(seconds: number, isCountdown: boolean): void {
    const min = Math.floor(seconds / 60);
    const sec = seconds % 60;
    this.timerEl.textContent = `${min}:${sec.toString().padStart(2, '0')}`;
    if (isCountdown && seconds <= 60) {
      this.timerEl.style.color = 'var(--color-missed)';
    }
  }

  setModeLabel(label: string): void {
    this.modeLabelEl.textContent = label;
  }

  updatePrompt(prompt: PromptData): void {
    this.promptArea.innerHTML = '';
    this.choicesRow.style.display = 'none';
    this.choiceSkipBtn.style.display = 'none';
    // Hide the choices wrapper too
    const choicesWrapper = this.choicesRow.parentElement;
    if (choicesWrapper) choicesWrapper.style.display = 'none';
    this.inputRow.style.display = 'flex';
    this.hideNearMiss();
    // Don't clear hint prefix here — it persists per-country (restored via restoreHint)

    // Flag display
    if (prompt.type === 'flag' && prompt.country) {
      const img = document.createElement('img');
      img.className = 'prompt-flag';
      img.src = `${import.meta.env.BASE_URL}flags/${prompt.country.alpha2}.svg`;
      img.alt = 'Flag';
      this.promptArea.appendChild(img);
    }

    // Text display (skip for modes 1 & 2 where it's redundant with placeholder)
    if (prompt.text && this.config.mode !== 1 && this.config.mode !== 2) {
      const textEl = document.createElement('div');
      textEl.className = 'prompt-text';
      textEl.textContent = prompt.text;
      this.promptArea.appendChild(textEl);
    }

    // Update placeholder for mode 1 once a country is selected
    if (this.config.mode === 1 && prompt.type === 'click') {
      this.input.placeholder = 'Type the country name...';
    }

    // Multiple choice
    if (prompt.choices && this.config.variant === 'multiple-choice') {
      this.inputRow.style.display = 'none';
      this.choicesRow.style.display = 'flex';
      this.choiceSkipBtn.style.display = 'inline-block';
      if (choicesWrapper) choicesWrapper.style.display = 'flex';
      this.choicesRow.innerHTML = '';
      prompt.choices.forEach((choice, idx) => {
        const btn = document.createElement('button');
        btn.className = 'choice-btn';
        btn.textContent = choice;
        btn.addEventListener('click', () => this.onChoice(idx));
        this.choicesRow.appendChild(btn);
      });
    }

    // Match-flag variant
    if (prompt.choiceItems && this.config.variant === 'match-flag') {
      this.inputRow.style.display = 'none';
      this.choicesRow.style.display = 'flex';
      this.choiceSkipBtn.style.display = 'inline-block';
      if (choicesWrapper) choicesWrapper.style.display = 'flex';
      this.choicesRow.innerHTML = '';

      if (this.config.mode === 3) {
        prompt.choiceItems.forEach((country, idx) => {
          const img = document.createElement('img');
          img.className = 'flag-choice';
          img.src = `${import.meta.env.BASE_URL}flags/${country.alpha2}.svg`;
          img.alt = 'Flag option';
          img.addEventListener('click', () => this.onChoice(idx));
          this.choicesRow.appendChild(img);
        });
      } else {
        prompt.choiceItems.forEach((country, idx) => {
          const btn = document.createElement('button');
          btn.className = 'choice-btn';
          btn.textContent = country.name;
          btn.addEventListener('click', () => this.onChoice(idx));
          this.choicesRow.appendChild(btn);
        });
      }
    }

    requestAnimationFrame(() => this.input.focus());
  }

  /**
   * Set hint prefix: the undeletable orange characters at the start of the input.
   * Called when engine emits 'hint'. Only the revealed chars — no underscores.
   */
  showHint(hintText: string): void {
    this.hintPrefix = hintText;
    const currentVal = this.input.value;
    const userText = currentVal.length > this.hintPrefix.length ? currentVal.slice(this.hintPrefix.length) : '';
    this.input.value = hintText + userText;
    this.input.classList.add('hinted');
    this.updateHintOverlay();
    this.input.setSelectionRange(this.input.value.length, this.input.value.length);
  }

  /**
   * Restore hint when switching back to a country that already has hints revealed.
   */
  restoreHint(hintText: string | null): void {
    if (hintText) {
      this.hintPrefix = hintText;
      this.input.value = hintText;
      this.input.classList.add('hinted');
      this.updateHintOverlay();
      this.input.setSelectionRange(hintText.length, hintText.length);
    } else {
      this.hintPrefix = '';
      this.input.value = '';
      this.input.classList.remove('hinted');
      this.hintOverlay.innerHTML = '';
      this.input.placeholder = this.getPlaceholder();
    }
  }

  /**
   * Show near-miss bar. The entire bar is clickable and reveals the full answer.
   * Shows the normalized suggestion (e.g. "Turkey") not the accented form.
   */
  showNearMiss(suggestion: string): void {
    this.nearMissBar.innerHTML = `
      <span>Nearly there! Reveal answer?</span>
      <span class="hint-link">Use hint</span>
    `;
    this.nearMissBar.classList.add('visible');
    // Whole bar is clickable
    this.nearMissBar.style.cursor = 'pointer';
    // Prevent keyboard dismiss on mobile
    this.nearMissBar.addEventListener('mousedown', (e) => e.preventDefault());
    this.nearMissBar.addEventListener('touchstart', (e) => e.preventDefault());
    this.nearMissBar.addEventListener('click', this.handleNearMissClick);
  }

  private handleNearMissClick = (): void => {
    this.onRevealNearMiss?.();
    this.input.focus();
  };

  hideNearMiss(): void {
    this.nearMissBar.classList.remove('visible');
    this.nearMissBar.style.cursor = '';
    this.nearMissBar.removeEventListener('click', this.handleNearMissClick);
  }

  shakeInput(): void {
    this.inputWrapper.classList.remove('shake');
    void this.inputWrapper.offsetWidth;
    this.inputWrapper.classList.add('shake');
  }

  clearInput(): void {
    this.hintPrefix = '';
    this.input.value = '';
    this.input.classList.remove('near-miss', 'hinted');
    this.hintOverlay.textContent = '';
    this.nearMissBar.classList.remove('visible');
    requestAnimationFrame(() => this.input.focus());
  }

  private updateHintOverlay(): void {
    if (!this.hintPrefix) {
      this.hintOverlay.innerHTML = '';
      return;
    }
    const userText = this.input.value.slice(this.hintPrefix.length);
    this.hintOverlay.innerHTML = '';
    const orangeSpan = document.createElement('span');
    orangeSpan.style.color = 'var(--color-hinted)';
    orangeSpan.textContent = this.hintPrefix;
    this.hintOverlay.appendChild(orangeSpan);
    const blackSpan = document.createElement('span');
    blackSpan.style.color = 'var(--color-text)';
    blackSpan.textContent = userText;
    this.hintOverlay.appendChild(blackSpan);
  }

  showCorrectToast(country: Country): void {
    const toast = document.createElement('div');
    toast.className = 'toast correct';
    toast.innerHTML = `
      <img class="toast-flag" src="${import.meta.env.BASE_URL}flags/${country.alpha2}.svg" alt="${country.name}">
      <span class="toast-name">${country.name}</span>
    `;
    this.toastContainer.appendChild(toast);

    // On mobile, position toast near top of visual viewport (visible above keyboard)
    if (this.isMobile && window.visualViewport) {
      const vv = window.visualViewport;
      this.toastContainer.style.top = `${vv.offsetTop + 50}px`;
    }

    setTimeout(() => toast.remove(), 2000);
  }

  showChoiceResult(correctIndex: number, chosenIndex: number): void {
    const buttons = this.choicesRow.querySelectorAll('.choice-btn, .flag-choice');
    buttons.forEach((btn, idx) => {
      (btn as HTMLButtonElement).disabled = true;
      btn.classList.add('disabled');
      if (idx === correctIndex) btn.classList.add('correct');
      else if (idx === chosenIndex) btn.classList.add('wrong');
    });
  }

  /**
   * On mobile, prevent the keyboard from closing when the user taps the map canvas.
   * We call preventDefault() on mousedown/touchstart on the canvas to stop the
   * browser from stealing focus from the input (which would dismiss the keyboard).
   * D3 zoom still works because it listens for the events regardless of default.
   */
  private setupMobileKeyboardPersistence(): void {
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
      (navigator.maxTouchPoints > 0 && window.innerWidth < 1024);
    if (!isMobile) return;

    // Find the map canvas
    const canvas = document.querySelector('.world-map-canvas') as HTMLCanvasElement | null;
    if (!canvas) return;

    // Prevent canvas touches from stealing focus (and thus closing the keyboard).
    // This is the standard technique: preventDefault on mousedown prevents the
    // browser's default "focus the clicked element" behavior.
    const preventBlur = (e: Event) => {
      // Only prevent default if the input is currently active — otherwise
      // allow normal focus behavior during start screen etc.
      if (document.activeElement === this.input && !this.input.disabled) {
        e.preventDefault();
      }
    };
    canvas.addEventListener('mousedown', preventBlur);
    canvas.addEventListener('touchstart', preventBlur);

    // Also catch blur events and immediately refocus as a fallback
    this.input.addEventListener('blur', () => {
      if (!this.input.disabled && this.inputRow.style.display !== 'none') {
        requestAnimationFrame(() => this.input.focus());
      }
    });
  }

  /**
   * Use the Visual Viewport API to keep the game HUD properly sized and
   * positioned when the mobile keyboard is open. The top bar stays pinned
   * to the top of the visible viewport and the bottom bar stays just above
   * the keyboard.
   */
  private setupVisualViewportTracking(): void {
    if (!this.isMobile || !window.visualViewport) return;

    const vv = window.visualViewport;

    const update = () => {
      // Size the HUD container to exactly the visual viewport
      const height = vv.height;
      const top = vv.offsetTop;
      this.container.style.position = 'fixed';
      this.container.style.top = `${top}px`;
      this.container.style.left = '0';
      this.container.style.right = '0';
      this.container.style.bottom = 'auto';
      this.container.style.height = `${height}px`;

      // Also reposition toast container to stay near top of visual viewport
      this.toastContainer.style.position = 'fixed';
      this.toastContainer.style.top = `${top + 50}px`;
    };

    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    update();

    this.viewportCleanup = () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }

  setInputLocked(locked: boolean): void {
    this.input.disabled = locked;
    if (locked) {
      this.input.placeholder = 'Click a country on the map...';
    } else {
      this.input.placeholder = this.getPlaceholder();
      this.input.focus();
    }
  }



  dispose(): void {
    this.viewportCleanup?.();
    this.container.remove();
    this.toastContainer.remove();
  }
}
