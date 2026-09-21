interface PerfBridge {
  /** Median renderer frame body duration after seeding, in milliseconds. */
  medianFrameMs: number;
  seeded: number;
}

declare global {
  interface Window {
    /** Dev/test only; absent from production builds. */
    __seedPerfBoard?: (count?: number) => number;
    /** Dev/test only; populated by `__seedPerfBoard`. */
    __perf?: PerfBridge;
  }
}

export {};
