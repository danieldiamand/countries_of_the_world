import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { FeatureCollection, Feature, Geometry } from 'geojson';


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

// Countries too small to have clearly visible polygons on a 50m resolution map.
// We draw dot markers at their centroids so they're findable.
// Threshold: roughly countries under ~1000 km² (about twice Andorra's size).
const MARKER_IDS = new Set([
  '336',  // Vatican City (~0.44 km²)
  '492',  // Monaco (~2 km²)
  '520',  // Nauru (~21 km²)
  '798',  // Tuvalu (~26 km²)
  '674',  // San Marino (~61 km²)
  '438',  // Liechtenstein (~160 km²)
  '584',  // Marshall Islands (~181 km²)
  '659',  // Saint Kitts and Nevis (~261 km²)
  '462',  // Maldives (~300 km²)
  '470',  // Malta (~316 km²)
  '308',  // Grenada (~344 km²)
  '670',  // Saint Vincent and the Grenadines (~390 km²)
  '052',  // Barbados (~430 km²)
  '028',  // Antigua and Barbuda (~440 km²)
  '585',  // Palau (~459 km²)
  '690',  // Seychelles (~459 km²)
  '662',  // Saint Lucia (~617 km²)
  '583',  // Micronesia (~702 km²)
  '702',  // Singapore (~733 km²)
  '776',  // Tonga (~748 km²)
  '212',  // Dominica (~751 km²)
  '048',  // Bahrain (~780 km²)
  '296',  // Kiribati (~811 km²)
  '678',  // São Tomé and Príncipe (~964 km²)
]);

export class WorldMap {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private projection!: d3.GeoProjection;
  private path!: d3.GeoPath;
  private features: CountryFeature[] = [];
  private countryStates: Map<string, CountryState> = new Map();
  private hoveredId: string | null = null;
  private zoom!: d3.ZoomBehavior<HTMLCanvasElement, unknown>;
  private currentTransform: d3.ZoomTransform = d3.zoomIdentity;
  private onCountryClick: ((countryId: string, rawId?: string, isOverseas?: boolean) => void) | null = null;
  private loaded: boolean = false;
  private width: number = 0;
  private height: number = 0;

  // Cached centroids in projected [x, y] coords
  private centroids: Map<string, [number, number]> = new Map();

  // Active country IDs (for greying out non-active countries)
  private activeCountryIds: Set<string> | null = null;

  // Territory→parent mapping (disabled territories map clicks to parent)
  private territoryParentMap: Map<string, string> = new Map();

  // Gravity center: projected [x,y] that the view drifts towards at max zoom-out
  private gravityCenter: [number, number] | null = null;

  // Last country flyTo targeted — used to re-center when keyboard opens/closes
  private lastFlyToId: string | null = null;
  private viewportCompensationTimer: number = 0;

  constructor(container: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'world-map-canvas';
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;

    this.setupSize();
    this.setupProjection();
    this.setupZoom();
    this.setupInteractions();
    this.setupViewportCompensation();

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
    // Threshold: below this scale, scroll-out stops zooming and pans to center instead.
    const PAN_THRESHOLD = 1.18;

    this.zoom = d3
      .zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([1, 12])
      .on('zoom', (event: d3.D3ZoomEvent<HTMLCanvasElement, unknown>) => {
        const t = event.transform;
        this.currentTransform = t;
        this.render();
      });

    // Intercept wheel events BEFORE d3's zoom handler (capture phase).
    // Below PAN_THRESHOLD, redirect zoom-out into smooth pan-to-center.
    this.canvas.addEventListener('wheel', (e) => {
      const k = this.currentTransform.k;

      // Only intercept zoom-out when below threshold and gravity center is set
      if (e.deltaY > 0 && k <= PAN_THRESHOLD && this.gravityCenter) {
        e.preventDefault();
        // Compute how far from centered we are
        const [gcx, gcy] = this.gravityCenter;
        const targetX = this.width / 2 - gcx;
        const targetY = this.height / 2 - gcy;
        const dx = targetX - this.currentTransform.x;
        const dy = targetY - this.currentTransform.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > 1) {
          // Pan toward center: strength proportional to scroll amount
          const panStrength = Math.min(0.35, e.deltaY * 0.004);
          const newX = this.currentTransform.x + dx * panStrength;
          const newY = this.currentTransform.y + dy * panStrength;
          // Also ease scale toward 1
          const newK = k + (1 - k) * panStrength;
          const newTransform = d3.zoomIdentity.translate(newX, newY).scale(newK);
          this.currentTransform = newTransform;
          (this.canvas as any).__zoom = newTransform;
          this.render();
          // Stop the event from reaching d3's zoom handler
          e.stopImmediatePropagation();
          return;
        }
      }
      // Otherwise let d3 handle normally (zoom-in, or zoom-out above threshold)
    }, { capture: true, passive: false });

