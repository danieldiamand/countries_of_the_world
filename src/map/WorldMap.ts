import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { FeatureCollection, Feature, Geometry } from 'geojson';
import { countryById, type Country } from '../data/countries';

export interface CountryFeature extends Feature<Geometry> {
  id?: string;
  properties: {
    name: string;
  };
}

export type CountryState = 'default' | 'correct' | 'hinted' | 'selected' | 'highlighted' | 'missed';

export const MAP_COLORS = {
  ocean: '#FFFFFF',
  land: '#E8E0D8',
  border: '#C8BFB4',
  correct: '#5B8A72',
  hinted: '#C4956A',
  selected: '#7BA7C9',
  highlighted: '#B8D4E8',
  hover: '#DDD6CE',
  missed: '#D4878F',
  text: '#4A4340',
};

export class WorldMap {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private projection!: d3.GeoProjection;
  private path!: d3.GeoPath;
  private features: CountryFeature[] = [];
  private landFeature: Feature<Geometry> | null = null;
  private countryStates: Map<string, CountryState> = new Map();
  private hoveredId: string | null = null;
  private zoom!: d3.ZoomBehavior<HTMLCanvasElement, unknown>;
  private currentTransform: d3.ZoomTransform = d3.zoomIdentity;
  private onCountryClick: ((countryId: string) => void) | null = null;
  private onCountryHover: ((countryId: string | null) => void) | null = null;
  private loaded: boolean = false;
  private width: number = 0;
  private height: number = 0;

  constructor(container: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'world-map-canvas';
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;

    this.setupSize();
    this.setupProjection();
    this.setupZoom();
    this.setupInteractions();

    // Resize observer
    const ro = new ResizeObserver(() => {
      this.setupSize();
      this.setupProjection();
      this.render();
    });
    ro.observe(container);
  }

