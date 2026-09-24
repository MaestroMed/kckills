import { describe, expect, it } from "vitest";
import { cleanTeamCode, httpsLogoUrl, resolveOpponentFromCodes } from "@/lib/team-display";
import { ddragonKey, formatGameTime } from "@/lib/constants";

describe("affichage des équipes", () => {
  it("passe les logos lolesports en https (next/image refuse le http)", () => {
    expect(httpsLogoUrl("http://static.lolesports.com/teams/kc.png")).toBe(
      "https://static.lolesports.com/teams/kc.png",
    );
    expect(httpsLogoUrl("https://cdn.example.com/x.png")).toBe("https://cdn.example.com/x.png");
    expect(httpsLogoUrl(null)).toBeNull();
  });

  it("écarte les codes non affichables : vide, id numérique gol.gg, placeholder LEC", () => {
    expect(cleanTeamCode("  ")).toBeNull();
    expect(cleanTeamCode("98767991")).toBeNull();
    expect(cleanTeamCode("lec")).toBeNull();
    expect(cleanTeamCode(" G2 ")).toBe("G2");
  });

  it("trouve l'adversaire des deux côtés, jamais KC ni KC Blue", () => {
    expect(resolveOpponentFromCodes("KC", "MKOI")).toBe("MKOI");
    expect(resolveOpponentFromCodes("GX", "KC")).toBe("GX");
    expect(resolveOpponentFromCodes("KCB", "LEC")).toBeNull();
  });
});

describe("clés DDragon des champions", () => {
  it.each([
    ["Wukong", "MonkeyKing"],
    ["MonkeyKing", "MonkeyKing"],
    ["Kai'Sa", "Kaisa"],
    ["Jarvan IV", "JarvanIV"],
    ["Renata Glasc", "Renata"],
    ["K'Sante", "KSante"],
    ["renekton", "Renekton"],
    ["Nunu & Willump", "Nunu"],
  ])("%s -> %s", (name, key) => {
    expect(ddragonKey(name)).toBe(key);
  });
});

describe("formatGameTime", () => {
  it("formate en M:SS", () => {
    expect(formatGameTime(0)).toBe("0:00");
    expect(formatGameTime(65_000)).toBe("1:05");
    expect(formatGameTime(34 * 60_000 + 26_000)).toBe("34:26");
  });
});
