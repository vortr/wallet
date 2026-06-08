import { describe, expect, it } from 'vitest';
import type { Address, Hex } from 'viem';
import { createSigner, type SignerClients } from './signer.js';
import type { Call } from '@vortr/core';

const SIGNER = '0x0000000000000000000000000000000000000001' as Address;
const APPROVE: Call = { to: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', data: '0xapprove', value: '0x0' };
const SWAP: Call = { to: '0x0000000000000000000000000000000000000def', data: '0xswap', value: '0x5' };

type Over = Partial<Omit<SignerClients, 'publicClient'>> & {
  publicClient?: Partial<SignerClients['publicClient']>;
};

function fakeClients(over: Over = {}): { clients: SignerClients; sent: { to: Address; value: bigint }[] } {
  const sent: { to: Address; value: bigint }[] = [];
  const defaultPub: SignerClients['publicClient'] = {
    waitForTransactionReceipt: async () => ({ status: 'success' }),
    getTransactionReceipt: async () => ({ status: 'success', blockNumber: 123n }),
    getBalance: async () => 0n,
    readContract: async () => 0n,
  };
  const clients: SignerClients = {
    address: SIGNER,
    walletClient: {
      sendTransaction: async ({ to, value }) => {
        sent.push({ to, value });
        return `0xhash${sent.length}` as Hex;
      },
    },
    ...over,
    publicClient: { ...defaultPub, ...(over.publicClient ?? {}) },
  };
  return { clients, sent };
}

describe('createSigner.sendCallsSequential', () => {
  it('sends each call in order and returns the LAST (swap) hash', async () => {
    const { clients, sent } = fakeClients();
    const signer = createSigner(clients);
    const hash = await signer.sendCallsSequential([APPROVE, SWAP]);
    expect(sent.map((s) => s.to)).toEqual([APPROVE.to, SWAP.to]);
    expect(sent[1]?.value).toBe(5n); // hex '0x5' -> 5n
    expect(hash).toBe('0xhash2');
  });

  it('aborts before the swap if the approve reverts', async () => {
    const { clients, sent } = fakeClients({
      publicClient: {
        waitForTransactionReceipt: async () => ({ status: 'reverted' }),
        getTransactionReceipt: async () => ({ status: 'reverted', blockNumber: 1n }),
      },
    });
    const signer = createSigner(clients);
    await expect(signer.sendCallsSequential([APPROVE, SWAP])).rejects.toThrow(/reverted/);
    expect(sent).toHaveLength(1); // swap never sent
  });

  it('exposes the account address', () => {
    const { clients } = fakeClients();
    expect(createSigner(clients).address).toBe(SIGNER);
  });
});

describe('createSigner.balanceOf', () => {
  it('native: reads the wallet ETH balance via getBalance', async () => {
    const { clients } = fakeClients({
      publicClient: { getBalance: async ({ address }) => (address === SIGNER ? 7n : 0n) },
    });
    expect(await createSigner(clients).balanceOf('0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' as Address, true)).toBe(7n);
  });

  it('erc20: reads balanceOf(token, signer) via readContract', async () => {
    let calledWith: { address?: Address; functionName?: string; args?: readonly unknown[] } = {};
    const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address;
    const { clients } = fakeClients({
      publicClient: {
        readContract: async (a) => {
          calledWith = a;
          return 42n;
        },
      },
    });
    const bal = await createSigner(clients).balanceOf(USDC, false);
    expect(bal).toBe(42n);
    expect(calledWith.address).toBe(USDC);
    expect(calledWith.functionName).toBe('balanceOf');
    expect(calledWith.args?.[0]).toBe(SIGNER);
  });
});

describe('createSigner.getStatus', () => {
  it('maps a successful receipt to confirmed', async () => {
    const { clients } = fakeClients();
    expect(await createSigner(clients).getStatus('0xabc' as Hex)).toEqual({
      status: 'confirmed',
      blockNumber: '123',
    });
  });

  it('maps a reverted receipt to failed', async () => {
    const { clients } = fakeClients({
      publicClient: {
        waitForTransactionReceipt: async () => ({ status: 'reverted' }),
        getTransactionReceipt: async () => ({ status: 'reverted', blockNumber: 9n }),
      },
    });
    expect((await createSigner(clients).getStatus('0xabc' as Hex)).status).toBe('failed');
  });

  it('maps a missing receipt (throws) to pending', async () => {
    const { clients } = fakeClients({
      publicClient: {
        getTransactionReceipt: async () => { throw new Error('not found'); },
      },
    });
    expect((await createSigner(clients).getStatus('0xabc' as Hex)).status).toBe('pending');
  });
});
