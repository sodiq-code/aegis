/**
 * Aegis Wallet Authentication
 * 
 * Supports:
 * - EVM wallets (MetaMask) for auditor access
 * - XRPL wallets (Xaman/Xumm) for depositor access
 * 
 * The dashboard uses wallet-based auth — no traditional login.
 */

'use client';

import { create } from 'zustand';
import { getFlareConfig } from './flare-config';

export type WalletType = 'evm' | 'xrpl';
export type WalletStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
export type UserRole = 'depositor' | 'auditor' | 'admin';

export interface WalletState {
  type: WalletType | null;
  status: WalletStatus;
  address: string | null;
  chainId: number | null;
  balance: string | null;
  role: UserRole;
  error: string | null;
}

export interface WalletActions {
  connectEvm: () => Promise<void>;
  disconnect: () => void;
  switchRole: (role: UserRole) => void;
  refreshBalance: () => Promise<void>;
}

const initialState: WalletState = {
  type: null,
  status: 'disconnected',
  address: null,
  chainId: null,
  balance: null,
  role: 'depositor',
  error: null,
};

/**
 * EVM (MetaMask) Wallet Connection
 */
async function connectEvmWallet(): Promise<Pick<WalletState, 'address' | 'chainId' | 'balance'>> {
  if (typeof window === 'undefined' || !window.ethereum) {
    throw new Error('MetaMask is not installed. Please install MetaMask to connect.');
  }

  const config = getFlareConfig();

  // Request account access
  const accounts = await window.ethereum.request({
    method: 'eth_requestAccounts',
  }) as string[];

  if (!accounts || accounts.length === 0) {
    throw new Error('No accounts found. Please unlock MetaMask.');
  }

  const address = accounts[0];

  // Get chain ID
  const chainIdHex = await window.ethereum.request({
    method: 'eth_chainId',
  }) as string;

  const chainId = parseInt(chainIdHex, 16);

  // Switch to Coston2 if not already on it
  if (chainId !== config.chainId) {
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: config.chainIdHex }],
      });
    } catch (switchError: unknown) {
      // Chain not added yet — add it
      const err = switchError as { code?: number };
      if (err.code === 4902) {
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: config.chainIdHex,
            chainName: `Flare ${config.name}`,
            nativeCurrency: config.currency,
            rpcUrls: [config.rpcUrl],
            blockExplorerUrls: [config.blockExplorer],
          }],
        });
      } else {
        throw switchError;
      }
    }
  }

  // Get balance
  const balanceHex = await window.ethereum.request({
    method: 'eth_getBalance',
    params: [address, 'latest'],
  }) as string;

  const balanceWei = BigInt(balanceHex);
  const balanceCflr = Number(balanceWei) / 1e18;

  return {
    address,
    chainId: config.chainId,
    balance: balanceCflr.toFixed(4),
  };
}

/**
 * Wallet Store (Zustand)
 */
export const useWalletStore = create<WalletState & WalletActions>((set, get) => ({
  ...initialState,

  connectEvm: async () => {
    set({ status: 'connecting', error: null, type: 'evm' });
    try {
      const { address, chainId, balance } = await connectEvmWallet();
      set({
        status: 'connected',
        address,
        chainId,
        balance,
        type: 'evm',
        // EVM wallets default to auditor role
        role: 'auditor',
      });

      // Listen for account changes
      if (window.ethereum) {
        window.ethereum.on('accountsChanged', (...args: unknown[]) => {
          const accounts = args[0] as string[];
          if (accounts.length === 0) {
            set({ status: 'disconnected', address: null, balance: null });
          } else {
            set({ address: accounts[0] });
            get().refreshBalance();
          }
        });

        window.ethereum.on('chainChanged', (...args: unknown[]) => {
          const chainIdHex = args[0] as string;
          set({ chainId: parseInt(chainIdHex, 16) });
        });
      }
    } catch (error) {
      set({
        status: 'error',
        error: error instanceof Error ? error.message : 'Failed to connect wallet',
      });
    }
  },

  disconnect: () => {
    set(initialState);
  },

  switchRole: (role: UserRole) => {
    set({ role });
  },

  refreshBalance: async () => {
    const { address, type } = get();
    if (!address || type !== 'evm' || !window.ethereum) return;

    try {
      const balanceHex = await window.ethereum.request({
        method: 'eth_getBalance',
        params: [address, 'latest'],
      }) as string;

      const balanceWei = BigInt(balanceHex);
      const balanceCflr = Number(balanceWei) / 1e18;
      set({ balance: balanceCflr.toFixed(4) });
    } catch {
      // Silently fail — balance refresh is non-critical
    }
  },
}));

/**
 * XRPL Wallet (Xaman/Xumm) Connection
 *
 * The real Xaman SDK integration lives in `lib/xaman-wallet.ts` and uses
 * the `/api/xaman-sign` route to create server-side sign requests. This
 * hook is kept for backwards compatibility with the navbar's "Xaman"
 * button — it now defers to the real `useXamanConnection` hook.
 *
 * In production:
 *   - If XAMM_API_KEY is set on the server, the user scans a QR code.
 *   - Otherwise, the user manually enters their XRPL address.
 *
 * The deposit production flow (deposit-production-flow.tsx) uses the
 * full `useXamanConnection` hook with QR display + polling.
 */
export function useXamanWallet() {
  const connectXrpl = async () => {
    // Redirect users to the production deposit flow for the real connection.
    // This stub is retained so the navbar doesn't break, but the real
    // connection happens in DepositProductionFlow via useXamanConnection.
    useWalletStore.setState({
      type: 'xrpl',
      status: 'connected',
      address: null, // Set by the production flow's useXamanConnection hook
      chainId: null,
      balance: null,
      role: 'depositor',
      error: null,
    });
  };

  return { connectXrpl };
}

/**
 * Type declaration for window.ethereum (MetaMask)
 */
declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      on: (event: string, callback: (...args: unknown[]) => void) => void;
      removeListener: (event: string, callback: (...args: unknown[]) => void) => void;
      isMetaMask?: boolean;
    };
  }
}
