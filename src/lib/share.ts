import { formatTime } from "../hooks/useTimer.ts";

export const GAME_URL = "https://sortezy.bgameworld.com/";

/** Spoiler-free result: stars, moves against the target, and time. */
export function buildShareText(opts: { date: string; moves: number; target: number; stars: number; hints: number; timeMs: number }): string {
  const pretty = new Date(opts.date + "T00:00:00Z").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  const stars = "⭐".repeat(opts.stars) + "☆".repeat(3 - opts.stars);
  const hintNote = opts.hints > 0 ? `, ${opts.hints} hint${opts.hints === 1 ? "" : "s"}` : "";
  return (
    `Sortezy · ${pretty}\n` +
    `${stars}\n` +
    `🧪 ${opts.moves} pours (target ${opts.target}${hintNote}) · ⏱ ${formatTime(opts.timeMs)}\n` +
    GAME_URL
  );
}

/** Opens the native share sheet where there is one (phones), otherwise
 *  copies to the clipboard. Resolves to what happened, for the button label. */
export async function shareResult(text: string): Promise<"shared" | "copied" | "failed"> {
  try {
    if (typeof navigator !== "undefined" && navigator.share && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
      await navigator.share({ text });
      return "shared";
    }
  } catch (err) {
    // The player closing the share sheet isn't a failure worth reporting.
    if ((err as { name?: string })?.name === "AbortError") return "shared";
  }
  try {
    await navigator.clipboard.writeText(text);
    return "copied";
  } catch {
    return "failed";
  }
}
