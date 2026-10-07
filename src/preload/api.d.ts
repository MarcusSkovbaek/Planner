import type { PlannerApi } from '../core/api';

declare global {
  interface Window {
    /** Present when running inside the desktop app (see src/preload/index.ts). */
    planner?: PlannerApi;
  }
}

export {};
