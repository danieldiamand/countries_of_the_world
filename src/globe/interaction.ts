/**
 * Globe interaction: pixel-delta drag rotation, scroll zoom, click/tap.
 *
 * Uses direct pixel-to-degree mapping — simple, predictable, responsive.
 * No quaternions. Works consistently everywhere including near the poles.
 */

import type { Globe } from './Globe';
import { IS_MOBILE } from '../data/constants';

export interface InteractionCallbacks {
  onClick: (countryId: string | null, canvasXY: [number, number]) => void;
  onZoomChange: (zoom: number) => void;
}

export class GlobeInteraction {
  private globe: Globe;
  private canvas: HTMLCanvasElement;
  private callbacks: InteractionCallbacks;

  // Drag state
  private dragging = false;
  private dragStartXY: [number, number] = [0, 0];
  private dragStartRotation: [number, number, number] = [0, 0, 0];
  private dragMoved = false;

  // Inertia (in degrees/ms)
  private inertiaVx = 0;
  private inertiaVy = 0;
  private inertiaRaf = 0;
  private lastDragXY: [number, number] = [0, 0];
  private lastDragTime = 0;

  // Pinch zoom
  private pinchStartDist = 0;
  private pinchStartZoom = 1;

  // Wheel zoom debounce for interaction mode
  private wheelIdleTimer = 0;

  constructor(globe: Globe, callbacks: InteractionCallbacks) {
    this.globe = globe;
    const container = (globe as any).container as HTMLElement;
    this.canvas = container.querySelector('canvas')!;
    this.callbacks = callbacks;

    this.setupMouse();
    this.setupTouch();
    this.setupWheel();
  }

  // ── Event setup ─────────────────────────────────────────

  private setupMouse(): void {
    this.canvas.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mouseup', this.onMouseUp);
    this.canvas.addEventListener('mousemove', this.onHoverMove);
  }

  private setupTouch(): void {
    this.canvas.addEventListener('touchstart', this.onTouchStart, { passive: false });
    this.canvas.addEventListener('touchmove', this.onTouchMove, { passive: false });
    this.canvas.addEventListener('touchend', this.onTouchEnd, { passive: false });
  }

  private setupWheel(): void {
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
  }

  /** Pixels → degrees: at projection scale S, S pixels = 1 radian on equator */
  private pixelToDeg(): number {
    return (180 / Math.PI) / this.globe.getProjection().scale()!;
  }

  // ── Mouse ───────────────────────────────────────────────

