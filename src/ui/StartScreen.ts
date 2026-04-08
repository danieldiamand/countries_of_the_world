import { continents } from '../data/countries';
import type { GameConfig, GameMode, QuizVariant, TimeLimit } from '../engine/types';

export class StartScreen {
  private container: HTMLElement;
  private onStart: (config: GameConfig) => void;
  private selectedMode: GameMode = 1;
  private selectedContinent: string = 'World';
  private selectedTime: TimeLimit = null;
  private selectedVariant: QuizVariant = 'free';

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
    const modes: { id: GameMode; name: string; desc: string }[] = [
      {
        id: 1,
        name: 'Click & Type',
        desc: 'Click a country on the map, type its name',
      },
      {
        id: 2,
        name: 'Free Type',
        desc: 'Type any country name — no clicking needed',
      },
      {
        id: 3,
        name: 'Flag Quiz',
        desc: 'See a flag, name the country',
      },
      {
        id: 4,
        name: 'Country Quiz',
        desc: 'See a highlighted country, name it',
      },
      {
        id: 5,
        name: 'Capital Quiz',
        desc: 'See a country name, type its capital',
      },
    ];

    this.container.innerHTML = `
      <h1>Countries of the World</h1>
      <p class="subtitle">Test your geography knowledge</p>

      <div class="section-label">Game Mode</div>
      <div class="mode-grid">
        ${modes
          .map(
            (m) => `
          <div class="mode-card ${m.id === this.selectedMode ? 'active' : ''}" data-mode="${m.id}">
            <span class="mode-number">Mode ${m.id}</span>
            <span class="mode-name">${m.name}</span>
            <span class="mode-desc">${m.desc}</span>
          </div>
        `
          )
          .join('')}
      </div>

      <div class="section-label">Region</div>
      <div class="pill-group" id="continent-group">
        <button class="pill ${this.selectedContinent === 'World' ? 'active' : ''}" data-continent="World">World</button>
        ${continents
          .map(
            (c) =>
              `<button class="pill ${this.selectedContinent === c ? 'active' : ''}" data-continent="${c}">${c}</button>`
          )
          .join('')}
      </div>

      <div class="section-label">Time Limit</div>
      <div class="pill-group" id="time-group">
        <button class="pill ${this.selectedTime === 15 ? 'active' : ''}" data-time="15">15 min</button>
        <button class="pill ${this.selectedTime === 30 ? 'active' : ''}" data-time="30">30 min</button>
        <button class="pill ${this.selectedTime === null ? 'active' : ''}" data-time="null">Unlimited</button>
      </div>

      <div id="variant-section" style="display: ${this.selectedMode >= 3 ? 'block' : 'none'}">
        <div class="section-label">Quiz Style</div>
        <div class="pill-group" id="variant-group">
          <button class="pill ${this.selectedVariant === 'free' ? 'active' : ''}" data-variant="free">Type Answer</button>
          <button class="pill ${this.selectedVariant === 'choice' ? 'active' : ''}" data-variant="choice">Pick from 3</button>
          <button class="pill ${this.selectedVariant === 'reverse' ? 'active' : ''}" data-variant="reverse">Reverse Match</button>
        </div>
      </div>

      <button class="start-btn" id="start-btn">Start Game</button>
    `;

    // Bind events
    this.container.querySelectorAll('.mode-card').forEach((card) => {
      card.addEventListener('click', () => {
        this.selectedMode = parseInt(
          card.getAttribute('data-mode')!
        ) as GameMode;
        this.render();
      });
    });

    this.container
      .querySelectorAll('#continent-group .pill')
      .forEach((btn) => {
        btn.addEventListener('click', () => {
          this.selectedContinent = btn.getAttribute('data-continent')!;
          this.render();
        });
      });

    this.container
      .querySelectorAll('#time-group .pill')
      .forEach((btn) => {
        btn.addEventListener('click', () => {
          const val = btn.getAttribute('data-time')!;
          this.selectedTime =
            val === 'null' ? null : (parseInt(val) as TimeLimit);
          this.render();
        });
      });

    this.container
      .querySelectorAll('#variant-group .pill')
      .forEach((btn) => {
        btn.addEventListener('click', () => {
          this.selectedVariant = btn.getAttribute(
            'data-variant'
          )! as QuizVariant;
          this.render();
        });
      });

    this.container
      .querySelector('#start-btn')!
      .addEventListener('click', () => {
        this.onStart({
          mode: this.selectedMode,
          continent: this.selectedContinent,
          timeLimit: this.selectedTime,
          variant: this.selectedVariant,
        });
      });
  }

  dispose(): void {
    this.container.remove();
  }
}
