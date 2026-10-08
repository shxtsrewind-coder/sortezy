import React, { useEffect, useState } from "react";
import { CAPACITY, isComplete, pourAmount, type Board, type Move } from "../lib/sort.ts";

/** Liquid colours — picked to stay apart from each other on the dark ink
 *  background, with a symbol each for players who prefer not to rely on colour. */
export const LIQUIDS = [
  { name: "red", hex: "#e5484d", symbol: "●" },
  { name: "orange", hex: "#f28c28", symbol: "▲" },
  { name: "yellow", hex: "#f2cf3a", symbol: "■" },
  { name: "lime", hex: "#9ad04b", symbol: "◆" },
  { name: "jade", hex: "#1f9a62", symbol: "★" },
  { name: "cyan", hex: "#3cc6d9", symbol: "✚" },
  { name: "blue", hex: "#3a6ff0", symbol: "♥" },
  { name: "violet", hex: "#8b5cf6", symbol: "☾" },
  { name: "pink", hex: "#ec6fb0", symbol: "✿" },
  { name: "brown", hex: "#9a5b34", symbol: "⬢" },
  { name: "cream", hex: "#efe6d2", symbol: "✦" },
  { name: "slate", hex: "#8a94a6", symbol: "≡" },
];

interface Props {
  board: Board;
  /** Bumps on every pour or undo, so the last pour can animate and the
   *  selection clears. */
  version: number;
  lastPour: { to: number; count: number } | null;
  hint: Move | null;
  symbols: boolean;
  disabled: boolean;
  onPour: (move: Move) => void;
}

export const SortBoard: React.FC<Props> = ({ board, version, lastPour, hint, symbols, disabled, onPour }) => {
  const [selected, setSelected] = useState<number | null>(null);
  const [shake, setShake] = useState<number | null>(null);

  useEffect(() => setSelected(null), [version]);

  const n = board.length;
  const rows = n <= 6 ? 1 : 2;
  const perRow = Math.ceil(n / rows);

  const tap = (i: number) => {
    if (disabled) return;
    if (selected === null) {
      if (board[i].length > 0 && !isComplete(board[i])) setSelected(i);
      return;
    }
    if (selected === i) {
      setSelected(null);
      return;
    }
    if (pourAmount(board, selected, i) > 0) {
      onPour({ from: selected, to: i });
      setSelected(null);
      return;
    }
    // Not a legal pour: pick up the tapped tube instead if it can be poured,
    // otherwise shake it so the player sees why nothing happened.
    if (board[i].length > 0 && !isComplete(board[i])) {
      setSelected(i);
    } else {
      setShake(i);
      setTimeout(() => setShake(null), 420);
    }
  };

  return (
    <div
      className="grid justify-center gap-x-[min(2.6vw,14px)] gap-y-9 pt-6 w-full"
      style={{ gridTemplateColumns: `repeat(${perRow}, minmax(0, 54px))` }}
      role="group"
      aria-label="Tubes"
    >
      {board.map((tube, i) => {
        const done = isComplete(tube);
        const isSel = selected === i;
        const isHintFrom = hint?.from === i;
        const isHintTo = hint?.to === i;
        const label =
          tube.length === 0
            ? `Tube ${i + 1}: empty`
            : `Tube ${i + 1}: ${tube.map((c) => LIQUIDS[c].name).join(", ")} (top)${done ? ", complete" : ""}`;
        return (
          <button
            key={i}
            type="button"
            onClick={() => tap(i)}
            aria-label={label}
            aria-pressed={isSel}
            className={`relative w-full transition-transform duration-150 ease-out focus:outline-none focus-visible:ring-2 focus-visible:ring-paper/60 rounded-b-full ${
              isSel ? "-translate-y-4" : ""
            } ${shake === i ? "animate-shake" : ""}`}
            style={{ aspectRatio: "1 / 3.3" }}
          >
            {/* Cork on a finished tube. */}
            {done && (
              <span
                className="absolute left-1/2 -translate-x-1/2 -top-[9px] w-[62%] h-[11px] rounded-t-[4px] bg-[#a87a4d] border border-[#7c5634] animate-pop"
                aria-hidden="true"
              />
            )}
            {/* Glass. */}
            <span
              className={`absolute inset-0 rounded-b-full border-2 border-t-0 transition-colors ${
                isHintFrom || isHintTo
                  ? "border-present"
                  : isSel
                  ? "border-paper/80"
                  : done
                  ? "border-correct/70"
                  : "border-paper/30"
              } ${isHintFrom ? "animate-pulse" : ""} ${isHintTo ? "border-dashed" : ""}`}
              aria-hidden="true"
            />
            {/* Rim. */}
            <span className="absolute -left-[3px] -right-[3px] top-0 h-[3px] rounded-full bg-paper/40" aria-hidden="true" />
            {/* Liquid, bottom up. */}
            <span className="absolute left-[4px] right-[4px] bottom-[4px] top-[13%] rounded-b-full overflow-hidden flex flex-col-reverse" aria-hidden="true">
              {tube.map((c, k) => {
                const fresh = lastPour && lastPour.to === i && k >= tube.length - lastPour.count;
                const isTop = k === tube.length - 1 || tube[k + 1] !== c;
                return (
                  <span
                    key={`${version}-${k}`}
                    className={`relative shrink-0 flex items-center justify-center text-[11px] leading-none ${fresh ? "animate-fill origin-bottom" : ""}`}
                    style={{
                      height: `${100 / CAPACITY}%`,
                      background: LIQUIDS[c].hex,
                      boxShadow: isTop ? "inset 0 3px 0 rgba(255,255,255,0.22)" : undefined,
                      color: "rgba(11,10,8,0.62)",
                    }}
                  >
                    {symbols && LIQUIDS[c].symbol}
                  </span>
                );
              })}
            </span>
          </button>
        );
      })}
    </div>
  );
};
