import './style.css';
import { GameEngine } from './engine/GameEngine';
import type { GameConfig, GameResult, ModeAdapter } from './engine/types';
import {
  ClickAndTypeMode,
  FreeTypeMode,
  FlagQuizMode,
  CapitalQuizMode,
} from './modes/adapters';
import { WorldMap, type CountryState } from './map/WorldMap';
import { countries as allCountries } from './data/countries';
import { getEnabledTerritories, buildTerritoryParentMap, buildParentToTerritoryMap } from './data/territories';
import { StartScreen } from './ui/StartScreen';
import { GameHUD } from './ui/GameHUD';
import { ResultScreen } from './ui/ResultScreen';

class App {
  private app: HTMLElement;
  private mapContainer: HTMLElement;
  private worldMap: WorldMap;
  private engine: GameEngine;
  private startScreen: StartScreen | null = null;
  private gameHUD: GameHUD | null = null;
  private resultScreen: ResultScreen | null = null;
  private lastConfig: GameConfig | null = null;
  private lastEnabledTerritoryIds: Set<string> = new Set();
  private parentToTerritoryMap: Map<string, string[]> = new Map();
  private highlightedTerritoryRawIds: Set<string> = new Set();

  constructor() {
    this.app = document.getElementById('app')!;
    this.engine = new GameEngine();

    // Map container (always present behind UI)
    this.mapContainer = document.createElement('div');
    this.mapContainer.className = 'map-container';
    this.app.appendChild(this.mapContainer);

    this.worldMap = new WorldMap(this.mapContainer);
    this.worldMap.load().then(() => {
      this.showStartScreen();
    });
  }

  private showStartScreen(): void {
    this.cleanupGame();
    this.worldMap.resetStates();
    this.worldMap.setActiveCountryIds(null);
    this.worldMap.setGravityCenter(null);
    this.worldMap.resetZoom();

    this.startScreen = new StartScreen(this.app, (config) => {
      const enabledIds = this.startScreen!.getEnabledTerritoryIds();
      this.startGame(config, enabledIds);
    }, (mode) => {
      if (mode === 3) this.preloadAllFlags();
    }, (continent) => {
      this.handleContinentPreview(continent);
    });
  }

  /** Highlight continent on map from start screen selection */
  private handleContinentPreview(continent: string): void {
    const CONTINENT_CENTERS: Record<string, [number, number]> = {
      'Africa': [20, 0],
      'Asia': [90, 30],
      'Europe': [15, 52],
      'North America': [-95, 40],
      'South America': [-60, -15],
      'Oceania': [140, -25],
    };

    if (continent === 'World') {
      this.worldMap.setActiveCountryIds(null);
      this.worldMap.setGravityCenter([10, 20]);
      this.worldMap.resetZoom(600);
    } else {
      const ids = new Set(
        allCountries.filter(c => c.continent === continent).map(c => c.id)
      );
      this.worldMap.setActiveCountryIds(ids);
      this.worldMap.setGravityCenter(CONTINENT_CENTERS[continent] || null);
      this.worldMap.zoomToContinent(continent);
    }
  }

