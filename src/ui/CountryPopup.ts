export class CountryPopup {
  private el: HTMLElement;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'country-popup';

    const img = document.createElement('img');
    img.alt = '';
    const name = document.createElement('span');
    name.className = 'popup-name';

    this.el.appendChild(img);
    this.el.appendChild(name);
    container.appendChild(this.el);
  }

  /**
   * Show a transient popup for a correct answer (auto-dismiss after duration).
   */
  showCorrect(countryName: string, alpha2: string, duration = 2000): void {
    this.show(countryName, alpha2);
    this.clearTimer();
    this.timer = setTimeout(() => this.hide(), duration);
  }

  /**
   * Show a persistent popup for re-clicking a completed country.
   */
  showPersistent(countryName: string, alpha2: string): void {
    this.show(countryName, alpha2);
    this.clearTimer();
  }

  private show(countryName: string, alpha2: string): void {
    const img = this.el.querySelector('img')!;
    // Hide until new flag loads to avoid flash of old/wrong image
    img.style.opacity = '0';
    img.onload = () => { img.style.opacity = '1'; };
    img.onerror = () => { img.style.opacity = '1'; };
    img.src = `./flags/${alpha2}.svg`;
    img.alt = countryName;

    const name = this.el.querySelector('.popup-name')!;
    name.textContent = countryName;

    this.el.classList.add('visible');
  }

  hide(): void {
    this.el.classList.remove('visible');
    this.clearTimer();
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  destroy(): void {
    this.clearTimer();
    this.el.remove();
  }
}
