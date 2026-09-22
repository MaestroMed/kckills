import { describe, expect, it } from "vitest";
import { computeKillScore, wilsonScore } from "@/lib/feed-algorithm";

describe("wilsonScore", () => {
  it("vaut 0 sans vote", () => {
    expect(wilsonScore(0.9, 0)).toBe(0);
  });

  it("donne la borne basse de Wilson à 95 % (10 votes positifs sur 10 ≈ 0,7225)", () => {
    expect(wilsonScore(1, 10)).toBeCloseTo(0.7225, 3);
  });

  it("récompense le volume à ratio égal : 50/50 bat 5/5", () => {
    expect(wilsonScore(1, 50)).toBeGreaterThan(wilsonScore(1, 5));
  });

  it("ne dépasse jamais le ratio observé", () => {
    for (const [p, n] of [[0.8, 5], [0.5, 100], [0.95, 20]] as const) {
      expect(wilsonScore(p, n)).toBeLessThanOrEqual(p);
      expect(wilsonScore(p, n)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("computeKillScore", () => {
  it("un penta sans mort d'une game gagnée dépasse une game à 0/5", () => {
    const carry = computeKillScore(5, 0, 3, 12, true, true);
    const weak = computeKillScore(0, 5, 1, 12, true, false);
    expect(carry).toBeGreaterThan(weak);
  });

  it("plafonne l'apport des kills (15 points max)", () => {
    const a = computeKillScore(10, 1, 0, 20, true, true);
    const b = computeKillScore(30, 1, 0, 40, true, true);
    // au-delà de 10 kills, seuls KDA et participation peuvent encore bouger
    expect(b - a).toBeLessThan(15);
  });
});
