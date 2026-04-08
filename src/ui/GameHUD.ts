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
  private choicesRow: HTMLElement;
  private toastContainer: HTMLElement;
  private scoreEl: HTMLElement;
  private timerEl: HTMLElement;
  private modeLabelEl: HTMLElement;

  private onGuess: (input: string) => void;
  private onHint: () => void;
  private onSkip: () => void;
  private onEnd: () => void;
  private onChoice: (index: number) => void;

  private config: GameConfig;
  private currentHintText: string | null = null;

  constructor(
    parent: HTMLElement,
    config: GameConfig,
    callbacks: {
      onGuess: (input: string) => void;
      onHint: () => void;
      onSkip: () => void;
      onEnd: () => void;
      onChoice: (index: number) => void;
    }
  ) {
    this.config = config;
    this.onGuess = callbacks.onGuess;
    this.onHint = callbacks.onHint;
    this.onSkip = callbacks.onSkip;
    this.onEnd = callbacks.onEnd;
    this.onChoice = callbacks.onChoice;

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

    // Prompt area
    this.promptArea = document.createElement('div');
    this.promptArea.className = 'prompt-area';
    this.bottomBar.appendChild(this.promptArea);

    // Near-miss bar
    this.nearMissBar = document.createElement('div');
    this.nearMissBar.className = 'near-miss-bar';
    this.bottomBar.appendChild(this.nearMissBar);

    // Choices row (for multiple choice variants)
    this.choicesRow = document.createElement('div');
    this.choicesRow.className = 'choices-row';
    this.choicesRow.style.display = 'none';
    this.bottomBar.appendChild(this.choicesRow);

    // Input row (for free-type variants)
    this.inputRow = document.createElement('div');
    this.inputRow.className = 'input-row';
    this.bottomBar.appendChild(this.inputRow);

    this.input = document.createElement('input');
    this.input.type = 'text';
    this.input.className = 'guess-input';
    this.input.placeholder = this.getPlaceholder();
    this.input.autocomplete = 'off';
    this.input.autocapitalize = 'off';
    this.input.spellcheck = false;
    this.inputRow.appendChild(this.input);

    // Hint button — minimal text, orange themed
    const hintBtn = document.createElement('button');
    hintBtn.className = 'hint-btn';
    hintBtn.textContent = 'Hint';
    hintBtn.title = 'Reveal a letter';
    hintBtn.addEventListener('click', (e) => {
      e.preventDefault();
      this.onHint();
      this.input.focus();
    });
    this.inputRow.appendChild(hintBtn);

    // Skip button (not for Mode 2) — minimal text
    if (config.mode !== 2) {
      const skipBtn = document.createElement('button');
      skipBtn.className = 'skip-btn';
      skipBtn.textContent = 'Skip';
      skipBtn.title = 'Skip this country';
      skipBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.onSkip();
        this.input.focus();
      });
      this.inputRow.appendChild(skipBtn);
    }

    // Input events
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const val = this.input.value.trim();
        if (val) {
          this.onGuess(val);
        }
      } else if (e.key === 'Tab') {
        e.preventDefault();
        this.onHint();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (config.mode !== 2) this.onSkip();
      }
    });

    // Keep input focused
    document.addEventListener('keydown', () => {
      if (document.activeElement !== this.input && this.inputRow.style.display !== 'none') {
        this.input.focus();
      }
    });

    // Auto focus
    requestAnimationFrame(() => this.input.focus());
  }

  private getPlaceholder(): string {
    switch (this.config.mode) {
      case 1:
        return 'Click a country, then type its name...';
      case 2:
        return 'Type any country name...';
      case 3:
        return 'Name this country...';
      case 5:
        return 'Type the capital city...';
      default:
        return 'Type your answer...';
    }
  }

  updateScore(correct: number, total: number): void {
    this.scoreEl.textContent = `${correct} / ${total}`;
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
    this.inputRow.style.display = 'flex';
    this.hideNearMiss();
    this.currentHintText = null;

    // Flag display
    if (prompt.type === 'flag' && prompt.country) {
      const img = document.createElement('img');
      img.className = 'prompt-flag';
      img.src = `/flags/${prompt.country.alpha2}.svg`;
      img.alt = 'Flag';
      this.promptArea.appendChild(img);
    }

    // Text display (no background box, just text)
    if (prompt.text) {
      const textEl = document.createElement('div');
      textEl.className = 'prompt-text';
      textEl.textContent = prompt.text;
      this.promptArea.appendChild(textEl);
    }

    // Multiple choice (choice variant)
    if (prompt.choices && this.config.variant === 'choice') {
      this.inputRow.style.display = 'none';
      this.choicesRow.style.display = 'flex';
      this.choicesRow.innerHTML = '';
      prompt.choices.forEach((choice, idx) => {
        const btn = document.createElement('button');
        btn.className = 'choice-btn';
        btn.textContent = choice;
        btn.addEventListener('click', () => this.onChoice(idx));
        this.choicesRow.appendChild(btn);
      });
    }

    // Reverse variant: flag or map choices
    if (prompt.choiceItems && this.config.variant === 'reverse') {
      this.inputRow.style.display = 'none';
      this.choicesRow.style.display = 'flex';
      this.choicesRow.innerHTML = '';

      if (this.config.mode === 3) {
        // Show flags as choices
        prompt.choiceItems.forEach((country, idx) => {
          const img = document.createElement('img');
          img.className = 'flag-choice';
          img.src = `/flags/${country.alpha2}.svg`;
          img.alt = 'Flag option';
          img.addEventListener('click', () => this.onChoice(idx));
          this.choicesRow.appendChild(img);
        });
      } else {
        // Show country names or capitals as text buttons
        prompt.choiceItems.forEach((country, idx) => {
          const btn = document.createElement('button');
          btn.className = 'choice-btn';
          btn.textContent = country.name;
          btn.addEventListener('click', () => this.onChoice(idx));
          this.choicesRow.appendChild(btn);
        });
      }
    }

    // Clear input and hint state for next question
    this.input.value = '';
    this.input.placeholder = this.getPlaceholder();
    this.input.classList.remove('hinted', 'near-miss');
    requestAnimationFrame(() => this.input.focus());
  }

  /**
   * Wordle-style hint: show revealed letters directly in the input as placeholder-like text.
   * User can still type — their typing replaces the hint.
   */
  showHint(hintText: string): void {
    this.currentHintText = hintText;
    // Put hint text in the input as value if user hasn't typed yet
    if (!this.input.value || this.input.classList.contains('hinted')) {
      this.input.value = hintText;
      this.input.classList.add('hinted');
    }
  }

  showNearMiss(suggestion: string): void {
    this.nearMissBar.innerHTML = `
      Close! Did you mean <span class="suggestion">${suggestion}</span>?
      <span class="hint-link">Use hint</span>
    `;
    this.nearMissBar.classList.add('visible');
    this.input.classList.add('near-miss');
    this.nearMissBar.querySelector('.hint-link')?.addEventListener('click', () => {
      this.onHint();
      this.input.focus();
    });
  }

  hideNearMiss(): void {
    this.nearMissBar.classList.remove('visible');
    this.input.classList.remove('near-miss');
  }

  shakeInput(): void {
    this.input.classList.remove('shake');
    void this.input.offsetWidth; // force reflow
    this.input.classList.add('shake');
  }

  clearInput(): void {
    this.input.value = '';
    this.input.classList.remove('near-miss', 'hinted');
    this.nearMissBar.classList.remove('visible');
    this.currentHintText = null;
    requestAnimationFrame(() => this.input.focus());
  }

  showCorrectToast(country: Country): void {
    const toast = document.createElement('div');
    toast.className = 'toast correct';
    toast.innerHTML = `
      <img class="toast-flag" src="/flags/${country.alpha2}.svg" alt="${country.name}">
      <span class="toast-name">${country.name}</span>
    `;
    this.toastContainer.appendChild(toast);
    setTimeout(() => toast.remove(), 2000);
  }

  showChoiceResult(correctIndex: number, chosenIndex: number): void {
    const buttons = this.choicesRow.querySelectorAll('.choice-btn, .flag-choice');
    buttons.forEach((btn, idx) => {
      if (idx === correctIndex) btn.classList.add('correct');
      else if (idx === chosenIndex) btn.classList.add('wrong');
    });
  }

  focusInput(): void {
    this.input.focus();
  }

  dispose(): void {
    this.container.remove();
    this.toastContainer.remove();
  }
}
