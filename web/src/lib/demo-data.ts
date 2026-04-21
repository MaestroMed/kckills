/**
 * KCKills — Données pilote KC LEC 2026
 *
 * Source data : Oracle's Elixir LEC 2026 + lolesports.com
 * VODs        : Chaîne LoL Esports YouTube
 *
 * Pour ajouter un VOD réel :
 *  1. Trouve la vidéo YouTube du match
 *  2. Cherche le timestamp du kill (horloge jeu visible)
 *  3. Remplis youtubeId + youtubeStart dans le kill correspondant
 */

import type {
  Kill,
  Player,
  Team,
  Game,
  Match,
  Tournament,
  Comment,
  Profile,
  KillAssist,
  KillTag,
} from "@/types";

// ─── Teams ────────────────────────────────────────────────────────────────────
export const KC: Team = {
  id: "t1",
  name: "Karmine Corp",
  slug: "karmine-corp",
  short_name: "KC",
  logo_url: "https://am-a.akamaihd.net/image?resize=40:&f=http%3A%2F%2Fstatic.lolesports.com%2Fteams%2F1641480111736_KClogowhite.png",
  is_tracked: true,
};
export const G2: Team = {
  id: "t2",
  name: "G2 Esports",
  slug: "g2-esports",
  short_name: "G2",
  logo_url: null,
  is_tracked: false,
};
export const FNC: Team = {
  id: "t3",
  name: "Fnatic",
  slug: "fnatic",
  short_name: "FNC",
  logo_url: null,
  is_tracked: false,
};
export const TH: Team = {
  id: "t5",
  name: "Team Heretics",
  slug: "team-heretics",
  short_name: "TH",
  logo_url: null,
  is_tracked: false,
};
export const SK: Team = {
  id: "t6",
  name: "SK Gaming",
  slug: "sk-gaming",
  short_name: "SK",
  logo_url: null,
  is_tracked: false,
};
export const VIT: Team = {
  id: "t7",
  name: "Team Vitality",
  slug: "team-vitality",
  short_name: "VIT",
  logo_url: null,
  is_tracked: false,
};

// ─── KC Players (Roster LEC 2026) ─────────────────────────────────────────────
export const CANNA: Player = {
  id: "p1",
  summoner_name: "Canna",
  slug: "canna",
  real_name: "Kim Chang-dong",
  role: "top",
  team_id: KC.id,
  team: KC,
  profile_image_url: null,
  is_active: true,
};
export const YIKE: Player = {
  id: "p2",
  summoner_name: "Yike",
  slug: "yike",
  real_name: "Martin Sundelin",
  role: "jungle",
  team_id: KC.id,
  team: KC,
  profile_image_url: null,
  is_active: true,
};
export const KYEAHOO: Player = {
  id: "p3",
  summoner_name: "Kyeahoo",
  slug: "kyeahoo",
  real_name: null,
  role: "mid",
  team_id: KC.id,
  team: KC,
  profile_image_url: null,
  is_active: true,
};
export const CALISTE: Player = {
  id: "p4",
  summoner_name: "Caliste",
  slug: "caliste",
  real_name: null,
  role: "adc",
  team_id: KC.id,
  team: KC,
  profile_image_url: null,
  is_active: true,
};
export const BUSIO: Player = {
  id: "p5",
  summoner_name: "Busio",
  slug: "busio",
  real_name: null,
  role: "support",
  team_id: KC.id,
  team: KC,
  profile_image_url: null,
  is_active: true,
};

export const KC_PLAYERS = [CANNA, YIKE, KYEAHOO, CALISTE, BUSIO];

