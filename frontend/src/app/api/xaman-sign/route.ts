/**
 * API Route: Xaman Sign Request
 *
 * Creates a Xaman sign request server-side via the xumm-sdk.
 * Falls back to manual mode if XAMM_API_KEY is not configured.
 *
 * POST /api/xaman-sign
 *   body: { action: 'connect' | 'sign', payload?: {...} }
 *   returns (with API key):
 *     { mode: 'qr', sessionId, qrUrl, wsUrl, nextUrl, expiresInSec }
 *   returns (without API key):
 *     { mode: 'manual', message: 'Xaman API key not configured' }
 *
 * GET /api/xaman-sign?sessionId=X
 *   returns: { resolved, address?, balance?, expired }
 *
 * Reference: https://xumm.readme.io/reference/payloadcreate
 */

import { NextRequest, NextResponse } from 'next/server';

// Session storage (in-memory; demo only)
interface XamanSession {
  sessionId: string;
  payloadUuid?: string;       // Xumm payload UUID
  qrUrl?: string;             // QR code image URL
  wsUrl?: string;             // WebSocket URL
  nextUrl?: string;           // Xaman deep link
  createdAt: number;
  expiresAt: number;
  resolved: boolean;
  address?: string;
  balance?: string;
  expired: boolean;
}

const sessions = new Map<string, XamanSession>();

const XAMM_API_KEY = process.env.XAMM_API_KEY || '';
const XAMM_API_SECRET = process.env.XAMM_API_SECRET || '';

function makeSessionId(): string {
  return 'xaman_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

/**
 * POST handler — create a Xaman sign request.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, payload } = body as { action?: string; payload?: any };

    // If no API key, return manual mode
    if (!XAMM_API_KEY || !XAMM_API_SECRET) {
      return NextResponse.json({
        mode: 'manual',
        message: 'Xaman API key not configured on server. Enter your XRPL address manually.',
      });
    }

    // Dynamically import xumm-sdk (only if API key is set)
    const { XummSdk } = await import('xumm-sdk');
    const xumm = new XummSdk(XAMM_API_KEY, XAMM_API_SECRET);

    if (action === 'connect') {
      // Create a simple "sign in" payload — user just signs an arbitrary tx
      // to prove they own the XRPL address.
      const created = await xumm.payload.create({
        TransactionType: 'SignIn',
      });
      if (!created) {
        return NextResponse.json({ error: 'Xaman payload creation failed' }, { status: 500 });
      }

      const sessionId = makeSessionId();
      const session: XamanSession = {
        sessionId,
        payloadUuid: created.uuid,
        qrUrl: created.refs.qr_png,
        wsUrl: created.next.always,
        nextUrl: created.next.always,
        createdAt: Date.now(),
        expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes
        resolved: false,
        expired: false,
      };
      sessions.set(sessionId, session);

      return NextResponse.json({
        mode: 'qr',
        sessionId,
        qrUrl: created.refs.qr_png,
        wsUrl: created.next.always,
        nextUrl: created.next.always,
        expiresInSec: 300,
      });
    }

    if (action === 'sign') {
      // Sign an arbitrary XRPL payment (for the FAssets direct-mint flow)
      const { destination, amountDrops, memoHex } = payload || {};
      if (!destination || !amountDrops) {
        return NextResponse.json(
          { error: 'destination and amountDrops required for sign action' },
          { status: 400 }
        );
      }
      const created = await xumm.payload.create({
        TransactionType: 'Payment',
        Destination: destination,
        Amount: amountDrops,
        Memos: memoHex ? [{
          Memo: { MemoData: memoHex, MemoType: '0x4642505266410018' },
        }] : undefined,
      });
      if (!created) {
        return NextResponse.json({ error: 'Xaman payload creation failed' }, { status: 500 });
      }

      const sessionId = makeSessionId();
      const session: XamanSession = {
        sessionId,
        payloadUuid: created.uuid,
        qrUrl: created.refs.qr_png,
        wsUrl: created.next.always,
        nextUrl: created.next.always,
        createdAt: Date.now(),
        expiresAt: Date.now() + 5 * 60 * 1000,
        resolved: false,
        expired: false,
      };
      sessions.set(sessionId, session);

      return NextResponse.json({
        mode: 'qr',
        sessionId,
        qrUrl: created.refs.qr_png,
        wsUrl: created.next.always,
        nextUrl: created.next.always,
        txHash: null, // will be available after signing
        expiresInSec: 300,
      });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create Xaman sign request' },
      { status: 500 }
    );
  }
}

/**
 * GET handler — poll for sign resolution.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get('sessionId');

  if (!sessionId) {
    return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
  }

  const session = sessions.get(sessionId);
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  // Check expiry
  if (Date.now() > session.expiresAt) {
    session.expired = true;
    return NextResponse.json({ resolved: false, expired: true });
  }

  // If we have a Xaman API key, poll the payload status
  if (session.payloadUuid && XAMM_API_KEY && XAMM_API_SECRET) {
    try {
      const { XummSdk } = await import('xumm-sdk');
      const xumm = new XummSdk(XAMM_API_KEY, XAMM_API_SECRET);
      const payload = await xumm.payload.get(session.payloadUuid);

      // xumm-sdk's payload.get returns an object with .meta.resolved and .response.account
      const isResolved = (payload as any)?.meta?.resolved;
      const account = (payload as any)?.response?.account;
      if (isResolved && account) {
        session.resolved = true;
        session.address = account;

        // Try to fetch balance via XRPL API
        try {
          const balanceResp = await fetch('https://s.altnet.rippletest.net:51234', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              method: 'account_info',
              params: [{ account }],
            }),
          });
          const balanceData = await balanceResp.json();
          const balanceDrops = balanceData?.result?.account_data?.Balance;
          if (balanceDrops) {
            session.balance = (Number(balanceDrops) / 1e6).toFixed(6);
          }
        } catch {}
      }
    } catch {
      // Continue — return current state
    }
  }

  return NextResponse.json({
    resolved: session.resolved,
    address: session.address,
    balance: session.balance,
    expired: session.expired,
  });
}
