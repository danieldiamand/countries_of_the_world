import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { Feature, Geometry, FeatureCollection } from 'geojson';
import { CENTROID_OVERRIDES, MARKER_IDS, IS_MOBILE } from '../data/constants';

export interface CountryFeature extends Feature<Geometry> {
  id?: string;
  properties: { name: string };
}

export type CountryState = 'default' | 'unselectable' | 'correct' | 'selected' | 'complete-selected' | 'missed';

const DEG2RAD = Math.PI / 180;
const EMPTY_SET: ReadonlySet<string> = new Set<string>();

export const GLOBE_COLORS = {
  ocean: '#E8F4F0',
  land: '#E8DFD4',
  border: '#7A7060',
  correct: '#6B9E5E',
  selected: '#6BBCB0',
  hover: '#D8CFC2',
  correctHover: '#5A8E4E',
  missedHover: '#A05040',
  missed: '#B8604E',
  unselectable: '#C8C0B4',
  graticule: '#D8EEE8',
  globeEdge: 'rgba(160, 152, 140, 0.2)',
  // Realistic ("real Earth") view mode
  realisticOcean: '#1f3b59',
  realisticGraticule: 'rgba(255, 255, 255, 0.07)',
  realisticEdge: 'rgba(0, 0, 0, 0.35)',
};

/**
 * Normalize rotation: clamp latitude to ±89° and wrap longitude.
 *
 * Clamping (not bouncing) avoids the Euler-angle singularity at the poles.
 * At 89° the pole is visually centered but we never hit the degenerate
 * point where longitude becomes undefined and the view flips 180°.
 * This is the same strategy Google Earth / Apple Maps use.
 */
function normalizeRotation(r: [number, number, number]): [number, number, number] {
  let [lon, lat] = r;
  lat = Math.max(-89, Math.min(89, lat));
  lon = ((lon % 360) + 540) % 360 - 180;
  return [lon, lat, 0];
}

export class Globe {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private projection: d3.GeoProjection;
  private path: d3.GeoPath;
  private features: CountryFeature[] = [];
  private countryStates: Map<string, CountryState> = new Map();
  private hoveredIds: Set<string> = new Set();
  private loaded = false;

  // Cached centroids [lon, lat]
  private geoCentroids: Map<string, [number, number]> = new Map();

  // Bounding angular radius per feature (for culling & hit-test pre-filter)
  private boundingRadii: Map<string, number> = new Map();

  // Interaction mode — reduces rendering precision for speed
  private _interacting = false;

  // Active country IDs (null = all active)
  private activeCountryIds: Set<string> | null = null;

  // ── Realistic ("real Earth") view mode ──────────────────
  // When on, countries the player has correctly guessed are filled with the
  // matching patch of a Blue-Marble equirectangular texture instead of a flat
  // green, so the globe "fills in for real" as you play.
  private realistic = false;
  /** When true (e.g. on the start screen), every in-play country is shown revealed. */
  private revealAll = false;
  private earthImg: HTMLImageElement | null = null;
  private textureLoading = false;
  private texW = 0;
  private texH = 0;

  // Base scale — fills viewport
  private baseScale = 1;

  // Current zoom multiplier on base scale
  private _zoomLevel = 1;
  private _smoothZoomRaf = 0;
  private _smoothZoomTarget = 1;

  // Hit-test: cache last-hit feature index for spatial locality
  private lastHitIdx = -1;

  // Parallel arrays for the hot render/hit-test loops (index-aligned with `features`).
  // Avoids per-frame string allocation (String(f.id)), Map lookups, and d3.geoDistance
  // temp-array allocation — the main sources of GC churn that cause pan/hover stutter.
  private _ids: string[] = [];
  private _vx = new Float64Array(0);      // centroid unit-vector x
  private _vy = new Float64Array(0);      // centroid unit-vector y
  private _vz = new Float64Array(0);      // centroid unit-vector z
  private _cullCos = new Float64Array(0); // cos(π/2 + boundingRadius) threshold for back-face culling
  private _bRadCos = new Float64Array(0); // cos(boundingRadius) threshold for hit-test pre-filter

  // Offscreen cache of the static (non-hover) scene. While the globe is stationary,
  // hover changes only re-blit this layer + overlay the few hovered features,
  // instead of re-projecting every polygon each frame.
  private offscreen: HTMLCanvasElement;
  private offCtx: CanvasRenderingContext2D;
  private baseValid = false;