// ─── Opponent Players ──────────────────────────────────────────────────────────
const CAPS: Player = {
  id: "p10",
  summoner_name: "Caps",
  slug: "caps",
  real_name: "Rasmus Winther",
  role: "mid",
  team_id: G2.id,
  team: G2,
  profile_image_url: null,
  is_active: true,
};
const HANS_SAMA: Player = {
  id: "p11",
  summoner_name: "Hans sama",
  slug: "hans-sama",
  real_name: "Steven Liv",
  role: "adc",
  team_id: G2.id,
  team: G2,
  profile_image_url: null,
  is_active: true,
};
const BROKENBLADE: Player = {
  id: "p12",
  summoner_name: "BrokenBlade",
  slug: "brokenblade",
  real_name: "Sergen Celik",
  role: "top",
  team_id: G2.id,
  team: G2,
  profile_image_url: null,
  is_active: true,
};
const MIKYX: Player = {
  id: "p13",
  summoner_name: "Mikyx",
  slug: "mikyx",
  real_name: "Mihael Mehle",
  role: "support",
  team_id: G2.id,
  team: G2,
  profile_image_url: null,
  is_active: true,
};
const FLAKKED: Player = {
  id: "p14",
  summoner_name: "Flakked",
  slug: "flakked",
  real_name: "Ramon Llorente",
  role: "adc",
  team_id: FNC.id,
  team: FNC,
  profile_image_url: null,
  is_active: true,
};
const OSCARININ: Player = {
  id: "p15",
  summoner_name: "Oscarinin",
  slug: "oscarinin",
  real_name: "Oscar Muñoz",
  role: "top",
  team_id: FNC.id,
  team: FNC,
  profile_image_url: null,
  is_active: true,
};
const HUMANOID: Player = {
  id: "p16",
  summoner_name: "Humanoid",
  slug: "humanoid",
  real_name: "Marek Brázda",
  role: "mid",
  team_id: FNC.id,
  team: FNC,
  profile_image_url: null,
  is_active: true,
};
const JACKIES: Player = {
  id: "p17",
  summoner_name: "Jackies",
  slug: "jackies",
  real_name: null,
  role: "mid",
  team_id: TH.id,
  team: TH,
  profile_image_url: null,
  is_active: true,
};
const LYNCAS: Player = {
  id: "p18",
  summoner_name: "Lyncas",
  slug: "lyncas",
  real_name: null,
  role: "adc",
  team_id: SK.id,
  team: SK,
  profile_image_url: null,
  is_active: true,
};

export const ALL_PLAYERS: Record<string, Player> = {};
[
  CANNA, YIKE, KYEAHOO, CALISTE, BUSIO,
  CAPS, HANS_SAMA, BROKENBLADE, MIKYX,
  FLAKKED, OSCARININ, HUMANOID, JACKIES, LYNCAS,
].forEach((p) => {
  ALL_PLAYERS[p.id] = p;
});

// ─── Tournaments ───────────────────────────────────────────────────────────────
const LEC_SPRING: Tournament = {
  id: "tr1",
  name: "LEC Winter 2026",
  slug: "lec-winter-2026",
  region: "LEC",
  split: "Winter",
  year: 2026,
  start_date: "2026-01-10",
  end_date: "2026-02-28",
};
const LEC_VERSUS: Tournament = {
  id: "tr2",
  name: "LEC Versus 2026",
  slug: "lec-versus-2026",
  region: "LEC",
  split: "Versus",
  year: 2026,
  start_date: "2026-03-07",
  end_date: "2026-03-23",
};

export const TOURNAMENTS = [LEC_SPRING, LEC_VERSUS];

// ─── Matches ───────────────────────────────────────────────────────────────────
const M_KC_G2_VF: Match = {
  id: "m1",
  tournament_id: LEC_VERSUS.id,
  tournament: LEC_VERSUS,
  team_blue_id: KC.id,
  team_blue: KC,
  team_red_id: G2.id,
  team_red: G2,
  winner_id: null, // TBD (Finale)
  match_date: "2026-03-23T17:00:00Z",
  best_of: 5,
  stage: "Grande Finale",
  slug: "kc-vs-g2-lec-versus-finale",
};
const M_KC_FNC_VQF: Match = {
  id: "m2",
  tournament_id: LEC_VERSUS.id,
  tournament: LEC_VERSUS,
  team_blue_id: KC.id,
  team_blue: KC,
  team_red_id: FNC.id,
  team_red: FNC,
  winner_id: KC.id,
  match_date: "2026-03-15T17:00:00Z",
  best_of: 3,
  stage: "Demi-finale",
  slug: "kc-vs-fnc-lec-versus-demi",
};
const M_KC_TH: Match = {
  id: "m3",
  tournament_id: LEC_SPRING.id,
  tournament: LEC_SPRING,
  team_blue_id: TH.id,
  team_blue: TH,
  team_red_id: KC.id,
  team_red: KC,
  winner_id: KC.id,
  match_date: "2026-02-14T18:00:00Z",
  best_of: 3,
  stage: "Week 4",
  slug: "th-vs-kc-lec-winter-w4",
};
const M_KC_SK: Match = {
  id: "m4",
  tournament_id: LEC_SPRING.id,
  tournament: LEC_SPRING,
  team_blue_id: KC.id,
  team_blue: KC,
  team_red_id: SK.id,
  team_red: SK,
  winner_id: KC.id,
  match_date: "2026-01-24T18:00:00Z",
  best_of: 1,
  stage: "Week 1",
  slug: "kc-vs-sk-lec-winter-w1",
};

