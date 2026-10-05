/**
 * Where a series is at a given elapsed time. Pure maths, no state.
 *
 * Mirrored logic: the device derives run position the same way, in
 * `firmware/lib/rt_logic/run_position.h` (`locate_event`, `Series::total_ms`).
 * Keep the two in lock-step — a divergence shows up as a timeline that
 * disagrees with the targets, which is exactly the failure nobody notices
 * until a competition.
 *
 * Deriving position from elapsed series time, rather than tracking it per
 * event, is what lets `stop` pause instead of rewind: a paused run resumes at
 * whatever event its `tickerMs` lands in.
 */
import type { Series } from '../api/types';

export interface EventLocation {
  /** Index of the event `elapsedMs` falls in. */
  index: number;
  /** How far into that event. */
  offsetMs: number;
  /** Series-relative time the event ends at. */
  endMs: number;
}

export function seriesTotalMs(series: Series): number {
  return series.events.reduce((sum, event) => sum + event.duration, 0);
}

/**
 * Locate `elapsedMs` within `series`, or `null` once elapsed is at or beyond
 * the total duration — the caller treats that as "the series is done".
 */
export function locateEvent(series: Series, elapsedMs: number): EventLocation | null {
  let cumulativeMs = 0;

  for (let i = 0; i < series.events.length; i++) {
    const event = series.events[i];
    if (elapsedMs < cumulativeMs + event.duration) {
      return { index: i, offsetMs: elapsedMs - cumulativeMs, endMs: cumulativeMs + event.duration };
    }
    cumulativeMs += event.duration;
  }

  return null;
}

/**
 * Milliseconds from the start of a series to the event its run clock starts on
 * (#126). A series without `timer_start_index` anchors at 0, which is what
 * every program meant before the field existed, so this is the identity for
 * all of them.
 *
 * Mirrors `rt::Series::timer_anchor_ms`.
 */
export function anchorMs(series: Series): number {
  const index = series.timer_start_index ?? 0;
  return series.events.slice(0, index).reduce((total, event) => total + event.duration, 0);
}

/** Signed milliseconds from the series' run-clock zero: negative before it. */
export function anchorRelativeMs(series: Series, msFromSeriesStart: number): number {
  return msFromSeriesStart - anchorMs(series);
}

/**
 * A whole-second run-clock figure for an event card. Written with an explicit
 * `+` once a series has an anchor, so a positive number cannot be read as
 * "seconds into the series" when the two disagree; unsigned without one,
 * because then they agree and a `+` on every card is noise.
 */
export function anchorRelativeSeconds(series: Series, msFromSeriesStart: number): string {
  const seconds = Math.round(anchorRelativeMs(series, msFromSeriesStart) / 1000);
  if (anchorMs(series) === 0) return String(seconds);
  return seconds > 0 ? `+${String(seconds)}` : String(seconds);
}

/**
 * The same figure for the detail panel, which keeps the tenth of a second
 * `formatSeconds` does - a 2.5 s event rounded to 3 in the one place that
 * exists to be precise would be a worse answer than the one it replaced.
 */
export function formatRunClock(series: Series, msFromSeriesStart: number): string {
  const ms = anchorRelativeMs(series, msFromSeriesStart);
  const text = formatSeconds(Math.abs(ms));
  if (anchorMs(series) === 0) return text;
  if (ms === 0) return text;
  return `${ms > 0 ? '+' : '-'}${text}`;
}

export function formatSeconds(ms: number): string {
  const seconds = ms / 1000;
  return `${Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1)} s`;
}
