// Achievement definitions — computed from the per-device SaveData, so
// unlocking one doesn't require an account.
import { levelsCleared, type SaveData } from "../lib/localSave.ts";

export interface Achievement {
  id: string;
  title: string;
  description: string;
  /** lucide-react icon name, resolved by the component that renders these. */
  icon: "Star" | "Flame" | "Zap" | "Gauge" | "Target" | "Trophy";
  isUnlocked: (save: SaveData) => boolean;
  /** Shown under a locked achievement, e.g. "Best streak: 2". */
  progress?: (save: SaveData) => string;
}

export const ACHIEVEMENTS: Achievement[] = [
  {
    id: "first_win",
    title: "First Pour",
    description: "Solve your first daily puzzle.",
    icon: "Star",
    isUnlocked: (s) => s.totalDailyWins >= 1,
  },
  {
    id: "perfect",
    title: "Three Stars",
    description: "Solve a daily puzzle within the move target, no hints.",
    icon: "Target",
    isUnlocked: (s) => s.perfectWins >= 1,
  },
  {
    id: "streak_3",
    title: "On a Roll",
    description: "Reach a 3-day streak.",
    icon: "Flame",
    isUnlocked: (s) => s.maxStreak >= 3,
    progress: (s) => `Best streak: ${s.maxStreak}`,
  },
  {
    id: "streak_7",
    title: "Week Streak",
    description: "Reach a 7-day streak.",
    icon: "Flame",
    isUnlocked: (s) => s.maxStreak >= 7,
    progress: (s) => `Best streak: ${s.maxStreak}`,
  },
  {
    id: "speed_90",
    title: "Quick Pour",
    description: "Solve a daily puzzle in under 90 seconds.",
    icon: "Zap",
    isUnlocked: (s) => s.bestDailyTimeMs !== null && s.bestDailyTimeMs < 90_000,
  },
  {
    id: "levels_10",
    title: "Getting Warm",
    description: "Finish 10 levels.",
    icon: "Gauge",
    isUnlocked: (s) => levelsCleared(s) >= 10,
    progress: (s) => `${levelsCleared(s)} / 10 levels`,
  },
  {
    id: "levels_20",
    title: "Free Run",
    description: "Finish all 20 free levels.",
    icon: "Trophy",
    isUnlocked: (s) => levelsCleared(s) >= 20,
    progress: (s) => `${levelsCleared(s)} / 20 levels`,
  },
  {
    id: "dedicated_25",
    title: "Dedicated",
    description: "Solve 25 daily puzzles.",
    icon: "Trophy",
    isUnlocked: (s) => s.totalDailyWins >= 25,
    progress: (s) => `${s.totalDailyWins} / 25`,
  },
];

/** Ids of achievements newly true in `save` that weren't already unlocked. */
export function diffNewlyUnlocked(save: SaveData, prevUnlockedIds: string[]): string[] {
  const prev = new Set(prevUnlockedIds);
  return ACHIEVEMENTS.filter((a) => !prev.has(a.id) && a.isUnlocked(save)).map((a) => a.id);
}
