import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Lock,
  Sparkles,
  Flame,
  Timer as TimerIcon,
  WifiOff,
  Award,
  Play,
  Share2,
  Check,
  Lightbulb,
  Undo2,
  RotateCcw,
  ChevronRight,
  LayoutGrid,
  X,
  Star,
  Shapes,
  Hand,
} from "lucide-react";
import { SortBoard } from "../components/SortBoard.tsx";
import { Leaderboard } from "../components/Leaderboard.tsx";
import { AuthModal } from "../components/AuthModal.tsx";
import { Confetti } from "../components/Confetti.tsx";
import { AchievementToastStack } from "../components/AchievementToast.tsx";
import { AchievementsModal } from "../components/AchievementsModal.tsx";
import {
  applyMove,
  getDailyPuzzle,
  getLevel,
  hintFor,
  isSolved,
  legalMoves,
  msUntilNextPuzzle,
  pourAmount,
  starsFor,
  todayUtc,
  FREE_LEVELS,
  type Board,
  type Move,
  type Puzzle,
} from "../lib/sort.ts";
import { localSave, levelsCleared, type DailyProgress } from "../lib/localSave.ts";
import { submitScore, ensureProfile } from "../lib/leaderboard.ts";
import { supabase, ensureSession, currentUser, withTimeout, BOOT_STEP_MS } from "../lib/supabase.ts";
import { useElapsed, formatTime, formatCountdown } from "../hooks/useTimer.ts";
import { ACHIEVEMENTS, diffNewlyUnlocked, type Achievement } from "../data/achievements.ts";
import { buildShareText, shareResult } from "../lib/share.ts";

type Mode = "daily" | "levels";
type Phase = "auth_checking" | "choice" | "ready";

/** Each hint adds this much to the daily time, so hints can't buy a fast time. */
const HINT_PENALTY_MS = 10_000;
const PLAY_CHOICE_KEY = "sortezy.playChoice";
const SYMBOLS_KEY = "sortezy.symbols";

const OTHER_GAMES = [
  { name: "Wordezy", url: "https://wordezy.bgameworld.com/" },
  { name: "Wordezy Search", url: "https://wordezysearch.bgameworld.com/" },
  { name: "Wordezy Scramble", url: "https://wordezyscramble.bgameworld.com/" },
  { name: "Wordezy Ladder", url: "https://wordezyladder.bgameworld.com/" },
  { name: "When & Where", url: "https://whenandwhere.bgameworld.com/" },
];

/** Four little tubes in the brand colours, the last one corked. */
const Wordmark: React.FC<{ className?: string }> = ({ className = "flex" }) => (
  <div className={`${className} items-end gap-[3px] h-7`} aria-hidden="true">
    {[
      ["#1f9a62", "#c9922f", "#1f9a62"],
      ["#c9922f", "#1f9a62", "#c9922f"],
      ["#1f9a62", "#1f9a62", "#c9922f"],
      ["#c9922f", "#c9922f", "#c9922f"],
    ].map((col, i) => (
      <span key={i} className="relative w-[9px] h-6 rounded-b-full border border-t-0 border-paper/40 overflow-hidden flex flex-col-reverse">
        {col.map((c, k) => (
          <span key={k} className="h-1/3 shrink-0" style={{ background: c }} />
        ))}
      </span>
    ))}
  </div>
);

const Stars: React.FC<{ count: number; size?: string }> = ({ count, size = "w-6 h-6" }) => (
  <span className="inline-flex gap-1" aria-label={`${count} of 3 stars`}>
    {[1, 2, 3].map((i) => (
      <Star key={i} className={`${size} ${i <= count ? "text-present fill-present" : "text-faint"}`} />
    ))}
  </span>
);

function replay(start: Board, moves: Move[]): Board {
  let b = start;
  for (const m of moves) b = applyMove(b, m);
  return b;
}

