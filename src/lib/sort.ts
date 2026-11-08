import { makeRng } from "./rng.ts";

/** Each tube holds this many units of liquid. */
export const CAPACITY = 4;

/** A tube's contents, bottom to top, as colour indices. */
export type Tube = number[];
export type Board = Tube[];
export interface Move {
  from: number;
  to: number;
}

export interface Puzzle {
  /** "daily:2026-10-08" or "level:12" — also the seed. */
  id: string;
  colors: number;
  tubes: Board;
  /** Moves the built-in solver needed — beat or match it for 3 stars. */
  target: number;
  /** Mystery puzzle: only the top colour of each tube shows until it's uncovered. */
  hidden: boolean;
}

// ---- Rules ---------------------------------------------------------------

function topRun(tube: Tube): { color: number; count: number } | null {
  if (tube.length === 0) return null;
  const color = tube[tube.length - 1];
  let count = 0;
  for (let i = tube.length - 1; i >= 0 && tube[i] === color; i--) count++;
  return { color, count };
}

export function isComplete(tube: Tube): boolean {
  return tube.length === CAPACITY && tube.every((c) => c === tube[0]);
}

export function isSolved(board: Board): boolean {
  return board.every((t) => t.length === 0 || isComplete(t));
}

/** Units that would move if `from` poured into `to` (0 = not allowed). */
export function pourAmount(board: Board, from: number, to: number): number {
  if (from === to) return 0;
  const src = board[from];
  const dst = board[to];
  const run = topRun(src);
  if (!run || dst.length >= CAPACITY) return 0;
  if (dst.length > 0 && dst[dst.length - 1] !== run.color) return 0;
  return Math.min(run.count, CAPACITY - dst.length);
}

/** Pours the top run of `from` into `to`, as much as fits. */
export function applyMove(board: Board, move: Move): Board {
  const n = pourAmount(board, move.from, move.to);
  if (n === 0) return board;
  const next = board.map((t) => t.slice());
  const moved = next[move.from].splice(next[move.from].length - n, n);
  next[move.to].push(...moved);
  return next;
}

export function legalMoves(board: Board): Move[] {
  const out: Move[] = [];
  for (let a = 0; a < board.length; a++) {
    for (let b = 0; b < board.length; b++) {
      if (pourAmount(board, a, b) > 0) out.push({ from: a, to: b });
    }
  }
  return out;
}

// ---- Solver ----------------------------------------------------------------

/** Order-independent key, so boards that differ only by tube order match. */
function boardKey(board: Board): string {
  return board
    .map((t) => t.map((c) => String.fromCharCode(97 + c)).join(""))
    .sort()
    .join("|");
}

/** Rough distance to solved: colour splits within tubes plus each colour
 *  spread across several tubes. Not exact; it steers the search. */
function heuristic(board: Board): number {
  let h = 0;
  const tubesWith = new Map<number, number>();
  for (const t of board) {
    const seen = new Set<number>();
    for (let i = 0; i < t.length; i++) {
      if (i > 0 && t[i] !== t[i - 1]) h++;
      seen.add(t[i]);
    }
    for (const c of seen) tubesWith.set(c, (tubesWith.get(c) ?? 0) + 1);
  }
  for (const k of tubesWith.values()) h += k - 1;
  return h;
}

/** Moves the search never needs: pouring out a finished tube, or moving a
 *  single-colour tube into an empty one (it just relabels the tubes). */
function usefulMoves(board: Board): Move[] {
  const out: Move[] = [];
  for (let a = 0; a < board.length; a++) {
    const src = board[a];
    if (src.length === 0 || isComplete(src)) continue;
    const uniform = src.every((c) => c === src[0]);
    let emptyTried = false;
    for (let b = 0; b < board.length; b++) {
      if (pourAmount(board, a, b) === 0) continue;
      if (board[b].length === 0) {
        if (uniform) continue;
        // All empty tubes are alike; trying one is enough.
        if (emptyTried) continue;
        emptyTried = true;
      }
      out.push({ from: a, to: b });
    }
  }
  return out;
}

/** Weighted best-first search. Returns a list of moves, or null if none was
 *  found within the node budget (treated as unsolvable). */
