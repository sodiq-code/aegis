/**
 * API Route: FCC Extension Proxy
 * 
 * Proxies requests to the Aegis FCC extension server.
 * In production, the extension runs inside a TEE on Flare.
 * For development/demo, it connects to the local Go server.
 */

import { NextRequest, NextResponse } from 'next/server';
import { FCC_EXTENSION_CONFIG } from '@/lib/flare-config';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const endpoint = searchParams.get('endpoint') || '/health';
    const url = `${FCC_EXTENSION_CONFIG.proxyUrl}${endpoint}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `FCC Extension error: HTTP ${response.status}`, reachable: false },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json({ ...data, reachable: true });
  } catch (error) {
    // FCC extension not reachable — return mock data for demo
    return NextResponse.json({
      reachable: false,
      error: error instanceof Error ? error.message : 'Extension not reachable',
      mock: true,
    });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const endpoint = body.endpoint || '/health';
    const url = `${FCC_EXTENSION_CONFIG.proxyUrl}${endpoint}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body.payload || {}),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `FCC Extension error: HTTP ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Extension not reachable' },
      { status: 503 }
    );
  }
}
