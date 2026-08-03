/**
 * API Route: Flare RPC Proxy
 * 
 * Proxies requests to the Flare Coston2 RPC endpoint.
 * This allows the dashboard to make RPC calls without CORS issues.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFlareConfig } from '@/lib/flare-config';

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