  private startGame(config: GameConfig, enabledTerritoryIds?: Set<string>): void {
    this.lastConfig = config;
    const enabledIds = enabledTerritoryIds || new Set<string>();
    this.lastEnabledTerritoryIds = enabledIds;

    // Hide start screen
    this.startScreen?.dispose();
    this.startScreen = null;

    // Clean up any previous game
    this.cleanupGame();
    this.worldMap.resetStates();
    this.worldMap.resetZoom(300);

    // Create mode adapter
    const adapter = this.createAdapter(config);

    // Set up territory→parent mapping for disabled territories
    const territoryParentMap = buildTerritoryParentMap(enabledIds);
    this.worldMap.setTerritoryParentMap(territoryParentMap);
    this.parentToTerritoryMap = buildParentToTerritoryMap(enabledIds);

    // Set enabled territories on the engine
    const extras = getEnabledTerritories(enabledIds);
    this.engine.setExtraCountries(extras);

    // Pass centroids to engine for geographic nearest-neighbor
    this.engine.setCentroids(this.worldMap.getAllCentroids());

    // Set up map click handler
    const enableMapClick = adapter.requiresMapClick ||
      (config.mode === 5 && config.variant === 'free');
    if (enableMapClick) {
      this.worldMap.setClickHandler((countryId, territoryRawId, isOverseas) => {
        if (this.engine.isRunning) {
          const selected = this.engine.selectCountry(countryId);
          if (selected) {
            this.worldMap.setCountryState(countryId, 'selected');
            // Also highlight the territory feature if clicked on one
            if (territoryRawId) {
              this.worldMap.setCountryState(territoryRawId, 'selected');
              this.highlightedTerritoryRawIds.add(territoryRawId);
            }
            // Unlock input now that a country is selected (mode 1)
            if (config.mode === 1) {
              this.gameHUD?.setInputLocked(false);
            }
            // Restore hint state if this country had hints
            const hint = this.engine.getHintForCountry(countryId);
            this.gameHUD?.restoreHint(hint);
            // Fly to the clicked spot (territory or country)
            if (territoryRawId && territoryRawId !== countryId) {
              // Clicked a separate territory feature → show both territory and parent
              this.worldMap.flyToShowBoth(territoryRawId, countryId, 600);
            } else if (isOverseas) {
              // Clicked overseas part of a multipolygon country (e.g. French Guiana)
              this.worldMap.flyToShowBoth(countryId, countryId, 600);
            } else {
              this.worldMap.flyTo(countryId, 600, true, config.mode === 1 ? {
                preferPanOnly: true,
              } : undefined);
            }
          }
        }
      });
    } else {
      this.worldMap.setClickHandler((countryId, territoryRawId, isOverseas) => {
        // Click-to-fly: clicking a country flies to it even in non-click modes
        if (this.engine.isRunning && (config.mode === 2)) {
          if (isOverseas) {
            this.worldMap.flyToShowBoth(countryId, countryId, 600);
          } else {
            this.worldMap.flyTo(countryId, 600, true);
          }
        }
      });
    }

    // Preload flag images for flag-based modes
    if (config.mode === 3) {
      this.preloadFlags();
    }

    // Create HUD
    this.gameHUD = new GameHUD(this.app, config, {
      onGuess: (input) => this.handleGuess(input),
      onHint: () => this.handleHint(),
      onSkip: () => this.handleSkip(),
      onEnd: () => this.handleEnd(),
      onChoice: (index) => this.handleChoice(index),
      onRevealNearMiss: () => this.handleRevealNearMiss(),
      onZoom: (factor) => this.worldMap.zoomBy(factor),
      onFind: () => this.handleFind(),
    });

    this.gameHUD.setModeLabel(adapter.modeName);

    // Clear previous engine listeners and set up new ones
    this.engine.removeAllListeners();

    // Track question index for score display (flag/capital modes)
    let questionIndex = 0;

    this.engine.on('correct', (event) => {
      const country = event.country!;
      // Flag and Capital modes (3, 5): flash green briefly then revert
      // Point-and-type (1) and Free-type (2): stay green permanently
      if (config.mode === 3 || (config.mode === 5 && config.variant !== 'free')) {
        this.worldMap.setCountryState(country.id, 'correct');
        const childTerritories = this.parentToTerritoryMap.get(country.id);
        if (childTerritories) {
          for (const tid of childTerritories) {
            this.worldMap.setCountryState(tid, 'correct');
          }
        }
        // Flash: revert after a longer delay so user sees it
        setTimeout(() => {
          this.worldMap.setCountryState(country.id, 'default');
          if (childTerritories) {
            for (const tid of childTerritories) {
              this.worldMap.setCountryState(tid, 'default');
            }
          }
        }, 2500);
      } else {
        this.worldMap.setCountryState(country.id, 'correct');
        const childTerritories = this.parentToTerritoryMap.get(country.id);
        if (childTerritories) {
          for (const tid of childTerritories) {
            this.worldMap.setCountryState(tid, 'correct');
          }
        }
      }
      this.gameHUD?.showCorrectToast(country);
      this.gameHUD?.clearInput();

      if (config.mode === 3 || config.mode === 5) {
        questionIndex++;
        this.gameHUD?.updateScoreDetailed(
          this.engine.correctCount,
          questionIndex - this.engine.correctCount,
          this.engine.totalCountries - questionIndex
        );
      } else {
        this.gameHUD?.updateScore(
          this.engine.correctCount,
          this.engine.totalCountries
        );
      }

      // Free Type mode: gently pan toward the country's continent (high-level view)
      if (config.mode === 2) {
        this.worldMap.panToContinent(country.continent, 900);
      }
    });

    this.engine.on('near-miss', (event) => {
      if (event.result?.suggestion) {
        this.gameHUD?.showNearMiss(event.result.suggestion);
      }
    });

    this.engine.on('incorrect', () => {
      this.gameHUD?.shakeInput();
    });

    this.engine.on('skip', () => {
      // Skip moves the question to the back of the queue — don't change score
    });

    this.engine.on('hint', (event) => {
      if (event.hintText) {
        this.gameHUD?.showHint(event.hintText);
      }
    });

    this.engine.on('next', (event) => {
      if (event.prompt) {
        this.gameHUD?.updatePrompt(event.prompt);

        const country = event.prompt.country;
        if (
          country &&
          (event.prompt.type === 'map-highlight' || event.prompt.type === 'click')
        ) {
          // Clear previous selection highlights (keep correct states)
          for (const c of this.engine.remainingCountries) {
            const currentState = this.worldMap.getCountryState(c.id);
            if (currentState === 'selected' || currentState === 'highlighted') {
              this.worldMap.setCountryState(c.id, 'default');
            }
          }
          // Also clear any territory raw ID highlights
          for (const tid of this.highlightedTerritoryRawIds) {
            const currentState = this.worldMap.getCountryState(tid);
            if (currentState === 'selected' || currentState === 'highlighted') {
              this.worldMap.setCountryState(tid, 'default');
            }
          }
          this.highlightedTerritoryRawIds.clear();

          // Mode 1 (click & type): highlight auto-advanced country + fly to it
          if (config.mode === 1) {
            this.worldMap.setCountryState(country.id, 'highlighted');
            this.worldMap.flyTo(country.id, 600, false, {
              preferPanOnly: true,
            });
            this.gameHUD?.setInputLocked(false);
            // Restore hint for this country if it had one
            const hint = this.engine.getHintForCountry(country.id);
            this.gameHUD?.restoreHint(hint);
            return;
          }

          this.worldMap.setCountryState(country.id, 'selected');

          // For capital quiz free mode, fly to the country
          if (config.mode === 5) {
            this.worldMap.flyTo(country.id, 600);
          }
        }

        // For flag/capital quiz sequential modes, restore hints
        if (country && (config.mode === 3 || config.mode === 5)) {
          const hint = this.engine.getHintForCountry(country.id);
          this.gameHUD?.restoreHint(hint);
        }
      }
    });

    this.engine.on('tick', (event) => {
      const seconds = event.timeRemaining || 0;
      // If questionCount is set, timer always counts up (no countdown)
      const isCountdown = config.timeLimit !== null && !config.questionCount;
      this.gameHUD?.updateTimer(seconds, isCountdown);
    });

    this.engine.on('end', (event) => {
      if (event.gameResult) {
        this.showResults(event.gameResult);
      }
    });

    // Start the engine
    this.engine.start(config, adapter);
    if (config.mode === 3 || config.mode === 5) {
      this.gameHUD.updateScoreDetailed(0, 0, this.engine.totalCountries);
    } else {
      this.gameHUD.updateScore(0, this.engine.totalCountries);
    }

    // Mode 1: lock input until a country is selected
    if (config.mode === 1) {
      this.gameHUD.setInputLocked(true);
    }

    // Zoom to continent if specific one selected
    if (config.continent !== 'World') {
      this.worldMap.zoomToContinent(config.continent);
      // Grey out non-active countries — highlight ALL countries in the continent,
      // not just the ones in the quiz pool (so the whole continent is colored)
      const allBase = [...allCountries, ...extras];
      const allContinentIds = new Set(
        allBase.filter(c => c.continent === config.continent).map(c => c.id)
      );
      this.worldMap.setActiveCountryIds(allContinentIds);
      // Set gravity center for this continent
      const CONTINENT_CENTERS: Record<string, [number, number]> = {
        'Africa': [20, 0], 'Asia': [90, 30], 'Europe': [15, 52],
        'North America': [-95, 40], 'South America': [-60, -15], 'Oceania': [140, -25],
      };
      this.worldMap.setGravityCenter(CONTINENT_CENTERS[config.continent] || null);
    } else {
      this.worldMap.setActiveCountryIds(null);
      this.worldMap.setGravityCenter([10, 20]);
    }

    // Initial timer display
    if (config.timeLimit && !config.questionCount) {
      this.gameHUD.updateTimer(config.timeLimit * 60, true);
    } else {
      this.gameHUD.updateTimer(0, false);
    }
  }