export const MATCHES = [M_KC_G2_VF, M_KC_FNC_VQF, M_KC_TH, M_KC_SK];

// ─── Games ─────────────────────────────────────────────────────────────────────
// NOTE: Remplace youtubeId par la vraie YouTube ID du VOD LEC
// Ex: https://www.youtube.com/watch?v=XXXXXXXX → youtubeId: "XXXXXXXX"
const G_VF_G1: Game = {
  id: "g1",
  match_id: M_KC_G2_VF.id,
  match: M_KC_G2_VF,
  game_number: 1,
  duration_seconds: 1923,
  winner_side: "blue",
  patch: "25.6",
  vod_url: null, // À remplacer par le vrai VOD
};
const G_VF_G2: Game = {
  id: "g2",
  match_id: M_KC_G2_VF.id,
  match: M_KC_G2_VF,
  game_number: 2,
  duration_seconds: 2241,
  winner_side: "red",
  patch: "25.6",
  vod_url: null,
};
const G_VF_G3: Game = {
  id: "g3",
  match_id: M_KC_G2_VF.id,
  match: M_KC_G2_VF,
  game_number: 3,
  duration_seconds: 1674,
  winner_side: "blue",
  patch: "25.6",
  vod_url: null,
};
const G_DEMI_G1: Game = {
  id: "g4",
  match_id: M_KC_FNC_VQF.id,
  match: M_KC_FNC_VQF,
  game_number: 1,
  duration_seconds: 1821,
  winner_side: "blue",
  patch: "25.6",
  vod_url: null,
};
const G_DEMI_G2: Game = {
  id: "g5",
  match_id: M_KC_FNC_VQF.id,
  match: M_KC_FNC_VQF,
  game_number: 2,
  duration_seconds: 1543,
  winner_side: "blue",
  patch: "25.6",
  vod_url: null,
};
const G_TH_G1: Game = {
  id: "g6",
  match_id: M_KC_TH.id,
  match: M_KC_TH,
  game_number: 1,
  duration_seconds: 1687,
  winner_side: "red",
  patch: "25.4",
  vod_url: null,
};
const G_SK_G1: Game = {
  id: "g7",
  match_id: M_KC_SK.id,
  match: M_KC_SK,
  game_number: 1,
  duration_seconds: 1432,
  winner_side: "blue",
  patch: "25.2",
  vod_url: null,
};

// ─── Kills ─────────────────────────────────────────────────────────────────────
// youtubeId + youtubeStart = le clip joue directement dans la page
// Pour trouver le timestamp : VOD YouTube → avance jusqu'au moment du kill
// Le timestamp = secondes depuis le début de la vidéo

