/**
 * API Route: Flare RPC Proxy
 *
 * Proxies requests to the Flare Coston2 RPC endpoint.
 * This allows the dashboard to make RPC calls without CORS issues.
 *
 * GET /api/flare-rpc?method=balanceOf&address=0x...
 *   Returns the FXRP balance (6 decimals) of the given address.
 *
 * POST /api/flare-rpc
 *   Body: a raw JSON-RPC request object.
 *   Forwards it to Coston2 and returns the response.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFlareConfig, FLARE_SYSTEM_CONTRACTS } from '@/lib/flare-config';

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

/**
 * GET /api/flare-rpc?method=balanceOf&address=0x...
 *   Returns: { balance: number (FXRP, 6 decimals), balanceAtomic: string, address, token }
 */
async function handleGet(request: NextRequest) {
  const url = new URL(request.url);
  const method = url.searchParams.get('method');

  if (method === 'balanceOf') {
    const address = url.searchParams.get('address');
    if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return NextResponse.json({ error: 'Valid address required' }, { status: 400 });
    }
    try {
      // FXRP.balanceOf(address) selector: 0x70a08231
      const data = '0x70a08231' + address.slice(2).toLowerCase().padStart(64, '0');
      const result = await rpcCall('eth_call', [
        { to: FLARE_SYSTEM_CONTRACTS.FXRP, data },
        'latest',
      ]);
      const balanceAtomic = BigInt(result).toString();
      const balance = Number(balanceAtomic) / 1e6;
      return NextResponse.json({
        balance,
        balanceAtomic,
        address,
        token: FLARE_SYSTEM_CONTRACTS.FXRP,
        symbol: 'FXRP',
        decimals: 6,
      });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'balanceOf failed' },
        { status: 500 }
      );
    }
  }

  if (method === 'xrpPrice') {
    try {
      // VaultCore.getXrpUsdPrice() selector: 0xf0ec455a
      const result = await rpcCall('eth_call', [
        { to: '0xcb08be1cc86d3f94c54c64682372e32f669134bc', data: '0xf0ec455a' },
        'latest',
      ]);
      return NextResponse.json({
        price: Number(BigInt(result)) / 1e6,
        timestamp: Math.floor(Date.now() / 1000),
      });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'xrpPrice failed' },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ error: `Unknown method: ${method}` }, { status: 400 });
}

export async function GET(request: NextRequest) {
  return handleGet(request);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const config = getFlareConfig();

    const response = await fetch(config.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Flare RPC error: HTTP ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
