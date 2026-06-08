import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PendingStore } from './pending.js';
import type { Call, SwapSummary } from '@vortr/core';

const CALLS: Call[] = [{ to: '0x4200000000000000000000000000000000000006', data: '0x', value: '0x0' }];
function summary(expiresAt: number): SwapSummary {
  return {
    sell: { token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', amount: '5000000' },
    buyMin: { token: '0x4200000000000000000000000000000000000006', amount: '1880000000000000' },
    taker: '0x0000000000000000000000000000000000000001',
    expiresAt,
  };
}

describe('PendingStore', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'vortr-pending-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('round-trips a pending swap by token', () => {
    const store = new PendingStore(() => 1000, dir);
    const token = store.put({ calls: CALLS, summary: summary(9999) });
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThanOrEqual(16);
    expect(store.take(token)?.calls).toEqual(CALLS);
  });

  it('is single-use — a second take returns null', () => {
    const store = new PendingStore(() => 1000, dir);
    const token = store.put({ calls: CALLS, summary: summary(9999) });
    expect(store.take(token)).not.toBeNull();
    expect(store.take(token)).toBeNull();
  });

  it('returns null for an unknown / malformed token (no path traversal)', () => {
    const store = new PendingStore(() => 1000, dir);
    expect(store.take('nope')).toBeNull();
    expect(store.take('../../etc/passwd')).toBeNull();
    expect(store.take('')).toBeNull();
  });

  it('rejects an expired entry (now >= summary.expiresAt) and drops it', () => {
    let now = 1000;
    const store = new PendingStore(() => now, dir);
    const token = store.put({ calls: CALLS, summary: summary(2000) });
    now = 2000;
    expect(store.take(token)).toBeNull();
  });

  it('issues distinct tokens for distinct puts', () => {
    const store = new PendingStore(() => 1000, dir);
    const a = store.put({ calls: CALLS, summary: summary(9999) });
    const b = store.put({ calls: CALLS, summary: summary(9999) });
    expect(a).not.toBe(b);
  });

  // The bug this fixes: an agent that spawns a fresh `npx @vortr/wallet` per tool
  // call ran prepare_swap and execute_swap in DIFFERENT processes, so an in-memory
  // token was gone by execute. A file-backed store survives the restart.
  it('persists across store instances sharing a dir (survives a process restart)', () => {
    const prepareProc = new PendingStore(() => 1000, dir);
    const token = prepareProc.put({ calls: CALLS, summary: summary(9999) });

    const executeProc = new PendingStore(() => 1000, dir); // fresh "process"
    expect(executeProc.take(token)?.calls).toEqual(CALLS);
    expect(executeProc.take(token)).toBeNull(); // still single-use across instances
  });
});
