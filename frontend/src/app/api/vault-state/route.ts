/**
 * API Route: Vault State
 * 
 * Reads vault state from Flare RPC and returns it to the dashboard.
 * This is the primary data source for the Treasury view.
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

export async function GET() {
  try {
    // Read vault state from on-chain
    const [chainIdHex, blockHex, totalDepositedHex, totalValuationHex, positionCountHex, xrpPriceHex, isEmergencyHex] = 
      await Promise.all([
        rpcCall('eth_chainId'),
        rpcCall('eth_blockNumber'),
        rpcCall('eth_call', [{ to: AEGIS_CONTRACTS.VaultCore, data: '0x2e1a7d4d' }, 'latest']).catch(() => '0x0'),
        rpcCall('eth_call', [{ to: AEGIS_CONTRACTS.VaultCore, data: '0x5641ec03' }, 'latest']).catch(() => '0x0'),
        rpcCall('eth_call', [{ to: AEGIS_CONTRACTS.VaultCore, data: '0xc3f909d4' }, 'latest']).catch(() => '0x0'),
        rpcCall('eth_call', [{ to: AEGIS_CONTRACTS.VaultCore, data: '0xf514d6e5' }, 'latest']).catch(() => '0x0'),
        rpcCall('eth_call', [{ to: AEGIS_CONTRACTS.VaultCore, data: '0xeb02c301' }, 'latest']).catch(() => '0x0'),
      ]);

    const chainId = parseInt(chainIdHex, 16);
    const blockNumber = parseInt(blockHex, 16);
    const totalDeposited = parseInt(totalDepositedHex, 16);
    const totalValuation = parseInt(totalValuationHex, 16);
    const positionCount = parseInt(positionCountHex, 16);
    const xrpPriceRaw = parseInt(xrpPriceHex, 16);
    const xrpPrice = xrpPriceRaw / 1e6; // 6 decimals
    const isEmergency = isEmergencyHex !== '0x0000000000000000000000000000000000000000000000000000000000000000';

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
        isSafeState: false,
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
        contractsDeployed: null,
      },
      { status: 503 }
    );
  }
}
