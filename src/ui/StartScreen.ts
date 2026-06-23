import { continents, countries } from '../data/countries';
import { territories, type TerritoryCategory } from '../data/territories';
import {
  countryIdsForRegion,
  type AppSettings,
  type GameMode,
  type QuizLength,
} from '../data/settings';
import {
  QUIZ_STYLES,
  QUIZ_CATEGORIES,
  type QuizStyleId,
  type QuizCategory,
} from '../engine/quizStyles';

export interface StartScreenCallbacks {
  onStart: (settings: AppSettings) => void;
  /** Preview the current country selection on the globe. */
  onPreview: (settings: AppSettings) => void;
}

const MODE_LABELS: { value: GameMode; label: string }[] = [
  { value: 'click-type', label: 'Click & Type' },
  { value: 'free-type', label: 'Free Type' },
  { value: 'flag', label: 'Flag' },
  // Quiz mode is hidden for now — code is preserved, just not offered here.
  // { value: 'quiz', label: 'Quiz' },
];

const QUIZ_PRESETS: { label: string; styles: QuizStyleId[] }[] = [
  { label: 'All', styles: QUIZ_STYLES.map(s => s.id) },
  { label: 'Flags', styles: ['flag-name', 'flag-pick-name', 'name-pick-flag', 'flag-locate'] },
  { label: 'Shapes', styles: ['outline-name', 'outline-pick-name'] },
  { label: 'Locate', styles: ['flag-locate', 'name-locate'] },
];

const LENGTH_CHOICES: { label: string; value: QuizLength }[] = [
  { label: '10', value: 10 },
  { label: '25', value: 25 },
  { label: '50', value: 50 },
  { label: 'All', value: 'all' },
];

// Territory category display order
const CATEGORY_ORDER: TerritoryCategory[] = [
  'Disputed States',
  'Other Dependencies',
  'US Territories',
  'British Territories',
  'French Territories',
  'Dutch Territories',
];

export class StartScreen {
  private el: HTMLElement;
  private settings: AppSettings;
  private callbacks: StartScreenCallbacks;
  /** Top-bar left slot to host the territory gear (so it sits inside the bar). */
  private topbarSlot: HTMLElement | null;
  /** The territory gear button (lives in the top bar; removed on destroy). */
  private terrBtn: HTMLElement | null = null;
  private overlayEl: HTMLElement | null = null;
  private quizSection: HTMLElement | null = null;
  private flagSection: HTMLElement | null = null;

  // Country selection state
  private selectedSet: Set<string>;
  private regionSelect!: HTMLSelectElement;
  private countrySummary!: HTMLElement;
  private countryCheckboxes = new Map<string, HTMLInputElement>();
  private groupCheckboxes = new Map<string, HTMLInputElement>();

  constructor(settings: AppSettings, callbacks: StartScreenCallbacks, topbarSlot?: HTMLElement) {
    this.settings = { ...settings };
    // Quiz mode is currently hidden — fall back to point-and-click if a stale
    // 'quiz' selection was loaded from a previous session.
    if (this.settings.mode === 'quiz') this.settings.mode = 'click-type';
    this.callbacks = callbacks;
    this.topbarSlot = topbarSlot ?? null;
    this.selectedSet = new Set(settings.selectedCountryIds);
    this.el = document.createElement('div');
    this.el.className = 'start-screen';
    this.render();
  }

  get element(): HTMLElement {
    return this.el;
  }