    d3.select(this.canvas).call(this.zoom);
  }

  private setupInteractions(): void {
    this.canvas.addEventListener('mousemove', (e) => {
      const country = this.hitTest(e.offsetX, e.offsetY);
      const newId = country?.id?.toString() || null;
      if (newId !== this.hoveredId) {
        this.hoveredId = newId;
        this.canvas.style.cursor = newId ? 'pointer' : 'default';
        this.render();
      }
    });

    this.canvas.addEventListener('click', (e) => {
      const country = this.hitTest(e.offsetX, e.offsetY);
      if (country?.id) {
        const rawId = country.id.toString();
        const mappedId = this.territoryParentMap.get(rawId) ?? rawId;
        const overseas = this.isOverseasClick(mappedId, e.offsetX, e.offsetY);
        this.onCountryClick?.(mappedId, rawId !== mappedId ? rawId : undefined, overseas || undefined);
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
            const rawId = country.id.toString();
            const mappedId = this.territoryParentMap.get(rawId) ?? rawId;
            const overseas = this.isOverseasClick(mappedId, x, y);
            this.onCountryClick?.(mappedId, rawId !== mappedId ? rawId : undefined, overseas || undefined);
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

    // Check marker countries FIRST — their dots sit on top of
    // neighboring country polygons, so they must take priority.
    const k = this.currentTransform.k;
    if (k >= 3) {
      const dotScreenRadius = k < 5 ? 5 : 4 * (1 + Math.max(0, k - 5) * 0.08);
      const hitRadiusPx = dotScreenRadius + 14;
      let closest: CountryFeature | null = null;
      let closestDist = Infinity;
      for (const feature of this.features) {
        const id = feature.id?.toString() || '';
        if (!MARKER_IDS.has(id)) continue;
        const centroid = this.centroids.get(id);
        if (!centroid) continue;
        const [sx, sy] = this.currentTransform.apply(centroid);
        const dx = px - sx;
        const dy = py - sy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < hitRadiusPx && dist < closestDist) {
          closestDist = dist;
          closest = feature;
        }
      }
      if (closest) return closest;
    }

    // Standard polygon hit test
    for (const feature of this.features) {
      if (d3.geoContains(feature as any, coords)) return feature;
    }

    return null;
  }

  /**
   * For countries with overseas territories embedded in their multipolygon
   * (e.g., France includes French Guiana), detect if a click at screen
   * coords (px, py) landed on an overseas part. Returns true if the click
   * geo-coords are far from the metropolitan center.
   */
  private isOverseasClick(countryId: string, px: number, py: number): boolean {
    // Metropolitan bounding boxes [lonMin, latMin, lonMax, latMax]
    const METRO_BOUNDS: Record<string, [number, number, number, number]> = {
      '250': [-5, 41, 10, 51.5],     // France → metropolitan
      '840': [-130, 24, -65, 50],     // USA → contiguous 48
      '528': [3, 50, 8, 54],          // Netherlands → European
      '208': [7, 54, 16, 58],         // Denmark → Jutland + islands
    };
    const metro = METRO_BOUNDS[countryId];
    if (!metro) return false;

    const [tx, ty] = this.currentTransform.invert([px, py]);
    const geo = this.projection.invert?.([tx, ty]);
    if (!geo) return false;

    const [lon, lat] = geo;
    return lon < metro[0] || lon > metro[2] || lat < metro[1] || lat > metro[3];
  }

  private computeCentroids(): void {
    this.centroids.clear();

    // Countries with overseas territories whose map centroids would be misleading.
    // We override with approximate lon/lat of the metropolitan territory, then project.
    const CENTROID_OVERRIDES: Record<string, [number, number]> = {
      '250': [2.5, 46.5],   // France → metropolitan France, not French Guiana
      '840': [-98, 39],     // USA → contiguous US, not pulled by Alaska/Hawaii
      '528': [5.5, 52.3],   // Netherlands → European Netherlands
      '124': [-96, 56],     // Canada → southern populated area
      '156': [104, 35],     // China → central China
      '643': [90, 62],      // Russia → geographic center of landmass
      '554': [174, -41],    // New Zealand → North/South Island center
      '242': [178, -18],    // Fiji → main islands
      '036': [134, -27],    // Australia → visual center of mainland
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
    const response = await fetch(`${import.meta.env.BASE_URL}data/world-50m.json`);
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

    this.loaded = true;
    this.computeCentroids();
    this.render();
  }

  setClickHandler(handler: (countryId: string, rawId?: string, isOverseas?: boolean) => void): void {
    this.onCountryClick = handler;
  }

  setTerritoryParentMap(map: Map<string, string>): void {
    this.territoryParentMap = map;
  }

  /**
   * Set gravity center in lon/lat. When fully zoomed out, the view gently
   * drifts toward this point.  Pass null to use default (map center).
   */
  setGravityCenter(lonLat: [number, number] | null): void {
    if (!lonLat) {
      this.gravityCenter = null;
      return;
    }
    const projected = this.projection(lonLat);
    if (projected) {
      this.gravityCenter = [projected[0], projected[1]];
    }
  }

  setCountryState(countryId: string, state: CountryState): void {
    this.countryStates.set(countryId, state);
    this.render();
  }

  batchSetCountryStates(states: Map<string, CountryState>): void {
    for (const [id, state] of states) {
      this.countryStates.set(id, state);
    }
    this.render();
  }

  resetStates(): void {
    this.countryStates.clear();
    this.render();
  }

  getCountryState(countryId: string): CountryState {
    return this.countryStates.get(countryId) || 'default';
  }

  /**
   * Get all centroids map.
   */
  getAllCentroids(): Map<string, [number, number]> {
    return this.centroids;
  }

  /**
   * Smart fly-to: pans to center the country. Adjusts zoom automatically.
   * Options:
   *   forceCenter: always pan to center (no dead-zone skip)
   */
  flyTo(
    countryId: string,
    duration: number = 750,
    forceCenter: boolean = false,
  ): void {
    this.lastFlyToId = countryId;

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

    // Per-country virtual bounds for countries with overseas territories.
    // Values are fractions of viewport size representing the metropolitan area.
    const VIRTUAL_BOUNDS: Record<string, number> = {
      '250': 0.06,   // France → metropolitan France (not pulled by French Guiana)
      '840': 0.20,   // USA → contiguous states
      '528': 0.02,   // Netherlands → European Netherlands
      '124': 0.22,   // Canada
      '156': 0.18,   // China
      '643': 0.22,   // Russia → large landmass
      '554': 0.06,   // New Zealand → islands
      '242': 0.03,   // Fiji → small islands
    };
    let dx: number, dy: number;
    const vbRatio = VIRTUAL_BOUNDS[countryId];
    if (vbRatio !== undefined) {
      dx = this.width * vbRatio;
      dy = this.height * vbRatio;
    } else {
      dx = bx1 - bx0;
      dy = by1 - by0;
    }

    // Fixed zoom tiers — nearly all countries share the STANDARD zoom.
    // Only exceptional cases get their own tier. This prevents the
    // "rollercoaster" effect when clicking between similarly-sized countries.
    const MASSIVE_IDS = new Set(['643', '124']);            // Russia, Canada
    const BIG_IDS = new Set(['840', '156', '076', '036']); // USA, China, Brazil, Australia
    const VERY_BIG_IDS = new Set(['356', '032', '398', '010']); // India, Argentina, Kazakhstan, Antarctica
    const TINY_IDS = new Set([                              // Small countries — visible at high zoom
      '442', '132', '480', '270',                           // Luxembourg, Cabo Verde, Mauritius, Gambia
      '096', '626',                                         // Brunei, Timor-Leste
      '212', '780',                                         // Dominica, Trinidad
      '242', '296', '584', '583',                           // Fiji, Kiribati, Marshall Islands, Micronesia
      '882', '090', '548',                                  // Samoa, Solomon Islands, Vanuatu
      '020', '470', '048', '702',                           // Andorra, Malta, Bahrain, Singapore
      '462',                                                // Maldives
      '028', '052', '308', '659', '662', '670',             // Antigua, Barbados, Grenada, St Kitts, St Lucia, St Vincent
      '520', '585', '798', '776',                           // Nauru, Palau, Tuvalu, Tonga
      '174', '678', '690',                                  // Comoros, São Tomé, Seychelles
      '438',                                                // Liechtenstein
    ]);

    // Determine fixed target scale based on tier.
    // These are absolute zoom levels, not viewport fractions.
    let fixedScale: number | null = null;
    if (MASSIVE_IDS.has(countryId)) fixedScale = 2.2;
    else if (BIG_IDS.has(countryId)) fixedScale = 3.0;
    else if (VERY_BIG_IDS.has(countryId)) fixedScale = 3.8;
    else if (MARKER_IDS.has(countryId) || TINY_IDS.has(countryId)) fixedScale = 10;
    else fixedScale = 5.0; // STANDARD — the one zoom for nearly all countries

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

    let clampedIdeal = Math.max(1, Math.min(12, fixedScale));

    const targetScale = clampedIdeal;

    // If centroid is already centered and zoom matches, skip (unless forceCenter)
    if (!forceCenter && inDeadZone && Math.abs(targetScale - this.currentTransform.k) < 0.05) {
      return;
    }

    const actualDuration = duration;

    const t0 = this.currentTransform;

    // On mobile with keyboard open, visualViewport.height < window.innerHeight.
    // Center the fly-to in the visible portion above the keyboard.
    const vv = window.visualViewport;
    const visibleHeight = vv ? vv.height : this.height;
    const visibleOffsetTop = vv ? vv.offsetTop : 0;
    const centerY = visibleOffsetTop + visibleHeight / 2;

    const t1 = d3.zoomIdentity
      .translate(this.width / 2, centerY)
      .scale(targetScale)
      .translate(-cx, -cy);

    // Interpolate transform components directly in screen space.
    // This keeps pan and zoom perfectly synced throughout the animation.
    d3.select(this.canvas)
      .transition()
      .duration(actualDuration)
      .ease(d3.easeCubicInOut)
      .tween('zoom', () => {
        const ix = d3.interpolateNumber(t0.x, t1.x);
        const iy = d3.interpolateNumber(t0.y, t1.y);
        const ik = d3.interpolateNumber(t0.k, t1.k);
        return (t: number) => {
          this.currentTransform = d3.zoomIdentity
            .translate(ix(t), iy(t))
            .scale(ik(t));
          (this.canvas as any).__zoom = this.currentTransform;
          this.render();
        };
      });
  }

  /**
   * Zoom to show two features at once (e.g. territory + parent country).
   * Computes a bounding box that contains both centroids with padding.
   */
  flyToShowBoth(id1: string, id2: string, duration: number = 750): void {
    d3.select(this.canvas).interrupt();

    let minX: number, maxX: number, minY: number, maxY: number;

    if (id1 === id2) {
      // Same country — show the full extent of all its polygons (e.g. France + French Guiana)
      const feature = this.features.find((f) => f.id?.toString() === id1);
      if (!feature) { this.flyTo(id1, duration, true); return; }
      const bounds = this.path.bounds(feature as any);
      if (!bounds) { this.flyTo(id1, duration, true); return; }
      [[minX, minY], [maxX, maxY]] = bounds;
    } else {
      const c1 = this.centroids.get(id1);
      const c2 = this.centroids.get(id2);
      if (!c1 || !c2) { this.flyTo(id1, duration, true); return; }
      minX = Math.min(c1[0], c2[0]);
      maxX = Math.max(c1[0], c2[0]);
      minY = Math.min(c1[1], c2[1]);
      maxY = Math.max(c1[1], c2[1]);
    }

    // Bounding box with generous padding
    const padX = Math.max((maxX - minX) * 0.5, this.width * 0.12);
    const padY = Math.max((maxY - minY) * 0.5, this.height * 0.12);

    const dx = (maxX - minX) + padX * 2;
    const dy = (maxY - minY) + padY * 2;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    // Scale to fit both features with breathing room (0.85 factor)
    const targetScale = Math.max(1, Math.min(12,
      0.85 * Math.min(this.width / Math.max(dx, 1), this.height / Math.max(dy, 1))
    ));

    const t0 = this.currentTransform;
    const t1 = d3.zoomIdentity
      .translate(this.width / 2, this.height / 2)
      .scale(targetScale)
      .translate(-cx, -cy);

    // Screen-space interpolation keeps pan and zoom perfectly synced
    d3.select(this.canvas)
      .transition()
      .duration(duration)
      .ease(d3.easeCubicInOut)
      .tween('zoom', () => {
        const ix = d3.interpolateNumber(t0.x, t1.x);
        const iy = d3.interpolateNumber(t0.y, t1.y);
        const ik = d3.interpolateNumber(t0.k, t1.k);
        return (t: number) => {
          this.currentTransform = d3.zoomIdentity
            .translate(ix(t), iy(t))
            .scale(ik(t));
          (this.canvas as any).__zoom = this.currentTransform;
          this.render();
        };
      });
  }

  resetZoom(duration: number = 500): void {
    this.lastFlyToId = null;
    d3.select(this.canvas).interrupt();
    d3.select(this.canvas)
      .transition()
      .duration(duration)
      .call(this.zoom.transform as any, d3.zoomIdentity);
  }

  /**
   * On mobile, when the virtual keyboard opens or closes the visual viewport
   * height changes significantly. Re-flyTo the last selected country so it
   * stays centered in the visible area above (or without) the keyboard.
   */
  private setupViewportCompensation(): void {
    const vv = window.visualViewport;
    if (!vv) return;
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
      (navigator.maxTouchPoints > 0 && window.innerWidth < 1024);
    if (!isMobile) return;

    let prevHeight = vv.height;

    vv.addEventListener('resize', () => {
      const dh = vv.height - prevHeight;
      prevHeight = vv.height;

      // Only react to large height changes (keyboard open/close is 150px+)
      if (Math.abs(dh) < 80) return;
      if (!this.lastFlyToId) return;

      // Debounce: wait for the viewport to stabilize after the keyboard
      // animation, then re-center on the selected country.
      clearTimeout(this.viewportCompensationTimer);
      const id = this.lastFlyToId;
      this.viewportCompensationTimer = window.setTimeout(() => {
        if (this.lastFlyToId === id) {
          this.flyTo(id, 250, true);
        }
      }, 120);
    });
  }

  /**
   * Set a comfortable initial zoom for mobile (World mode).
   * Zooms in ~2.5x centered on Europe/Africa area to fill the small screen.
   * Also shifts center upward to account for keyboard covering bottom half.
   */
  setInitialMobileZoom(): void {
    const center: [number, number] = [15, 35]; // Europe/Mediterranean area — good density of countries
    const projected = this.projection(center);
    if (!projected) return;
    d3.select(this.canvas).interrupt();
    const scale = 2.5;
    const transform = d3.zoomIdentity
      .translate(this.width / 2, this.height / 2)
      .scale(scale)
      .translate(-projected[0], -projected[1]);
    d3.select(this.canvas)
      .transition()
      .duration(600)
      .ease(d3.easeCubicInOut)
      .call(this.zoom.transform as any, transform);
  }

  /**
   * Zoom to a specific continent region.
   */
  zoomToContinent(continent: string): void {
    const CONTINENT_BOUNDS: Record<string, { center: [number, number]; scale: number }> = {
      'Africa': { center: [20, 2], scale: 1.8 },
      'Asia': { center: [90, 30], scale: 1.7 },
      'Europe': { center: [15, 52], scale: 2.8 },
      'North America': { center: [-95, 40], scale: 1.9 },
      'South America': { center: [-60, -15], scale: 1.9 },
      'Oceania': { center: [140, -25], scale: 2.2 },
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
   * Smoothly pan to a continent view centered on a specific country's continent.
   * Offset upward to account for bottom HUD bar. Uses slower animation.
   */
  panToContinent(continent: string, duration: number = 900): void {
    const CONTINENT_BOUNDS: Record<string, { center: [number, number]; scale: number }> = {
      'Africa': { center: [20, 2], scale: 1.8 },
      'Asia': { center: [90, 30], scale: 1.7 },
      'Europe': { center: [15, 52], scale: 2.8 },
      'North America': { center: [-95, 40], scale: 1.9 },
      'South America': { center: [-60, -15], scale: 1.9 },
      'Oceania': { center: [140, -25], scale: 2.2 },
    };
    const region = CONTINENT_BOUNDS[continent];
    if (!region) return;
    const projected = this.projection(region.center);
    if (!projected) return;

    d3.select(this.canvas).interrupt();

    // Offset center upward by ~6% of viewport to account for bottom HUD
    const yOffset = this.height * 0.06;

    const t0 = this.currentTransform;
    const t1 = d3.zoomIdentity
      .translate(this.width / 2, this.height / 2 - yOffset)
      .scale(region.scale)
      .translate(-projected[0], -projected[1]);

    // Only pan if we're not already viewing this continent (within tolerance)
    const dx = Math.abs(t0.x - t1.x);
    const dy = Math.abs(t0.y - t1.y);
    const dk = Math.abs(t0.k - t1.k);
    if (dx < 20 && dy < 20 && dk < 0.2) return;

    d3.select(this.canvas)
      .transition()
      .duration(duration)
      .ease(d3.easeCubicInOut)
      .tween('zoom', () => {
        const ix = d3.interpolateNumber(t0.x, t1.x);
        const iy = d3.interpolateNumber(t0.y, t1.y);
        const ik = d3.interpolateNumber(t0.k, t1.k);
        return (t: number) => {
          this.currentTransform = d3.zoomIdentity
            .translate(ix(t), iy(t))
            .scale(ik(t));
          (this.canvas as any).__zoom = this.currentTransform;
          this.render();
        };
      });
  }

  /**
   * Set zoom level programmatically (for +/- buttons).
   * When zooming out near minimum, smoothly pan to centered world view.
   */
  zoomBy(factor: number): void {
    d3.select(this.canvas).interrupt();
    const currentK = this.currentTransform.k;
    const newK = Math.max(1, Math.min(12, currentK * factor));

    // When zooming out to near minimum, smoothly center the view
    if (factor < 1 && newK <= 1.18) {
      // Use d3's zoom.transform for smooth animated zoom-out to center
      let targetTransform: d3.ZoomTransform;
      if (this.gravityCenter) {
        const [gcx, gcy] = this.gravityCenter;
        targetTransform = d3.zoomIdentity
          .translate(this.width / 2 - gcx, this.height / 2 - gcy);
      } else {
        targetTransform = d3.zoomIdentity;
      }

      d3.select(this.canvas)
        .transition()
        .duration(400)
        .ease(d3.easeCubicOut)
        .call(this.zoom.transform as any, targetTransform);
      return;
    }

    // Use d3's zoom.scaleTo for proper scaleExtent enforcement
    const center: [number, number] = [this.width / 2, this.height / 2];
    d3.select(this.canvas)
      .transition()
      .duration(200)
      .ease(d3.easeCubicOut)
      .call(this.zoom.scaleTo as any, newK, center);
  }

  private lerpColor(a: string, b: string, t: number): string {
    const pa = this.parseHex(a), pb = this.parseHex(b);
    const r = Math.round(pa[0] + (pb[0] - pa[0]) * t);
    const g = Math.round(pa[1] + (pb[1] - pa[1]) * t);
    const bl = Math.round(pa[2] + (pb[2] - pa[2]) * t);
    return `rgb(${r},${g},${bl})`;
  }

  private parseHex(hex: string): [number, number, number] {
    const h = hex.replace('#', '');
    return [
      parseInt(h.substring(0, 2), 16),
      parseInt(h.substring(2, 4), 16),
      parseInt(h.substring(4, 6), 16),
    ];
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
        ctx.fillStyle = '#D4CDC5';
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

    // Draw dot markers for small countries.
    // Show from k >= 3 so they're visible when zooming into a region.
    // Dots grow gently with zoom so they're easier to click at high zoom.
    if (this.currentTransform.k >= 3) {
      const kVal = this.currentTransform.k;
      const baseRadius = kVal < 5 ? 5 : 4 * (1 + Math.max(0, kVal - 5) * 0.08);
      const dotRadius = baseRadius / kVal;
      const ringWidth = Math.max(1.5, 2.5 / kVal);
      for (const feature of this.features) {
        const id = feature.id?.toString() || '';
        if (!MARKER_IDS.has(id)) continue;
        const centroid = this.centroids.get(id);
        if (!centroid) continue;

        const isGreyedOut = this.activeCountryIds !== null && id !== '' && !this.activeCountryIds.has(id);
        if (isGreyedOut) continue;

        const state = this.countryStates.get(id) || 'default';
        const isHovered = this.hoveredId === id;

        // For active states: white fill + colored ring (clearly visible).
        // For default: subtle grey dot.
        let fillColor: string;
        let strokeColor: string;
        let lw = ringWidth;
        if (state === 'correct') { fillColor = '#FFFFFF'; strokeColor = MAP_COLORS.correct; lw = ringWidth * 1.5; }
        else if (state === 'hinted') { fillColor = '#FFFFFF'; strokeColor = MAP_COLORS.hinted; lw = ringWidth * 1.5; }
        else if (state === 'selected') { fillColor = '#FFFFFF'; strokeColor = MAP_COLORS.selected; lw = ringWidth * 1.5; }
        else if (state === 'highlighted') { fillColor = '#FFFFFF'; strokeColor = MAP_COLORS.highlighted; lw = ringWidth * 1.5; }
        else if (state === 'missed') { fillColor = '#FFFFFF'; strokeColor = MAP_COLORS.missed; lw = ringWidth * 1.5; }
        else if (isHovered) { fillColor = '#FFFFFF'; strokeColor = MAP_COLORS.text; lw = ringWidth * 1.2; }
        else { fillColor = MAP_COLORS.border; strokeColor = MAP_COLORS.text; }

        ctx.beginPath();
        ctx.arc(centroid[0], centroid[1], dotRadius, 0, Math.PI * 2);
        ctx.fillStyle = fillColor;
        ctx.fill();
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = lw;
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  dispose(): void {
    d3.select(this.canvas).on('.zoom', null);
    this.canvas.remove();
  }
}