  // Callbacks
  onCountryClick: ((countryId: string) => void) | null = null;
  onCountryHover: ((countryId: string | null) => void) | null = null;
  /** Optional: expand a hovered ID to include parent/siblings (set by main.ts) */
  hoverResolver: ((id: string) => Set<string>) | null = null;

  private graticule = d3.geoGraticule10();
  private dpr = window.devicePixelRatio || 1;
  private resizeObserver: ResizeObserver;
  private drawScheduled = false;

  constructor(private container: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;

    this.offscreen = document.createElement('canvas');
    this.offCtx = this.offscreen.getContext('2d')!;

    this.projection = d3.geoOrthographic()
      .clipAngle(90)
      .precision(0.5);

    this.path = d3.geoPath(this.projection, this.ctx);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.resize();
  }

  async load(): Promise<void> {
    const resp = await fetch('./data/world-50m.json');
    const topo = (await resp.json()) as Topology<{ countries: GeometryCollection }>;
    const fc = topojson.feature(topo, topo.objects.countries) as unknown as FeatureCollection<Geometry>;
    this.features = fc.features as CountryFeature[];

    // Assign stable IDs to unnamed features so they can be mapped to parents
    for (const f of this.features) {
      if (f.id == null) {
        const name = f.properties?.name;
        if (name) (f as any).id = `_${name.replace(/[^a-zA-Z]/g, '')}`;
      }
    }

    this.computeCentroids();
    this.computeBoundingRadii();
    this.buildHotArrays();
    this.loaded = true;
    this.draw();
  }

  private computeCentroids(): void {
    for (const f of this.features) {
      const id = String(f.id ?? '');
      if (!id) continue;
      if (CENTROID_OVERRIDES[id]) {
        this.geoCentroids.set(id, CENTROID_OVERRIDES[id]);
      } else {
        const c = d3.geoCentroid(f);
        this.geoCentroids.set(id, [c[0], c[1]]);
      }
    }
  }

  /**
   * Pre-compute the angular bounding radius for each feature.
   * Used for back-face culling in draw() and pre-filtering in hitTest().
   */
  private computeBoundingRadii(): void {
    for (const f of this.features) {
      const id = String(f.id ?? '');
      if (!id) continue;
      const centroid = this.geoCentroids.get(id);
      if (!centroid) continue;
      const bounds = d3.geoBounds(f);
      // Compute angular distance from centroid to each corner of the geo bounding box
      const corners: [number, number][] = [
        [bounds[0][0], bounds[0][1]],
        [bounds[0][0], bounds[1][1]],
        [bounds[1][0], bounds[0][1]],
        [bounds[1][0], bounds[1][1]],
      ];
      let maxDist = 0;
      for (const c of corners) {
        const dist = d3.geoDistance(centroid, c);
        if (dist > maxDist) maxDist = dist;
      }
      this.boundingRadii.set(id, maxDist + 0.1); // small safety margin
    }
  }

  /**
   * Build index-aligned parallel arrays for the hot draw/hit-test loops.
   * Each centroid is stored as a cartesian unit vector so back-face culling and
   * hit-test pre-filtering become a single dot product + comparison — no temp
   * arrays, no Map lookups, no d3.geoDistance calls per feature per frame.
   */
  private buildHotArrays(): void {
    const n = this.features.length;
    this._ids = new Array(n);
    this._vx = new Float64Array(n);
    this._vy = new Float64Array(n);
    this._vz = new Float64Array(n);
    this._cullCos = new Float64Array(n);
    this._bRadCos = new Float64Array(n);
    const halfPi = Math.PI / 2;

    for (let i = 0; i < n; i++) {
      const f = this.features[i];
      const id = String(f.id ?? '');
      (f as unknown as { _id: string })._id = id;
      this._ids[i] = id;

      const c = this.geoCentroids.get(id);
      const bRad = this.boundingRadii.get(id) ?? Math.PI;
      if (c) {
        const lonR = c[0] * DEG2RAD;
        const latR = c[1] * DEG2RAD;
        const cl = Math.cos(latR);
        this._vx[i] = cl * Math.cos(lonR);
        this._vy[i] = cl * Math.sin(lonR);
        this._vz[i] = Math.sin(latR);
        // angle > π/2 + bRad  ⟺  dot < cos(π/2 + bRad)
        this._cullCos[i] = Math.cos(Math.min(Math.PI, halfPi + bRad));
        this._bRadCos[i] = Math.cos(Math.min(Math.PI, bRad));
      } else {
        // No centroid → never cull (always draw / never pre-filter out)
        this._vx[i] = NaN;
        this._cullCos[i] = -1;
        this._bRadCos[i] = -1;
      }
    }
  }

