/**
 * API Route: Xaman Config Status
 *
 * Returns whether the Xaman (Xumm) API key is configured on the server.
 * The frontend uses this to decide whether to show the "Connect with Xaman QR"
 * button or fall back to manual address entry only.
 *
 * GET /api/xaman-config
 *   returns: { configured: boolean, hasApiKey: boolean, hasApiSecret: boolean }
 */

import { NextResponse } from 'next/server';

export async function GET() {
  const hasApiKey = !!process.env.XAMM_API_KEY;
  const hasApiSecret = !!process.env.XAMM_API_SECRET;

  return NextResponse.json({
    configured: hasApiKey && hasApiSecret,
    hasApiKey,
    hasApiSecret,
  });
}
