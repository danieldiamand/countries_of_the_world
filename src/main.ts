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

    // Set up map click handler for modes that need it
    const enableMapClick = adapter.requiresMapClick ||
      (config.mode === 5 && config.variant === 'free');
    if (enableMapClick) {
      this.worldMap.setClickHandler((countryId) => {
        if (this.engine.isRunning) {
          const selected = this.engine.selectCountry(countryId);
          if (selected) {
            this.worldMap.setCountryState(countryId, 'selected');
          }
        }
      });
    } else {
      this.worldMap.setClickHandler(() => {}); // no-op
    }

    // Create HUD
    this.gameHUD = new GameHUD(this.app, config, {
      onGuess: (input) => this.handleGuess(input),
      onHint: () => this.handleHint(),
      onSkip: () => this.handleSkip(),
      onEnd: () => this.handleEnd(),
      onChoice: (index) => this.handleChoice(index),
    });

    this.gameHUD.setModeLabel(adapter.modeName);

    // Clear previous engine listeners and set up new ones
    this.engine.removeAllListeners();

    this.engine.on('correct', (event) => {
      const country = event.country!;
      this.worldMap.setCountryState(country.id, 'correct');
      this.gameHUD?.showCorrectToast(country);
      this.gameHUD?.clearInput();
      this.gameHUD?.updateScore(
        this.engine.correctCount,
        this.engine.totalCountries
      );

      // Fly to country for Free Type mode
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

        // Handle map highlighting
        const country = event.prompt.country;
        if (
          country &&
          (event.prompt.type === 'map-highlight' || event.prompt.type === 'click')
        ) {
          // Clear previous selection highlight (keep correct states)
          for (const c of this.engine.remainingCountries) {
            const currentState = this.worldMap.getCountryState(c.id);
            if (currentState === 'selected' || currentState === 'highlighted') {
              this.worldMap.setCountryState(c.id, 'default');
            }
          }

          // For Mode 1 (click & type): don't pre-select, let user click
          if (config.mode === 1) {
            // Don't highlight or fly to any country — user picks
            return;
          }

          this.worldMap.setCountryState(country.id, 'selected');

          // For modes that auto-show the country, fly to it
          if (config.mode === 5) {
            this.worldMap.flyTo(country.id, 600);
          }
        }
      }
    });

    this.engine.on('tick', (event) => {
      this.gameHUD?.updateTimer(
        event.timeRemaining || 0,
        config.timeLimit !== null
      );
    });

    this.engine.on('end', (event) => {
      if (event.gameResult) {
        this.showResults(event.gameResult);
      }
    });

    // Start the engine
    this.engine.start(config, adapter);
    this.gameHUD.updateScore(0, this.engine.totalCountries);
    this.gameHUD.updateTimer(
      config.timeLimit ? config.timeLimit * 60 : 0,
      config.timeLimit !== null
    );
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
}

// Boot
new App();