  /** Resolve the fill color for a country/marker given its current state + hover. */
  private colorFor(id: string, isHovered: boolean): string {
    const isActive = !this.activeCountryIds || this.activeCountryIds.has(id);
    if (!isActive) return GLOBE_COLORS.unselectable;
    switch (this.countryStates.get(id)) {
      case 'correct':
      case 'complete-selected':
        return isHovered ? GLOBE_COLORS.correctHover : GLOBE_COLORS.correct;
      case 'selected':
        return GLOBE_COLORS.selected;
      case 'missed':
        return isHovered ? GLOBE_COLORS.missedHover : GLOBE_COLORS.missed;
      default:
        return isHovered ? GLOBE_COLORS.hover : GLOBE_COLORS.land;
    }
  }

  /** Whether the realistic "real Earth" texture mode is active. */
  get isRealistic(): boolean {
    return this.realistic;
  }

  /** Toggle the realistic ("real Earth") view mode. Lazily loads the texture. */
  setRealistic(v: boolean): void {
    if (this.realistic === v) return;
    this.realistic = v;
    this.baseValid = false;
    if (v) this.ensureTexture();
    this.scheduleDraw();
  }

  /** Preview helper: reveal every in-play country (used on the start screen). */
  setRevealAll(v: boolean): void {
    if (this.revealAll === v) return;
    this.revealAll = v;
    this.baseValid = false;
    this.scheduleDraw();
  }

  private isActive(id: string): boolean {
    return !this.activeCountryIds || this.activeCountryIds.has(id);
  }

  /** A correctly-guessed country gets the real-earth texture in realistic mode. */
  private isRevealed(id: string): boolean {
    if (this.revealAll) return this.isActive(id);
    const st = this.countryStates.get(id);
    return st === 'correct' || st === 'complete-selected';
  }

  /** Load the equirectangular Earth texture once, then precompute per-country source rects. */
  private ensureTexture(): void {
    if (this.earthImg || this.textureLoading) return;
    this.textureLoading = true;
    const img = new Image();
    img.onload = () => {
      this.earthImg = img;
      this.texW = img.naturalWidth;
      this.texH = img.naturalHeight;
      this.textureLoading = false;
      this.baseValid = false;
      this.draw();
    };
    img.onerror = () => { this.textureLoading = false; };
    img.src = './textures/earth.jpg';
  }

  /**
   * Fill the current path for feature `i`. In realistic mode a revealed country
   * is painted with the real-earth texture; otherwise a flat state color.
   * Assumes the path is already built on `ctx`.
   */
  private fillFeature(ctx: CanvasRenderingContext2D, i: number, id: string, isHovered: boolean): void {
    if (this.realistic && this.earthImg && this.isRevealed(id)) {
      // Land base first, so any uncovered sliver shows terrain — never ocean.
      ctx.fillStyle = GLOBE_COLORS.land;
      ctx.fill();
      this.paintTexture(ctx, this.features[i]);
      if (isHovered) { ctx.fillStyle = 'rgba(255, 255, 255, 0.18)'; ctx.fill(); }
      return;
    }
    ctx.fillStyle = this.colorFor(id, isHovered);
    ctx.fill();
  }

