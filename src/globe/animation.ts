/**
 * Globe fly-to animation: smooth rotation + zoom interpolation.
 * Uses great-circle interpolation for natural globe motion.
 */

import * as d3 from 'd3';
import type { Globe } from './Globe';

export interface FlyToOptions {
  target: [number, number];  // [lon, lat]
  zoom: number;              // target zoom multiplier
  duration?: number;         // ms, default 700
}

export class GlobeAnimation {
  private globe: Globe;
  private rafId = 0;
  private running = false;

  constructor(globe: Globe) {
    this.globe = globe;
  }

  /**
   * Animate the globe to center on target with the given zoom.
   * Returns a promise that resolves when complete.
   */
  flyTo(opts: FlyToOptions): Promise<void> {
    this.cancel();

    const { target, zoom, duration = 700 } = opts;

    const startRotation = this.globe.getRotation();
    const endRotation: [number, number, number] = [-target[0], -target[1], 0];
    const startZoom = this.globe.zoomLevel;

    // Calculate angular distance in degrees
    const startCenter: [number, number] = [-startRotation[0], -startRotation[1]];
    const angDist = d3.geoDistance(target, startCenter) * (180 / Math.PI);

    // Skip if already there
    const zoomDiff = Math.abs(startZoom - zoom);
    if (angDist < 2 && zoomDiff < 0.05) {
      return Promise.resolve();
    }

    // Scale duration by angular distance:
    //  - neighbor hop (~10°): ~500ms
    //  - medium arc (~60°): ~700ms
    //  - cross-globe (~180°): ~duration (capped)
    const scaledDuration = Math.min(duration, Math.max(450, 400 + angDist * 5));

    // Enable interaction mode for reduced precision during animation
    this.globe.setInteracting(true);

    return new Promise((resolve) => {
      this.running = true;

      // Interpolate rotation components independently using shortest path
      // This avoids d3.interpolate which can take weird great-circle paths
      // for the rotation array
      const dLon = shortestAngleDelta(startRotation[0], endRotation[0]);
      const dLat = endRotation[1] - startRotation[1];

      const startTime = performance.now();

      const tick = (now: number) => {
        if (!this.running) {
          resolve();
          return;
        }

        const elapsed = now - startTime;
        const rawT = Math.min(1, elapsed / scaledDuration);
        // Ease-in-out cubic — gentle start and end, no whiplash
        const t = rawT < 0.5
          ? 4 * rawT * rawT * rawT
          : 1 - Math.pow(-2 * rawT + 2, 3) / 2;

        this.globe.setView(
          [startRotation[0] + dLon * t, startRotation[1] + dLat * t, 0],
          startZoom + (zoom - startZoom) * t,
        );

        if (rawT < 1) {
          this.rafId = requestAnimationFrame(tick);
        } else {
          this.running = false;
          this.globe.setInteracting(false);
          resolve();
        }
      };

      this.rafId = requestAnimationFrame(tick);
    });
  }

  cancel(): void {
    const wasRunning = this.running;
    this.running = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    if (wasRunning) this.globe.setInteracting(false);
  }

  get isAnimating(): boolean {
    return this.running;
  }
}

/** Shortest angular delta between two angles in degrees, wrapping around ±180. */
function shortestAngleDelta(from: number, to: number): number {
  let d = to - from;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}
