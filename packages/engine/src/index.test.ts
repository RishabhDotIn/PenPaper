import { describe, expect, it } from "vitest";
import { ENGINE_VERSION } from "./index";

describe("engine package", () => {
  it("exposes a semver version string", () => {
    expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
