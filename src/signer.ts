import { createPublicClient, createWalletClient, http, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import type { Call } from '@vortr/core';

/** Minimal `balanceOf(address)` ABI — the only read we need off an ERC-20. */
const ERC20_BALANCE_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

/** Minimal client surface the signer needs — real viem clients satisfy it,
 *  and tests inject fakes. */
export interface SignerClients {
  address: Address;
  walletClient: {
    sendTransaction(tx: { to: Address; data: Hex; value: bigint }): Promise<Hex>;
  };
  publicClient: {
    waitForTransactionReceipt(args: { hash: Hex }): Promise<{ status: 'success' | 'reverted' }>;
    getTransactionReceipt(args: { hash: Hex }): Promise<{ status: 'success' | 'reverted'; blockNumber: bigint }>;
    getBalance(args: { address: Address }): Promise<bigint>;
    readContract(args: {
      address: Address;
      abi: typeof ERC20_BALANCE_ABI;
      functionName: 'balanceOf';
      args: readonly [Address];
    }): Promise<bigint>;
  };
}

export interface SwapStatus {
  status: 'pending' | 'confirmed' | 'failed';
  blockNumber?: string;
}

export interface Signer {
  address: Address;
  /** Replay [approve?, swap] as sequential Base txs; returns the final swap hash. */
  sendCallsSequential(calls: Call[]): Promise<Hex>;
  getStatus(hash: Hex): Promise<SwapStatus>;
  /** On-chain balance of `token` for THIS wallet, base-units. `isNative` reads
   *  the ETH balance; otherwise it's an ERC-20 balanceOf. Used to preflight a
   *  swap so we never build calldata the wallet can't fund. */
  balanceOf(token: Address, isNative: boolean): Promise<bigint>;
}

export function createSigner(clients: SignerClients): Signer {
  return {
    address: clients.address,

    async sendCallsSequential(calls) {
      if (calls.length === 0) throw new Error('no calls to execute');
      let last: Hex | undefined;
      for (const call of calls) {
        const hash = await clients.walletClient.sendTransaction({
          to: call.to,
          data: call.data,
          value: BigInt(call.value),
        });
        const receipt = await clients.publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== 'success') {
          throw new Error(`transaction ${hash} reverted; aborting before the next call`);
        }
        last = hash;
      }
      // Guaranteed defined: calls.length > 0 and every iteration sets `last`.
      return last as Hex;
    },

    async balanceOf(token, isNative) {
      if (isNative) return clients.publicClient.getBalance({ address: clients.address });
      return clients.publicClient.readContract({
        address: token,
        abi: ERC20_BALANCE_ABI,
        functionName: 'balanceOf',
        args: [clients.address],
      });
    },

    async getStatus(hash) {
      try {
        const r = await clients.publicClient.getTransactionReceipt({ hash });
        return {
          status: r.status === 'success' ? 'confirmed' : 'failed',
          blockNumber: r.blockNumber.toString(),
        };
      } catch {
        return { status: 'pending' };
      }
    },
  };
}

/** Build real viem clients on Base from the signing key + RPC. */
export function makeClients(privateKey: Hex, rpcUrl: string): SignerClients {
  const account = privateKeyToAccount(privateKey);
  const publicClient = createPublicClient({ chain: base, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ account, chain: base, transport: http(rpcUrl) });
  return {
    address: account.address,
    walletClient: {
      sendTransaction: ({ to, data, value }) =>
        walletClient.sendTransaction({ account, chain: base, to, data, value }),
    },
    publicClient: {
      waitForTransactionReceipt: ({ hash }) => publicClient.waitForTransactionReceipt({ hash }),
      getTransactionReceipt: ({ hash }) => publicClient.getTransactionReceipt({ hash }),
      getBalance: ({ address }) => publicClient.getBalance({ address }),
      readContract: (args) => publicClient.readContract(args) as Promise<bigint>,
    },
  };
}
