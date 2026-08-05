/**
 * API Route: Xaman Payment Link Builder
 *
 * Builds a Xaman deep-link URL that pre-fills a Payment transaction for the
 * FAssets direct-mint flow. This works WITHOUT a Xaman API key by using the
 * `xumm://sign?txJSON=<base64>` deep-link format supported by the Xaman app.
 *
 * The user scans a QR code (rendered client-side from the URL) or clicks the
 * link on mobile, and Xaman opens with the destination, amount, and memo
 * pre-filled — the user just reviews and signs.
 *
 * POST /api/xaman-payment-link
 *   body: { destination, amountDrops, memoHex }
 *   returns: { url, qrData, txJson }
 *
 * Reference: https://xumm.readme.io/reference/deep-link
 */

import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { destination, amountDrops, memoHex } = body as {
      destination?: string;
      amountDrops?: string;
      memoHex?: string;
    };

    if (!destination || !destination.match(/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/)) {
      return NextResponse.json(
        { error: 'destination must be a valid XRPL address' },
        { status: 400 }
      );
    }
    if (!amountDrops || !/^\d+$/.test(amountDrops)) {
      return NextResponse.json(
        { error: 'amountDrops must be a numeric string (in drops)' },
        { status: 400 }
      );
    }

    // Build the XRPL Payment transaction JSON.
    // FAssets direct-mint only needs MemoData (32-byte payload).
    // MemoType is omitted — it must be URL-safe when decoded, which the
    // binary FAssets prefix is not.
    const txJson = {
      TransactionType: 'Payment',
      Destination: destination,
      Amount: amountDrops,
      Memos: memoHex ? [{
        Memo: {
          MemoData: memoHex.replace(/^0x/, '').toLowerCase(),
        },
      }] : undefined,
    };

    // Encode txJson as base64 (URL-safe)
    const txJsonStr = JSON.stringify(txJson);
    const base64 = Buffer.from(txJsonStr, 'utf8').toString('base64url');

    // Build the Xuman deep-link URL
    const url = `https://xumm.app/sign?txJSON=${base64}`;

    return NextResponse.json({
      url,
      qrData: url, // The QR code encodes the same URL
      txJson: txJsonStr,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to build payment link' },
      { status: 500 }
    );
  }
}
