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
  private activeTransition: d3.Transition<HTMLCanvasElement, unknown, null, undefined> | null = null;

  // Cached centroids in projected [x, y] coords
  private centroids: Map<string, [number, number]> = new Map();

  // Active country IDs (for greying out non-active countries)
  private activeCountryIds: Set<string> | null = null;

  constructor(container: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'world-map-canvas';
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;

    this.setupSize();
    this.setupProjection();
    this.setupZoom();
    this.setupInteractions();

    const ro = new ResizeObserver(() => {
      this.setupSize();
      this.setupProjection();
      this.computeCentroids();
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
    this.canvas.addEventListener('wheel', (e) => { e.preventDefault(); }, { passive: false });
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
    const [tx, ty] = this.currentTransform.invert([px, py]);
    const coords = this.projection.invert?.([tx, ty]);
    if (!coords) return null;
    for (const feature of this.features) {
      if (d3.geoContains(feature as any, coords)) return feature;
    }
    return null;
  }

  private computeCentroids(): void {
    this.centroids.clear();

    // Countries with overseas territories whose map centroids would be misleading.
    // We override with approximate lon/lat of the metropolitan territory, then project.
    const CENTROID_OVERRIDES: Record<string, [number, number]> = {
      '250': [2.5, 46.5],   // France → metropolitan France, not French Guiana
      '840': [-98, 39],     // USA → contiguous US, not pulled by Alaska/Hawaii
      '528': [5.5, 52.3],   // Netherlands → European Netherlands
      '643': [40, 56],      // Russia → Moscow area, not middle of Siberia
      '124': [-96, 56],     // Canada → southern populated area
      '156': [104, 35],     // China → central China
    };

    for (const feature of this.features) {
      if (!feature.id) continue;
      const id = feature.id.toString();

      const override = CENTROID_OVERRIDES[id];
      if (override) {
        const projected = this.projection(override);
        if (projected) {
          this.centroids.set(id, [projected[0], projected[1]]);
          continue;
        }
      }

      const bounds = this.path.bounds(feature as any);
      if (!bounds) continue;
      const [[x0, y0], [x1, y1]] = bounds;
      this.centroids.set(id, [(x0 + x1) / 2, (y0 + y1) / 2]);
    }
  }

  async load(): Promise<void> {
    const response = await fetch('/data/world-50m.json');
    const topology = (await response.json()) as Topology;

    const countriesGeo = topojson.feature(
      topology,
      topology.objects.countries as GeometryCollection
    ) as unknown as FeatureCollection;

    this.features = countriesGeo.features as CountryFeature[];

    const nameToId: Record<string, string> = {
      'Kosovo': '-1',
      'Somaliland': '-2',
      'N. Cyprus': '-3',
    };
    for (const feature of this.features) {
      if (!feature.id && feature.properties?.name) {
        const syntheticId = nameToId[feature.properties.name];
        if (syntheticId) (feature as any).id = syntheticId;
      }
    }

    this.landFeature = topojson.merge(
      topology,
      (topology.objects.countries as any).geometries
    ) as unknown as Feature<Geometry>;

    this.loaded = true;
    this.computeCentroids();
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

  getCountryState(countryId: string): CountryState {
    return this.countryStates.get(countryId) || 'default';
  }

  getCountryForFeature(feature: CountryFeature): Country | undefined {
    if (!feature.id) return undefined;
    return countryById.get(feature.id.toString());
  }

  /**
   * Get projected centroid for a country (for geographic distance calculations).
   */
  getCentroid(countryId: string): [number, number] | null {
    return this.centroids.get(countryId) || null;
  }

  /**
   * Get all centroids map.
   */
  getAllCentroids(): Map<string, [number, number]> {
    return this.centroids;
  }

  /**
   * Smart fly-to: only pans if the country isn't already reasonably visible.
   * Uses a "dead zone" — if the country centroid is within the inner 60% of the
   * screen and the country bounding box fits on screen at current zoom, skip the pan.
   * Animation is interruptible: calling flyTo again cancels any in-progress transition.
   */
  flyTo(countryId: string, duration: number = 750): void {
    const feature = this.features.find((f) => f.id?.toString() === countryId);
    if (!feature || !this.path) return;

    // Cancel any in-progress transition
    d3.select(this.canvas).interrupt();

    // Use overridden centroid if available, else compute from bounds
    const storedCentroid = this.centroids.get(countryId);
    const bounds = this.path.bounds(feature as any);
    if (!bounds) return;

    const [[bx0, by0], [bx1, by1]] = bounds;
    const cx = storedCentroid ? storedCentroid[0] : (bx0 + bx1) / 2;
    const cy = storedCentroid ? storedCentroid[1] : (by0 + by1) / 2;

    // Use centroid-based virtual bounds for countries with large overseas territories
    const LARGE_IDS = new Set(['250', '840', '528', '643', '124', '156']);
    let dx: number, dy: number;
    if (LARGE_IDS.has(countryId)) {
      dx = this.width * 0.15;
      dy = this.height * 0.15;
    } else {
      dx = bx1 - bx0;
      dy = by1 - by0;
    }

    // Where is the country centroid in *screen* coordinates right now?
    const [screenX, screenY] = this.currentTransform.apply([cx, cy]);

    // Dead zone: inner 40% of the viewport (smaller = more willing to pan)
    const marginX = this.width * 0.3;
    const marginY = this.height * 0.3;
    const inDeadZone =
      screenX > marginX &&
      screenX < this.width - marginX &&
      screenY > marginY &&
      screenY < this.height - marginY;

    // If centroid is in the dead zone, skip pan entirely
    if (inDeadZone) {
      return;
    }

    // PAN ONLY — keep current zoom level, just center on the country
    const targetScale = this.currentTransform.k;

    const transform = d3.zoomIdentity
      .translate(this.width / 2, this.height / 2)
      .scale(targetScale)
      .translate(-cx, -cy);

    d3.select(this.canvas)
      .transition()
      .duration(duration)
      .ease(d3.easeCubicInOut)
      .call(this.zoom.transform as any, transform);
  }

  resetZoom(duration: number = 500): void {
    d3.select(this.canvas).interrupt();
    d3.select(this.canvas)
      .transition()
      .duration(duration)
      .call(this.zoom.transform as any, d3.zoomIdentity);
  }

  /**
   * Zoom to a specific continent region.
   */
  zoomToContinent(continent: string): void {
    const CONTINENT_BOUNDS: Record<string, { center: [number, number]; scale: number }> = {
      'Africa': { center: [20, 0], scale: 2.2 },
      'Asia': { center: [90, 30], scale: 2 },
      'Europe': { center: [15, 52], scale: 3.5 },
      'North America': { center: [-95, 40], scale: 2.2 },
      'South America': { center: [-60, -15], scale: 2.2 },
      'Oceania': { center: [140, -25], scale: 2.5 },
    };
    const region = CONTINENT_BOUNDS[continent];
    if (!region) return;
    const projected = this.projection(region.center);
    if (!projected) return;
    d3.select(this.canvas).interrupt();
    const transform = d3.zoomIdentity
      .translate(this.width / 2, this.height / 2)
      .scale(region.scale)
      .translate(-projected[0], -projected[1]);
    d3.select(this.canvas)
      .transition()
      .duration(600)
      .ease(d3.easeCubicInOut)
      .call(this.zoom.transform as any, transform);
  }

  /**
   * Grey out countries not in the given set. Pass null to clear.
   */
  setActiveCountryIds(ids: Set<string> | null): void {
    this.activeCountryIds = ids;
    this.render();
  }

  /**
   * Set zoom level programmatically (for +/- buttons).
   */
  zoomBy(factor: number): void {
    d3.select(this.canvas).interrupt();
    d3.select(this.canvas)
      .transition()
      .duration(200)
      .call(this.zoom.scaleBy as any, factor);
  }

  render(): void {
    if (!this.loaded) return;
    const ctx = this.ctx;
    const { width, height } = this;

    ctx.save();
    ctx.clearRect(0, 0, width, height);

    ctx.translate(this.currentTransform.x, this.currentTransform.y);
    ctx.scale(this.currentTransform.k, this.currentTransform.k);

    const pathGen = d3.geoPath().projection(this.projection).context(ctx);

    for (const feature of this.features) {
      const id = feature.id?.toString() || '';
      const state = this.countryStates.get(id) || 'default';
      const isHovered = this.hoveredId === id;

      ctx.beginPath();
      pathGen(feature as any);

      const isGreyedOut = this.activeCountryIds !== null && id !== '' && !this.activeCountryIds.has(id);

      if (isGreyedOut) {
        ctx.fillStyle = '#F0EDE9';
      } else if (state === 'correct') ctx.fillStyle = MAP_COLORS.correct;
      else if (state === 'hinted') ctx.fillStyle = MAP_COLORS.hinted;
      else if (state === 'selected') ctx.fillStyle = MAP_COLORS.selected;
      else if (state === 'highlighted') ctx.fillStyle = MAP_COLORS.highlighted;
      else if (state === 'missed') ctx.fillStyle = MAP_COLORS.missed;
      else if (isHovered) ctx.fillStyle = MAP_COLORS.hover;
      else ctx.fillStyle = MAP_COLORS.land;
      ctx.fill();

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
