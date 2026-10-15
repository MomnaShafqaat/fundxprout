// frontend/app/api/didit/sync-status/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { syncDiditStatus } from '@/lib/diditServer';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId } = body;

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    const result = await syncDiditStatus(userId);
    return NextResponse.json(result);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to sync Didit status';
    console.error('[API Didit sync-status error]:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
