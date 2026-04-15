-- Multi-point VOD calibration: stores time map per game
-- Each entry maps a game_time to a vod_time for piecewise linear interpolation
-- Example: [{"game_time": 300, "vod_time": 3870}, {"game_time": 600, "vod_time": 4180}, ...]
ALTER TABLE games ADD COLUMN IF NOT EXISTS vod_time_map JSONB;