  private onMouseDown = (e: MouseEvent): void => {
    e.preventDefault();
    this.cancelInertia();
    this.startDrag(e.offsetX, e.offsetY);
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.dragging) return;
    const rect = this.canvas.getBoundingClientRect();
    this.moveDrag(e.clientX - rect.left, e.clientY - rect.top);
  };

  private onMouseUp = (e: MouseEvent): void => {
    if (!this.dragging) return;
    const rect = this.canvas.getBoundingClientRect();
    this.endDrag(e.clientX - rect.left, e.clientY - rect.top);
  };

  // Hover throttle
  private hoverRaf = 0;
  private hoverX = 0;
  private hoverY = 0;

  private onHoverMove = (e: MouseEvent): void => {
    if (this.dragging) return;
    // Always record the latest position so the queued frame hit-tests where the
    // cursor actually is, not where it was when the frame was scheduled.
    this.hoverX = e.offsetX;
    this.hoverY = e.offsetY;
    if (this.hoverRaf) return;  // throttle to 1 per frame
    this.hoverRaf = requestAnimationFrame(() => {
      this.hoverRaf = 0;
      const id = this.globe.hitTest(this.hoverX, this.hoverY);
      this.globe.setHoveredId(id);
      this.canvas.style.cursor = id ? 'pointer' : 'grab';
    });
  };

  // ── Touch ───────────────────────────────────────────────

  private onTouchStart = (e: TouchEvent): void => {
    e.preventDefault();
    this.cancelInertia();

    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      this.pinchStartDist = Math.sqrt(dx * dx + dy * dy);
      this.pinchStartZoom = this.globe.zoomLevel;
      return;
    }

    const rect = this.canvas.getBoundingClientRect();
    this.startDrag(
      e.touches[0].clientX - rect.left,
      e.touches[0].clientY - rect.top,
    );
  };

  private onTouchMove = (e: TouchEvent): void => {
    e.preventDefault();

    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      this.globe.setZoomLevel(this.pinchStartZoom * (dist / this.pinchStartDist));
      this.callbacks.onZoomChange(this.globe.zoomLevel);
      return;
    }

    if (!this.dragging) return;
    const rect = this.canvas.getBoundingClientRect();
    this.moveDrag(
      e.touches[0].clientX - rect.left,
      e.touches[0].clientY - rect.top,
    );
  };

  private onTouchEnd = (e: TouchEvent): void => {
    if (e.touches.length > 0) return;
    if (!this.dragging) return;
    const rect = this.canvas.getBoundingClientRect();
    const ct = e.changedTouches[0];
    this.endDrag(ct.clientX - rect.left, ct.clientY - rect.top);
  };

  // ── Scroll zoom ─────────────────────────────────────────

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.globe.setInteracting(true);
    clearTimeout(this.wheelIdleTimer);
    this.wheelIdleTimer = window.setTimeout(() => this.globe.setInteracting(false), 150);
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    this.globe.setZoomLevel(this.globe.zoomLevel * factor);
    this.callbacks.onZoomChange(this.globe.zoomLevel);
  };

  // ── Core drag logic (pixel delta → degree rotation) ─────

  private startDrag(x: number, y: number): void {
    this.dragging = true;
    this.dragMoved = false;
    this.dragStartXY = [x, y];
    this.lastDragXY = [x, y];
    this.lastDragTime = performance.now();
    this.dragStartRotation = this.globe.getRotation();
    this.inertiaVx = 0;
    this.inertiaVy = 0;
    this.globe.setInteracting(true);
  }

  private moveDrag(x: number, y: number): void {
    const dx = x - this.dragStartXY[0];
    const dy = y - this.dragStartXY[1];
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) this.dragMoved = true;

    const k = this.pixelToDeg();
    this.globe.setRotation([
      this.dragStartRotation[0] + dx * k,
      this.dragStartRotation[1] - dy * k,
      0,
    ]);

    // Smooth velocity tracking for inertia (degrees/ms)
    const now = performance.now();
    const dt = now - this.lastDragTime;
    if (dt > 0 && dt < 100) {
      const ddx = x - this.lastDragXY[0];
      const ddy = y - this.lastDragXY[1];
      const alpha = 0.4;
      this.inertiaVx = alpha * (ddx * k / dt) + (1 - alpha) * this.inertiaVx;
      this.inertiaVy = alpha * (-ddy * k / dt) + (1 - alpha) * this.inertiaVy;
    }
    this.lastDragXY = [x, y];
    this.lastDragTime = now;
  }

  private endDrag(x: number, y: number): void {
    this.dragging = false;

    if (!this.dragMoved) {
      this.globe.setInteracting(false);
      const id = this.globe.hitTest(x, y);
      this.callbacks.onClick(id, [x, y]);
      return;
    }

    // Kill momentum if user paused before releasing (stale velocity)
    const timeSinceLastMove = performance.now() - this.lastDragTime;
    if (timeSinceLastMove > 80) {
      this.inertiaVx = 0;
      this.inertiaVy = 0;
    }

    // Only inertia if drag was substantial (>15px total movement) and fast enough
    const totalDx = Math.abs(x - this.dragStartXY[0]);
    const totalDy = Math.abs(y - this.dragStartXY[1]);
    const totalDist = Math.sqrt(totalDx ** 2 + totalDy ** 2);
    const speed = Math.sqrt(this.inertiaVx ** 2 + this.inertiaVy ** 2);
    if (speed > 0.03 && totalDist > 15) {
      // Cap velocity to prevent launch effect
      const maxV = 0.15;
      if (speed > maxV) {
        const scale = maxV / speed;
        this.inertiaVx *= scale;
        this.inertiaVy *= scale;
      }
      this.startInertia();
    } else {
      this.globe.setInteracting(false);
    }
  }

  // ── Inertia coast ───────────────────────────────────────

  private startInertia(): void {
    const decay = 0.82;
    const minSpeed = 0.003;
    let lastT = performance.now();

    const tick = () => {
      const now = performance.now();
      const dt = now - lastT;
      lastT = now;

      this.inertiaVx *= decay;
      this.inertiaVy *= decay;

      const speed = Math.sqrt(this.inertiaVx ** 2 + this.inertiaVy ** 2);
      if (speed < minSpeed) {
        this.globe.setInteracting(false);
        return;
      }

      const r = this.globe.getRotation();
      this.globe.setRotation([
        r[0] + this.inertiaVx * dt,
        r[1] + this.inertiaVy * dt,
        0,
      ]);

      this.inertiaRaf = requestAnimationFrame(tick);
    };

    this.inertiaRaf = requestAnimationFrame(tick);
  }

  cancelInertia(): void {
    const wasCoasting = !!this.inertiaRaf;
    if (this.inertiaRaf) {
      cancelAnimationFrame(this.inertiaRaf);
      this.inertiaRaf = 0;
    }
    this.inertiaVx = 0;
    this.inertiaVy = 0;
    if (wasCoasting) this.globe.setInteracting(false);
  }

  zoomBy(factor: number): void {
    this.globe.smoothZoomTo(this.globe.zoomLevel * factor);
    this.callbacks.onZoomChange(this.globe.zoomLevel);
  }

  destroy(): void {
    this.cancelInertia();
    if (this.hoverRaf) cancelAnimationFrame(this.hoverRaf);
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mouseup', this.onMouseUp);
    this.canvas.removeEventListener('mousemove', this.onHoverMove);
    this.canvas.removeEventListener('touchstart', this.onTouchStart);
    this.canvas.removeEventListener('touchmove', this.onTouchMove);
    this.canvas.removeEventListener('touchend', this.onTouchEnd);
    this.canvas.removeEventListener('wheel', this.onWheel);
  }
}