  private render(): void {
    const panel = document.createElement('div');
    panel.className = 'start-panel';

    // Territory-settings gear — sits in the top bar's left icon slot. Lives on the
    // start screen only, so it's removed during gameplay (see destroy()).
    const terrBtn = document.createElement('button');
    terrBtn.className = 'territory-gear-btn';
    terrBtn.innerHTML = '⚙';
    terrBtn.title = 'Territory settings';
    terrBtn.type = 'button';
    terrBtn.addEventListener('click', () => this.showTerritoryOverlay());
    this.terrBtn = terrBtn;
    (this.topbarSlot ?? this.el).appendChild(terrBtn);

    // Mode selector
    const modeLabel = document.createElement('label');
    modeLabel.textContent = 'Mode';
    const modeOptions = document.createElement('div');
    modeOptions.className = 'mode-options';
    for (const m of MODE_LABELS) {
      const btn = document.createElement('button');
      btn.textContent = m.label;
      btn.type = 'button';
      if (this.settings.mode === m.value) btn.classList.add('active');
      btn.addEventListener('click', () => {
        this.settings.mode = m.value;
        modeOptions.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.updateModeSections();
      });
      modeOptions.appendChild(btn);
    }
    modeLabel.appendChild(modeOptions);
    panel.appendChild(modeLabel);

    // Region quick-select
    const regionLabel = document.createElement('label');
    regionLabel.textContent = 'Region';
    this.regionSelect = document.createElement('select');
    for (const r of ['World', ...continents]) {
      const opt = document.createElement('option');
      opt.value = r;
      opt.textContent = r;
      this.regionSelect.appendChild(opt);
    }
    this.regionSelect.value = this.settings.continent;
    this.regionSelect.addEventListener('change', () => {
      const region = this.regionSelect.value;
      this.settings.continent = region;
      this.selectedSet = new Set(countryIdsForRegion(region));
      this.commitSelection();
      this.syncCountryUI();
      this.callbacks.onPreview(this.settings);
    });
    regionLabel.appendChild(this.regionSelect);
    panel.appendChild(regionLabel);

    // Countries dropdown (fine-grained)
    panel.appendChild(this.buildCountriesDropdown());

    // Time limit
    const timeLabel = document.createElement('label');
    timeLabel.textContent = 'Time Limit';
    const timeOptions = document.createElement('div');
    timeOptions.className = 'time-options';
    const timeChoices: { label: string; value: 15 | 30 | null }[] = [
      { label: 'None', value: null },
      { label: '15 min', value: 15 },
      { label: '30 min', value: 30 },
    ];
    for (const choice of timeChoices) {
      const btn = document.createElement('button');
      btn.textContent = choice.label;
      btn.type = 'button';
      if (this.settings.timeLimit === choice.value) btn.classList.add('active');
      btn.addEventListener('click', () => {
        this.settings.timeLimit = choice.value;
        timeOptions.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
      timeOptions.appendChild(btn);
    }
    timeLabel.appendChild(timeOptions);
    panel.appendChild(timeLabel);

    // Mode-specific sections
    this.quizSection = this.buildQuizSection();
    this.flagSection = this.buildFlagSection();
    panel.appendChild(this.quizSection);
    panel.appendChild(this.flagSection);
    this.updateModeSections();

    // Start button
    const startBtn = document.createElement('button');
    startBtn.className = 'start-btn';
    startBtn.textContent = 'Start Game';
    startBtn.type = 'button';
    startBtn.addEventListener('click', () => this.callbacks.onStart(this.settings));
    panel.appendChild(startBtn);

    this.el.appendChild(panel);
  }

  private updateModeSections(): void {
    if (this.quizSection) this.quizSection.style.display = this.settings.mode === 'quiz' ? '' : 'none';
    if (this.flagSection) this.flagSection.style.display = this.settings.mode === 'flag' ? '' : 'none';
  }

  // ── Country selection ──────────────────────────────────

  private commitSelection(): void {
    this.settings.selectedCountryIds = [...this.selectedSet];
  }

  /** Refresh region select, summary, and checkboxes to match selectedSet. */
  private syncCountryUI(): void {
    // Region select: show the matching preset, or blank if custom.
    const matchesRegion = (region: string): boolean => {
      const ids = countryIdsForRegion(region);
      return ids.length === this.selectedSet.size && ids.every(id => this.selectedSet.has(id));
    };
    if (matchesRegion(this.settings.continent)) {
      this.regionSelect.value = this.settings.continent;
    } else {
      this.regionSelect.selectedIndex = -1;
    }
    for (const [id, cb] of this.countryCheckboxes) cb.checked = this.selectedSet.has(id);
    this.refreshGroupCheckboxes();
    this.updateCountrySummary();
  }

  private updateCountrySummary(): void {
    const n = this.selectedSet.size;
    this.countrySummary.textContent = `${n} ${n === 1 ? 'country' : 'countries'} ▾`;
  }

  private refreshGroupCheckboxes(): void {
    for (const continent of continents) {
      const cb = this.groupCheckboxes.get(continent);
      if (!cb) continue;
      const ids = countries.filter(c => c.continent === continent).map(c => c.id);
      const selectedCount = ids.filter(id => this.selectedSet.has(id)).length;
      cb.checked = selectedCount === ids.length;
      cb.indeterminate = selectedCount > 0 && selectedCount < ids.length;
    }
  }

  private buildCountriesDropdown(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'dropdown';

    const summary = document.createElement('button');
    summary.type = 'button';
    summary.className = 'dropdown-summary';
    this.countrySummary = summary;

    const panel = document.createElement('div');
    panel.className = 'dropdown-panel';
    panel.style.display = 'none';

    summary.addEventListener('click', () => {
      panel.style.display = panel.style.display === 'none' ? '' : 'none';
    });

    // Search
    const search = document.createElement('input');
    search.type = 'text';
    search.className = 'dropdown-search';
    search.placeholder = 'Search countries...';
    search.addEventListener('input', () => {
      const q = search.value.trim().toLowerCase();
      for (const [id, cb] of this.countryCheckboxes) {
        const item = cb.closest('.country-item') as HTMLElement | null;
        if (!item) continue;
        const name = item.dataset.name ?? '';
        item.style.display = !q || name.includes(q) ? '' : 'none';
        void id;
      }
    });
    panel.appendChild(search);

    // Groups by continent
    for (const continent of continents) {
      const list = countries.filter(c => c.continent === continent);
      if (list.length === 0) continue;

      const group = document.createElement('div');
      group.className = 'dropdown-group';

      const header = document.createElement('label');
      header.className = 'dropdown-group-header';
      const groupCb = document.createElement('input');
      groupCb.type = 'checkbox';
      groupCb.addEventListener('change', () => {
        for (const c of list) {
          if (groupCb.checked) this.selectedSet.add(c.id);
          else this.selectedSet.delete(c.id);
        }
        this.commitSelection();
        this.syncCountryUI();
        this.callbacks.onPreview(this.settings);
      });
      this.groupCheckboxes.set(continent, groupCb);
      const headerText = document.createElement('span');
      headerText.textContent = continent;
      header.appendChild(groupCb);
      header.appendChild(headerText);
      group.appendChild(header);

      for (const c of list) {
        const item = document.createElement('label');
        item.className = 'country-item';
        item.dataset.name = c.name.toLowerCase();

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = this.selectedSet.has(c.id);
        cb.addEventListener('change', () => {
          if (cb.checked) this.selectedSet.add(c.id);
          else this.selectedSet.delete(c.id);
          this.commitSelection();
          this.refreshGroupCheckboxes();
          this.updateCountrySummary();
          this.regionSelect.selectedIndex = -1;
          this.callbacks.onPreview(this.settings);
        });
        this.countryCheckboxes.set(c.id, cb);

        const flag = document.createElement('img');
        flag.src = `./flags/${c.alpha2}.svg`;
        flag.alt = '';
        const name = document.createElement('span');
        name.textContent = c.name;

        item.appendChild(cb);
        item.appendChild(flag);
        item.appendChild(name);
        group.appendChild(item);
      }
      panel.appendChild(group);
    }

    wrap.appendChild(summary);
    wrap.appendChild(panel);

    this.refreshGroupCheckboxes();
    this.updateCountrySummary();
    return wrap;
  }

  // ── Length / format option rows ────────────────────────

  private buildLengthOptions(get: () => { length: QuizLength }): HTMLElement {
    const label = document.createElement('label');
    label.textContent = 'Questions';
    const options = document.createElement('div');
    options.className = 'time-options';
    for (const choice of LENGTH_CHOICES) {
      const btn = document.createElement('button');
      btn.textContent = choice.label;
      btn.type = 'button';
      if (get().length === choice.value) btn.classList.add('active');
      btn.addEventListener('click', () => {
        get().length = choice.value;
        options.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
      options.appendChild(btn);
    }
    label.appendChild(options);
    return label;
  }

  // ── Quiz section ───────────────────────────────────────

  private buildQuizSection(): HTMLElement {
    const section = document.createElement('div');
    section.className = 'mode-section';

    // Question-types dropdown
    const typesLabel = document.createElement('label');
    typesLabel.textContent = 'Question Types';

    const dropdown = document.createElement('div');
    dropdown.className = 'dropdown';

    const summary = document.createElement('button');
    summary.type = 'button';
    summary.className = 'dropdown-summary';

    const panel = document.createElement('div');
    panel.className = 'dropdown-panel';
    panel.style.display = 'none';
    summary.addEventListener('click', () => {
      panel.style.display = panel.style.display === 'none' ? '' : 'none';
    });

    const styleCheckboxes = new Map<QuizStyleId, HTMLInputElement>();
    const updateSummary = () => {
      const n = QUIZ_STYLES.filter(s => this.settings.quiz.styles[s.id]).length;
      summary.textContent = `${n} selected ▾`;
    };

    // Presets
    const presets = document.createElement('div');
    presets.className = 'dropdown-presets time-options';
    for (const p of QUIZ_PRESETS) {
      const btn = document.createElement('button');
      btn.textContent = p.label;
      btn.type = 'button';
      btn.addEventListener('click', () => {
        for (const s of QUIZ_STYLES) this.settings.quiz.styles[s.id] = p.styles.includes(s.id);
        for (const [id, cb] of styleCheckboxes) cb.checked = this.settings.quiz.styles[id];
        updateSummary();
      });
      presets.appendChild(btn);
    }
    panel.appendChild(presets);

    // Categorized styles
    for (const cat of QUIZ_CATEGORIES as QuizCategory[]) {
      const styles = QUIZ_STYLES.filter(s => s.category === cat);
      if (styles.length === 0) continue;

      const group = document.createElement('div');
      group.className = 'dropdown-group';
      const header = document.createElement('div');
      header.className = 'dropdown-group-header static';
      header.textContent = cat;
      group.appendChild(header);

      for (const s of styles) {
        const item = document.createElement('label');
        item.className = 'quiz-style-item';
        item.title = s.description;
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = this.settings.quiz.styles[s.id] !== false;
        cb.addEventListener('change', () => {
          this.settings.quiz.styles[s.id] = cb.checked;
          updateSummary();
        });
        styleCheckboxes.set(s.id, cb);
        const span = document.createElement('span');
        span.textContent = s.label;
        item.appendChild(cb);
        item.appendChild(span);
        group.appendChild(item);
      }
      panel.appendChild(group);
    }

    updateSummary();
    dropdown.appendChild(summary);
    dropdown.appendChild(panel);
    typesLabel.appendChild(dropdown);
    section.appendChild(typesLabel);

    // Format (Fixed / Adaptive) — quiz only
    const fmtLabel = document.createElement('label');
    fmtLabel.textContent = 'Format';
    const fmtOptions = document.createElement('div');
    fmtOptions.className = 'time-options';
    const fmts: { label: string; value: 'fixed' | 'adaptive' }[] = [
      { label: 'Fixed', value: 'fixed' },
      { label: 'Adaptive', value: 'adaptive' },
    ];
    for (const f of fmts) {
      const btn = document.createElement('button');
      btn.textContent = f.label;
      btn.type = 'button';
      if (this.settings.quiz.format === f.value) btn.classList.add('active');
      btn.addEventListener('click', () => {
        this.settings.quiz.format = f.value;
        fmtOptions.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
      fmtOptions.appendChild(btn);
    }
    fmtLabel.appendChild(fmtOptions);
    section.appendChild(fmtLabel);

    section.appendChild(this.buildLengthOptions(() => this.settings.quiz));
    return section;
  }

  // ── Flag section (no adaptive) ─────────────────────────

  private buildFlagSection(): HTMLElement {
    const section = document.createElement('div');
    section.className = 'mode-section';

    const ansLabel = document.createElement('label');
    ansLabel.textContent = 'Answer By';
    const ansOptions = document.createElement('div');
    ansOptions.className = 'time-options';
    const answers: { label: string; value: 'type' | 'click' }[] = [
      { label: 'Typing', value: 'type' },
      { label: 'Clicking', value: 'click' },
    ];
    for (const a of answers) {
      const btn = document.createElement('button');
      btn.textContent = a.label;
      btn.type = 'button';
      if (this.settings.flag.answer === a.value) btn.classList.add('active');
      btn.addEventListener('click', () => {
        this.settings.flag.answer = a.value;
        ansOptions.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
      ansOptions.appendChild(btn);
    }
    ansLabel.appendChild(ansOptions);
    section.appendChild(ansLabel);

    section.appendChild(this.buildLengthOptions(() => this.settings.flag));
    return section;
  }

  // ── Territory modal (unchanged) ────────────────────────

  private showTerritoryOverlay(): void {
    if (this.overlayEl) return;

    const overlay = document.createElement('div');
    overlay.className = 'territory-overlay';

    const modal = document.createElement('div');
    modal.className = 'territory-modal';

    const header = document.createElement('div');
    header.className = 'territory-modal-header';

    const heading = document.createElement('h2');
    heading.textContent = 'Territory Settings';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'territory-close-btn';
    closeBtn.innerHTML = '✕';
    closeBtn.type = 'button';
    closeBtn.addEventListener('click', () => this.closeTerritoryOverlay());

    header.appendChild(heading);
    header.appendChild(closeBtn);
    modal.appendChild(header);

    const desc = document.createElement('p');
    desc.className = 'territory-desc';
    desc.textContent = 'Enable territories to quiz them as separate countries.';
    modal.appendChild(desc);

    const body = document.createElement('div');
    body.className = 'territory-modal-body';

    const enabledSet = new Set(this.settings.enabledTerritoryIds);

    const grouped = new Map<TerritoryCategory, typeof territories>();
    for (const cat of CATEGORY_ORDER) grouped.set(cat, []);
    for (const t of territories) grouped.get(t.category)!.push(t);

    for (const cat of CATEGORY_ORDER) {
      const items = grouped.get(cat)!;
      if (items.length === 0) continue;

      const section = document.createElement('div');
      section.className = 'territory-category';

      const catHeader = document.createElement('div');
      catHeader.className = 'territory-category-header';
      catHeader.textContent = cat;
      section.appendChild(catHeader);

      const list = document.createElement('div');
      list.className = 'territory-category-list';

      for (const t of items) {
        const item = document.createElement('label');
        item.className = 'territory-item';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = enabledSet.has(t.id);
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) {
            if (!this.settings.enabledTerritoryIds.includes(t.id)) {
              this.settings.enabledTerritoryIds.push(t.id);
            }
          } else {
            this.settings.enabledTerritoryIds = this.settings.enabledTerritoryIds.filter(
              id => id !== t.id
            );
          }
        });

        const flag = document.createElement('img');
        flag.src = `./flags/${t.alpha2}.svg`;
        flag.alt = t.name;

        const name = document.createElement('span');
        name.textContent = t.name;

        item.appendChild(checkbox);
        item.appendChild(flag);
        item.appendChild(name);
        list.appendChild(item);
      }

      section.appendChild(list);
      body.appendChild(section);
    }

    modal.appendChild(body);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.closeTerritoryOverlay();
    });

    overlay.appendChild(modal);
    this.el.appendChild(overlay);
    this.overlayEl = overlay;
  }

  private closeTerritoryOverlay(): void {
    if (this.overlayEl) {
      this.overlayEl.remove();
      this.overlayEl = null;
    }
  }

  destroy(): void {
    this.terrBtn?.remove();
    this.terrBtn = null;
    this.el.remove();
  }
}
