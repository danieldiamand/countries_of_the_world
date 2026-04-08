import type { Country } from '../data/countries';
import type { GameResult } from '../engine/types';

export class ResultScreen {
  private container: HTMLElement;
  private onPlayAgain: () => void;
  private onChangeMode: () => void;

  constructor(
    parent: HTMLElement,
    result: GameResult,
    callbacks: {
      onPlayAgain: () => void;
      onChangeMode: () => void;
    }
  ) {
    this.onPlayAgain = callbacks.onPlayAgain;
    this.onChangeMode = callbacks.onChangeMode;

    this.container = document.createElement('div');
    this.container.className = 'screen results-screen';
    parent.appendChild(this.container);
    this.render(result);
  }

  private render(result: GameResult): void {
    const pct = result.total > 0
      ? Math.round((result.correct / result.total) * 100)
      : 0;

    const min = Math.floor(result.timeTaken / 60);
    const sec = result.timeTaken % 60;
    const timeStr = `${min}:${sec.toString().padStart(2, '0')}`;

    let missedHTML = '';
    if (result.missedCountries.length > 0) {
      const items = result.missedCountries
        .slice(0, 50) // limit display
        .map(
          (c: Country) =>
            `<div class="missed-item">
              <img src="/flags/${c.alpha2}.svg" alt="${c.name}">
              <span>${c.name}</span>
              <span style="color: var(--color-text-muted); margin-left: auto; font-size: 0.8rem;">${c.capital}</span>
            </div>`
        )
        .join('');

      missedHTML = `
        <div class="missed-list">
          <h3>Missed Countries (${result.missedCountries.length})</h3>
          ${items}
        </div>
      `;
    }

    const heading = pct === 100 ? 'Perfect' : pct >= 80 ? 'Great job' : pct >= 50 ? 'Good effort' : 'Keep practicing';

    this.container.innerHTML = `
      <div class="results-card">
        <h2>${heading}</h2>
        
        <div class="stats-grid">
          <div class="stat-item">
            <div class="stat-value">${result.correct}/${result.total}</div>
            <div class="stat-label">Countries</div>
          </div>
          <div class="stat-item">
            <div class="stat-value">${pct}%</div>
            <div class="stat-label">Accuracy</div>
          </div>
          <div class="stat-item">
            <div class="stat-value">${timeStr}</div>
            <div class="stat-label">Time</div>
          </div>
          <div class="stat-item">
            <div class="stat-value hint-color">${result.hintsUsed}</div>
            <div class="stat-label">Hints used</div>
          </div>
        </div>

        ${missedHTML}

        <div class="results-actions">
          <button class="btn-primary" id="play-again">Play again</button>
          <button class="btn-secondary" id="change-mode">Change game</button>
        </div>
      </div>
    `;

    this.container
      .querySelector('#play-again')!
      .addEventListener('click', this.onPlayAgain);
    this.container
      .querySelector('#change-mode')!
      .addEventListener('click', this.onChangeMode);
  }

  dispose(): void {
    this.container.remove();
  }
}
