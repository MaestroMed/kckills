export type KillStatus =
  | "pending"
  | "vod_searching"
  | "vod_found"
  | "clipping"
  | "uploading"
  | "ready"
  | "failed"
  | "no_vod";

export type KillType =
  | "solo_kill"
  | "first_blood"
  | "double_kill"
  | "triple_kill"
  | "quadra_kill"
  | "penta_kill"
  | "ace"
  | "shutdown"
  | "regular";

export type CameraStatus = "on_camera" | "off_camera" | "unknown";
export type Role = "top" | "jungle" | "mid" | "adc" | "support";

export interface Tournament {
  id: string;
  name: string;
  slug: string;
  region: string;
  split: string;
  year: number;
  start_date: string | null;
  end_date: string | null;
}

export interface Team {
  id: string;
  name: string;
  slug: string;
  short_name: string;
  logo_url: string | null;
  is_tracked: boolean;
}

export interface Player {
  id: string;
  summoner_name: string;
  slug: string;
  real_name: string | null;
  role: Role;
  team_id: string;
  team?: Team;
  profile_image_url: string | null;
  is_active: boolean;
}

export interface Match {
  id: string;
  tournament_id: string;
  tournament?: Tournament;
  team_blue_id: string;
  team_blue?: Team;
  team_red_id: string;
  team_red?: Team;
  winner_id: string | null;
  match_date: string;
  best_of: number;
  stage: string | null;
  slug: string;
}

export interface Game {
  id: string;
  match_id: string;
  match?: Match;
  game_number: number;
  duration_seconds: number | null;
  winner_side: "blue" | "red" | null;
  patch: string | null;
  vod_url: string | null;
}

export interface Kill {
  id: string;
  game_id: string;
  game?: Game;
  game_timestamp_ms: number;
  position_x: number | null;
  position_y: number | null;
  killer_id: string;
  killer?: Player;
  killer_champion: string;
  victim_id: string;
  victim?: Player;
  victim_champion: string;
  kill_type: KillType;
  is_first_blood: boolean;
  is_ace: boolean;
  shutdown_bounty: number;
  multi_kill_length: number;
  kc_is_killer: boolean;
  kc_is_victim: boolean;
  clip_url: string | null;
  clip_thumbnail_url: string | null;
  clip_duration_seconds: number;
  camera_status: CameraStatus;
  status: KillStatus;
  avg_rating: number;
  rating_count: number;
  comment_count: number;
  assists?: KillAssist[];
  tags?: KillTag[];
  created_at: string;
}

export interface KillAssist {
  id: string;
  kill_id: string;
  player_id: string;
  player?: Player;
  champion: string;
  is_kc_player: boolean;
}

export interface KillTag {
  id: string;
  kill_id: string;
  tag: string;
  is_auto: boolean;
  count: number;
}

export interface Rating {
  id: string;
  kill_id: string;
  user_id: string;
  score: number;
}

export interface Comment {
  id: string;
  kill_id: string;
  user_id: string;
  profile?: Profile;
  parent_id: string | null;
  /** DB column is `content` (max 500 chars) — see migration 001. */
  content: string;
  upvotes: number;
  is_edited: boolean;
  /** Set client-side when GET returns the author's own pending comments. */
  _pending?: boolean;
  created_at: string;
  replies?: Comment[];
}

export interface Profile {
  id: string;
  /** Source of truth field is `discord_username` (see profiles table). */
  username?: string;
  discord_username?: string;
  avatar_url?: string | null;
  discord_avatar_url?: string | null;
  total_ratings: number;
  total_comments: number;
  badges: string[];
}

// Utility types
export interface KillWithRelations extends Kill {
  killer: Player;
  victim: Player;
  game: Game & {
    match: Match & {
      team_blue: Team;
      team_red: Team;
      tournament: Tournament;
    };
  };
  assists: (KillAssist & { player: Player })[];
  tags: KillTag[];
}

export interface PlayerStats {
  player: Player;
  total_kills: number;
  total_deaths: number;
  total_assists: number;
  avg_kill_rating: number;
  best_rated_kill: Kill | null;
  champion_breakdown: { champion: string; kills: number; deaths: number }[];
  games_played: number;
}
