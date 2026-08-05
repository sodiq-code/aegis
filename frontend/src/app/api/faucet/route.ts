/**
 * API Route: FXRP Faucet
 *
 * Seeds a user's EVM address with test FXRP so they can deposit into the
 * Aegis vault. In production, FXRP is minted via Flare FAssets after an
 * XRPL payment (one signature, see https://dev.flare.network/fassets/developer-guides/).
 *
 * For the Coston2 demo, the faucet transfers FXRP from the verifier wallet
 * (which has a 20 FXRP test balance) to the user's connected EVM address.
 *
 * POST /api/faucet
 *   body: { address: "0x..." }
 *   returns: { txHash, amount, balance }
 *
 * Rate-limited to 5 FXRP per address per call, with a hard cap of 5 FXRP
 * to conserve the verifier's test balance.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFlareConfig, AEGIS_CONTRACTS, FLARE_SYSTEM_CONTRACTS } from '@/lib/flare-config';

// Faucet does on-chain ERC20 transfers + C2FLR drip — allow up to 60s.
export const maxDuration = 60;
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FAUCET_AMOUNT = BigInt(5_000_000); // 5 FXRP (6 decimals)
const MINIMUM_REMAINING_FOR_VERIFIER = BigInt(1_000_000); // Keep at least 1 FXRP for verifier
const CFLR_GAS_DRIP = BigInt(500_000_000_000_000_000); // 0.5 C2FLR for gas (approve + deposit ~0.05 CFLR each)
const CFLR_MINIMUM_REMAINING = BigInt(10_000_000_000_000_000_000); // Keep at least 10 C2FLR for verifier

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { address } = body as { address?: string };

    if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return NextResponse.json(
        { error: 'Valid EVM address required' },
        { status: 400 }
      );
    }

    const verifierKey = process.env.VERIFIER_PRIVATE_KEY;
    if (!verifierKey) {
      return NextResponse.json(
        { error: 'VERIFIER_PRIVATE_KEY not configured on server' },
        { status: 503 }
      );
    }

    // Dynamic import to avoid bundling ethers in the client
    const { JsonRpcProvider, Wallet, Contract, formatEther } = await import('ethers');

    const config = getFlareConfig();
    const provider = new JsonRpcProvider(config.rpcUrl);
    const wallet = new Wallet(verifierKey, provider);

    // Validate chain ID matches Coston2
    const network = await provider.getNetwork();
    if (Number(network.chainId) !== config.chainId) {
      return NextResponse.json(
        { error: `Wrong chain: expected ${config.chainId}, got ${Number(network.chainId)}` },
        { status: 500 }
      );
    }

    // FXRP ERC20 interface (FXRP is a transparent proxy — standard ERC20 methods work)
    const fxrpAbi = [
      'function balanceOf(address) view returns (uint256)',
      'function transfer(address to, uint256 amount) returns (bool)',
      'function decimals() view returns (uint8)',
      'function symbol() view returns (string)',
    ];
    const fxrp = new Contract(FLARE_SYSTEM_CONTRACTS.FXRP, fxrpAbi, wallet);

    // Check verifier FXRP balance
    const verifierFxrpBalance = await fxrp.balanceOf(wallet.address);
    if (verifierFxrpBalance < FAUCET_AMOUNT + MINIMUM_REMAINING_FOR_VERIFIER) {
      return NextResponse.json(
        {
          error: 'Faucet depleted — verifier FXRP balance too low',
          verifierBalance: verifierFxrpBalance.toString(),
          required: (FAUCET_AMOUNT + MINIMUM_REMAINING_FOR_VERIFIER).toString(),
        },
        { status: 503 }
      );
    }

    // Check verifier CFLR (native gas) balance
    const verifierCflrBalance = await provider.getBalance(wallet.address);

    // Check user's current balances
    const userFxrpBalance = await fxrp.balanceOf(address);
    const userCflrBalance = await provider.getBalance(address);

    const needsFxrp = userFxrpBalance < FAUCET_AMOUNT;
    const needsCflr = userCflrBalance < CFLR_GAS_DRIP; // drip if < 0.5 C2FLR

    // If user already has enough of both, skip
    if (!needsFxrp && !needsCflr) {
      return NextResponse.json({
        txHash: null,
        amount: 0,
        balance: Number(userFxrpBalance) / 1e6,
        cflrBalance: Number(userCflrBalance) / 1e18,
        message: `Address already has ${Number(userFxrpBalance) / 1e6} FXRP + ${Number(userCflrBalance) / 1e18} C2FLR — no drip needed`,
        skipped: true,
      });
    }

    const txHashes: string[] = [];
    let fxrpTxHash: string | null = null;
    let cflrTxHash: string | null = null;
    let lastBlockNumber: number | undefined;

    // Step 1: Drip CFLR (gas) first — without gas, nothing else works
    if (needsCflr && verifierCflrBalance > CFLR_GAS_DRIP + CFLR_MINIMUM_REMAINING) {
      try {
        const cflrTx = await wallet.sendTransaction({
          to: address,
          value: CFLR_GAS_DRIP,
        });
        const cflrReceipt = await cflrTx.wait();
        if (cflrReceipt?.status === 1) {
          cflrTxHash = cflrTx.hash;
          txHashes.push(cflrTx.hash);
          lastBlockNumber = cflrReceipt.blockNumber;
        }
      } catch {
        // Non-fatal — user might already have gas from another source
      }
    }

    // Step 2: Drip FXRP
    if (needsFxrp) {
      const fxrpTx = await fxrp.transfer(address, FAUCET_AMOUNT);
      const fxrpReceipt = await fxrpTx.wait();
      if (fxrpReceipt?.status !== 1) {
        return NextResponse.json(
          { error: 'Faucet FXRP transfer reverted on-chain', txHash: fxrpTx.hash },
          { status: 500 }
        );
      }
      fxrpTxHash = fxrpTx.hash;
      txHashes.push(fxrpTx.hash);
      lastBlockNumber = fxrpReceipt.blockNumber;
    }

    const newFxrpBalance = await fxrp.balanceOf(address);
    const newCflrBalance = await provider.getBalance(address);

    const parts: string[] = [];
    if (needsFxrp) parts.push(`${Number(FAUCET_AMOUNT) / 1e6} FXRP`);
    if (cflrTxHash) parts.push(`${Number(CFLR_GAS_DRIP) / 1e18} C2FLR (gas)`);

    return NextResponse.json({
      txHash: fxrpTxHash || txHashes[0] || null,
      txHashes,
      fxrpTxHash,
      cflrTxHash,
      blockNumber: lastBlockNumber,
      amount: needsFxrp ? Number(FAUCET_AMOUNT) / 1e6 : 0,
      balance: Number(newFxrpBalance) / 1e6,
      cflrBalance: Number(newCflrBalance) / 1e18,
      gasDrip: cflrTxHash ? Number(CFLR_GAS_DRIP) / 1e18 : 0,
      symbol: 'FXRP',
      from: wallet.address,
      to: address,
      message: `Dripped ${parts.join(' + ')} to ${address.slice(0, 8)}...${address.slice(-4)}`,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Faucet failed',
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/faucet — returns the faucet status (verifier FXRP balance)
 */
export async function GET() {
  try {
    const { JsonRpcProvider, Contract } = await import('ethers');
    const config = getFlareConfig();
    const provider = new JsonRpcProvider(config.rpcUrl);

    const fxrpAbi = ['function balanceOf(address) view returns (uint256)'];
    const fxrp = new Contract(FLARE_SYSTEM_CONTRACTS.FXRP, fxrpAbi, provider);

    // Read verifier balances
    const verifierAddress = '0xe37Ee912289B047A7C5e9DC8c15ab23E21b8b0C4';
    const fxrpBalance = await fxrp.balanceOf(verifierAddress);
    const cflrBalance = await provider.getBalance(verifierAddress);

    return NextResponse.json({
      available: Number(fxrpBalance) / 1e6,
      cflrAvailable: Number(cflrBalance) / 1e18,
      symbol: 'FXRP',
      dripAmount: Number(FAUCET_AMOUNT) / 1e6,
      gasDripAmount: Number(CFLR_GAS_DRIP) / 1e18,
      verifierAddress,
      contractAddress: FLARE_SYSTEM_CONTRACTS.FXRP,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to read faucet status' },
      { status: 500 }
    );
  }
}
