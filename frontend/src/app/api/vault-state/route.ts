/**
 * API Route: Vault State
 * 
 * Reads vault state from Flare RPC (Coston2) and returns it to the dashboard.
 * This is the primary data source for the Treasury view.
 * Uses correct keccak256 function selectors for VaultCore and SolvencyRoot.
 */

import { NextResponse } from 'next/server';
import { getFlareConfig, AEGIS_CONTRACTS } from '@/lib/flare-config';

interface JsonRpcResponse {
  result?: string;
  error?: { code: number; message: string };
}

async function rpcCall(method: string, params: unknown[] = []): Promise<string> {
  const config = getFlareConfig();
  const response = await fetch(config.rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const data: JsonRpcResponse = await response.json();
  if (data.error) throw new Error(data.error.message);
  return data.result || '0x0';
}

// Correct keccak256 function selectors (computed from contract ABIs)
const SELECTORS = {
  getTotalFxrpDeposited: '0xccec9b1d',   // getTotalFxrpDeposited()
  getTotalValuation: '0x8467456b',        // getTotalValuation()
  getActivePositionCount: '0xc5b01a23',   // getActivePositionCount()
  getXrpUsdPrice: '0xf0ec455a',           // getXrpUsdPrice()
  isEmergencyMode: '0x20a194b8',          // isEmergencyMode()
  isSafeState: '0x2473d898',              // isSafeState()
  isSolvent: '0x5ce23950',                // isSolvent() returns (bool, uint256)
} as const;

export async function GET() {
  try {
    const vaultCore = AEGIS_CONTRACTS.VaultCore;
    const solvencyRoot = AEGIS_CONTRACTS.SolvencyRoot;

    // Read all vault state from on-chain in parallel
    const [
      chainIdHex,
      blockHex,
      totalDepositedHex,
      totalValuationHex,
      positionCountHex,
      xrpPriceHex,
      isEmergencyHex,
      isSafeHex,
      isSolventHex,
    ] = await Promise.all([
      rpcCall('eth_chainId'),
      rpcCall('eth_blockNumber'),
      rpcCall('eth_call', [{ to: vaultCore, data: SELECTORS.getTotalFxrpDeposited }, 'latest']).catch(() => '0x0'),
      rpcCall('eth_call', [{ to: vaultCore, data: SELECTORS.getTotalValuation }, 'latest']).catch(() => '0x0'),
      rpcCall('eth_call', [{ to: vaultCore, data: SELECTORS.getActivePositionCount }, 'latest']).catch(() => '0x0'),
      rpcCall('eth_call', [{ to: vaultCore, data: SELECTORS.getXrpUsdPrice }, 'latest']).catch(() => '0x0'),
      rpcCall('eth_call', [{ to: vaultCore, data: SELECTORS.isEmergencyMode }, 'latest']).catch(() => '0x0'),
      rpcCall('eth_call', [{ to: vaultCore, data: SELECTORS.isSafeState }, 'latest']).catch(() => '0x0'),
      rpcCall('eth_call', [{ to: solvencyRoot, data: SELECTORS.isSolvent }, 'latest']).catch(() => '0x0'),
    ]);

    const chainId = parseInt(chainIdHex, 16);
    const blockNumber = parseInt(blockHex, 16);
    const totalDeposited = parseInt(totalDepositedHex, 16);
    const totalValuation = parseInt(totalValuationHex, 16);
    const positionCount = parseInt(positionCountHex, 16);

    // FTSO V2 returns XRP/USD with 6 decimals
    const xrpPriceRaw = parseInt(xrpPriceHex, 16);
    const xrpPrice = xrpPriceRaw / 1e6;

    const isEmergency = isEmergencyHex !== '0x0000000000000000000000000000000000000000000000000000000000000000';
    const isSafeState = isSafeHex !== '0x0000000000000000000000000000000000000000000000000000000000000000';

    // Parse isSolvent() return: (bool, uint256) ABI-encoded
    let solvent = false;
    let collateralRatio = 0;
    if (isSolventHex && isSolventHex.length >= 130) {
      const boolPart = isSolventHex.slice(2, 66);
      const ratioPart = isSolventHex.slice(66, 130);
      solvent = parseInt(boolPart, 16) === 1;
      // ratio stored as basis points * 100 (e.g., 14000 = 140.00%)
      collateralRatio = parseInt(ratioPart, 16) / 100;
    }

    // Verify all contracts are deployed
    const contractChecks = await Promise.all(
      Object.entries(AEGIS_CONTRACTS).map(async ([name, address]) => {
        const code = await rpcCall('eth_getCode', [address, 'latest']);
        return [name, code.length > 10] as const;
      })
    );
    const contractsDeployed = Object.fromEntries(contractChecks);

    return NextResponse.json({
      connected: true,
      chainId,
      blockNumber,
      vault: {
        totalDeposited,
        totalValuation,
        positionCount,
        xrpPrice,
        isEmergency,
        isSafeState,
      },
      solvency: {
        solvent,
        collateralRatio,
      },
      contractsDeployed,
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        connected: false,
        error: error instanceof Error ? error.message : 'Failed to connect to Flare RPC',
        vault: null,
        solvency: null,
        contractsDeployed: null,
      },
      { status: 503 }
    );
  }
}
