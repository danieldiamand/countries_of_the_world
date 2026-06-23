import './style.css';
import * as d3 from 'd3';
import { Globe } from './globe/Globe';
import { GlobeInteraction } from './globe/interaction';
import { GlobeAnimation } from './globe/animation';
import { GameEngine } from './engine/GameEngine';
import { QuizEngine } from './engine/QuizEngine';
import { FLAG_STYLE_IDS, type QuizQuestion, type QuizStyleId } from './engine/quizStyles';
import { StartScreen } from './ui/StartScreen';
import { GameHUD } from './ui/GameHUD';
import { QuizScreen } from './ui/QuizScreen';
import { CountryPopup } from './ui/CountryPopup';
import { FlagPrompt } from './ui/FlagPrompt';
import { ResultScreen } from './ui/ResultScreen';
import { loadSettings, saveSettings, type AppSettings } from './data/settings';
import { countries as allCountriesData, countryById, type Country } from './data/countries';
import { getZoomTier, CONTINENT_CENTERS, CONTINENT_SCALES, MARKER_IDS } from './data/constants';
import {
  territories as allTerritoriesData,
  buildParentToChildrenMap,
  buildFullFeatureParentMap,
} from './data/territories';
import type { CountryState, CountryFeature } from './globe/Globe';
import type { GameConfig, GameEvent, GameResult } from './engine/types';

