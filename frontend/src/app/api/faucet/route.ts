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

const FAUCET_AMOUNT = BigInt(5_000_000); // 5 FXRP (6 decimals)
const MINIMUM_REMAINING_FOR_VERIFIER = BigInt(1_000_000); // Keep at least 1 FXRP for verifier

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

    // Check verifier balance
    const verifierBalance = await fxrp.balanceOf(wallet.address);
    if (verifierBalance < FAUCET_AMOUNT + MINIMUM_REMAINING_FOR_VERIFIER) {
      return NextResponse.json(
        {
          error: 'Faucet depleted — verifier FXRP balance too low',
          verifierBalance: verifierBalance.toString(),
          required: (FAUCET_AMOUNT + MINIMUM_REMAINING_FOR_VERIFIER).toString(),
        },
        { status: 503 }
      );
    }

    // Check user's current FXRP balance (don't drip if they already have enough)
    const userBalance = await fxrp.balanceOf(address);
    if (userBalance >= FAUCET_AMOUNT) {
      return NextResponse.json({
        txHash: null,
        amount: 0,
        balance: Number(userBalance) / 1e6,
        message: `Address already has ${Number(userBalance) / 1e6} FXRP — no faucet drip needed`,
        skipped: true,
      });
    }

    // Transfer FXRP to the user
    const tx = await fxrp.transfer(address, FAUCET_AMOUNT);
    const receipt = await tx.wait();

    if (receipt?.status !== 1) {
      return NextResponse.json(
        { error: 'Faucet transfer reverted on-chain', txHash: tx.hash },
        { status: 500 }
      );
    }

    const newBalance = await fxrp.balanceOf(address);

    return NextResponse.json({
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
      amount: Number(FAUCET_AMOUNT) / 1e6,
      balance: Number(newBalance) / 1e6,
      symbol: 'FXRP',
      from: wallet.address,
      to: address,
      message: `Transferred ${Number(FAUCET_AMOUNT) / 1e6} FXRP to ${address.slice(0, 8)}...${address.slice(-4)}`,
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

    // Read verifier balance (verifier address derived from key — but we can't derive on GET)
    // So we use the known verifier address from the on-chain attestation.
    const verifierAddress = '0xe37Ee912289B047A7C5e9DC8c15ab23E21b8b0C4';
    const balance = await fxrp.balanceOf(verifierAddress);

    return NextResponse.json({
      available: Number(balance) / 1e6,
      symbol: 'FXRP',
      dripAmount: Number(FAUCET_AMOUNT) / 1e6,
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
