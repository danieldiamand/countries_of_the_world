import './style.css';
import { GameEngine } from './engine/GameEngine';
import type { GameConfig, GameResult, ModeAdapter } from './engine/types';
import {
  ClickAndTypeMode,
  FreeTypeMode,
  FlagQuizMode,
  CapitalQuizMode,
} from './modes/adapters';
import { WorldMap } from './map/WorldMap';
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
    this.worldMap.resetZoom();

    this.startScreen = new StartScreen(this.app, (config) => {
      this.startGame(config);
    });
  }

  private startGame(config: GameConfig): void {
    this.lastConfig = config;

    // Hide start screen
    this.startScreen?.dispose();
    this.startScreen = null;

    // Clean up any previous game
    this.cleanupGame();
    this.worldMap.resetStates();
    this.worldMap.resetZoom(300);

    // Create mode adapter
    const adapter = this.createAdapter(config);

    // Pass centroids to engine for geographic nearest-neighbor
    this.engine.setCentroids(this.worldMap.getAllCentroids());

    // Set up map click handler
    const enableMapClick = adapter.requiresMapClick ||
      (config.mode === 5 && config.variant === 'free');
    if (enableMapClick) {
      this.worldMap.setClickHandler((countryId) => {
        if (this.engine.isRunning) {
          const selected = this.engine.selectCountry(countryId);
          if (selected) {
            this.worldMap.setCountryState(countryId, 'selected');
            // Restore hint state if this country had hints
            const hint = this.engine.getHintForCountry(countryId);
            this.gameHUD?.restoreHint(hint);
            // Fly to the clicked country
            this.worldMap.flyTo(countryId, 600);
          }
        }
      });
    } else {
      this.worldMap.setClickHandler((countryId) => {
        // Click-to-fly: clicking a country flies to it even in non-click modes
        if (this.engine.isRunning && (config.mode === 2)) {
          this.worldMap.flyTo(countryId, 600);
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
    });

    this.gameHUD.setModeLabel(adapter.modeName);

    // Clear previous engine listeners and set up new ones
    this.engine.removeAllListeners();

    this.engine.on('correct', (event) => {
      const country = event.country!;
      // Don't color countries on the map for Flag Quiz (shows answers)
      if (config.mode !== 3) {
        this.worldMap.setCountryState(country.id, 'correct');
      }
      this.gameHUD?.showCorrectToast(country);
      this.gameHUD?.clearInput();
      this.gameHUD?.updateScore(
        this.engine.correctCount,
        this.engine.totalCountries
      );

      // Fly to country for Free Type mode (so user sees which one they got)
      if (config.mode === 2) {
        this.worldMap.flyTo(country.id, 600);
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

          // Mode 1 (click & type): highlight auto-advanced country + fly to it
          if (config.mode === 1) {
            this.worldMap.setCountryState(country.id, 'highlighted');
            this.worldMap.flyTo(country.id, 600);
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
    this.gameHUD.updateScore(0, this.engine.totalCountries);

    // Zoom to continent if specific one selected
    if (config.continent !== 'World') {
      this.worldMap.zoomToContinent(config.continent);
      // Grey out non-active countries
      const activeIds = new Set(this.engine.remainingCountries.map(c => c.id));
      this.worldMap.setActiveCountryIds(activeIds);
    } else {
      this.worldMap.setActiveCountryIds(null);
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

  private handleChoice(index: number): void {
    const prompt = this.engine.getPrompt();
    const result = this.engine.submitChoice(index);

    if (prompt && this.gameHUD) {
      if (prompt.choices) {
        const country = prompt.country;
        if (country) {
          const correctAnswer =
            this.lastConfig?.mode === 5 ? country.capital : country.name;
          const correctIdx = prompt.choices.findIndex(
            (c) => c === correctAnswer
          );
          this.gameHUD.showChoiceResult(correctIdx, index);
        }
      } else if (prompt.choiceItems) {
        const correctIdx = prompt.choiceItems.findIndex(
          (c) => c.id === prompt.country?.id
        );
        this.gameHUD.showChoiceResult(correctIdx, index);
      }

      // Auto-advance after brief delay on wrong choice
      if (result.status !== 'correct') {
        setTimeout(() => {
          this.engine.skip();
        }, 1200);
      }
    }
  }

  private showResults(result: GameResult): void {
    this.gameHUD?.dispose();
    this.gameHUD = null;

    // Clear grey-out
    this.worldMap.setActiveCountryIds(null);

    // Color map: correct = green, missed = faded red
    result.guessedCountries.forEach((c) => {
      this.worldMap.setCountryState(c.id, 'correct');
    });
    result.missedCountries.forEach((c) => {
      this.worldMap.setCountryState(c.id, 'missed');
    });
    this.worldMap.resetZoom(500);

    this.resultScreen = new ResultScreen(this.app, result, {
      onPlayAgain: () => {
        this.resultScreen?.dispose();
        this.resultScreen = null;
        if (this.lastConfig) {
          this.startGame(this.lastConfig);
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
      img.src = `/flags/${country.alpha2}.svg`;
    }
  }
}

// Boot
new App();
