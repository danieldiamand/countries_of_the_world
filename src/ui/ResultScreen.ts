import type { GameResult } from '../engine/types';

export interface ResultScreenCallbacks {
  onReplay: () => void;
  onHome: () => void;
}

export class ResultScreen {
  private el: HTMLElement;

  constructor(result: GameResult, callbacks: ResultScreenCallbacks) {
    this.el = document.createElement('div');
    this.el.className = 'result-screen';

    const panel = document.createElement('div');
    panel.className = 'result-panel';

    // Header bar (matches territory modal style)
    const header = document.createElement('div');
    header.className = 'result-panel-header';
    const pct = result.total > 0 ? (result.correct / result.total) * 100 : 0;
    const heading = document.createElement('h2');
    if (pct === 100) heading.textContent = 'Perfect!';
    else if (pct >= 80) heading.textContent = 'Great job!';
    else if (pct >= 50) heading.textContent = 'Good effort!';
    else heading.textContent = 'Keep practicing!';
    header.appendChild(heading);
    panel.appendChild(header);

    // Stats grid
    const stats = document.createElement('div');
    stats.className = 'stats-grid';

    const accuracy = result.total > 0 ? Math.round((result.correct / result.total) * 100) : 0;
    const min = Math.floor(result.timeTaken / 60);
    const sec = result.timeTaken % 60;
    const timeStr = `${min}:${sec.toString().padStart(2, '0')}`;

    const statItems = [
      { value: `${result.correct} / ${result.total}`, label: 'Countries' },
      { value: `${accuracy}%`, label: 'Accuracy' },
      { value: timeStr, label: 'Time' },
      { value: `${result.hintsUsed}`, label: 'Hints Used' },
    ];

    for (const item of statItems) {
      const div = document.createElement('div');
      div.className = 'stat-item';
      const val = document.createElement('div');
      val.className = 'stat-value';
      val.textContent = item.value;
      const lbl = document.createElement('div');
      lbl.className = 'stat-label';
      lbl.textContent = item.label;
      div.appendChild(val);
      div.appendChild(lbl);
      stats.appendChild(div);
    }
    panel.appendChild(stats);

    // Lists
    const listsContainer = document.createElement('div');
    listsContainer.className = 'result-lists';

    if (result.guessedCountries.length > 0) {
      const correctList = this.buildList('Correct', result.guessedCountries, 'correct');
      listsContainer.appendChild(correctList);
    }

    if (result.missedCountries.length > 0) {
      const missedList = this.buildList('Missed', result.missedCountries, 'missed');
      listsContainer.appendChild(missedList);
    }

    panel.appendChild(listsContainer);

    // Actions
    const actions = document.createElement('div');
    actions.className = 'result-actions';

    const replayBtn = document.createElement('button');
    replayBtn.className = 'btn-replay';
    replayBtn.textContent = 'Play Again';
    replayBtn.type = 'button';
    replayBtn.addEventListener('click', () => callbacks.onReplay());

    const homeBtn = document.createElement('button');
    homeBtn.className = 'btn-home';
    homeBtn.textContent = 'Home';
    homeBtn.type = 'button';
    homeBtn.addEventListener('click', () => callbacks.onHome());

    actions.appendChild(replayBtn);
    actions.appendChild(homeBtn);
    panel.appendChild(actions);

    this.el.appendChild(panel);
  }

  private buildList(title: string, countries: { name: string; alpha2: string }[], className: string): HTMLElement {
    const div = document.createElement('div');
    div.className = `result-list ${className}`;

    const h3 = document.createElement('h3');
    h3.textContent = `${title} (${countries.length})`;
    div.appendChild(h3);

    const ul = document.createElement('ul');
    for (const c of countries) {
      const li = document.createElement('li');
      const img = document.createElement('img');
      img.src = `./flags/${c.alpha2}.svg`;
      img.alt = c.name;
      const span = document.createElement('span');
      span.textContent = c.name;
      li.appendChild(img);
      li.appendChild(span);
      ul.appendChild(li);
    }
    div.appendChild(ul);
    return div;
  }

  get element(): HTMLElement {
    return this.el;
  }

  destroy(): void {
    this.el.remove();
  }
}
