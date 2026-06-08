import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, unlinkSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Call, SwapSummary } from '@vortr/core';

export interface PendingEntry {
  calls: Call[];
  summary: SwapSummary;
}

/** confirm_token = 16 random bytes hex → exactly 32 lowercase hex chars. The
 *  regex both validates and blocks path traversal in take() (the token is used
 *  as a filename). */
const TOKEN_RE = /^[0-9a-f]{32}$/;
/** Best-effort GC for entries that were prepared but never executed. Their
 *  logical life is summary.expiresAt (~30s), but a never-taken file lingers; an
 *  hour of real time is a safe ceiling for "obviously abandoned". */
const SWEEP_AGE_MS = 60 * 60 * 1000;

/**
 * File-backed store mapping a single-use confirm_token to the exact calldata the
 * human approved. Persisting to disk (not just process memory) is deliberate: an
 * agent that spawns a fresh `npx @vortr/wallet` per tool call runs prepare_swap
 * and execute_swap in DIFFERENT processes — an in-memory token would be gone by
 * execute. The file holds only calldata + summary (NEVER the signing key), is
 * single-use (deleted on take), and expires at the connector's summary.expiresAt.
 */
export class PendingStore {
  private readonly dir: string;

  constructor(
    private readonly now: () => number = () => Date.now(),
    dir?: string,
  ) {
    this.dir = dir ?? join(tmpdir(), 'vortr-wallet-pending');
    mkdirSync(this.dir, { recursive: true });
  }

  put(entry: PendingEntry): string {
    this.sweep();
    const token = randomBytes(16).toString('hex');
    // mode 0o600: readable only by the owner — calldata isn't secret, but there's
    // no reason to expose it to other users on a shared machine.
    writeFileSync(this.pathFor(token), JSON.stringify(entry), { mode: 0o600 });
    return token;
  }

  take(token: string): PendingEntry | null {
    if (!TOKEN_RE.test(token)) return null;
    const file = this.pathFor(token);
    let raw: string;
    try {
      raw = readFileSync(file, 'utf8');
    } catch {
      return null; // unknown token (or already taken)
    }
    try {
      unlinkSync(file); // single-use, regardless of outcome
    } catch {
      /* best effort */
    }
    const entry = JSON.parse(raw) as PendingEntry;
    if (this.now() >= entry.summary.expiresAt) return null;
    return entry;
  }

  private pathFor(token: string): string {
    return join(this.dir, `${token}.json`);
  }

  /** Remove abandoned entries older than SWEEP_AGE_MS by real wall-clock mtime.
   *  Uses Date.now() (not the injected clock) so a test's fake clock can't sweep
   *  freshly written files. Entirely best-effort — never throws into a swap. */
  private sweep(): void {
    try {
      const cutoff = Date.now() - SWEEP_AGE_MS;
      for (const name of readdirSync(this.dir)) {
        const f = join(this.dir, name);
        try {
          if (statSync(f).mtimeMs < cutoff) unlinkSync(f);
        } catch {
          /* ignore a file that vanished or can't be stat'd */
        }
      }
    } catch {
      /* ignore an unreadable dir */
    }
  }
}