export function solve(start: Board, opts: { weight?: number; maxNodes?: number } = {}): Move[] | null {
  const weight = opts.weight ?? 2;
  const maxNodes = opts.maxNodes ?? 60_000;
  if (isSolved(start)) return [];

  interface Node {
    board: Board;
    g: number;
    f: number;
    parent: Node | null;
    move: Move | null;
  }
  // Small binary heap keyed on f.
  const heap: Node[] = [];
  const push = (n: Node) => {
    heap.push(n);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p].f <= heap[i].f) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = (): Node => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l].f < heap[m].f) m = l;
        if (r < heap.length && heap[r].f < heap[m].f) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };

  const best = new Map<string, number>([[boardKey(start), 0]]);
  push({ board: start, g: 0, f: weight * heuristic(start), parent: null, move: null });
  let expanded = 0;
  while (heap.length > 0 && expanded < maxNodes) {
    const node = pop();
    expanded++;
    if (isSolved(node.board)) {
      const moves: Move[] = [];
      for (let n: Node | null = node; n && n.move; n = n.parent) moves.push(n.move);
      return moves.reverse();
    }
    for (const mv of usefulMoves(node.board)) {
      const next = applyMove(node.board, mv);
      const key = boardKey(next);
      const g = node.g + 1;
      const prev = best.get(key);
      if (prev !== undefined && prev <= g) continue;
      best.set(key, g);
      push({ board: next, g, f: g + weight * heuristic(next), parent: node, move: mv });
    }
  }
  return null;
}

/** A few searches with different weights; keeps the shortest solution. */
function bestSolution(board: Board): Move[] | null {
  let best: Move[] | null = null;
  for (const weight of [3, 1.6, 1.25]) {
    const sol = solve(board, { weight, maxNodes: weight < 1.5 ? 40_000 : 60_000 });
    if (sol && (!best || sol.length < best.length)) best = sol;
  }
  return best;
}

// ---- Generation -------------------------------------------------------------

/** Number of colours for a level — a slow climb from 3 to 12. */
export function colorsForLevel(level: number): number {
  const steps = [
    [2, 3],
    [4, 4],
    [7, 5],
    [11, 6],
    [16, 7],
    [22, 8],
    [30, 9],
    [45, 10],
    [65, 11],
  ];
  for (const [upTo, colors] of steps) if (level <= upTo) return colors;
  return 12;
}

export const DAILY_COLORS = 11;
export const EMPTY_TUBES = 2;
export const FREE_LEVELS = 20;
/** The harder daily (11 colours, hidden colours, hardest of many shuffles) starts on this UTC day,
 *  so a daily that's already being played never changes under anyone. */
export const HARD_DAILY_FROM = "2026-11-09";
/** Daily undos. Levels keep unlimited undo. */
export const DAILY_UNDOS = 5;
/** Levels from here on are mystery puzzles. */
export const HIDDEN_FROM_LEVEL = 31;

function deal(colors: number, rng: () => number): Board {
  const units: number[] = [];
  for (let c = 0; c < colors; c++) for (let k = 0; k < CAPACITY; k++) units.push(c);
  for (let i = units.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [units[i], units[j]] = [units[j], units[i]];
  }
  const board: Board = [];
  for (let t = 0; t < colors; t++) board.push(units.slice(t * CAPACITY, (t + 1) * CAPACITY));
  for (let e = 0; e < EMPTY_TUBES; e++) board.push([]);
  return board;
}

/** A shuffle where no tube starts finished, or nearly finished. */
function fairDeal(colors: number, rng: () => number): Board {
  for (;;) {
    const b = deal(colors, rng);
    const tooEasy = b.some((t) => t.length === CAPACITY && new Set(t).size === 1)
      || b.filter((t) => t.length === CAPACITY && t[1] === t[2] && t[2] === t[3]).length > 1;
    if (!tooEasy) return b;
  }
}

/** How often a player making random sensible pours runs out of moves: a measure of how many
 *  dead ends a shuffle hides. 0 = forgiving, 1 = almost every line of play gets stuck. */
