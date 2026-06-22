import * as d3 from 'd3';
import type { Feature, Geometry } from 'geojson';
import { GLOBE_COLORS } from './Globe';

/**
 * Renders a single country's geometry as a flat silhouette into its own canvas,
 * using a Mercator projection fitted to the feature. Used for "guess the
 * outline" quiz prompts and small outline thumbnails in multiple-choice options.
 */
export class CountryShape {
  readonly element: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr = window.devicePixelRatio || 1;

  constructor() {
    this.element = document.createElement('canvas');
    this.ctx = this.element.getContext('2d')!;
  }

  /** Render `feature` filling a `size`×`size` CSS-pixel box. */
  render(feature: Feature<Geometry>, size: number, padding = 0.12): void {
    const px = size * this.dpr;
    this.element.width = px;
    this.element.height = px;
    this.element.style.width = `${size}px`;
    this.element.style.height = `${size}px`;

    const ctx = this.ctx;
    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    ctx.clearRect(0, 0, size, size);

    const pad = size * padding;
    const projection = d3.geoMercator().fitExtent(
      [[pad, pad], [size - pad, size - pad]],
      feature,
    );
    const path = d3.geoPath(projection, ctx);

    ctx.beginPath();
    path(feature);
    ctx.fillStyle = GLOBE_COLORS.land;
    ctx.fill();
    ctx.strokeStyle = GLOBE_COLORS.border;
    ctx.lineWidth = 1.25;
    ctx.lineJoin = 'round';
    ctx.stroke();

    ctx.restore();
  }
}