  private handleGuess(input: string): void {
    this.engine.submitGuess(input);
  }

  private handleHint(): void {
    this.engine.useHint();
  }

  private handleSkip(): void {
    this.engine.skip();
  }

  private handleEnd(): void {
    this.engine.endGame();
  }

  private handleRevealNearMiss(): void {
    this.engine.revealNearMiss();
  }

  private handleFind(): void {
    const country = this.engine.getRandomUnguessedCountry();
    if (country) {
      // Find button: fly to the country (uses 4-level zoom system)
      this.worldMap.flyTo(country.id, 600, true);
    }
  }

  private handleChoice(index: number): void {
    const prompt = this.engine.getPrompt();
    if (!prompt || !this.gameHUD || !this.lastConfig) return;

    const country = prompt.country;
    if (!country) return;

    // Determine correct answer index
    let correctIdx = -1;
    if (this.lastConfig.variant === 'multiple-choice' && prompt.choices) {
      const correctAnswer =
        this.lastConfig.mode === 5 ? country.capital : country.name;
      correctIdx = prompt.choices.findIndex((c) => c === correctAnswer);
    } else if (this.lastConfig.variant === 'match-flag' && prompt.choiceItems) {
      correctIdx = prompt.choiceItems.findIndex((c) => c.id === country.id);
    }

    const isCorrect = index === correctIdx;

    // Show visual result immediately
    this.gameHUD.showChoiceResult(correctIdx, index);

    // Delay engine processing so user sees the visual feedback first
    const delay = isCorrect ? 800 : 1200;
    setTimeout(() => {
      if (!this.engine.isRunning) return;
      const result = this.engine.submitChoice(index);
      if (result.status !== 'correct') {
        this.engine.skip();
      }
    }, delay);
  }

