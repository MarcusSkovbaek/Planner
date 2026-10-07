import type { WindowProvider, WindowSample } from '../tracking/types';
import { mulberry32 } from './generate';
import { DEMO_INTERRUPTIONS, DEMO_TASKS, type DemoWindow } from './scenario';

/**
 * Pretends to be a user working through the demo tasks. Used by the browser build and
 * by the desktop app in demo mode (`PLANNER_DEMO=1`), so the whole pipeline can be
 * exercised on any OS.
 */
export class SimulatedProvider implements WindowProvider {
  readonly id = 'simulated';
  private readonly rng: () => number;
  private current: DemoWindow | null = null;
  private until = 0;
  private taskIndex = 0;
  private taskUntil = 0;

  constructor(
    private readonly clock: () => number = Date.now,
    seed = 42,
  ) {
    this.rng = mulberry32(seed);
  }

  sample(): WindowSample {
    const now = this.clock();
    if (!this.current || now >= this.until) this.next(now);
    const w = this.current!;
    return { app: w.app, appName: w.appName, title: w.title };
  }

  private next(now: number): void {
    if (now >= this.taskUntil) {
      this.taskIndex = Math.floor(this.rng() * DEMO_TASKS.length);
      this.taskUntil = now + (3 + this.rng() * 5) * 60_000;
    }
    const task = DEMO_TASKS[this.taskIndex]!;
    const roll = this.rng();
    if (roll < 0.6) {
      this.current = task.focus;
      this.until = now + (40 + this.rng() * 80) * 1000;
    } else if (roll < 0.9 && task.related.length) {
      this.current = task.related[Math.floor(this.rng() * task.related.length)]!;
      this.until = now + (12 + this.rng() * 30) * 1000;
    } else {
      this.current = DEMO_INTERRUPTIONS[Math.floor(this.rng() * DEMO_INTERRUPTIONS.length)]!;
      this.until = now + (8 + this.rng() * 15) * 1000;
    }
  }
}