/** Tracks a play session on one puzzle: pours, undo, restart, hint. */
function usePlay(puzzle: Puzzle, initialMoves: Move[] = []) {
  const [moves, setMoves] = useState<Move[]>(initialMoves);
  const [version, setVersion] = useState(0);
  const [lastPour, setLastPour] = useState<{ to: number; count: number } | null>(null);
  const [hint, setHint] = useState<Move | null>(null);
  const [stuck, setStuck] = useState(false);
  const board = useMemo(() => replay(puzzle.tubes, moves), [puzzle, moves]);

  useEffect(() => {
    setMoves(initialMoves);
    setVersion((v) => v + 1);
    setLastPour(null);
    setHint(null);
    setStuck(false);
    // Only a new puzzle resets the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puzzle.id]);

  const pour = (m: Move): Move[] => {
    const count = pourAmount(board, m.from, m.to);
    const next = [...moves, m];
    setMoves(next);
    setLastPour({ to: m.to, count });
    setVersion((v) => v + 1);
    setHint(null);
    const after = applyMove(board, m);
    setStuck(!isSolved(after) && legalMoves(after).length === 0);
    return next;
  };
  const undo = (): Move[] => {
    const next = moves.slice(0, -1);
    setMoves(next);
    setLastPour(null);
    setVersion((v) => v + 1);
    setHint(null);
    setStuck(false);
    return next;
  };
  const restart = (): Move[] => {
    setMoves([]);
    setLastPour(null);
    setVersion((v) => v + 1);
    setHint(null);
    setStuck(false);
    return [];
  };
  /** Shows the best next pour; returns false if the position is a dead end. */
  const showHint = (): boolean => {
    const h = hintFor(board);
    setHint(h);
    setStuck(h === null && !isSolved(board));
    return h !== null;
  };
  return { moves, board, version, lastPour, hint, stuck, pour, undo, restart, showHint, setMoves };
}

export const GamePage: React.FC = () => {
  const [phase, setPhase] = useState<Phase>("auth_checking");
  // Sign-in couldn't be reached: the game plays, the leaderboard waits.
  const [offline, setOffline] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("Player");
  const [hasProfile, setHasProfile] = useState(false);
  const [showAuth, setShowAuth] = useState(false);

  const [mode, setMode] = useState<Mode>("daily");
  const [save, setSave] = useState(() => localSave.get());
  const [today] = useState(() => todayUtc());
  const daily = useMemo(() => getDailyPuzzle(today), [today]);

  const [leaderboardKey, setLeaderboardKey] = useState(0);
  const [scoreStatus, setScoreStatus] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [showAchievements, setShowAchievements] = useState(false);
  const [showLevels, setShowLevels] = useState(false);
  const [newlyUnlocked, setNewlyUnlocked] = useState<Achievement[] | null>(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const [shareState, setShareState] = useState<"idle" | "shared" | "copied" | "failed">("idle");
  const [symbols, setSymbols] = useState(() => {
    try {
      return localStorage.getItem(SYMBOLS_KEY) === "1";
    } catch {
      return false;
    }
  });

  const progress: DailyProgress | null = save.daily && save.daily.date === today ? save.daily : null;
  const dailyDone = !!progress && progress.finishedMs !== null;
  const dailyPlay = usePlay(daily, progress?.moves ?? []);
  const dailyRunning = !!progress && !dailyDone && phase === "ready";
  const dailyElapsed = useElapsed(progress?.startedAt ?? null, dailyRunning);
  const dailyTime = dailyDone ? (progress!.finishedMs as number) : dailyElapsed + (progress?.hints ?? 0) * HINT_PENALTY_MS;

  const [level, setLevel] = useState(() => localSave.get().currentLevel);
  const levelPuzzle = useMemo(() => getLevel(level), [level]);
  const levelPlay = usePlay(levelPuzzle);
  const [levelWon, setLevelWon] = useState<number | null>(null);
  const levelLocked = level > FREE_LEVELS && !save.unlockedLevels;
  const highestCleared = useMemo(
    () => Object.keys(save.levelStars).reduce((m, k) => Math.max(m, Number(k)), 0),
    [save.levelStars]
  );

  const toggleSymbols = () => {
    setSymbols((s) => {
      try {
        localStorage.setItem(SYMBOLS_KEY, s ? "0" : "1");
      } catch {
        /* preference just won't persist */
      }
      return !s;
    });
  };

  const unlockAchievements = useCallback((updated: ReturnType<typeof localSave.get>) => {
    const prev = updated.unlockedAchievements;
    const newIds = diffNewlyUnlocked(updated, prev);
    if (newIds.length === 0) return updated;
    setNewlyUnlocked(ACHIEVEMENTS.filter((a) => newIds.includes(a.id)));
    return localSave.setUnlockedAchievements([...prev, ...newIds]);
  }, []);

  const submitDaily = useCallback(
    (moves: number, hints: number, timeMs: number) => {
      setScoreStatus("saving");
      submitScore({ puzzleDate: today, moves, hints, target: daily.target, timeMs })
        .then(() => {
          setScoreStatus("saved");
          setLeaderboardKey((k) => k + 1);
        })
        .catch(() => setScoreStatus("failed"));
    },
    [today, daily.target]
  );

  /** `quiet` retries in the background (the Retry link, coming back online)
   *  without swapping the game out for the loading screen. */
  const bootAuth = useCallback(async (quiet = false) => {
    if (!quiet) setPhase("auth_checking");
    try {
      const session = await ensureSession();
      if (!session.ok) {
        // Offline, blocked or down. The puzzle doesn't need the server, so
        // play locally; scores sync once a later retry gets through.
        setOffline(true);
        setPhase("ready");
        return;
      }
      setOffline(false);
      const user = await currentUser();
      const uid = user?.id ?? null;
      const anon = user?.is_anonymous ?? true;
      setUserId(uid);

      const name = await withTimeout(ensureProfile(), BOOT_STEP_MS, null);
      if (name) {
        setDisplayName(name);
        setHasProfile(true);
        // A finish from earlier today that never reached the server gets
        // another try. Only the first finish ever counts.
        const s = localSave.get();
        if (s.daily && s.daily.date === todayUtc() && s.daily.finishedMs !== null) {
          submitScore({
            puzzleDate: s.daily.date,
            moves: s.daily.moves.length,
            hints: s.daily.hints,
            target: getDailyPuzzle(s.daily.date).target,
            timeMs: s.daily.finishedMs,
          })
            .then(() => setLeaderboardKey((k) => k + 1))
            .catch(() => undefined);
        }
      }
      const choiceDone = typeof window !== "undefined" && sessionStorage.getItem(PLAY_CHOICE_KEY) === "true";
      setPhase(!anon || choiceDone || name || quiet ? "ready" : "choice");
    } catch (err) {
      console.error("Failed to establish session:", err);
      setOffline(true);
      setPhase("ready");
    }
  }, []);

  useEffect(() => {
    bootAuth();
  }, [bootAuth]);

  useEffect(() => {
    if (!offline) return;
    const retry = () => bootAuth(true);
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [offline, bootAuth]);

  const handleAuthResolved = useCallback(
    (opts: { isAnonymous: boolean; displayName?: string }) => {
      if (typeof window !== "undefined") sessionStorage.setItem(PLAY_CHOICE_KEY, "true");
      setShowAuth(false);
      setPhase("ready");
      if (!opts.displayName && opts.isAnonymous) return;
      if (opts.displayName) setDisplayName(opts.displayName);
      setHasProfile(true);
      supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
      const s = localSave.get();
      if (s.daily && s.daily.date === today && s.daily.finishedMs !== null) {
        submitDaily(s.daily.moves.length, s.daily.hints, s.daily.finishedMs);
      }
    },
    [today, submitDaily]
  );

  // ---- Daily -------------------------------------------------------------

  const startDaily = () => setSave(localSave.startDaily(today));

  const dailyPour = (m: Move) => {
    if (!progress) return;
    const moves = dailyPlay.pour(m);
    setSave(localSave.updateDaily({ moves }));
    if (isSolved(replay(daily.tubes, moves))) {
      const timeMs = Math.max(1, Date.now() - progress.startedAt + progress.hints * HINT_PENALTY_MS);
      const perfect = moves.length <= daily.target && progress.hints === 0;
      const updated = unlockAchievements(localSave.recordDailyWin(today, timeMs, perfect));
      setSave(updated);
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 1800);
      if (hasProfile) submitDaily(moves.length, progress.hints, timeMs);
    }
  };
  const dailyUndo = () => setSave(localSave.updateDaily({ moves: dailyPlay.undo() }));
  const dailyRestart = () => setSave(localSave.updateDaily({ moves: dailyPlay.restart() }));
  const dailyHint = () => {
    if (!progress) return;
    if (dailyPlay.showHint()) setSave(localSave.updateDaily({ hints: progress.hints + 1 }));
  };

  const handleShare = async () => {
    if (!progress || progress.finishedMs === null) return;
    const moves = progress.moves.length;
    const text = buildShareText({
      date: today,
      moves,
      target: daily.target,
      stars: progress.hints > 0 ? Math.min(2, starsFor(moves, daily.target)) : starsFor(moves, daily.target),
      hints: progress.hints,
      timeMs: progress.finishedMs,
    });
    const result = await shareResult(text);
    setShareState(result);
    setTimeout(() => setShareState("idle"), 2200);
  };

  // ---- Levels --------------------------------------------------------------

  const levelPour = (m: Move) => {
    const moves = levelPlay.pour(m);
    if (isSolved(replay(levelPuzzle.tubes, moves))) {
      const stars = starsFor(moves.length, levelPuzzle.target);
      let updated = localSave.recordLevelWin(level, stars);
      updated = unlockAchievements(updated);
      setSave(updated);
      setLevelWon(stars);
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 1500);
    }
  };

  const goToLevel = (n: number) => {
    setLevel(n);
    setLevelWon(null);
    setSave(localSave.setCurrentLevel(n));
    setShowLevels(false);
  };

  const handleUnlock = () => {
    // Stub — no payment processor wired up yet. Replace with a real
    // server-verified purchase flow before this ever ships.
    alert(`Payments aren't set up yet — levels beyond ${FREE_LEVELS} will unlock for $2 once that's wired in.`);
  };

  // ---- Screens -------------------------------------------------------------

  if (phase === "auth_checking") {
    return (
      <div className="min-h-screen bg-ink text-paper flex items-center justify-center">
        <Wordmark />
      </div>
    );
  }
  if (phase === "choice") {
    return <AuthModal currentDisplayName={displayName} onResolved={handleAuthResolved} />;
  }

  const modalOpen = showAuth || showAchievements || showLevels;
  const btn = "flex items-center gap-1.5 px-3 py-2 rounded-md border border-rule bg-surface text-sm text-paper/90 hover:border-muted/60 transition-colors disabled:opacity-40";

  const controls = (opts: { onUndo: () => void; onRestart: () => void; onHint: () => void; canUndo: boolean; hintLabel: string }) => (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <button type="button" onClick={opts.onUndo} disabled={!opts.canUndo} className={btn}>
        <Undo2 className="w-4 h-4" />
        Undo
      </button>
      <button type="button" onClick={opts.onRestart} disabled={!opts.canUndo} className={btn}>
        <RotateCcw className="w-4 h-4" />
        Restart
      </button>
      <button
        type="button"
        onClick={opts.onHint}
        className="flex items-center gap-1.5 px-3 py-2 rounded-md border border-present-dim/50 bg-present-soft text-sm text-present hover:border-present transition-colors"
      >
        <Lightbulb className="w-4 h-4" />
        {opts.hintLabel}
      </button>
      <button
        type="button"
        onClick={toggleSymbols}
        aria-pressed={symbols}
        title="Show a symbol on each colour"
        className={`${btn} ${symbols ? "border-paper/50 text-paper" : ""}`}
      >
        <Shapes className="w-4 h-4" />
        Symbols
      </button>
    </div>
  );

  const stuckNote = (stuck: boolean) =>
    stuck ? (
      <p className="text-sm text-present text-center" role="status">
        No way to finish from here — undo a few pours or restart.
      </p>
    ) : null;

  return (
    <div className="min-h-screen bg-ink text-paper flex flex-col items-center px-4 py-6 gap-5">
      <header className="w-full max-w-xl flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <Wordmark />
          <h1 className="font-display font-semibold text-lg truncate">Sortezy</h1>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {mode === "daily" && progress && (
            <div className="flex items-center gap-1.5 text-sm text-paper/80 font-mono" aria-label="Time">
              <TimerIcon className="w-4 h-4" />
              {formatTime(dailyTime)}
            </div>
          )}
          {save.streak > 0 && (
            <div className="flex items-center gap-1 text-sm text-present font-mono" title="Daily streak">
              <Flame className="w-4 h-4" />
              {save.streak}
            </div>
          )}
          <button
            type="button"
            onClick={() => setShowAchievements(true)}
            className="flex items-center gap-1.5 text-sm text-muted hover:text-paper transition-colors"
            aria-label="Achievements"
          >
            <Award className="w-4 h-4" />
            {save.unlockedAchievements.length}/{ACHIEVEMENTS.length}
          </button>
        </div>
      </header>

      {showConfetti && <Confetti durationMs={1800} />}
      {newlyUnlocked && newlyUnlocked.length > 0 && <AchievementToastStack achievements={newlyUnlocked} onDone={() => setNewlyUnlocked(null)} />}
      {showAchievements && <AchievementsModal save={save} onClose={() => setShowAchievements(false)} />}
      {showAuth && <AuthModal currentDisplayName={displayName} onResolved={handleAuthResolved} />}
      {showLevels && (
        <LevelPicker
          current={level}
          highestCleared={highestCleared}
          stars={save.levelStars}
          unlocked={save.unlockedLevels}
          onPick={goToLevel}
          onClose={() => setShowLevels(false)}
        />
      )}

      <div className="flex items-center gap-1 p-1 bg-surface border border-rule rounded-lg">
        {(["daily", "levels"] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${mode === m ? "bg-correct text-paper" : "text-muted hover:text-paper"}`}
          >
            {m === "daily" ? "Daily" : "Levels"}
          </button>
        ))}
      </div>

      <main className="w-full max-w-xl flex flex-col items-center gap-5">
        {offline && (
          <div role="status" className="w-full flex items-center gap-2 px-3 py-2 rounded-md border border-rule bg-surface text-xs text-muted">
            <WifiOff className="w-4 h-4 shrink-0 text-present" aria-hidden="true" />
            <span className="flex-1">Playing offline. Your game saves on this device; the leaderboard comes back when you reconnect.</span>
            <button type="button" onClick={() => bootAuth(true)} className="shrink-0 font-medium text-paper underline underline-offset-2">
              Retry
            </button>
          </div>
        )}
        {mode === "daily" && !progress && (
          <section className="w-full bg-surface border border-rule rounded-xl p-6 text-center space-y-5 animate-rise-in">
            <div className="space-y-1.5">
              <p className="text-xs font-mono text-muted uppercase tracking-wide">
                {new Date(today + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })}
              </p>
              <h2 className="font-display font-semibold text-2xl">Today's pour</h2>
              <p className="text-sm text-muted">
                {daily.colors} colours, {daily.tubes.length} tubes. Sort every colour into its own tube in{" "}
                <span className="text-paper font-mono">{daily.target} pours</span> or fewer for three stars.
              </p>
            </div>
            <ul className="text-sm text-paper/80 space-y-2 text-left max-w-xs mx-auto">
              <li className="flex items-start gap-2.5">
                <Hand className="w-4 h-4 mt-0.5 text-correct shrink-0" />
                Tap a tube, then tap where to pour it.
              </li>
              <li className="flex items-start gap-2.5">
                <Check className="w-4 h-4 mt-0.5 text-correct shrink-0" />
                You can only pour onto the same colour, or into an empty tube.
              </li>
              <li className="flex items-start gap-2.5">
                <Lightbulb className="w-4 h-4 mt-0.5 text-present shrink-0" />
                Undo is free. A hint shows the best next pour but adds {HINT_PENALTY_MS / 1000} seconds.
              </li>
            </ul>
            <button
              type="button"
              onClick={startDaily}
              className="inline-flex items-center justify-center gap-2 w-full max-w-xs py-3 rounded-lg bg-correct hover:bg-correct-dim text-paper font-medium transition-colors"
            >
              <Play className="w-4 h-4" />
              Play — the clock starts now
            </button>
            {save.bestDailyTimeMs !== null && <p className="text-xs font-mono text-muted">Your best time: {formatTime(save.bestDailyTimeMs)}</p>}
          </section>
        )}

        {mode === "daily" && progress && !dailyDone && (
          <>
            <p className="text-xs font-mono uppercase tracking-wide text-paper/80">
              {dailyPlay.moves.length} pours <span className="text-faint">·</span> <span className="text-muted">target {daily.target}</span>
              {progress.hints > 0 && (
                <>
                  {" "}
                  <span className="text-faint">·</span> <span className="text-present">{progress.hints} hint{progress.hints === 1 ? "" : "s"}</span>
                </>
              )}
            </p>
            <SortBoard
              board={dailyPlay.board}
              version={dailyPlay.version}
              lastPour={dailyPlay.lastPour}
              hint={dailyPlay.hint}
              symbols={symbols}
              disabled={modalOpen}
              onPour={dailyPour}
            />
            {stuckNote(dailyPlay.stuck)}
            {controls({ onUndo: dailyUndo, onRestart: dailyRestart, onHint: dailyHint, canUndo: dailyPlay.moves.length > 0, hintLabel: `Hint +${HINT_PENALTY_MS / 1000}s` })}
          </>
        )}

        {mode === "daily" && progress && dailyDone && (
          <>
            <DailyResult
              puzzle={daily}
              progress={progress}
              streak={save.streak}
              shareState={shareState}
              onShare={handleShare}
              scoreStatus={scoreStatus}
              hasProfile={hasProfile}
              onJoin={() => setShowAuth(true)}
              onLevels={() => setMode("levels")}
            />
            <Leaderboard date={today} target={daily.target} currentPlayerId={userId} refreshKey={leaderboardKey} />
          </>
        )}

        {mode === "levels" && (
          <div className="w-full flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-display font-semibold text-xl flex items-center gap-2">
                Level {level}
                {save.levelStars[String(level)] ? <Stars count={save.levelStars[String(level)]} size="w-3.5 h-3.5" /> : null}
              </p>
              <p className="text-xs font-mono text-muted">
                {levelPuzzle.colors} colours · target {levelPuzzle.target}
              </p>
            </div>
            <button type="button" onClick={() => setShowLevels(true)} className={`${btn} shrink-0 whitespace-nowrap`}>
              <LayoutGrid className="w-4 h-4" />
              All levels
            </button>
          </div>
        )}

        {mode === "levels" && levelLocked && (
          <section className="w-full max-w-sm bg-surface border border-rule rounded-xl p-6 text-center space-y-4 mt-2">
            <div className="w-12 h-12 rounded-full bg-present-soft border border-present-dim/50 flex items-center justify-center text-present mx-auto">
              <Sparkles className="w-6 h-6" />
            </div>
            <div>
              <h2 className="font-display font-semibold text-lg">Keep pouring</h2>
              <p className="text-sm text-muted mt-1.5">
                You've finished the {FREE_LEVELS} free levels. Unlock hundreds more, up to 12 colours, with a one-time purchase.
              </p>
            </div>
            <button type="button" onClick={handleUnlock} className="w-full py-2.5 px-4 rounded-md bg-correct hover:bg-correct-dim text-paper font-medium text-sm transition-colors">
              Unlock all levels for $2
            </button>
          </section>
        )}

        {mode === "levels" && !levelLocked && levelWon === null && (
          <>
            <p className="text-xs font-mono uppercase tracking-wide text-paper/80">{levelPlay.moves.length} pours</p>
            <SortBoard
              board={levelPlay.board}
              version={levelPlay.version}
              lastPour={levelPlay.lastPour}
              hint={levelPlay.hint}
              symbols={symbols}
              disabled={modalOpen}
              onPour={levelPour}
            />
            {stuckNote(levelPlay.stuck)}
            {controls({
              onUndo: () => levelPlay.undo(),
              onRestart: () => levelPlay.restart(),
              onHint: () => levelPlay.showHint(),
              canUndo: levelPlay.moves.length > 0,
              hintLabel: "Hint",
            })}
          </>
        )}

        {mode === "levels" && !levelLocked && levelWon !== null && (
          <section className="w-full bg-surface border border-rule rounded-xl p-6 text-center space-y-4 animate-rise-in">
            <p className="text-xs font-mono text-muted uppercase tracking-wide">Level {level} sorted</p>
            <Stars count={levelWon} size="w-8 h-8" />
            <p className="font-mono text-paper/80">
              {levelPlay.moves.length} pours <span className="text-muted">· target {levelPuzzle.target}</span>
            </p>
            {levelWon < 3 && <p className="text-xs text-muted">Finish in {levelPuzzle.target} pours or fewer for three stars.</p>}
            <div className="flex gap-2 justify-center">
              <button
                type="button"
                onClick={() => {
                  levelPlay.restart();
                  setLevelWon(null);
                }}
                className={btn}
              >
                <RotateCcw className="w-4 h-4" />
                Replay
              </button>
              <button
                type="button"
                onClick={() => goToLevel(level + 1)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-correct hover:bg-correct-dim text-paper font-medium text-sm transition-colors"
              >
                Next level
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
            {levelsCleared(save) > 0 && (
              <p className="text-[11px] font-mono text-faint">
                {levelsCleared(save)} level{levelsCleared(save) === 1 ? "" : "s"} finished
              </p>
            )}
          </section>
        )}
      </main>

      <footer className="w-full max-w-xl mt-auto pt-6 border-t border-rule/60 text-center space-y-2">
        <p className="text-xs text-muted">More free games on bgameworld</p>
        <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm">
          {OTHER_GAMES.map((g) => (
            <a key={g.url} href={g.url} className="text-paper/80 hover:text-correct transition-colors">
              {g.name}
            </a>
          ))}
          <a href="https://bgameworld.com/" className="text-muted hover:text-paper transition-colors">
            All games
          </a>
        </nav>
      </footer>
    </div>
  );
};

const LevelPicker: React.FC<{
  current: number;
  highestCleared: number;
  stars: Record<string, number>;
  unlocked: boolean;
  onPick: (level: number) => void;
  onClose: () => void;
}> = ({ current, highestCleared, stars, unlocked, onPick, onClose }) => {
  const reachable = highestCleared + 1;
  const shown = Math.max(FREE_LEVELS, Math.ceil((reachable + 5) / 5) * 5);
  return (
    <div role="dialog" aria-modal="true" aria-label="All levels" className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-md bg-surface border border-rule rounded-2xl p-5 space-y-4 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-display font-semibold text-lg">Levels</h2>
          <button type="button" onClick={onClose} className="text-muted hover:text-paper transition-colors" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-xs text-muted">Finish a level to open the next. Levels 1–{FREE_LEVELS} are free.</p>
        <div className="grid grid-cols-5 gap-2">
          {Array.from({ length: shown }, (_, i) => i + 1).map((n) => {
            const s = stars[String(n)] ?? 0;
            const paywalled = n > FREE_LEVELS && !unlocked;
            const open = n <= reachable && !paywalled;
            return (
              <button
                key={n}
                type="button"
                disabled={!open}
                onClick={() => onPick(n)}
                aria-label={`Level ${n}${s ? `, ${s} stars` : ""}${open ? "" : ", locked"}`}
                className={`aspect-square rounded-lg border flex flex-col items-center justify-center gap-0.5 font-mono text-sm transition-colors ${
                  n === current ? "border-correct bg-correct-soft text-correct" : open ? "border-rule bg-ink hover:border-muted/60" : "border-rule/50 bg-ink/50 text-faint"
                }`}
              >
                {open || s ? n : <Lock className="w-3.5 h-3.5" />}
                {s > 0 && <Stars count={s} size="w-2.5 h-2.5" />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const DailyResult: React.FC<{
  puzzle: Puzzle;
  progress: DailyProgress;
  streak: number;
  shareState: "idle" | "shared" | "copied" | "failed";
  onShare: () => void;
  scoreStatus: "idle" | "saving" | "saved" | "failed";
  hasProfile: boolean;
  onJoin: () => void;
  onLevels: () => void;
}> = ({ puzzle, progress, streak, shareState, onShare, scoreStatus, hasProfile, onJoin, onLevels }) => {
  const [countdown, setCountdown] = useState(() => msUntilNextPuzzle());
  useEffect(() => {
    const id = setInterval(() => setCountdown(msUntilNextPuzzle()), 1000);
    return () => clearInterval(id);
  }, []);
  const moves = progress.moves.length;
  // Hints cap the daily at two stars, so three stars always means unaided.
  const stars = progress.hints > 0 ? Math.min(2, starsFor(moves, puzzle.target)) : starsFor(moves, puzzle.target);

  return (
    <section className="w-full bg-surface border border-rule rounded-xl p-6 space-y-5 animate-rise-in">
      <div className="text-center space-y-2">
        <p className="text-xs font-mono text-muted uppercase tracking-wide">Sorted</p>
        <Stars count={stars} size="w-8 h-8" />
        <p className="font-mono text-3xl text-correct">
          {moves} <span className="text-base">pours</span>
        </p>
        <p className="text-xs text-muted">
          Target {puzzle.target} · {formatTime(progress.finishedMs ?? 0)}
          {progress.hints > 0 ? ` incl. +${(progress.hints * HINT_PENALTY_MS) / 1000}s for hints` : ""}
          {streak > 1 ? ` · ${streak}-day streak` : ""}
        </p>
      </div>

      <button
        type="button"
        onClick={onShare}
        className="inline-flex items-center justify-center gap-2 w-full py-2.5 rounded-lg bg-correct hover:bg-correct-dim text-paper font-medium text-sm transition-colors"
      >
        {shareState === "copied" ? <Check className="w-4 h-4" /> : <Share2 className="w-4 h-4" />}
        {shareState === "copied" ? "Copied — paste it anywhere" : shareState === "failed" ? "Couldn't copy — try again" : "Share result"}
      </button>
      <button type="button" onClick={onLevels} className="w-full py-2 rounded-lg border border-rule text-sm text-paper/90 hover:border-muted/60 transition-colors">
        Keep playing — Levels
      </button>

      <div className="text-center space-y-1.5">
        <p className="text-xs font-mono text-muted">Next puzzle in {formatCountdown(countdown)}</p>
        {!hasProfile ? (
          <button type="button" onClick={onJoin} className="text-xs text-correct hover:underline">
            Create a free account to put today's result on the leaderboard
          </button>
        ) : scoreStatus === "failed" ? (
          <p className="text-xs text-muted">Saved on this device — the leaderboard couldn't be reached.</p>
        ) : null}
      </div>
    </section>
  );
};
