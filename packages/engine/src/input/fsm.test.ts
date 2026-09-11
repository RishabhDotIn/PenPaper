import { describe, expect, it } from "vitest";
import { InteractionFSM } from "./fsm";

describe("InteractionFSM", () => {
  it("rejects illegal transitions", () => {
    const fsm = new InteractionFSM("idle");
    expect(() => fsm.transition("rotating")).toThrow(/illegal transition/i);
    fsm.transition("drawing");
    expect(fsm.state).toBe("drawing");
  });

  it("allows the documented drawing → idle return", () => {
    const fsm = new InteractionFSM("idle");
    fsm.transition("drawing");
    fsm.transition("idle");
    expect(fsm.state).toBe("idle");
  });

  it("reaches rotation only through dragging, never from idle", () => {
    const fsm = new InteractionFSM("idle");
    fsm.transition("dragging");
    fsm.transition("rotating");
    expect(fsm.state).toBe("rotating");
  });

  it("treats a transition to the current state as a no-op", () => {
    const fsm = new InteractionFSM("idle");
    expect(() => fsm.transition("idle")).not.toThrow();
  });
});
