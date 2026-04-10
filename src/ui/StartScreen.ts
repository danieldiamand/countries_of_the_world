import { continents } from '../data/countries';
import type { GameConfig, GameMode, QuizVariant, TimeLimit, QuestionCount } from '../engine/types';
import { territories } from '../data/territories';
import { loadSettings, saveSettings, type AppSettings } from '../data/settings';

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

export class StartScreen {
  private container: HTMLElement;
  private onStart: (config: GameConfig) => void;
  private onModeChange: ((mode: GameMode) => void) | null = null;
  private onContinentChange: ((continent: string) => void) | null = null;
  private selectedMode: GameMode;
  private selectedContinent: string;
  private selectedTime: TimeLimit;
  private selectedVariant: QuizVariant;
  private selectedCount: QuestionCount;
  private enabledTerritoryIds: Set<string>;

  // DOM refs for stable updates
  private optionsArea: HTMLElement | null = null;
  private settingsPanel: HTMLElement | null = null;

  constructor(
    parent: HTMLElement,
    onStart: (config: GameConfig) => void,
    onModeChange?: (mode: GameMode) => void,
    onContinentChange?: (continent: string) => void
  ) {
    // Load persisted settings
    const saved = loadSettings();
    this.selectedMode = saved.mode;
    this.selectedContinent = saved.continent;
    this.selectedTime = saved.timeLimit;
    this.selectedVariant = saved.variant;
    this.selectedCount = saved.questionCount;
    this.enabledTerritoryIds = new Set(saved.enabledTerritoryIds);

    this.container = document.createElement('div');
    this.container.className = 'screen start-screen';
    parent.appendChild(this.container);
    this.onStart = onStart;
    this.onModeChange = onModeChange || null;
    this.onContinentChange = onContinentChange || null;
    this.render();
    // Fire initial continent so map can highlight
    this.onContinentChange?.(this.selectedContinent);
  }

  getEnabledTerritoryIds(): Set<string> {
    return new Set(this.enabledTerritoryIds);
  }

  show(): void { this.container.classList.remove('hidden'); }
  hide(): void { this.container.classList.add('hidden'); }

  private render(): void {
    this.container.innerHTML = '';

    // Gear icon (top-right)
    const gearBtn = document.createElement('button');
    gearBtn.className = 'settings-gear';
    gearBtn.title = 'Territory settings';
    gearBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
    gearBtn.addEventListener('click', () => this.toggleSettingsPanel());
    this.container.appendChild(gearBtn);

    // Settings panel (hidden by default)
    this.settingsPanel = document.createElement('div');
    this.settingsPanel.className = 'settings-panel hidden';
    this.container.appendChild(this.settingsPanel);
    this.renderSettingsPanel();

    const inner = document.createElement('div');
    inner.className = 'start-inner';
    this.container.appendChild(inner);

    const h1 = document.createElement('h1');
    h1.textContent = "Diamand's Countries of the World";
    inner.appendChild(h1);

    const sub = document.createElement('p');
    sub.className = 'subtitle';
    sub.textContent = 'Start learning!';
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
        this.onModeChange?.(mode.id);
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
      // Modes 1 & 2 use time, not question count
      const isTimeBased = this.selectedMode === 1 || this.selectedMode === 2;
      // Persist settings
      this.persistSettings();
      this.onStart({
        mode: this.selectedMode,
        continent: this.selectedContinent,
        timeLimit: isTimeBased ? this.selectedTime : null,
        variant: this.selectedVariant,
        questionCount: isTimeBased ? null : this.selectedCount,
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
      this.onContinentChange?.(v);
    }));

    // Show count selector for Flag Quiz / Capital Quiz
    if (this.selectedMode === 3 || this.selectedMode === 5) {
      const countOptions = [
        { value: 'null', label: 'All countries' },
        { value: '10', label: '10 questions' },
        { value: '20', label: '20 questions' },
        { value: '50', label: '50 questions' },
        { value: '100', label: '100 questions' },
      ];
      row.appendChild(this.makeSelect('Questions', countOptions,
        this.selectedCount === null ? 'null' : String(this.selectedCount),
        (v) => { this.selectedCount = v === 'null' ? null : parseInt(v) as QuestionCount; }
      ));

      // Variant (only for flag/capital)
      const variantOptions: { value: string; label: string }[] = [
        { value: 'free', label: 'Type answer' },
        { value: 'multiple-choice', label: 'Multiple choice' },
      ];
      // Only show match-flag for Flag Quiz (not Capital Quiz)
      if (this.selectedMode === 3) {
        variantOptions.push({ value: 'match-flag', label: 'Match the flag' });
      }
      row.appendChild(this.makeSelect('Style', variantOptions, this.selectedVariant,
        (v) => { this.selectedVariant = v as QuizVariant; this.renderOptions(); }
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

  private toggleSettingsPanel(): void {
    this.settingsPanel?.classList.toggle('hidden');
  }

  private renderSettingsPanel(): void {
    if (!this.settingsPanel) return;
    this.settingsPanel.innerHTML = '';

    const heading = document.createElement('h3');
    heading.textContent = 'Territories';
    this.settingsPanel.appendChild(heading);

    const desc = document.createElement('p');
    desc.className = 'settings-desc';
    desc.textContent = 'Include these as separate entries in the game';
    this.settingsPanel.appendChild(desc);

    for (const t of territories) {
      const row = document.createElement('label');
      row.className = 'territory-toggle';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = this.enabledTerritoryIds.has(t.id);
      cb.addEventListener('change', () => {
        if (cb.checked) this.enabledTerritoryIds.add(t.id);
        else this.enabledTerritoryIds.delete(t.id);
        this.persistSettings();
      });
      row.appendChild(cb);

      const flag = document.createElement('img');
      flag.src = `/flags/${t.alpha2}.svg`;
      flag.alt = t.name;
      flag.className = 'territory-flag';
      row.appendChild(flag);

      const name = document.createElement('span');
      name.textContent = t.name;
      row.appendChild(name);

      this.settingsPanel.appendChild(row);
    }
  }

  private persistSettings(): void {
    const settings: AppSettings = {
      mode: this.selectedMode,
      continent: this.selectedContinent,
      timeLimit: this.selectedTime,
      variant: this.selectedVariant,
      questionCount: this.selectedCount,
      enabledTerritoryIds: [...this.enabledTerritoryIds],
    };
    saveSettings(settings);
  }

  dispose(): void {
    this.container.remove();
  }
}
