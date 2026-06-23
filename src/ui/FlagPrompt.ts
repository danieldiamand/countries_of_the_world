export type FlagPromptVariant = 'type' | 'click';

/**
 * Flag prompt for Flag mode.
 *  - 'type':  a large flag centred over a dim backdrop (globe hidden) — the
 *             player types the country name in the normal HUD answer box.
 *  - 'click': a compact flag panel in the corner — the globe stays visible and
 *             clickable so the player can find the country.
 */
export class FlagPrompt {
  private el: HTMLElement;
  private img: HTMLImageElement;
  private caption: HTMLElement;

  constructor(container: HTMLElement, variant: FlagPromptVariant) {
    this.el = document.createElement('div');
    this.el.className = `flag-prompt ${variant}`;

    const card = document.createElement('div');
    card.className = 'flag-prompt-card';

    this.img = document.createElement('img');
    this.img.className = 'flag-prompt-img';
    this.img.alt = '';

    this.caption = document.createElement('div');
    this.caption.className = 'flag-prompt-caption';
    this.caption.textContent = variant === 'click'
      ? 'Find this country'
      : 'Name this country';

    card.appendChild(this.img);
    card.appendChild(this.caption);
    this.el.appendChild(card);
    container.appendChild(this.el);
  }

  /** Show the flag for a country. `name` is only used for alt text (never the caption). */
  setFlag(alpha2: string, name = ''): void {
    // Hide until the new flag loads to avoid a flash of the previous one.
    this.img.style.opacity = '0';
    this.img.onload = () => { this.img.style.opacity = '1'; };
    this.img.onerror = () => { this.img.style.opacity = '1'; };
    this.img.src = `./flags/${alpha2}.svg`;
    this.img.alt = name;
    this.el.classList.add('visible');
  }

  /** Dim the prompt while the game is paused (so the pause overlay reads clean). */
  setPaused(paused: boolean): void {
    this.el.classList.toggle('paused', paused);
  }

  /** Brief red flash when the wrong country is clicked (click variant). */
  private wrongTimer: ReturnType<typeof setTimeout> | null = null;
  flashWrong(): void {
    this.el.classList.add('wrong');
    if (this.wrongTimer) clearTimeout(this.wrongTimer);
    this.wrongTimer = setTimeout(() => this.el.classList.remove('wrong'), 350);
  }

  hide(): void {
    this.el.classList.remove('visible');
  }

  destroy(): void {
    this.el.remove();
  }
}