export const DEMO_KILLS: (Kill & {
  youtubeId?: string | null;
  youtubeStart?: number | null;
  youtubeEnd?: number | null;
})[] = [
  // ── Finale KC vs G2 — Game 1 ────────────────────────────────────────────
  {
    id: "k1",
    game_id: "g1",
    game: G_VF_G1,
    game_timestamp_ms: 432000,
    position_x: 3100, position_y: 4200,
    killer_id: YIKE.id, killer: YIKE, killer_champion: "LeeSin",
    victim_id: BROKENBLADE.id, victim: BROKENBLADE, victim_champion: "Ksante",
    kill_type: "first_blood",
    is_first_blood: true, is_ace: false, shutdown_bounty: 400, multi_kill_length: 1,
    kc_is_killer: true, kc_is_victim: false,
    clip_url: null, clip_thumbnail_url: null,
    clip_duration_seconds: 18, camera_status: "on_camera", status: "ready",
    youtubeId: "qHAn7zWJE_Q", // G2 vs KC Grand Final Game 1
    youtubeStart: 432,
    youtubeEnd: 450,
    avg_rating: 4.6, rating_count: 312, comment_count: 48,
    assists: [{ id: "a1", kill_id: "k1", player_id: CANNA.id, player: CANNA, champion: "Gragas", is_kc_player: true }],
    tags: [
      { id: "t1", kill_id: "k1", tag: "first blood", is_auto: true, count: 312 },
      { id: "t2", kill_id: "k1", tag: "gank top", is_auto: false, count: 198 },
    ],
    created_at: "2026-03-23T17:07:12Z",
  },
  {
    id: "k2",
    game_id: "g1",
    game: G_VF_G1,
    game_timestamp_ms: 918000,
    position_x: 9800, position_y: 9100,
    killer_id: KYEAHOO.id, killer: KYEAHOO, killer_champion: "Sylas",
    victim_id: CAPS.id, victim: CAPS, victim_champion: "Azir",
    kill_type: "solo_kill",
    is_first_blood: false, is_ace: false, shutdown_bounty: 900, multi_kill_length: 1,
    kc_is_killer: true, kc_is_victim: false,
    clip_url: null, clip_thumbnail_url: null,
    clip_duration_seconds: 18, camera_status: "on_camera", status: "ready",
    youtubeId: "qHAn7zWJE_Q", // G2 vs KC Grand Final Game 1
    youtubeStart: 918,
    youtubeEnd: 936,
    avg_rating: 4.9, rating_count: 542, comment_count: 87,
    assists: [],
    tags: [
      { id: "t3", kill_id: "k2", tag: "1v1", is_auto: false, count: 389 },
      { id: "t4", kill_id: "k2", tag: "outplay", is_auto: false, count: 421 },
      { id: "t5", kill_id: "k2", tag: "big shutdown", is_auto: true, count: 312 },
    ],
    created_at: "2026-03-23T17:15:18Z",
  },
  {
    id: "k3",
    game_id: "g1",
    game: G_VF_G1,
    game_timestamp_ms: 1284000,
    position_x: 6500, position_y: 5100,
    killer_id: CALISTE.id, killer: CALISTE, killer_champion: "Jinx",
    victim_id: HANS_SAMA.id, victim: HANS_SAMA, victim_champion: "Aphelios",
    kill_type: "double_kill",
    is_first_blood: false, is_ace: false, shutdown_bounty: 500, multi_kill_length: 2,
    kc_is_killer: true, kc_is_victim: false,
    clip_url: null, clip_thumbnail_url: null,
    clip_duration_seconds: 18, camera_status: "on_camera", status: "ready",
    youtubeId: "qHAn7zWJE_Q",
    youtubeStart: null,
    youtubeEnd: null,
    avg_rating: 4.8, rating_count: 478, comment_count: 71,
    assists: [
      { id: "a2", kill_id: "k3", player_id: BUSIO.id, player: BUSIO, champion: "Thresh", is_kc_player: true },
    ],
    tags: [
      { id: "t6", kill_id: "k3", tag: "double kill", is_auto: true, count: 478 },
      { id: "t7", kill_id: "k3", tag: "teamfight", is_auto: true, count: 298 },
      { id: "t8", kill_id: "k3", tag: "adc diff", is_auto: false, count: 356 },
    ],
    created_at: "2026-03-23T17:21:24Z",
  },
  {
    id: "k4",
    game_id: "g1",
    game: G_VF_G1,
    game_timestamp_ms: 1590000,
    position_x: 7200, position_y: 3400,
    killer_id: CANNA.id, killer: CANNA, killer_champion: "Gragas",
    victim_id: BROKENBLADE.id, victim: BROKENBLADE, victim_champion: "Ksante",
    kill_type: "shutdown",
    is_first_blood: false, is_ace: false, shutdown_bounty: 1200, multi_kill_length: 1,
    kc_is_killer: true, kc_is_victim: false,
    clip_url: null, clip_thumbnail_url: null,
    clip_duration_seconds: 18, camera_status: "on_camera", status: "ready",
    youtubeId: "qHAn7zWJE_Q",
    youtubeStart: null,
    youtubeEnd: null,
    avg_rating: 4.5, rating_count: 367, comment_count: 52,
    assists: [
      { id: "a3", kill_id: "k4", player_id: YIKE.id, player: YIKE, champion: "LeeSin", is_kc_player: true },
    ],
    tags: [
      { id: "t9", kill_id: "k4", tag: "big shutdown", is_auto: true, count: 290 },
      { id: "t10", kill_id: "k4", tag: "+1200g", is_auto: false, count: 210 },
    ],
    created_at: "2026-03-23T17:26:30Z",
  },
  // ── Finale KC vs G2 — Game 2 ────────────────────────────────────────────
  {
    id: "k5",
    game_id: "g2",
    game: G_VF_G2,
    game_timestamp_ms: 720000,
    position_x: 2800, position_y: 7100,
    killer_id: CAPS.id, victim_id: KYEAHOO.id,
    killer: CAPS, victim: KYEAHOO,
    killer_champion: "Viktor", victim_champion: "Sylas",
    kill_type: "solo_kill",
    is_first_blood: false, is_ace: false, shutdown_bounty: 600, multi_kill_length: 1,
    kc_is_killer: false, kc_is_victim: true,
    clip_url: null, clip_thumbnail_url: null,
    clip_duration_seconds: 18, camera_status: "on_camera", status: "ready",
    youtubeId: "e3MtBGlCyT8",
    youtubeStart: null,
    youtubeEnd: null,
    avg_rating: 1.8, rating_count: 187, comment_count: 31,
    assists: [],
    tags: [{ id: "t11", kill_id: "k5", tag: "kc death", is_auto: true, count: 187 }],
    created_at: "2026-03-23T17:54:00Z",
  },
  {
    id: "k6",
    game_id: "g2",
    game: G_VF_G2,
    game_timestamp_ms: 1860000,
    position_x: 8900, position_y: 8800,
    killer_id: CALISTE.id, killer: CALISTE, killer_champion: "Zeri",
    victim_id: HANS_SAMA.id, victim: HANS_SAMA, victim_champion: "Jinx",
    kill_type: "triple_kill",
    is_first_blood: false, is_ace: false, shutdown_bounty: 300, multi_kill_length: 3,
    kc_is_killer: true, kc_is_victim: false,
    clip_url: null, clip_thumbnail_url: null,
    clip_duration_seconds: 18, camera_status: "on_camera", status: "ready",
    youtubeId: "e3MtBGlCyT8",
    youtubeStart: null,
    youtubeEnd: null,
    avg_rating: 4.95, rating_count: 891, comment_count: 143,
    assists: [
      { id: "a4", kill_id: "k6", player_id: BUSIO.id, player: BUSIO, champion: "Thresh", is_kc_player: true },
      { id: "a5", kill_id: "k6", player_id: KYEAHOO.id, player: KYEAHOO, champion: "Sylas", is_kc_player: true },
    ],
    tags: [
      { id: "t12", kill_id: "k6", tag: "triple kill", is_auto: true, count: 891 },
      { id: "t13", kill_id: "k6", tag: "teamfight", is_auto: true, count: 654 },
      { id: "t14", kill_id: "k6", tag: "clutch", is_auto: false, count: 712 },
    ],
    created_at: "2026-03-23T18:22:00Z",
  },
  // ── Finale KC vs G2 — Game 3 ────────────────────────────────────────────
  {
    id: "k7",
    game_id: "g3",
    game: G_VF_G3,
    game_timestamp_ms: 384000,
    position_x: 4200, position_y: 6800,
    killer_id: YIKE.id, killer: YIKE, killer_champion: "Viego",
    victim_id: MIKYX.id, victim: MIKYX, victim_champion: "Lulu",
    kill_type: "first_blood",
    is_first_blood: true, is_ace: false, shutdown_bounty: 400, multi_kill_length: 1,
    kc_is_killer: true, kc_is_victim: false,
    clip_url: null, clip_thumbnail_url: null,
    clip_duration_seconds: 18, camera_status: "on_camera", status: "ready",
    youtubeId: "0pBxCGvx6xU",
    youtubeStart: null,
    youtubeEnd: null,
    avg_rating: 4.3, rating_count: 289, comment_count: 39,
    assists: [
      { id: "a6", kill_id: "k7", player_id: KYEAHOO.id, player: KYEAHOO, champion: "Corki", is_kc_player: true },
    ],
    tags: [
      { id: "t15", kill_id: "k7", tag: "first blood", is_auto: true, count: 289 },
      { id: "t16", kill_id: "k7", tag: "invasion", is_auto: false, count: 198 },
    ],
    created_at: "2026-03-23T18:50:24Z",
  },
  {
    id: "k8",
    game_id: "g3",
    game: G_VF_G3,
    game_timestamp_ms: 1440000,
    position_x: 10100, position_y: 9800,
    killer_id: KYEAHOO.id, killer: KYEAHOO, killer_champion: "Corki",
    victim_id: CAPS.id, victim: CAPS, victim_champion: "Viktor",
    kill_type: "penta_kill",
    is_first_blood: false, is_ace: true, shutdown_bounty: 0, multi_kill_length: 5,
    kc_is_killer: true, kc_is_victim: false,
    clip_url: null, clip_thumbnail_url: null,
    clip_duration_seconds: 25, camera_status: "on_camera", status: "ready",
    youtubeId: "0pBxCGvx6xU",
    youtubeStart: null,
    youtubeEnd: null,
    avg_rating: 5.0, rating_count: 2341, comment_count: 412,
    assists: [],
    tags: [
      { id: "t17", kill_id: "k8", tag: "PENTA KILL", is_auto: true, count: 2341 },
      { id: "t18", kill_id: "k8", tag: "ace", is_auto: true, count: 2341 },
      { id: "t19", kill_id: "k8", tag: "clutch", is_auto: false, count: 1987 },
      { id: "t20", kill_id: "k8", tag: "1v5", is_auto: false, count: 1654 },
    ],
    created_at: "2026-03-23T19:04:00Z",
  },
  // ── Demi-finale KC vs FNC — Game 1 ──────────────────────────────────────
  {
    id: "k9",
    game_id: "g4",
    game: G_DEMI_G1,
    game_timestamp_ms: 546000,
    position_x: 3600, position_y: 5200,
    killer_id: CALISTE.id, killer: CALISTE, killer_champion: "Caitlyn",
    victim_id: FLAKKED.id, victim: FLAKKED, victim_champion: "Zeri",
    kill_type: "first_blood",
    is_first_blood: true, is_ace: false, shutdown_bounty: 400, multi_kill_length: 1,
    kc_is_killer: true, kc_is_victim: false,
    clip_url: null, clip_thumbnail_url: null,
    clip_duration_seconds: 18, camera_status: "on_camera", status: "ready",
    youtubeId: "KIZVnYokEEo",
    youtubeStart: null,
    youtubeEnd: null,
    avg_rating: 4.4, rating_count: 234, comment_count: 28,
    assists: [
      { id: "a7", kill_id: "k9", player_id: BUSIO.id, player: BUSIO, champion: "Nautilus", is_kc_player: true },
    ],
    tags: [
      { id: "t21", kill_id: "k9", tag: "first blood", is_auto: true, count: 234 },
      { id: "t22", kill_id: "k9", tag: "lane kill", is_auto: false, count: 178 },
    ],
    created_at: "2026-03-15T17:09:06Z",
  },
  {
    id: "k10",
    game_id: "g4",
    game: G_DEMI_G1,
    game_timestamp_ms: 1380000,
    position_x: 7800, position_y: 4500,
    killer_id: CANNA.id, killer: CANNA, killer_champion: "Jax",
    victim_id: OSCARININ.id, victim: OSCARININ, victim_champion: "Fiora",
    kill_type: "solo_kill",
    is_first_blood: false, is_ace: false, shutdown_bounty: 450, multi_kill_length: 1,
    kc_is_killer: true, kc_is_victim: false,
    clip_url: null, clip_thumbnail_url: null,
    clip_duration_seconds: 18, camera_status: "on_camera", status: "ready",
    youtubeId: "KIZVnYokEEo",
    youtubeStart: null,
    youtubeEnd: null,
    avg_rating: 4.7, rating_count: 356, comment_count: 54,
    assists: [],
    tags: [
      { id: "t23", kill_id: "k10", tag: "1v1", is_auto: false, count: 298 },
      { id: "t24", kill_id: "k10", tag: "top diff", is_auto: false, count: 245 },
    ],
    created_at: "2026-03-15T17:23:00Z",
  },
  // ── Demi-finale KC vs FNC — Game 2 ──────────────────────────────────────
  {
    id: "k11",
    game_id: "g5",
    game: G_DEMI_G2,
    game_timestamp_ms: 960000,
    position_x: 6100, position_y: 4900,
    killer_id: KYEAHOO.id, killer: KYEAHOO, killer_champion: "Tristana",
    victim_id: HUMANOID.id, victim: HUMANOID, victim_champion: "Yone",
    kill_type: "solo_kill",
    is_first_blood: false, is_ace: false, shutdown_bounty: 700, multi_kill_length: 1,
    kc_is_killer: true, kc_is_victim: false,
    clip_url: null, clip_thumbnail_url: null,
    clip_duration_seconds: 18, camera_status: "on_camera", status: "ready",
    youtubeId: "KIZVnYokEEo",
    youtubeStart: null,
    youtubeEnd: null,
    avg_rating: 4.8, rating_count: 423, comment_count: 67,
    assists: [],
    tags: [
      { id: "t25", kill_id: "k11", tag: "mid diff", is_auto: false, count: 356 },
      { id: "t26", kill_id: "k11", tag: "big shutdown", is_auto: true, count: 312 },
      { id: "t27", kill_id: "k11", tag: "solo carry", is_auto: false, count: 289 },
    ],
    created_at: "2026-03-15T18:46:00Z",
  },
  // ── LEC Winter — KC vs TH ────────────────────────────────────────────────
  {
    id: "k12",
    game_id: "g6",
    game: G_TH_G1,
    game_timestamp_ms: 660000,
    position_x: 5200, position_y: 5000,
    killer_id: YIKE.id, killer: YIKE, killer_champion: "Jarvan",
    victim_id: JACKIES.id, victim: JACKIES, victim_champion: "LeBlanc",
    kill_type: "first_blood",
    is_first_blood: true, is_ace: false, shutdown_bounty: 400, multi_kill_length: 1,
    kc_is_killer: true, kc_is_victim: false,
    clip_url: null, clip_thumbnail_url: null,
    clip_duration_seconds: 18, camera_status: "on_camera", status: "ready",
    youtubeId: "FTcm5EIba10",
    youtubeStart: null,
    youtubeEnd: null,
    avg_rating: 4.1, rating_count: 167, comment_count: 21,
    assists: [
      { id: "a8", kill_id: "k12", player_id: KYEAHOO.id, player: KYEAHOO, champion: "Orianna", is_kc_player: true },
    ],
    tags: [
      { id: "t28", kill_id: "k12", tag: "gank mid", is_auto: false, count: 134 },
    ],
    created_at: "2026-02-14T18:11:00Z",
  },
  // ── LEC Winter — KC vs SK ────────────────────────────────────────────────
  {
    id: "k13",
    game_id: "g7",
    game: G_SK_G1,
    game_timestamp_ms: 1248000,
    position_x: 8400, position_y: 2100,
    killer_id: BUSIO.id, killer: BUSIO, killer_champion: "Senna",
    victim_id: LYNCAS.id, victim: LYNCAS, victim_champion: "Aphelios",
    kill_type: "solo_kill",
    is_first_blood: false, is_ace: false, shutdown_bounty: 300, multi_kill_length: 1,
    kc_is_killer: true, kc_is_victim: false,
    clip_url: null, clip_thumbnail_url: null,
    clip_duration_seconds: 18, camera_status: "on_camera", status: "ready",
    youtubeId: "vuS5ekbMCf0",
    youtubeStart: null,
    youtubeEnd: null,
    avg_rating: 4.6, rating_count: 289, comment_count: 44,
    assists: [
      { id: "a9", kill_id: "k13", player_id: CALISTE.id, player: CALISTE, champion: "Ezreal", is_kc_player: true },
    ],
    tags: [
      { id: "t29", kill_id: "k13", tag: "support carry", is_auto: false, count: 212 },
      { id: "t30", kill_id: "k13", tag: "outplay", is_auto: false, count: 178 },
    ],
    created_at: "2026-01-24T18:20:48Z",
  },
];

