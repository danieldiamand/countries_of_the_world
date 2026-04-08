import { continents } from '../data/countries';
import type { GameConfig, GameMode, QuizVariant, TimeLimit } from '../engine/types';

interface ModeOption {
  id: GameMode;
  name: string;
  desc: string;
}

const MODES: ModeOption[] = [
  { id: 1, name: 'Click & Type', desc: 'Click a country on the map, type its name' },
  { id: 2, name: 'Free Type', desc: 'Type any country name — no clicking needed' },
  { id: 3, name: 'Flag Quiz', desc: 'See a flag, name the country' },
  { id: 5, name: 'Capital Quiz', desc: 'See a country name, type its capital' },
];

const VARIANT_DESCRIPTIONS: Record<QuizVariant, string> = {
  free: 'Type the answer yourself',
  choice: 'Pick the correct answer from three options',
  reverse: 'Given the answer, match it to the right prompt',
};

export class StartScreen {
  private container: HTMLElement;
  private onStart: (config: GameConfig) => void;
  private selectedMode: GameMode = 1;
  private selectedContinent: string = 'World';
  private selectedTime: TimeLimit = null;
  private selectedVariant: QuizVariant = 'free';

  // DOM refs for stable updates
  private modeDescEl: HTMLElement | null = null;
  private variantRow: HTMLElement | null = null;
  private variantDescEl: HTMLElement | null = null;

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

  show(): void {
    this.container.classList.remove('hidden');
  }

  hide(): void {
    this.container.classList.add('hidden');
  }

  private render(): void {
    this.container.innerHTML = '';

    const h1 = document.createElement('h1');
    h1.textContent = 'Countries of the World';
    this.container.appendChild(h1);

    const sub = document.createElement('p');
    sub.className = 'subtitle';
    sub.textContent = 'Test your geography knowledge';
    this.container.appendChild(sub);

    // Row 1: Game type + Region
    const row1 = document.createElement('div');
    row1.className = 'config-row';
    this.container.appendChild(row1);

    // Game type dropdown
    const modeGroup = this.createSelect(
      'Game type',
      MODES.map((m) => ({ value: String(m.id), label: m.name })),
      String(this.selectedMode),
      (val) => {
        this.selectedMode = parseInt(val) as GameMode;
        this.updateModeDesc();
        this.updateVariantVisibility();
      },
      MODES.find((m) => m.id === this.selectedMode)?.desc
    );
    row1.appendChild(modeGroup.group);
    this.modeDescEl = modeGroup.descEl;

    // Region dropdown
    const regionOptions = [
      { value: 'World', label: 'World' },
      ...continents.map((c) => ({ value: c, label: c })),
    ];
    const regionGroup = this.createSelect(
      'Region',
      regionOptions,
      this.selectedContinent,
      (val) => { this.selectedContinent = val; }
    );
    row1.appendChild(regionGroup.group);

    // Row 2: Time + Quiz style (variant)
    const row2 = document.createElement('div');
    row2.className = 'config-row';
    this.container.appendChild(row2);

    // Time dropdown
    const timeOptions = [
      { value: 'null', label: 'Unlimited' },
      { value: '15', label: '15 minutes' },
      { value: '30', label: '30 minutes' },
    ];
    const timeGroup = this.createSelect(
      'Time limit',
      timeOptions,
      this.selectedTime === null ? 'null' : String(this.selectedTime),
      (val) => {
        this.selectedTime = val === 'null' ? null : (parseInt(val) as TimeLimit);
      }
    );
    row2.appendChild(timeGroup.group);

    // Variant dropdown (only for modes ≥ 3)
    const variantOptions = [
      { value: 'free', label: 'Type answer' },
      { value: 'choice', label: 'Pick from 3' },
      { value: 'reverse', label: 'Reverse match' },
    ];
    const variantGroup = this.createSelect(
      'Quiz style',
      variantOptions,
      this.selectedVariant,
      (val) => {
        this.selectedVariant = val as QuizVariant;
        this.updateVariantDesc();
      },
      VARIANT_DESCRIPTIONS[this.selectedVariant]
    );
    this.variantRow = variantGroup.group;
    this.variantDescEl = variantGroup.descEl;
    row2.appendChild(variantGroup.group);
    this.updateVariantVisibility();

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
      });
    });
    this.container.appendChild(startBtn);
  }

  private createSelect(
    label: string,
    options: { value: string; label: string }[],
    currentValue: string,
    onChange: (value: string) => void,
    description?: string
  ): { group: HTMLElement; descEl: HTMLElement } {
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

    const descEl = document.createElement('div');
    descEl.className = 'mode-description';
    descEl.textContent = description || '';
    group.appendChild(descEl);

    return { group, descEl };
  }

  private updateModeDesc(): void {
    if (this.modeDescEl) {
      const mode = MODES.find((m) => m.id === this.selectedMode);
      this.modeDescEl.textContent = mode?.desc || '';
    }
  }

  private updateVariantVisibility(): void {
    if (this.variantRow) {
      this.variantRow.style.display = this.selectedMode >= 3 ? 'flex' : 'none';
    }
  }

  private updateVariantDesc(): void {
    if (this.variantDescEl) {
      this.variantDescEl.textContent = VARIANT_DESCRIPTIONS[this.selectedVariant] || '';
      this.variantDescEl.className = 'variant-description';
    }
  }

  dispose(): void {
    this.container.remove();
  }
}