  /**
   * Paint a feature with the equirectangular Earth texture, clipped to the
   * (already-built) country path. The country's lon/lat bounding box is split
   * into a grid and each cell is drawn through the *actual* sphere projection
   * via an affine transform, so the imagery follows the globe's curvature
   * instead of stretching a single rectangle over the screen bbox (which warps
   * badly for large / antimeridian-crossing countries like Russia and the USA).
   */
  private paintTexture(ctx: CanvasRenderingContext2D, feat: CountryFeature): void {
    const img = this.earthImg;
    if (!img) return;
    const W = this.texW, H = this.texH, dpr = this.dpr;
    const proj = this.projection;

    const b = d3.geoBounds(feat); // [[lon0,lat0],[lon1,lat1]]; lon0>lon1 ⇒ wraps ±180
    const lon0 = b[0][0], lat0 = b[0][1], lon1 = b[1][0], lat1 = b[1][1];
    const lonSpan = lon1 < lon0 ? (lon1 + 360 - lon0) : (lon1 - lon0);
    const latSpan = lat1 - lat0;
    if (lonSpan <= 0 || latSpan <= 0) return;

    // Coarser grid while interacting (cheaper); fine grid when stationary (cached).
    const div = this._interacting ? 22 : 11;
    const maxC = this._interacting ? 6 : 18;
    const maxR = this._interacting ? 4 : 12;
    const cols = Math.max(1, Math.min(maxC, Math.ceil(lonSpan / div)));
    const rows = Math.max(1, Math.min(maxR, Math.ceil(latSpan / div)));

    ctx.save();
    ctx.clip(); // clip to the country polygon (current path)

    for (let r = 0; r < rows; r++) {
      const laN = lat1 - (latSpan * r) / rows;       // north edge of row (top)
      const laS = lat1 - (latSpan * (r + 1)) / rows; // south edge
      const syN = ((90 - laN) / 180) * H;
      const syS = ((90 - laS) / 180) * H;
      const dsy = syS - syN;
      if (dsy <= 0) continue;

      for (let c = 0; c < cols; c++) {
        const loW = lon0 + (lonSpan * c) / cols;        // west edge
        const loE = lon0 + (lonSpan * (c + 1)) / cols;  // east edge
        const loWw = ((loW + 180) % 360 + 360) % 360 - 180; // wrap into −180..180
        const loEw = ((loE + 180) % 360 + 360) % 360 - 180;

        const sxW = ((loWw + 180) / 360) * W;
        const sxE = ((loEw + 180) / 360) * W;
        const dsx = sxE - sxW;
        if (dsx <= 0) continue; // cell straddles the texture seam — skip sliver

        const p00 = proj([loWw, laN]); // top-left  (W,N)
        const p10 = proj([loEw, laN]); // top-right (E,N)
        const p01 = proj([loWw, laS]); // bottom-left (W,S)
        if (!p00 || !p10 || !p01) continue; // corner behind the horizon

        // Affine mapping the unit square (0,0)-(1,0)-(0,1) onto p00-p10-p01,
        // pre-multiplied by dpr (projection outputs CSS px; canvas is dpr-scaled).
        const a = (p10[0] - p00[0]) * dpr;
        const bb = (p10[1] - p00[1]) * dpr;
        const cc = (p01[0] - p00[0]) * dpr;
        const dd = (p01[1] - p00[1]) * dpr;
        ctx.setTransform(a, bb, cc, dd, p00[0] * dpr, p00[1] * dpr);
        ctx.drawImage(img, sxW, syN, dsx, dsy, 0, 0, 1, 1);
      }
    }

    ctx.restore(); // pops transform (back to dpr scale) and the country clip
  }

  /** Toggle interaction mode — uses lower projection precision for faster rendering. */
  setInteracting(v: boolean): void {
    if (this._interacting === v) return;
    this._interacting = v;
    this.projection.precision(v ? 1.5 : 0.5);
    this.baseValid = false; // precision change alters the rendered base
  }

  private resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.canvas.width = w * this.dpr;
    this.canvas.height = h * this.dpr;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.offscreen.width = this.canvas.width;
    this.offscreen.height = this.canvas.height;
    this.baseValid = false;

