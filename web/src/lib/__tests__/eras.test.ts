import { describe, expect, it } from "vitest";
import { ERAS, getEraById, getErasSortedByDate } from "@/lib/eras";

describe("frise des ères", () => {
  it("a des identifiants uniques", () => {
    const ids = ERAS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("a des dates ISO cohérentes (début <= fin)", () => {
    for (const e of ERAS) {
      expect(e.dateStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.dateEnd).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.dateStart <= e.dateEnd).toBe(true);
    }
  });

  it("n'a au plus qu'une ère LIVE et qu'une ère À VENIR", () => {
    expect(ERAS.filter((e) => e.badge === "live").length).toBeLessThanOrEqual(1);
    expect(ERAS.filter((e) => e.badge === "upcoming").length).toBeLessThanOrEqual(1);
  });

  it("couvre 2026 jusqu'aux Worlds", () => {
    const sorted = getErasSortedByDate();
    expect(sorted.at(-1)?.id).toBe("worlds-2026");
    expect(getEraById("lec-2026-summer")?.result).toContain("Worlds");
    expect(getEraById("lec-2026-spring")?.label).not.toBe("En Cours");
  });
});
