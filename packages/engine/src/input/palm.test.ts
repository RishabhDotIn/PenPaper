import { describe, expect, it } from "vitest";
import { PalmRejection } from "./palm";

describe("PalmRejection", () => {
  it("ignores touch while a pen is active", () => {
    const palm = new PalmRejection(800);
    palm.notePen(1000);
    expect(palm.accept({ type: "touch", time: 1500 })).toBe(false);
    expect(palm.accept({ type: "touch", time: 1850 })).toBe(true);
    expect(palm.accept({ type: "pen", time: 1400 })).toBe(true);
  });

  it("never blocks a mouse", () => {
    const palm = new PalmRejection(800);
    palm.notePen(1000);
    expect(palm.accept({ type: "mouse", time: 1100 })).toBe(true);
  });

  it("extends the window on every pen event", () => {
    const palm = new PalmRejection(800);
    palm.notePen(1000);
    palm.notePen(1700);
    expect(palm.accept({ type: "touch", time: 2400 })).toBe(false);
    expect(palm.accept({ type: "touch", time: 2501 })).toBe(true);
  });

  it("accepts touch when no pen has ever been used", () => {
    const palm = new PalmRejection(800);
    expect(palm.accept({ type: "touch", time: 0 })).toBe(true);
  });
});