    this.baseScale = Math.min(w, h) * 0.45;
    this.projection
      .translate([w / 2, h / 2])
      .scale(this.baseScale * this._zoomLevel);
    this.draw();
  }

  get width(): number { return this.container.clientWidth; }
  get height(): number { return this.container.clientHeight; }
  get zoomLevel(): number { return this._zoomLevel; }

  setZoomLevel(z: number): void {
    const minZ = 0.8;
    const maxZ = 25;
    this._zoomLevel = Math.max(minZ, Math.min(maxZ, z));
    this.projection.scale(this.baseScale * this._zoomLevel);
    this.baseValid = false;
    this.scheduleDraw();
  }

  smoothZoomTo(target: number): void {
    const minZ = 0.8, maxZ = 25;
    this._smoothZoomTarget = Math.max(minZ, Math.min(maxZ, target));
    if (this._smoothZoomRaf) return; // already animating toward a target
    const step = () => {
      const diff = this._smoothZoomTarget - this._zoomLevel;
      if (Math.abs(diff) < 0.002) {
        this._zoomLevel = this._smoothZoomTarget;
        this.projection.scale(this.baseScale * this._zoomLevel);
        this.draw();
        this._smoothZoomRaf = 0;
        return;
      }
      this._zoomLevel += diff * 0.2;
      this.projection.scale(this.baseScale * this._zoomLevel);
      this.draw();
      this._smoothZoomRaf = requestAnimationFrame(step);
    };
    this._smoothZoomRaf = requestAnimationFrame(step);
  }

  getRotation(): [number, number, number] {
    return this.projection.rotate() as [number, number, number];
  }

  setRotation(r: [number, number, number]): void {
    this.projection.rotate(normalizeRotation(r));
    this.baseValid = false;
    this.scheduleDraw();
  }

  /** Atomic rotation + zoom update with immediate draw (for animation ticks). */
  setView(r: [number, number, number], zoom: number): void {
    this.projection.rotate(normalizeRotation(r));
    this._zoomLevel = Math.max(0.8, Math.min(25, zoom));
    this.projection.scale(this.baseScale * this._zoomLevel);
    this.drawScheduled = false; // cancel any pending scheduleDraw
    this.draw();
  }

  getProjection(): d3.GeoProjection {
    return this.projection;
  }

  setCountryStates(states: Map<string, CountryState>): void {
    this.countryStates = states;
    this.baseValid = false;
    this.scheduleDraw();
  }

  setActiveCountryIds(ids: Set<string> | null): void {
    this.activeCountryIds = ids;
    this.baseValid = false;
    this.scheduleDraw();
  }

  setHoveredId(id: string | null): void {
    let newSet = new Set<string>();
    if (id) {
      newSet = this.hoverResolver ? this.hoverResolver(id) : new Set([id]);
    }
    // Quick equality check
    if (newSet.size === this.hoveredIds.size) {
      let same = true;
      for (const hid of newSet) { if (!this.hoveredIds.has(hid)) { same = false; break; } }
      if (same) return;
    }
    this.hoveredIds = newSet;
    // Hover-only change: reuse the cached static scene and overlay just the
    // hovered features. Called from within interaction.ts's RAF, so drawing now
    // gives single-frame latency instead of double.
    this.drawScheduled = false;
    this.drawHoverChange();
  }

  getCentroid(countryId: string): [number, number] | undefined {
    return this.geoCentroids.get(countryId);
  }

  getFeatures(): CountryFeature[] {
    return this.features;
  }

  /** Hit-test canvas coordinates → country ID or null. */
  hitTest(canvasX: number, canvasY: number): string | null {
    if (!this.loaded) return null;

    const point = this.projection.invert?.([canvasX, canvasY]);
    if (!point) return null;

    // Check angular distance from center — if beyond 90°, it's on the back side
    const rotation = this.projection.rotate();
    const center: [number, number] = [-rotation[0], -rotation[1]];
    const angDist = d3.geoDistance(point, center) * (180 / Math.PI);
    if (angDist > 90) return null;

    const scale = this.baseScale * this._zoomLevel;

    // 1. Marker dots / tiny countries first (always checked, generous tap radius)
    const hitRadius = IS_MOBILE ? 24 : 18;
    {
      let bestDist = Infinity;
      let bestId: string | null = null;
      for (const id of MARKER_IDS) {
        const geo = this.geoCentroids.get(id);
        if (!geo) continue;
        // Skip if on back side
        if (d3.geoDistance(geo, [point[0], point[1]]) > Math.PI / 2) continue;
        const proj = this.projection(geo);
        if (!proj) continue;
        const dx = proj[0] - canvasX;
        const dy = proj[1] - canvasY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < hitRadius && dist < bestDist) {
          bestDist = dist;
          bestId = id;
        }
      }
      if (bestId) return bestId;
    }

    // 2. Polygon containment — check last-hit feature first (spatial locality)
    //    Pre-filter with bounding circle to skip expensive geoContains
    const feats = this.features;
    const len = feats.length;
    if (this.lastHitIdx >= 0 && this.lastHitIdx < len) {
      const f = feats[this.lastHitIdx];
      if (d3.geoContains(f, point)) return this._ids[this.lastHitIdx] || null;
    }

    // Point as a cartesian unit vector — lets the bounding-circle pre-filter be a
    // single dot product against precomputed centroid vectors (no allocations).
    const pLon = point[0] * DEG2RAD;
    const pLat = point[1] * DEG2RAD;
    const pcl = Math.cos(pLat);
    const px = pcl * Math.cos(pLon);
    const py = pcl * Math.sin(pLon);
    const pz = Math.sin(pLat);

    for (let i = 0; i < len; i++) {
      if (i === this.lastHitIdx) continue; // already checked
      const id = this._ids[i];
      if (!id) continue;
      // Bounding circle pre-filter: skip if point is outside feature's angular extent
      const vx = this._vx[i];
      if (!Number.isNaN(vx) && (vx * px + this._vy[i] * py + this._vz[i] * pz) < this._bRadCos[i]) continue;
      if (d3.geoContains(feats[i], point)) {
        this.lastHitIdx = i;
        return id;
      }
    }

    // 3. Proximity fallback for small islands
    const proximityRadius = 30;
    let bestDist = Infinity;
    let bestId: string | null = null;
    for (const f of this.features) {
      const id = String(f.id ?? '');
      if (!id) continue;
      const geo = this.geoCentroids.get(id);
      if (!geo) continue;
      const proj = this.projection(geo);
      if (!proj) continue;
      const dx = proj[0] - canvasX;
      const dy = proj[1] - canvasY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < proximityRadius && dist < bestDist) {
        bestDist = dist;
        bestId = id;
      }
    }
    return bestId;
  }

  /** Schedule a draw on the next animation frame (deduplicates multiple calls per frame). */
  private scheduleDraw(): void {
    if (this.drawScheduled) return;
    this.drawScheduled = true;
    requestAnimationFrame(() => {
      this.drawScheduled = false;
      this.draw();
    });
  }

  draw(): void {
    if (!this.loaded) return;
    this.renderScene(this.ctx, this.hoveredIds);
    // The main canvas now holds the scene *with* hover baked in, so the cached
    // base layer (which must be hover-free) is stale.
    this.baseValid = false;
  }

  /**
   * Hover-only update. While the globe is stationary the projected geometry is
   * identical frame-to-frame and only fill colors change, so we render the
   * static scene once to an offscreen layer and then just blit it and repaint
   * the handful of hovered features on top. This turns a full ~200-polygon
   * re-projection into a single image copy + a few path() calls.
   */
  private drawHoverChange(): void {
    if (!this.loaded) return;

    // During motion the base changes every frame; a normal full draw is correct
    // and the cache would only thrash, so fall back to it.
    if (this._interacting) { this.draw(); return; }

    if (!this.baseValid) {
      this.renderScene(this.offCtx, EMPTY_SET);
      this.baseValid = true;
    }

    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.offscreen, 0, 0);

    if (this.hoveredIds.size > 0) this.overlayHovered(ctx);
  }

  /** Repaint only the currently-hovered features on top of the blitted base layer. */
  private overlayHovered(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    // geoPath is bound to a context — point it at the one we're drawing into.
    this.path.context(ctx);

    const rot = this.projection.rotate();
    const cl0 = Math.cos(-rot[1] * DEG2RAD);
    const cx = cl0 * Math.cos(-rot[0] * DEG2RAD);
    const cy = cl0 * Math.sin(-rot[0] * DEG2RAD);
    const cz = Math.sin(-rot[1] * DEG2RAD);

    ctx.strokeStyle = GLOBE_COLORS.border;
    ctx.lineWidth = 1.0;

    const feats = this.features;
    const ids = this._ids;
    for (let i = 0; i < feats.length; i++) {
      const id = ids[i];
      if (!this.hoveredIds.has(id)) continue;
      const vx = this._vx[i];
      if (!Number.isNaN(vx) && (vx * cx + this._vy[i] * cy + this._vz[i] * cz) < this._cullCos[i]) continue;
      ctx.beginPath();
      this.path(feats[i]);
      this.fillFeature(ctx, i, id, true);
      ctx.stroke();
    }

    if (this._zoomLevel >= 3) {
      const markerGrowth = Math.max(1, 1 + (this._zoomLevel - 3) * 0.1);
      const dotRadius = Math.max(3, 4 * markerGrowth);
      const viewCenter: [number, number] = [-rot[0], -rot[1]];
      ctx.lineWidth = 1;
      for (const id of MARKER_IDS) {
        if (!this.hoveredIds.has(id)) continue;
        const geo = this.geoCentroids.get(id);
        if (!geo) continue;
        if (d3.geoDistance(geo, viewCenter) > Math.PI / 2) continue;
        const proj = this.projection(geo);
        if (!proj) continue;
        ctx.beginPath();
        ctx.arc(proj[0], proj[1], dotRadius, 0, Math.PI * 2);
        ctx.fillStyle = this.colorFor(id, true);
        ctx.fill();
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  /** Render the full scene (ocean, graticule, countries, markers) into `ctx`. */
  private renderScene(ctx: CanvasRenderingContext2D, hovered: ReadonlySet<string>): void {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const dpr = this.dpr;

    ctx.save();
    ctx.scale(dpr, dpr);
    // geoPath is bound to a single context at construction; retarget it to the
    // context we're actually drawing into (main canvas or the offscreen cache).
    this.path.context(ctx);

    const cw = w / dpr;
    const ch = h / dpr;

    // Clear
    ctx.clearRect(0, 0, cw, ch);

    // Ocean circle
    const center = this.projection.translate()!;
    const radius = this.projection.scale()!;
    ctx.beginPath();
    ctx.arc(center[0], center[1], radius, 0, Math.PI * 2);
    ctx.fillStyle = this.realistic ? GLOBE_COLORS.realisticOcean : GLOBE_COLORS.ocean;
    ctx.fill();

    // Globe edge shadow
    ctx.beginPath();
    ctx.arc(center[0], center[1], radius, 0, Math.PI * 2);
    ctx.strokeStyle = this.realistic ? GLOBE_COLORS.realisticEdge : GLOBE_COLORS.globeEdge;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Graticule — skip during interaction (barely visible during motion)
    if (!this._interacting) {
      ctx.beginPath();
      this.path(this.graticule);
      ctx.strokeStyle = this.realistic ? GLOBE_COLORS.realisticGraticule : GLOBE_COLORS.graticule;
      ctx.lineWidth = 0.4;
      ctx.stroke();
    }

    // Country polygons — single pass, one path() call per feature.
    // path() is the bottleneck (projects every vertex through the spherical projection),
    // so we must never call it more than once per feature per frame.
    // Back-face culling is a branchless dot product against precomputed centroid
    // unit vectors — no allocations, no Map lookups, no d3.geoDistance.
    const rot = this.projection.rotate();
    const cl0 = Math.cos(-rot[1] * DEG2RAD);
    const cx = cl0 * Math.cos(-rot[0] * DEG2RAD);
    const cy = cl0 * Math.sin(-rot[0] * DEG2RAD);
    const cz = Math.sin(-rot[1] * DEG2RAD);

    const feats = this.features;
    const n = feats.length;
    const ids = this._ids;
    const vxs = this._vx, vys = this._vy, vzs = this._vz, cullCos = this._cullCos;

    ctx.strokeStyle = GLOBE_COLORS.border;
    ctx.lineWidth = 1.0;

    for (let i = 0; i < n; i++) {
      const vx = vxs[i];
      // Back-face culling: skip features whose centroid is far behind the horizon.
      if (!Number.isNaN(vx) && (vx * cx + vys[i] * cy + vzs[i] * cz) < cullCos[i]) continue;

      const id = ids[i];

      ctx.beginPath();
      this.path(feats[i]);
      this.fillFeature(ctx, i, id, hovered.has(id));
      ctx.stroke();
    }

    // Marker dots for tiny countries
    if (this._zoomLevel >= 3) {
      const markerGrowth = Math.max(1, 1 + (this._zoomLevel - 3) * 0.1);
      const dotRadius = Math.max(3, 4 * markerGrowth);
      const viewCenter: [number, number] = [-rot[0], -rot[1]];

      ctx.strokeStyle = GLOBE_COLORS.border;
      ctx.lineWidth = 1;

      for (const id of MARKER_IDS) {
        const geo = this.geoCentroids.get(id);
        if (!geo) continue;
        if (d3.geoDistance(geo, viewCenter) > Math.PI / 2) continue;
        const proj = this.projection(geo);
        if (!proj) continue;

        ctx.beginPath();
        ctx.arc(proj[0], proj[1], dotRadius, 0, Math.PI * 2);
        ctx.fillStyle = this.colorFor(id, hovered.has(id));
        ctx.fill();
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  destroy(): void {
    this.resizeObserver.disconnect();
    this.canvas.remove();
  }
}
