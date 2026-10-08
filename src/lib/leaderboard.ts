// Daily leaderboard — backed by Supabase (the project shared with the
// Wordezy games; see supabase/migrations for the sortezy_* tables). Writes go
// through a SECURITY DEFINER RPC that reads the player's identity and display
// name from the session itself, never from client-supplied values.
import { supabase } from "./supabase.ts";

export interface LeaderboardEntry {
  playerId: string;
  displayName: string;
  moves: number;
  hints: number;
  timeMs: number;
  isYou: boolean;
}

/** Records the signed-in player's finish for a puzzle date. Only the first
 *  finish of the day counts — the RPC ignores any later submission. */
export async function submitScore(opts: { puzzleDate: string; moves: number; hints: number; target: number; timeMs: number }): Promise<void> {
  const { error } = await supabase.rpc("submit_sortezy_score", {
    p_puzzle_date: opts.puzzleDate,
    p_moves: opts.moves,
    p_hints: opts.hints,
    p_target: opts.target,
    p_time_ms: Math.max(1, Math.round(opts.timeMs)),
  });
  if (error) throw error;
}

/** Returns this game's display name for the signed-in player, copying it
 *  over from the Wordezy games the first time an existing account plays.
 *  Null for guests who haven't picked a name. */
export async function ensureProfile(): Promise<string | null> {
  const { data, error } = await supabase.rpc("sortezy_ensure_profile");
  if (error) throw error;
  return (data as string | null) ?? null;
}

/** Fewest moves first, fastest time as the tiebreaker. */
export async function getDailyLeaderboard(puzzleDate: string, currentPlayerId: string | null, limit = 10): Promise<LeaderboardEntry[]> {
  const { data, error } = await supabase.rpc("sortezy_daily_leaderboard", { p_puzzle_date: puzzleDate, p_limit: limit });
  if (error) throw error;
  return (data ?? []).map((row: { player_id: string; display_name: string; moves: number; hints: number; time_ms: number }) => ({
    playerId: row.player_id,
    displayName: row.display_name,
    moves: row.moves,
    hints: row.hints,
    timeMs: row.time_ms,
    isYou: row.player_id === currentPlayerId,
  }));
}

export interface AllTimeLeaderboardEntry {
  playerId: string;
  displayName: string;
  wins: number;
  /** Daily puzzles solved at or under the target with no hints. */
  perfect: number;
  isYou: boolean;
}

/** All-time standings: most daily finishes, then most three-star finishes. */
export async function getAllTimeLeaderboard(currentPlayerId: string | null, limit = 10): Promise<AllTimeLeaderboardEntry[]> {
  const { data, error } = await supabase.rpc("sortezy_alltime_leaderboard", { p_limit: limit });
  if (error) throw error;
  return (data ?? []).map((row: { player_id: string; display_name: string; wins: number; perfect: number }) => ({
    playerId: row.player_id,
    displayName: row.display_name,
    wins: Number(row.wins),
    perfect: Number(row.perfect),
    isYou: row.player_id === currentPlayerId,
  }));
}
