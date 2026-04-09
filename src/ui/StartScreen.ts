import { continents } from '../data/countries';
import type { GameConfig, GameMode, QuizVariant, TimeLimit, QuestionCount } from '../engine/types';

interface ModeOption {
  id: GameMode;
  name: string;
  desc: string;
}

const MODES: ModeOption[] = [
  { id: 1, name: 'Click & Type', desc: 'Click a country on the map, then type its name' },
  { id: 2, name: 'Free Type', desc: 'Type any country name — no clicking needed' },
  { id: 3, name: 'Flag Quiz', desc: 'See a flag and identify the country' },
  { id: 5, name: 'Capital Quiz', desc: 'Name the capital city of each country' },
];

const VARIANT_DESCRIPTIONS: Record<QuizVariant, string> = {
  free: 'Type the answer yourself',
  'multiple-choice': 'Choose the correct answer from three options',
  'match-flag': 'See three flags, pick the right one',
};

export class StartScreen {
  private container: HTMLElement;
  private onStart: (config: GameConfig) => void;
  private selectedMode: GameMode = 1;
  private selectedContinent: string = 'World';
  private selectedTime: TimeLimit = null;
  private selectedVariant: QuizVariant = 'free';
  private selectedCount: QuestionCount = null;

  // DOM refs for stable updates
  private optionsArea: HTMLElement | null = null;

  constructor(
    parent: HTMLElement,
    onStart: (config: GameConfig) => void
  ) {
    this.container = document.createElement('div');
    this.container.className = 'screen start-screen';
    parent.appendChild(this.container);
    this.onStart = onStart;
    this.render();
  }

  show(): void { this.container.classList.remove('hidden'); }
  hide(): void { this.container.classList.add('hidden'); }

  private render(): void {
    this.container.innerHTML = '';

    const inner = document.createElement('div');
    inner.className = 'start-inner';
    this.container.appendChild(inner);

    const h1 = document.createElement('h1');
    h1.textContent = 'Countries of the World';
    inner.appendChild(h1);

    const sub = document.createElement('p');
    sub.className = 'subtitle';
    sub.textContent = 'Test your geography knowledge';
    inner.appendChild(sub);

    // Mode cards grid
    const grid = document.createElement('div');
    grid.className = 'mode-grid';
    inner.appendChild(grid);

    for (const mode of MODES) {
      const card = document.createElement('div');
      card.className = 'mode-card' + (mode.id === this.selectedMode ? ' active' : '');
      card.innerHTML = `
        <span class="mode-name">${mode.name}</span>
        <span class="mode-desc">${mode.desc}</span>
      `;
      card.addEventListener('click', () => {
        this.selectedMode = mode.id;
        this.updateModeCards(grid);
        this.renderOptions();
      });
      grid.appendChild(card);
    }

    // Options area (dropdowns below cards)
    this.optionsArea = document.createElement('div');
    this.optionsArea.className = 'start-options';
    inner.appendChild(this.optionsArea);
    this.renderOptions();

    // Start button
    const startBtn = document.createElement('button');
    startBtn.className = 'start-btn';
    startBtn.textContent = 'Start';
    startBtn.addEventListener('click', () => {
      this.onStart({
        mode: this.selectedMode,
        continent: this.selectedContinent,
        timeLimit: this.selectedTime,
        variant: this.selectedVariant,
        questionCount: this.selectedCount,
      });
    });
    inner.appendChild(startBtn);
  }

  private updateModeCards(grid: HTMLElement): void {
    grid.querySelectorAll('.mode-card').forEach((card, idx) => {
      const mode = MODES[idx];
      card.classList.toggle('active', mode.id === this.selectedMode);
    });
  }

  private renderOptions(): void {
    if (!this.optionsArea) return;
    this.optionsArea.innerHTML = '';

    const row = document.createElement('div');
    row.className = 'config-row';
    this.optionsArea.appendChild(row);

    // Region
    const regionOptions = [
      { value: 'World', label: 'World' },
      ...continents.map((c) => ({ value: c, label: c })),
    ];
    row.appendChild(this.makeSelect('Region', regionOptions, this.selectedContinent, (v) => {
      this.selectedContinent = v;
    }));

    // Show count selector for Flag Quiz / Capital Quiz
    if (this.selectedMode === 3 || this.selectedMode === 5) {
      const countOptions = [
        { value: 'null', label: 'All countries' },
        { value: '10', label: '10 questions' },
        { value: '25', label: '25 questions' },
        { value: '50', label: '50 questions' },
        { value: '100', label: '100 questions' },
      ];
      row.appendChild(this.makeSelect('Questions', countOptions,
        this.selectedCount === null ? 'null' : String(this.selectedCount),
        (v) => { this.selectedCount = v === 'null' ? null : parseInt(v) as QuestionCount; }
      ));

      // Variant (only for flag/capital)
      const variantOptions = [
        { value: 'free', label: 'Type answer' },
        { value: 'multiple-choice', label: 'Multiple choice' },
        { value: 'match-flag', label: 'Match the flag' },
      ];
      row.appendChild(this.makeSelect('Style', variantOptions, this.selectedVariant,
        (v) => { this.selectedVariant = v as QuizVariant; },
        VARIANT_DESCRIPTIONS[this.selectedVariant]
      ));
    } else {
      // Time limit (for click & type / free type)
      const timeOptions = [
        { value: 'null', label: 'Unlimited' },
        { value: '15', label: '15 minutes' },
        { value: '30', label: '30 minutes' },
      ];
      row.appendChild(this.makeSelect('Time limit', timeOptions,
        this.selectedTime === null ? 'null' : String(this.selectedTime),
        (v) => { this.selectedTime = v === 'null' ? null : parseInt(v) as TimeLimit; }
      ));
    }
  }

  private makeSelect(
    label: string,
    options: { value: string; label: string }[],
    currentValue: string,
    onChange: (value: string) => void,
    description?: string
  ): HTMLElement {
    const group = document.createElement('div');
    group.className = 'config-group';

    const labelEl = document.createElement('label');
    labelEl.textContent = label;
    group.appendChild(labelEl);

    const select = document.createElement('select');
    select.className = 'config-select';
    select.title = label;
    for (const opt of options) {
      const option = document.createElement('option');
      option.value = opt.value;
      option.textContent = opt.label;
      if (opt.value === currentValue) option.selected = true;
      select.appendChild(option);
    }
    select.addEventListener('change', () => onChange(select.value));
    group.appendChild(select);

    if (description) {
      const descEl = document.createElement('div');
      descEl.className = 'mode-description';
      descEl.textContent = description;
      group.appendChild(descEl);
    }

    return group;
  }

  dispose(): void {
    this.container.remove();
  }
}