  private setupSize(): void {
    const dpr = window.devicePixelRatio || 1;
    this.width = this.canvas.parentElement?.clientWidth || window.innerWidth;
    this.height = this.canvas.parentElement?.clientHeight || window.innerHeight;
    this.canvas.width = this.width * dpr;
    this.canvas.height = this.height * dpr;
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private setupProjection(): void {
    this.projection = d3
      .geoNaturalEarth1()
      .fitSize([this.width, this.height], { type: 'Sphere' } as any)
      .precision(0.1);

    this.path = d3.geoPath().projection(this.projection);
  }

  private setupZoom(): void {
    this.zoom = d3
      .zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([1, 12])
      .on('zoom', (event: d3.D3ZoomEvent<HTMLCanvasElement, unknown>) => {
        this.currentTransform = event.transform;
        this.render();
      });

    d3.select(this.canvas).call(this.zoom);
    // Prevent page scroll when over map
    this.canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
      },
      { passive: false }
    );
  }

  private setupInteractions(): void {
    this.canvas.addEventListener('mousemove', (e) => {
      const country = this.hitTest(e.offsetX, e.offsetY);
      const newId = country?.id?.toString() || null;
      if (newId !== this.hoveredId) {
        this.hoveredId = newId;
        this.canvas.style.cursor = newId ? 'pointer' : 'default';
        this.onCountryHover?.(newId);
        this.render();
      }
    });

    this.canvas.addEventListener('click', (e) => {
      const country = this.hitTest(e.offsetX, e.offsetY);
      if (country?.id) {
        this.onCountryClick?.(country.id.toString());
      }
    });

    // Touch support for click
    let touchStart: { x: number; y: number } | null = null;
    this.canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        const touch = e.touches[0];
        touchStart = { x: touch.clientX, y: touch.clientY };
      }
    });

    this.canvas.addEventListener('touchend', (e) => {
      if (touchStart && e.changedTouches.length === 1) {
        const touch = e.changedTouches[0];
        const dx = touch.clientX - touchStart.x;
        const dy = touch.clientY - touchStart.y;
        // Only treat as click if didn't move much
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
          const rect = this.canvas.getBoundingClientRect();
          const x = touch.clientX - rect.left;
          const y = touch.clientY - rect.top;
          const country = this.hitTest(x, y);
          if (country?.id) {
            this.onCountryClick?.(country.id.toString());
          }
        }
        touchStart = null;
      }
    });
  }

  private hitTest(px: number, py: number): CountryFeature | null {
    // Invert the zoom transform then the projection
    const [tx, ty] = this.currentTransform.invert([px, py]);
    const coords = this.projection.invert?.([tx, ty]);
    if (!coords) return null;

    for (const feature of this.features) {
      if (d3.geoContains(feature as any, coords)) {
        return feature;
      }
    }
    return null;
  }

  async load(): Promise<void> {
    const response = await fetch('/data/world-50m.json');
    const topology = (await response.json()) as Topology;

    const countriesGeo = topojson.feature(
      topology,
      topology.objects.countries as GeometryCollection
    ) as unknown as FeatureCollection;

    this.features = countriesGeo.features as CountryFeature[];
    // Store the combined land for rendering borders
    this.landFeature = topojson.merge(
      topology,
      (topology.objects.countries as any).geometries
    ) as unknown as Feature<Geometry>;

    this.loaded = true;
    this.render();
  }

  setClickHandler(handler: (countryId: string) => void): void {
    this.onCountryClick = handler;
  }

  setHoverHandler(handler: (countryId: string | null) => void): void {
    this.onCountryHover = handler;
  }

  setCountryState(countryId: string, state: CountryState): void {
    this.countryStates.set(countryId, state);
    this.render();
  }

  resetStates(): void {
    this.countryStates.clear();
    this.render();
  }

  getCountryForFeature(feature: CountryFeature): Country | undefined {
    if (!feature.id) return undefined;
    return countryById.get(feature.id.toString());
  }

  /**
   * Fly to a specific country with animation.
   */
  flyTo(countryId: string, duration: number = 750): void {
    const feature = this.features.find(
      (f) => f.id?.toString() === countryId
    );
    if (!feature || !this.path) return;

    // Compute the bounding box of the country in projected coordinates
    const bounds = this.path.bounds(feature as any);
    if (!bounds) return;

    const [[x0, y0], [x1, y1]] = bounds;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;

    // Calculate appropriate zoom level
    const scale = Math.min(
      8,
      Math.max(
        1.5,
        0.8 / Math.max(dx / this.width, dy / this.height)
      )
    );

    const transform = d3.zoomIdentity
      .translate(this.width / 2, this.height / 2)
      .scale(scale)
      .translate(-cx, -cy);

    d3.select(this.canvas)
      .transition()
      .duration(duration)
      .call(this.zoom.transform as any, transform);
  }

  /**
   * Reset the zoom to show the full world.
   */
  resetZoom(duration: number = 500): void {
    d3.select(this.canvas)
      .transition()
      .duration(duration)
      .call(this.zoom.transform as any, d3.zoomIdentity);
  }

  render(): void {
    if (!this.loaded) return;
    const ctx = this.ctx;
    const { width, height } = this;

    ctx.save();
    ctx.clearRect(0, 0, width, height);

    // Apply zoom transform
    ctx.translate(this.currentTransform.x, this.currentTransform.y);
    ctx.scale(this.currentTransform.k, this.currentTransform.k);

    const pathGen = d3.geoPath().projection(this.projection).context(ctx);

    // Draw each country
    for (const feature of this.features) {
      const id = feature.id?.toString() || '';
      const state = this.countryStates.get(id) || 'default';
      const isHovered = this.hoveredId === id;

      ctx.beginPath();
      pathGen(feature as any);

      // Fill color based on state
      if (state === 'correct') {
        ctx.fillStyle = MAP_COLORS.correct;
      } else if (state === 'hinted') {
        ctx.fillStyle = MAP_COLORS.hinted;
      } else if (state === 'selected') {
        ctx.fillStyle = MAP_COLORS.selected;
      } else if (state === 'highlighted') {
        ctx.fillStyle = MAP_COLORS.highlighted;
      } else if (state === 'missed') {
        ctx.fillStyle = MAP_COLORS.missed;
      } else if (isHovered) {
        ctx.fillStyle = MAP_COLORS.hover;
      } else {
        ctx.fillStyle = MAP_COLORS.land;
      }
      ctx.fill();

      // Border
      ctx.strokeStyle = MAP_COLORS.border;
      ctx.lineWidth = 0.5 / this.currentTransform.k;
      ctx.stroke();
    }

    ctx.restore();
  }

  dispose(): void {
    d3.select(this.canvas).on('.zoom', null);
    this.canvas.remove();
  }
}
