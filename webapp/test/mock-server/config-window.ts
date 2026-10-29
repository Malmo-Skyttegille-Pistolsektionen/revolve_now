/**
 * `rt::ConfigWindow` in firmware/lib/rt_logic/config_window.h - change both.
 * The window three presses of BOOT open belongs to the one client that asked
 * (D-52); with more than one waiting the presses open it for nobody.
 */
import { randomBytes } from 'node:crypto';

import type { ConfigWindowState } from '../../src/api/types';

export const CONFIG_WINDOW_MS = 5 * 60 * 1000;
export const WINDOW_REQUEST_MS = 2 * 60 * 1000;
export const WINDOW_CONFLICT_MS = 2 * 60 * 1000;
export const MAX_WINDOW_REQUESTS = 4;

export type Press = 'nothingPending' | 'granted' | 'conflict';

export class ConfigWindowModel {
  private pending: { token: string; sinceMs: number }[] = [];
  private conflicted: string[] = [];
  private conflictMs = -Infinity;
  private holder = '';
  private untilMs = 0;

  /** The token to wait with, or null when the queue is full. */
  request(presented: string, nowMs: number): string | null {
    this.expire(nowMs);
    const existing = presented === '' ? undefined : this.pending.find((r) => r.token === presented);
    if (existing) {
      existing.sinceMs = nowMs;
      return existing.token;
    }
    const token = this.holds(presented, nowMs) ? this.holder : randomBytes(16).toString('hex');
    if (this.pending.length >= MAX_WINDOW_REQUESTS) return null;
    this.pending.push({ token, sinceMs: nowMs });
    return token;
  }

  press(nowMs: number): Press {
    this.expire(nowMs);
    if (this.pending.length === 0) return 'nothingPending';
    if (this.pending.length > 1) {
      this.conflicted = this.pending.map((r) => r.token);
      this.conflictMs = nowMs;
      this.pending = [];
      return 'conflict';
    }
    this.holder = this.pending[0].token;
    this.untilMs = nowMs + CONFIG_WINDOW_MS;
    this.pending = [];
    return 'granted';
  }

  holds(token: string, nowMs: number): boolean {
    return token !== '' && this.open(nowMs) && token === this.holder;
  }

  open(nowMs: number): boolean {
    return this.holder !== '' && nowMs < this.untilMs;
  }

  until(): number {
    return this.untilMs;
  }

  state(token: string, nowMs: number): { state: ConfigWindowState; remainingMs: number } {
    if (this.holds(token, nowMs)) return { state: 'open', remainingMs: this.untilMs - nowMs };
    const pending = token === '' ? undefined : this.pending.find((r) => r.token === token);
    if (pending && nowMs - pending.sinceMs < WINDOW_REQUEST_MS) {
      return { state: 'pending', remainingMs: pending.sinceMs + WINDOW_REQUEST_MS - nowMs };
    }
    if (token !== '' && nowMs - this.conflictMs < WINDOW_CONFLICT_MS && this.conflicted.includes(token)) {
      return { state: 'conflict', remainingMs: 0 };
    }
    if (this.open(nowMs)) return { state: 'elsewhere', remainingMs: 0 };
    return { state: 'closed', remainingMs: 0 };
  }

  reset(): void {
    this.pending = [];
    this.conflicted = [];
    this.holder = '';
    this.untilMs = 0;
  }

  private expire(nowMs: number): void {
    this.pending = this.pending.filter((r) => nowMs - r.sinceMs < WINDOW_REQUEST_MS);
  }
}
