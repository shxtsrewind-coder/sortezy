// Local save for what's inherently per-device: today's puzzle in progress,
// level progress and stars, the win streak, the level unlock flag, and the
// stats achievements are computed from. Identity and leaderboard standing
// live in Supabase (lib/supabase.ts ensureSession + lib/leaderboard.ts).
import type { Move } from "./sort.ts";

const KEY = "sortezy.save.v1";

/** Today's daily puzzle. Kept in storage so a reload mid-puzzle neither
 *  resets the clock nor loses the pours already made. */
export interface DailyProgress {
  date: string;
  /** Wall-clock start (ms since epoch), set when the player presses Play. */
  startedAt: number;
  /** Pours made so far, in order (undo removes the last one). */
  moves: Move[];
  /** Hints used — each adds HINT_PENALTY_MS to the final time. */
  hints: number;
  /** Final time (penalties included) once the puzzle is solved. */
  finishedMs: number | null;
}

export interface SaveData {
  lastSolvedDate: string | null;
  streak: number;
  maxStreak: number;
  totalDailyWins: number;
  /** Daily wins at or under the target with no hints. */
  perfectWins: number;
  bestDailyTimeMs: number | null;
  /** Levels beyond the free ones (stub until payments exist). */
  unlockedLevels: boolean;
  /** Best stars per level number. */
  levelStars: Record<string, number>;
  /** The level the Levels tab opens on. */
  currentLevel: number;
  displayName: string | null;
  unlockedAchievements: string[];
  daily: DailyProgress | null;
}

const DEFAULTS: SaveData = {
  lastSolvedDate: null,
  streak: 0,
  maxStreak: 0,
  totalDailyWins: 0,
  perfectWins: 0,
  bestDailyTimeMs: null,
  unlockedLevels: false,
  levelStars: {},
  currentLevel: 1,
  displayName: null,
  unlockedAchievements: [],
  daily: null,
};

function read(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

function write(data: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* storage unavailable (private mode, etc.) */
  }
}

/** Levels finished at least once. */
export function levelsCleared(save: SaveData): number {
  return Object.keys(save.levelStars).length;
}

export const localSave = {
  get: read,

  startDaily(date: string): SaveData {
    const data = read();
    data.daily = { date, startedAt: Date.now(), moves: [], hints: 0, finishedMs: null };
    write(data);
    return data;
  },

  updateDaily(patch: Partial<DailyProgress>): SaveData {
    const data = read();
    if (data.daily) data.daily = { ...data.daily, ...patch };
    write(data);
    return data;
  },

  /** Records a finished daily: streak, stats and best time. Counts once per
   *  calendar day. */
  recordDailyWin(date: string, timeMs: number, perfect: boolean): SaveData {
    const data = read();
    if (data.daily && data.daily.date === date) data.daily.finishedMs = timeMs;

    if (data.lastSolvedDate !== date) {
      const yesterday = new Date(Date.parse(date + "T00:00:00Z") - 86400000).toISOString().slice(0, 10);
      data.streak = data.lastSolvedDate === yesterday ? data.streak + 1 : 1;
      data.lastSolvedDate = date;
      data.maxStreak = Math.max(data.maxStreak, data.streak);
      data.totalDailyWins += 1;
      if (perfect) data.perfectWins += 1;
      data.bestDailyTimeMs = data.bestDailyTimeMs === null ? timeMs : Math.min(data.bestDailyTimeMs, timeMs);
    }
    write(data);
    return data;
  },

  /** Keeps the best stars for a level and moves the player on to the next. */
  recordLevelWin(level: number, stars: number): SaveData {
    const data = read();
    const prev = data.levelStars[String(level)] ?? 0;
    data.levelStars[String(level)] = Math.max(prev, stars);
    write(data);
    return data;
  },

  setCurrentLevel(level: number): SaveData {
    const data = read();
    data.currentLevel = Math.max(1, level);
    write(data);
    return data;
  },

  setUnlockedAchievements(ids: string[]): SaveData {
    const data = read();
    data.unlockedAchievements = ids;
    write(data);
    return data;
  },

  /** Placeholder until a real payment processor is wired up — never call
   *  this from anywhere except a confirmed, server-verified purchase. */
  setUnlocked(value: boolean): SaveData {
    const data = read();
    data.unlockedLevels = value;
    write(data);
    return data;
  },

  setDisplayName(name: string): SaveData {
    const data = read();
    data.displayName = name.trim().slice(0, 20) || null;
    write(data);
    return data;
  },
};