function stuckRate(board: Board, rng: () => number, runs = 60): number {
  let stuck = 0;
  for (let r = 0; r < runs; r++) {
    let b = board;
    const seen = new Set<string>([boardKey(b)]);
    let steps = 0;
    for (; steps < 300 && !isSolved(b); steps++) {
      const options: Board[] = [];
      for (const m of legalMoves(b)) {
        if (isComplete(b[m.from])) continue;
        const nb = applyMove(b, m);
        if (!seen.has(boardKey(nb))) options.push(nb);
      }
      if (options.length === 0) break;
      b = options[Math.floor(rng() * options.length)];
      seen.add(boardKey(b));
    }
    if (!isSolved(b)) stuck++;
  }
  return stuck / runs;
}

interface BuildOpts {
  /** Solvable shuffles to compare; the hardest one is kept. */
  candidates: number;
  hidden: boolean;
}

function buildPuzzle(id: string, colors: number, opts: BuildOpts = { candidates: 1, hidden: false }): Puzzle {
  const rng = makeRng(`sortezy:${id}`);
  let best: { tubes: Board; target: number; score: number } | null = null;
  let found = 0;
  for (let attempt = 0; attempt < Math.max(50, opts.candidates * 8) && found < opts.candidates; attempt++) {
    const tubes = fairDeal(colors, rng);
    const sol = bestSolution(tubes);
    if (!sol) continue;
    found++;
    // Harder = more dead ends for a player, then a longer best solution.
    const score = opts.candidates > 1 ? stuckRate(tubes, rng) * 100 + sol.length : 0;
    if (!best || score > best.score) best = { tubes, target: sol.length, score };
  }
  if (best) {
    // The solver sees every colour; a mystery puzzle gets two pours of slack for what the player can't see yet.
    return { id, colors, tubes: best.tubes, target: best.target + (opts.hidden ? 2 : 0), hidden: opts.hidden };
  }
  // Practically unreachable; a 3-colour puzzle is always solvable.
  return buildPuzzle(`${id}:fallback`, 3);
}

/** How many units at the bottom of each tube are still hidden after these pours. Hidden units
 *  always sit at the bottom: a unit is uncovered for good once it has been the top of its tube. */
export function hiddenCounts(puzzle: Puzzle, moves: Move[]): number[] {
  if (!puzzle.hidden) return puzzle.tubes.map(() => 0);
  let b = puzzle.tubes;
  const h = b.map((t) => Math.max(0, t.length - 1));
  for (const m of moves) {
    b = applyMove(b, m);
    for (let i = 0; i < b.length; i++) h[i] = Math.min(h[i], Math.max(0, b[i].length - 1));
  }
  return h;
}

const cache = new Map<string, Puzzle>();
function cached(id: string, colors: number, opts?: BuildOpts): Puzzle {
  let p = cache.get(id);
  if (!p) {
    p = buildPuzzle(id, colors, opts);
    cache.set(id, p);
  }
  return p;
}

export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/** The same puzzle for every player on a given UTC day. */
export function getDailyPuzzle(date: string = todayUtc()): Puzzle {
  if (date < HARD_DAILY_FROM) return cached(`daily:${date}`, 9);
  return cached(`daily:${date}`, DAILY_COLORS, { candidates: 10, hidden: true });
}

/** Undos left in a daily, or Infinity before the harder daily began. */
export function dailyUndoLimit(date: string): number {
  return date < HARD_DAILY_FROM ? Infinity : DAILY_UNDOS;
}

/** Level N is the same for every player, so friends can compare. */
export function getLevel(level: number): Puzzle {
  const candidates = level <= 10 ? 1 : level <= 30 ? 4 : 8;
  return cached(`level:${level}`, colorsForLevel(level), { candidates, hidden: level >= HIDDEN_FROM_LEVEL });
}

/** Best next pour from where the player is now, or null if the position
 *  can't be solved any more (then the player should undo or restart). */
export function hintFor(board: Board): Move | null {
  const sol = solve(board, { weight: 2.2, maxNodes: 50_000 });
  return sol && sol.length > 0 ? sol[0] : null;
}

/** 3 stars at or under the target, 2 within a few moves, else 1. */
export function starsFor(moves: number, target: number): 1 | 2 | 3 {
  if (moves <= target) return 3;
  if (moves <= target + Math.max(3, Math.round(target * 0.2))) return 2;
  return 1;
}

/** Milliseconds until the next daily puzzle (midnight UTC). */
export function msUntilNextPuzzle(now: number = Date.now()): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - now;
}