const REVEAL_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="color:#6BBCB0"><circle cx="12" cy="12" r="7"/><line x1="12" y1="1.5" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22.5"/><line x1="1.5" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22.5" y2="12"/></svg>`;

class App {
  private appEl: HTMLElement;
  private globeContainer: HTMLElement;
  private globe!: Globe;
  private interaction!: GlobeInteraction;
  private animation!: GlobeAnimation;
  private engine = new GameEngine();

  private startScreen: StartScreen | null = null;
  private hud: GameHUD | null = null;
  private popup: CountryPopup | null = null;
  private flagPrompt: FlagPrompt | null = null;
  private resultScreen: ResultScreen | null = null;
  private quizEngine: QuizEngine | null = null;
  private quizScreen: QuizScreen | null = null;

  private settings: AppSettings;
  private lastConfig: GameConfig | null = null;
  /** Cached for the current game — rebuilt in startGame(). */
  private parentToChildren = new Map<string, Set<string>>();
  /** Feature → parent id map for resolving territory/child clicks. */
  private featureParentMap = new Map<string, string>();
  /** Feature lookup by id (for outline rendering). */
  private featureMap = new Map<string, CountryFeature>();

  constructor() {
    this.appEl = document.getElementById('app')!;
    this.settings = loadSettings();

    // Globe container
    this.globeContainer = document.createElement('div');
    this.globeContainer.className = 'globe-container';
    this.appEl.appendChild(this.globeContainer);

    this.init();
  }

  private async init(): Promise<void> {
    // Create globe
    this.globe = new Globe(this.globeContainer);
    await this.globe.load();

    // Animation
    this.animation = new GlobeAnimation(this.globe);

    // Interaction — cancel any fly-to when user starts dragging
    this.interaction = new GlobeInteraction(this.globe, {
      onClick: (id, xy) => this.handleGlobeClick(id, xy),
      onZoomChange: () => { this.animation.cancel(); },
    });

    // Cancel fly-to on mousedown/touchstart so dragging feels immediate
    const cancelOnDrag = () => this.animation.cancel();
    this.globeContainer.addEventListener('mousedown', cancelOnDrag);
    this.globeContainer.addEventListener('touchstart', cancelOnDrag);

    // Persistent top bar (brand title + game actions) + floating realistic toggle
    this.createTopBar();
    this.createViewToggle();
    this.globe.setRealistic(this.settings.realistic);

    // Flags appear instantly once cached — warm them in the background now.
    this.preloadFlags();

    // Show start screen
    this.showStartScreen();
  }

  /** Shared top-bar slot where the game injects score/timer/Pause/End. */
  private topbarActions!: HTMLElement;
  /** Left-side icon slot in the top bar (realistic-view toggle + territory gear). */
  private topbarLeft!: HTMLElement;

  /** Persistent top bar (always visible): brand title + icon controls + game actions. */
  private createTopBar(): void {
    const bar = document.createElement('div');
    bar.className = 'app-topbar';

    const title = document.createElement('span');
    title.className = 'app-topbar-title';
    title.textContent = "Diamand's Globe Guesser";

    this.topbarLeft = document.createElement('div');
    this.topbarLeft.className = 'app-topbar-left';

    this.topbarActions = document.createElement('div');
    this.topbarActions.className = 'app-topbar-actions';

    bar.appendChild(title);
    bar.appendChild(this.topbarLeft);
    bar.appendChild(this.topbarActions);
    this.appEl.appendChild(bar);
  }

  /** Realistic-view ("real Earth") toggle — lives in the top bar's left icon slot. */
  private createViewToggle(): void {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'view-toggle-btn';
    toggle.innerHTML = '🌍';
    const sync = () => {
      const on = this.settings.realistic;
      toggle.classList.toggle('active', on);
      toggle.title = on ? 'Realistic view: on' : 'Realistic view: off';
      toggle.setAttribute('aria-pressed', String(on));
    };
    toggle.addEventListener('click', () => {
      this.settings.realistic = !this.settings.realistic;
      saveSettings(this.settings);
      this.globe.setRealistic(this.settings.realistic);
      sync();
    });
    sync();
    this.topbarLeft.appendChild(toggle);
  }

  /** Warm the browser cache with every flag SVG so popups/lists render instantly. */
  private preloadFlags(): void {
    const codes = new Set<string>();
    for (const c of allCountriesData) if (c.alpha2) codes.add(c.alpha2);
    for (const t of allTerritoriesData) if (t.alpha2) codes.add(t.alpha2);
    const warm = () => { for (const a of codes) { const img = new Image(); img.src = `./flags/${a}.svg`; } };
    if ('requestIdleCallback' in window) {
      (window as Window & { requestIdleCallback(cb: () => void): void }).requestIdleCallback(warm);
    } else {
      setTimeout(warm, 300);
    }
  }

  // ── Pause ──────────────────────────────────────────────

  private paused = false;
  private pauseOverlay: HTMLElement | null = null;

  /** Toggle pause: freeze the clock/input and grey out the globe. */
  private togglePause(): void {
    if (!this.engine.isRunning) return;
    this.paused = !this.paused;
    if (this.paused) {
      this.engine.pause();
      this.animation.cancel();
      this.globe.setDimmed(true);
      this.showPauseOverlay();
    } else {
      this.engine.resume();
      this.globe.setDimmed(false);
      this.hidePauseOverlay();
    }
    this.flagPrompt?.setPaused(this.paused);
    this.hud?.setPaused(this.paused);
  }

  private showPauseOverlay(): void {
    if (this.pauseOverlay) return;
    const overlay = document.createElement('div');
    overlay.className = 'pause-overlay';

    const panel = document.createElement('div');
    panel.className = 'pause-panel';
    const h2 = document.createElement('h2');
    h2.textContent = 'Paused';
    const p = document.createElement('p');
    p.textContent = 'Game paused';
    const resume = document.createElement('button');
    resume.type = 'button';
    resume.className = 'pause-resume-btn';
    resume.textContent = 'Resume';
    panel.appendChild(h2);
    panel.appendChild(p);
    panel.appendChild(resume);
    overlay.appendChild(panel);

    overlay.addEventListener('click', () => this.togglePause());
    this.globeContainer.appendChild(overlay);
    this.pauseOverlay = overlay;
  }

  private hidePauseOverlay(): void {
    if (this.pauseOverlay) {
      this.pauseOverlay.remove();
      this.pauseOverlay = null;
    }
  }

  // ── Screens ────────────────────────────────────────────

  private showStartScreen(): void {
    this.cleanupGame();

    // Reset globe to a nice default view
    this.globe.setRotation([-15, -30, 0]); // Show Europe/Africa area
    this.globe.setZoomLevel(1);
    this.globe.setActiveCountryIds(null);
    this.globe.setCountryStates(new Map());
    // On the start screen, realistic mode previews the whole world filled in.
    this.globe.setRevealAll(true);

    this.startScreen = new StartScreen(this.settings, {
      onStart: (settings) => this.startGame(settings),
      onPreview: (settings) => this.previewSelection(settings),
    }, this.topbarLeft);
    this.appEl.appendChild(this.startScreen.element);

    // Frame & highlight the saved region immediately (otherwise a restored
    // region looks unselected until the user re-picks it).
    this.previewSelection(this.settings);
  }

  /** Highlight & frame the current country selection while on the start screen. */
  private previewSelection(settings: AppSettings): void {
    this.settings = settings;
    // Build the same territory→parent maps the game uses, so contested
    // territories resolve to their parent's state/active set on the start
    // screen too (otherwise their child features render greyed/unrevealed).
    this.ensureFeatureMap();
    this.featureParentMap = buildFullFeatureParentMap(new Set(settings.enabledTerritoryIds));
    this.parentToChildren = buildParentToChildrenMap(this.featureParentMap);
    this.setupHoverResolver();
    this.applySelectionToGlobe(settings, this.buildPlayCountryIds(settings));
    this.flyToSelection(settings);
  }

  private startGame(settings: AppSettings): void {
    // The realistic-view toggle lives outside the start-screen form, so its live
    // value (on this.settings) wins over the form's stale copy.
    settings.realistic = this.settings.realistic;
    this.settings = settings;
    saveSettings(settings);

    // Leave the start-screen "reveal everything" preview — in-game only guessed
    // countries fill in.
    this.globe.setRevealAll(false);

    // Remove start screen
    if (this.startScreen) {
      this.startScreen.destroy();
      this.startScreen = null;
    }

    if (settings.mode === 'flag') {
      this.startFlagMode(settings);
    } else if (settings.mode === 'quiz') {
      this.startQuizMode(settings);
    } else {
      this.startClassicGame(settings);
    }
  }

  /** Click & Type and Free-Type modes (both driven by GameEngine). */
  private startClassicGame(settings: AppSettings): void {
    const isFree = settings.mode === 'free-type';

    const config: GameConfig = {
      continent: settings.continent,
      timeLimit: settings.timeLimit,
      enabledTerritoryIds: new Set(settings.enabledTerritoryIds),
      countryIds: this.buildPlayCountryIds(settings),
    };
    this.lastConfig = config;

    // Pass centroids from globe to engine
    this.engine = new GameEngine();
    for (const f of this.globe.getFeatures()) {
      const id = String(f.id ?? '');
      const centroid = this.globe.getCentroid(id);
      if (id && centroid) {
        this.engine.centroids.set(id, centroid);
      }
    }

    // Wire engine events
    this.engine.on('correct', (e) => this.onCorrect(e));
    this.engine.on('near-miss', (e) => this.onNearMiss(e));
    this.engine.on('incorrect', () => this.onIncorrect());
    this.engine.on('hint', (e) => this.onHint(e));
    this.engine.on('next', (e) => this.onNext(e));
    this.engine.on('select', (e) => this.onSelect(e));
    this.engine.on('skip', () => this.onSkip());
    this.engine.on('tick', (e) => this.onTick(e));
    this.engine.on('end', (e) => this.onEnd(e));

    // Create HUD
    this.hud = new GameHUD(this.appEl, {
      onGuess: (input) => {
        if (isFree) this.engine.submitFreeGuess(input);
        else this.engine.submitGuess(input);
      },
      onHint: () => this.engine.useHint(),
      onSkip: () => this.engine.skip(),
      onEnd: () => this.engine.endGame(),
      onZoomIn: () => this.interaction.zoomBy(1.5),
      onZoomOut: () => this.interaction.zoomBy(0.67),
      onTogglePause: () => this.togglePause(),
    }, isFree
      ? {
          modeLabel: 'Free Type',
          showHint: false,
          showSkip: false,
          actionsSlot: this.topbarActions,
          extraButton: {
            title: 'Reveal a country',
            svgHtml: REVEAL_ICON,
            onClick: () => this.engine.selectRandomUncompleted(),
          },
        }
      : { actionsSlot: this.topbarActions });

    // Create popup
    this.popup = new CountryPopup(this.appEl);

    // Start engine — must happen before reading activeIds (pool is empty before start)
    this.engine.start(config);
    this.hud.updateScore(0, this.engine.total);

    // Wire hover resolver so hovering a territory highlights the whole group
    const fpm = this.engine.featureParentMap;
    this.featureParentMap = fpm;
    this.parentToChildren = buildParentToChildrenMap(fpm);
    const p2c = this.parentToChildren;
    this.globe.hoverResolver = (id: string): Set<string> => {
      const set = new Set<string>([id]);
      // If this feature is a child, add parent + siblings
      const parentId = fpm.get(id);
      if (parentId) {
        set.add(parentId);
        const siblings = p2c.get(parentId);
        if (siblings) for (const s of siblings) set.add(s);
      }
      // If this feature is a parent, add children
      const children = p2c.get(id);
      if (children) for (const c of children) set.add(c);
      return set;
    };

    // Active countries + region view based on the selected set.
    this.applySelectionToGlobe(settings, config.countryIds!);
    this.flyToSelection(settings);

    this.updateGlobeStates();

    // Free-Type: no clicking — the player just types. Prime the input.
    if (isFree) {
      this.hud.setPlaceholder('Type any country in the region...');
      this.hud.focusInput();
    }
  }

  // ── Flag mode ──────────────────────────────────────────

  /** Flag mode runs on the SAME engine/HUD as the classic modes (shared top bar,
   *  Pause/End, the normal answer box, near-miss, hint, skip). The only extras are
   *  the flag prompt and, for the click variant, answering by clicking the globe. */
  private startFlagMode(settings: AppSettings): void {
    const isClick = settings.flag.answer === 'click';

    const config: GameConfig = {
      continent: settings.continent,
      timeLimit: settings.timeLimit,
      enabledTerritoryIds: new Set(settings.enabledTerritoryIds),
      countryIds: this.buildPlayCountryIds(settings),
      limit: settings.flag.length === 'all' ? undefined : settings.flag.length,
    };
    this.lastConfig = config;

    // Engine + centroids (same as classic).
    this.engine = new GameEngine();
    for (const f of this.globe.getFeatures()) {
      const id = String(f.id ?? '');
      const centroid = this.globe.getCentroid(id);
      if (id && centroid) this.engine.centroids.set(id, centroid);
    }

    this.engine.on('correct', (e) => this.onCorrect(e));
    this.engine.on('near-miss', (e) => this.onNearMiss(e));
    this.engine.on('incorrect', () => this.onIncorrect());
    this.engine.on('hint', (e) => this.onHint(e));
    this.engine.on('next', (e) => this.onNext(e));
    this.engine.on('select', (e) => this.onSelect(e));
    this.engine.on('skip', () => this.onSkip());
    this.engine.on('tick', (e) => this.onTick(e));
    this.engine.on('end', (e) => this.onEnd(e));

    // HUD: type uses the normal answer box; click hides it (answer via the globe).
    this.hud = new GameHUD(this.appEl, {
      onGuess: (input) => { this.engine.submitGuess(input); },
      onHint: () => this.engine.useHint(),
      onSkip: () => this.engine.skip(),
      onEnd: () => this.engine.endGame(),
      onZoomIn: () => this.interaction.zoomBy(1.5),
      onZoomOut: () => this.interaction.zoomBy(0.67),
      onTogglePause: () => this.togglePause(),
    }, {
      modeLabel: 'Flag',
      actionsSlot: this.topbarActions,
      showInput: !isClick,
      showHint: !isClick,
      showSkip: true,
    });

    this.popup = new CountryPopup(this.appEl);
    this.flagPrompt = new FlagPrompt(this.appEl, isClick ? 'click' : 'type');

    this.engine.start(config);
    this.hud.updateScore(0, this.engine.total);

    // Territory grouping for hover/click resolution (same as classic).
    this.featureParentMap = this.engine.featureParentMap;
    this.parentToChildren = buildParentToChildrenMap(this.featureParentMap);
    this.setupHoverResolver();

    this.applySelectionToGlobe(settings, config.countryIds!);
    this.flyToSelection(settings);

    // Kick off the first flag — emits 'select' → presents the target.
    this.engine.selectRandomUncompleted();
  }

  /** Show the current target's flag and prime the answer box (Flag mode). */
  private presentFlagTarget(country: Country): void {
    this.flagPrompt?.setFlag(country.alpha2, country.name);
    this.hud?.clearInput();
    this.hud?.hideNearMiss();
    this.hud?.setPlaceholder('Name this country...');
    const hintText = this.engine.getHintText();
    if (hintText) this.hud?.setHintText(hintText);
    this.updateGlobeStates();
    this.hud?.focusInput();
  }

  // ── Quiz mode ──────────────────────────────────────────

  private startQuizMode(settings: AppSettings): void {
    const isFlag = settings.mode === 'flag';
    const cfg = isFlag ? settings.flag : settings.quiz;

    const styleIds = isFlag
      ? FLAG_STYLE_IDS[settings.flag.answer]
      : (Object.keys(settings.quiz.styles) as QuizStyleId[]).filter(id => settings.quiz.styles[id]);

    // Region maps + globe setup.
    this.ensureFeatureMap();
    const enabledSet = new Set(settings.enabledTerritoryIds);
    this.featureParentMap = buildFullFeatureParentMap(enabledSet);
    this.parentToChildren = buildParentToChildrenMap(this.featureParentMap);
    this.setupHoverResolver();
    const countryIds = this.buildPlayCountryIds(settings);
    this.applySelectionToGlobe(settings, countryIds);

    const shapeAvailable = (id: string) => this.featureMap.has(id) && !MARKER_IDS.has(id);

    this.quizEngine = new QuizEngine();
    this.quizEngine.on('question', (e) => {
      if (!e.question) return;
      this.setupGlobeForQuestion(e.question);
      this.quizScreen?.showQuestion(e.question, e.index ?? 0, e.total ?? 0);
    });
    this.quizEngine.on('answered', (e) => {
      if (!e.correctCountry) return;
      this.quizScreen?.showFeedback(!!e.correct, e.correctCountry);
      this.revealOnGlobe(e.correctCountry);
    });
    this.quizEngine.on('tick', (e) => {
      if (e.timeRemaining !== undefined) this.quizScreen?.updateTimer(e.timeRemaining);
    });
    this.quizEngine.on('end', (e) => {
      if (!e.result) return;
      if (this.quizScreen) { this.quizScreen.destroy(); this.quizScreen = null; }
      this.showResults(e.result);
    });

    this.quizScreen = new QuizScreen(this.appEl, {
      onSubmitText: (input) => { this.quizEngine?.checkTypedAnswer(input); },
      onChoose: (cid) => { this.quizEngine?.chooseAnswer(cid); },
      onSkip: () => this.quizEngine?.skip(),
      onHint: () => this.quizEngine?.useHint() ?? null,
      onNext: () => this.quizEngine?.advance(),
      onEnd: () => this.quizEngine?.endQuiz(),
      getFeature: (id) => this.featureMap.get(id),
    }, isFlag ? 'Flag' : 'Quiz');

    this.flyToSelection(settings);

    this.quizEngine.start({
      continent: settings.continent,
      enabledTerritoryIds: enabledSet,
      countryIds,
      styleIds,
      format: cfg.format,
      length: cfg.length,
      timeLimit: settings.timeLimit,
      shapeAvailable,
    });
  }

  private ensureFeatureMap(): void {
    if (this.featureMap.size > 0) return;
    for (const f of this.globe.getFeatures()) {
      const id = String(f.id ?? '');
      if (id) this.featureMap.set(id, f);
    }
  }

  private setupHoverResolver(): void {
    const fpm = this.featureParentMap;
    const p2c = this.parentToChildren;
    this.globe.hoverResolver = (id: string): Set<string> => {
      const set = new Set<string>([id]);
      const parentId = fpm.get(id);
      if (parentId) {
        set.add(parentId);
        const siblings = p2c.get(parentId);
        if (siblings) for (const s of siblings) set.add(s);
      }
      const children = p2c.get(id);
      if (children) for (const c of children) set.add(c);
      return set;
    };
  }

  /** Build the full set of country IDs in play: the selected countries plus any
   *  enabled territories whose continent is represented in the selection. */
  private buildPlayCountryIds(settings: AppSettings): Set<string> {
    const ids = new Set(settings.selectedCountryIds);
    const continentsInPlay = new Set<string>();
    for (const id of settings.selectedCountryIds) {
      const c = countryById.get(id);
      if (c) continentsInPlay.add(c.continent);
    }
    const enabled = new Set(settings.enabledTerritoryIds);
    for (const t of allTerritoriesData) {
      if (enabled.has(t.id) && continentsInPlay.has(t.continent)) ids.add(t.id);
    }
    return ids;
  }

  /** Grey out everything not in play (null = whole world, nothing greyed). */
  private applySelectionToGlobe(settings: AppSettings, playIds: Set<string>): void {
    const wholeWorld = settings.continent === 'World'
      && settings.selectedCountryIds.length === allCountriesData.length;
    if (wholeWorld) {
      this.globe.setActiveCountryIds(null);
      return;
    }
    const activeIds = new Set(playIds);
    for (const [parentId, childIds] of this.parentToChildren) {
      if (activeIds.has(parentId)) for (const cid of childIds) activeIds.add(cid);
    }
    this.globe.setActiveCountryIds(activeIds);
  }

  /** The single continent a selection is confined to, or 'World' if it spans more. */
  private regionForSelection(settings: AppSettings): string {
    const conts = new Set<string>();
    for (const id of settings.selectedCountryIds) {
      const c = countryById.get(id);
      if (c) {
        conts.add(c.continent);
        if (conts.size > 1) return 'World';
      }
    }
    return conts.size === 1 ? [...conts][0] : 'World';
  }

  private regionScale(): number {
    const region = this.regionForSelection(this.settings);
    return region === 'World' ? 2.2 : (CONTINENT_SCALES[region] ?? 1);
  }

  private flyToSelection(settings: AppSettings): void {
    const region = this.regionForSelection(settings);
    if (region === 'World') {
      this.animation.flyTo({ target: [15, 30], zoom: 1, duration: 600 });
    } else {
      const center = CONTINENT_CENTERS[region];
      const scale = CONTINENT_SCALES[region] ?? 1;
      if (center) this.animation.flyTo({ target: center, zoom: scale, duration: 600 });
    }
  }

  private setGlobeHighlight(id: string, state: CountryState): void {
    const states = new Map<string, CountryState>();
    states.set(id, state);
    const children = this.parentToChildren.get(id);
    if (children) for (const c of children) states.set(c, state);
    this.globe.setCountryStates(states);
  }

  private setupGlobeForQuestion(q: QuizQuestion): void {
    if (q.style.prompt === 'globe-highlight') {
      this.setGlobeHighlight(q.target.id, 'selected');
      const c = this.globe.getCentroid(q.target.id);
      if (c) this.animation.flyTo({ target: c, zoom: this.regionScale(), duration: 800 });
    } else {
      // Flag/outline/name prompts (behind a scrim) and "find on globe" answers:
      // show a clean region view so neighbours are visible.
      this.globe.setCountryStates(new Map());
      this.flyToSelection(this.settings);
    }
  }

  private revealOnGlobe(country: Country): void {
    this.setGlobeHighlight(country.id, 'correct');
    const q = this.quizEngine?.currentQuestion;
    const globeProminent = !!q && (q.style.prompt === 'globe-highlight' || q.style.answer === 'locate');
    if (globeProminent) {
      const c = this.globe.getCentroid(country.id);
      if (c) this.animation.flyTo({ target: c, zoom: this.regionScale(), duration: 700 });
    }
  }

  private cleanupGame(): void {
    this.paused = false;
    this.globe.setDimmed(false);
    this.hidePauseOverlay();
    if (this.quizScreen) {
      this.quizScreen.destroy();
      this.quizScreen = null;
    }
    this.quizEngine = null;
    if (this.hud) {
      this.hud.destroy();
      this.hud = null;
    }
    if (this.popup) {
      this.popup.destroy();
      this.popup = null;
    }
    if (this.flagPrompt) {
      this.flagPrompt.destroy();
      this.flagPrompt = null;
    }
    if (this.resultScreen) {
      this.resultScreen.destroy();
      this.resultScreen = null;
    }
    if (this.startScreen) {
      this.startScreen.destroy();
      this.startScreen = null;
    }
  }

  // Click geo location for fly-to targeting
  private lastClickGeo: [number, number] | null = null;

  // ── Globe click handling ───────────────────────────────

  private handleGlobeClick(id: string | null, canvasXY: [number, number]): void {
    if (!id) return;

    // If on start screen, ignore clicks
    if (this.startScreen) return;

    // Quiz "find on the globe" answers — route the click to the quiz engine.
    if (this.quizScreen && this.quizEngine?.isRunning) {
      if (this.quizScreen.isAwaitingLocate) {
        const resolved = this.featureParentMap.get(id) ?? id;
        this.quizEngine.chooseAnswer(resolved);
      }
      return;
    }

    // Free-Type needs no clicking — the player just types.
    if (this.settings.mode === 'free-type') return;

    // Flag mode.
    if (this.settings.mode === 'flag') {
      // Type variant answers by typing — ignore globe clicks.
      if (this.settings.flag.answer !== 'click') return;
      if (!this.engine.isRunning || this.paused) return;
      const resolved = this.engine.resolveTerritory(id);
      const target = this.engine.currentCountry;
      if (!target) return;
      if (resolved === target.id) {
        // Correct country clicked — drive the normal scoring path.
        this.engine.submitGuess(target.name);
      } else if (this.engine.activeIds.has(resolved)) {
        // Wrong in-pool country — brief cue, let them try again.
        this.flagPrompt?.flashWrong();
      }
      return;
    }

    // If game not running, ignore
    if (!this.engine.isRunning) return;

    // Resolve territory
    const resolvedId = this.engine.resolveTerritory(id);

    // Check if this country is in the pool
    if (!this.engine.activeIds.has(resolvedId)) return;

    // Store the click geo-coordinate for fly-to targeting
    const geo = this.globe.getProjection().invert?.(canvasXY);
    this.lastClickGeo = geo ? [geo[0], geo[1]] : null;

    // Set referenceGeo if click is far from the resolved country's centroid.
    // Handles both: (a) clicking a listed territory that resolves to parent,
    // and (b) clicking an overseas part of a parent's own MultiPolygon
    // (e.g. French Guiana is part of France's feature id 250).
    let referenceGeo: [number, number] | undefined;
    if (this.lastClickGeo) {
      const centroid = this.globe.getCentroid(resolvedId);
      if (centroid) {
        const angDist = d3.geoDistance(this.lastClickGeo, centroid) * (180 / Math.PI);
        if (angDist > 15) {
          referenceGeo = this.lastClickGeo;
        }
      }
    }

    // Select the country — onSelect handler will animate
    this.engine.selectCountry(resolvedId, referenceGeo);
  }

  // ── Engine event handlers ──────────────────────────────

  private onCorrect(e: GameEvent): void {
    if (!e.country) return;

    this.popup?.showCorrect(e.country.name, e.country.alpha2);
    this.hud?.clearInput();
    this.hud?.hideNearMiss();
    this.hud?.updateScore(this.engine.score, this.engine.total);
    this.updateGlobeStates();
  }

  private onNearMiss(e: GameEvent): void {
    if (!e.result?.suggestion) return;
    this.hud?.showNearMiss(e.result.suggestion);
  }

  private onIncorrect(): void {
    // Could add a subtle shake animation or red flash later
  }

  private onHint(e: GameEvent): void {
    if (e.hintText) {
      this.hud?.setHintText(e.hintText);
    }
    this.hud?.hideNearMiss();
    this.updateGlobeStates();
  }

  private onNext(e: GameEvent): void {
    if (!e.country) return;

    // Flag mode: show the next flag, don't fly to / reveal the country.
    if (this.settings.mode === 'flag') {
      this.presentFlagTarget(e.country);
      return;
    }

    this.hud?.clearInput();
    this.hud?.hideNearMiss();
    this.hud?.setPlaceholder(`Name this country...`);

    // Restore hint state for this country
    const hintText = this.engine.getHintText();
    if (hintText) {
      this.hud?.setHintText(hintText);
    }

    // Fly to next country
    const centroid = this.globe.getCentroid(e.country.id);
    if (centroid) {
      const zoom = getZoomTier(e.country.id);
      this.animation.flyTo({ target: centroid, zoom, duration: 1200 });
    }

    this.updateGlobeStates();
    this.hud?.focusInput();
  }

  private onSelect(e: GameEvent): void {
    if (!e.country) return;

    // Flag mode: present the target as a flag (no globe reveal/fly-to).
    if (this.settings.mode === 'flag') {
      this.presentFlagTarget(e.country);
      return;
    }

    // Free-Type "Reveal a country": highlight it and recenter, but stay at
    // continent zoom so neighbours remain visible (don't zoom in hard).
    if (this.settings.mode === 'free-type') {
      this.popup?.hide();
      this.updateGlobeStates();
      const centroid = this.globe.getCentroid(e.country.id);
      const scale = this.settings.continent === 'World'
        ? 2.5
        : (CONTINENT_SCALES[this.settings.continent] ?? 1);
      if (centroid) {
        this.animation.flyTo({ target: centroid, zoom: scale, duration: 800 });
      }
      this.hud?.focusInput();
      return;
    }

    this.hud?.clearInput();
    this.hud?.hideNearMiss();

    // If already completed, show persistent popup and green locked input
    if (this.engine.getCountryState(e.country.id) === 'complete-selected') {
      this.popup?.showPersistent(e.country.name, e.country.alpha2);
      this.hud?.showCompleted(e.country.name);
    } else {
      this.popup?.hide();
      this.hud?.setPlaceholder(`Name this country...`);
      const hintText = this.engine.getHintText();
      if (hintText) {
        this.hud?.setHintText(hintText);
      }
    }

    this.updateGlobeStates();

    // Fly to the selected country
    let flyTarget = this.globe.getCentroid(e.country.id);
    let flyZoom = getZoomTier(e.country.id);

    if (flyTarget && this.lastClickGeo) {
      const angDistDeg = d3.geoDistance(this.lastClickGeo, flyTarget) * (180 / Math.PI);

      if (angDistDeg > 15) {
        // Territory is far from mainland — zoom out to show both
        const interp = d3.geoInterpolate(this.lastClickGeo, flyTarget);
        flyTarget = interp(0.5) as [number, number];
        flyZoom = Math.min(flyZoom, Math.max(0.8, 108 / angDistDeg));
      }
    }
    this.lastClickGeo = null;

    if (flyTarget) {
      this.animation.flyTo({ target: flyTarget, zoom: flyZoom, duration: 1200 });
    }

    this.hud?.focusInput();
  }

  private onSkip(): void {
    this.popup?.hide();
    this.globe.setHoveredId(null);
  }

  private onTick(e: GameEvent): void {
    if (e.timeRemaining !== undefined) {
      const isCountdown = this.lastConfig?.timeLimit !== null;
      this.hud?.updateTimer(e.timeRemaining, isCountdown);
    }
  }

  private onEnd(e: GameEvent): void {
    if (!e.gameResult) return;

    this.paused = false;
    this.globe.setDimmed(false);
    this.hidePauseOverlay();

    // Clean up HUD
    if (this.hud) {
      this.hud.destroy();
      this.hud = null;
    }
    if (this.popup) {
      this.popup.destroy();
      this.popup = null;
    }
    if (this.flagPrompt) {
      this.flagPrompt.destroy();
      this.flagPrompt = null;
    }

    this.showResults(e.gameResult);
  }

  /** Show the post-game results screen (shared by all modes). */
  private showResults(result: GameResult): void {
    // Don't re-color the globe on the end screen — just clear it
    this.globe.setCountryStates(new Map());

    this.resultScreen = new ResultScreen(result, {
      onReplay: () => {
        if (this.resultScreen) {
          this.resultScreen.destroy();
          this.resultScreen = null;
        }
        this.startGame(this.settings);
      },
      onHome: () => {
        if (this.resultScreen) {
          this.resultScreen.destroy();
          this.resultScreen = null;
        }
        this.showStartScreen();
      },
    });
    this.appEl.appendChild(this.resultScreen.element);
  }

  // ── Globe state sync ───────────────────────────────────

  private updateGlobeStates(): void {
    const states = new Map<string, CountryState>();

    // Flag "click" mode must not highlight the pending target (that would give
    // away the answer) — only already-guessed countries turn green.
    const hideCurrent = this.settings.mode === 'flag' && this.settings.flag.answer === 'click';

    for (const id of this.engine.activeIds) {
      const state = this.engine.getCountryState(id);
      if (state === 'default') continue;
      if (hideCurrent && (state === 'selected' || state === 'complete-selected')) continue;
      states.set(id, state);
    }

    // Propagate parent state to territory/child features.
    // E.g. when France is 'selected', Greenland-like territories and
    // unlisted features (French Guiana polygon, etc.) also turn blue.
    const parentToChildren = this.parentToChildren;
    for (const [parentId, childIds] of parentToChildren) {
      const parentState = states.get(parentId);
      if (parentState) {
        for (const childId of childIds) {
          states.set(childId, parentState);
        }
      }
    }

    this.globe.setCountryStates(states);
  }
}

// Boot
new App();