// ─── Comments ─────────────────────────────────────────────────────────────────
export const DEMO_COMMENTS: (Comment & { profile: Profile })[] = [
  {
    id: "c1",
    kill_id: "k8",
    user_id: "u1",
    parent_id: null,
    content: "KYEAHOO PENTA EN FINALE LEC. JE PLEURE. HISTORIC.",
    upvotes: 312,
    is_edited: false,
    created_at: "2026-03-23T19:04:30Z",
    profile: { id: "u1", username: "KCFanatic", avatar_url: null, total_ratings: 892, total_comments: 234, badges: ["early_rater", "veteran"] },
  },
  {
    id: "c2",
    kill_id: "k8",
    user_id: "u2",
    parent_id: null,
    content: "Le Corki package sur Caps pour ouvrir le penta... Kyeahoo est trop fort mdr",
    upvotes: 187,
    is_edited: false,
    created_at: "2026-03-23T19:05:12Z",
    profile: { id: "u2", username: "LoLAnalyst_FR", avatar_url: null, total_ratings: 1204, total_comments: 456, badges: ["analyst"] },
  },
  {
    id: "c3",
    kill_id: "k8",
    user_id: "u3",
    parent_id: null,
    content: "VIVE KC 🇫🇷🇫🇷🇫🇷",
    upvotes: 245,
    is_edited: false,
    created_at: "2026-03-23T19:06:00Z",
    profile: { id: "u3", username: "BleuBlanRouge", avatar_url: null, total_ratings: 234, total_comments: 89, badges: [] },
  },
  {
    id: "c4",
    kill_id: "k2",
    user_id: "u2",
    parent_id: null,
    content: "Kyeahoo steal le Shurima Shuffle de Caps et le tue avec... C'est de la poésie.",
    upvotes: 156,
    is_edited: false,
    created_at: "2026-03-23T17:15:45Z",
    profile: { id: "u2", username: "LoLAnalyst_FR", avatar_url: null, total_ratings: 1204, total_comments: 456, badges: ["analyst"] },
  },
  {
    id: "c5",
    kill_id: "k6",
    user_id: "u4",
    parent_id: null,
    content: "Le TRIPLE de Caliste pour égaliser dans la série... Ce sang froid.",
    upvotes: 289,
    is_edited: false,
    created_at: "2026-03-23T18:22:30Z",
    profile: { id: "u4", username: "Caliste_fan", avatar_url: null, total_ratings: 567, total_comments: 123, badges: ["adc_enjoyer"] },
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
export function getPlayerKills(playerId: string): typeof DEMO_KILLS {
  return DEMO_KILLS.filter(
    (k) => k.killer_id === playerId || k.victim_id === playerId
  );
}

export function getPlayerStats(player: Player) {
  const kills = DEMO_KILLS.filter((k) => k.killer_id === player.id);
  const deaths = DEMO_KILLS.filter((k) => k.victim_id === player.id);
  const assists = DEMO_KILLS.filter((k) =>
    k.assists?.some((a) => a.player_id === player.id)
  );

  const avgRating =
    kills.length > 0
      ? kills.reduce((acc, k) => acc + k.avg_rating, 0) / kills.length
      : 0;

  const allKills = [...kills].sort((a, b) => b.avg_rating - a.avg_rating);
  const bestKill = allKills[0] ?? null;

  const champMap: Record<string, { kills: number; deaths: number }> = {};
  kills.forEach((k) => {
    const c = k.killer_champion;
    if (!champMap[c]) champMap[c] = { kills: 0, deaths: 0 };
    champMap[c].kills++;
  });
  deaths.forEach((k) => {
    const c = k.victim_champion;
    if (!champMap[c]) champMap[c] = { kills: 0, deaths: 0 };
    champMap[c].deaths++;
  });

  return {
    player,
    total_kills: kills.length,
    total_deaths: deaths.length,
    total_assists: assists.length,
    avg_kill_rating: avgRating,
    best_rated_kill: bestKill,
    champion_breakdown: Object.entries(champMap)
      .map(([champion, s]) => ({ champion, ...s }))
      .sort((a, b) => b.kills - a.kills),
    games_played: new Set([...kills, ...deaths].map((k) => k.game_id)).size,
  };
}