  private showResults(result: GameResult): void {
    this.gameHUD?.dispose();
    this.gameHUD = null;

    // Clear grey-out
    this.worldMap.setActiveCountryIds(null);

    // Color map: correct = green, missed = faded red (batch to avoid N renders)
    const states = new Map<string, CountryState>();
    result.guessedCountries.forEach((c) => states.set(c.id, 'correct'));
    result.missedCountries.forEach((c) => states.set(c.id, 'missed'));
    this.worldMap.batchSetCountryStates(states);
    this.worldMap.resetZoom(500);

    this.resultScreen = new ResultScreen(this.app, result, {
      onPlayAgain: () => {
        this.resultScreen?.dispose();
        this.resultScreen = null;
        if (this.lastConfig) {
          this.startGame(this.lastConfig, this.lastEnabledTerritoryIds);
        }
      },
      onChangeMode: () => {
        this.resultScreen?.dispose();
        this.resultScreen = null;
        this.showStartScreen();
      },
    });
  }

  private cleanupGame(): void {
    this.gameHUD?.dispose();
    this.gameHUD = null;
    this.resultScreen?.dispose();
    this.resultScreen = null;
  }

  private createAdapter(config: GameConfig): ModeAdapter {
    switch (config.mode) {
      case 1:
        return new ClickAndTypeMode();
      case 2:
        return new FreeTypeMode();
      case 3:
        return new FlagQuizMode(config.variant);
      case 5:
        return new CapitalQuizMode(config.variant);
      default:
        return new ClickAndTypeMode();
    }
  }

  /**
   * Preload flag SVGs so they appear instantly during the quiz.
   */
  private preloadFlags(): void {
    const pool = this.engine.remainingCountries;
    for (const country of pool) {
      const img = new Image();
      img.src = `${import.meta.env.BASE_URL}flags/${country.alpha2}.svg`;
    }
  }

  /**
   * Preload all flag SVGs (called when user selects flag mode, before game starts).
   */
  private preloadAllFlags(): void {
    for (const country of allCountries) {
      const img = new Image();
      img.src = `${import.meta.env.BASE_URL}flags/${country.alpha2}.svg`;
    }
  }
}

// Boot
new App();
