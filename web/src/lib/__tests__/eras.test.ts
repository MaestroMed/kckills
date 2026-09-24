import { describe, expect, it } from "vitest";
import { ERAS, eraBadge, getEraById, getErasSortedByDate } from "@/lib/eras";

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

describe("eraBadge (badge calculé depuis les dates)", () => {
  const worlds = ERAS.find((e) => e.id === "worlds-2026")!;
  const summer = ERAS.find((e) => e.id === "lec-2026-summer")!;
  it("Worlds 2026 : à venir avant le 15/10, live pendant, rien après la finale", () => {
    expect(eraBadge(worlds, Date.parse("2026-10-14T23:00:00Z"))).toBe("upcoming");
    expect(eraBadge(worlds, Date.parse("2026-10-15T08:00:00Z"))).toBe("live");
    expect(eraBadge(worlds, Date.parse("2026-11-14T22:00:00Z"))).toBe("live");
    expect(eraBadge(worlds, Date.parse("2026-11-15T01:00:00Z"))).toBeNull();
  });
  it("Summer 2026 terminé le 19/09 : plus de badge", () => {
    expect(eraBadge(summer, Date.parse("2026-09-23T00:00:00Z"))).toBeNull();
  });
  it("au plus une ère live et une à venir à tout instant", () => {
    for (const iso of ["2026-09-23", "2026-10-16", "2026-12-01"]) {
      const now = Date.parse(`${iso}T12:00:00Z`);
      const badges = ERAS.map((e) => eraBadge(e, now));
      expect(badges.filter((b) => b === "live").length).toBeLessThanOrEqual(1);
    }
  });
});
