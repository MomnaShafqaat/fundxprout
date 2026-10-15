// frontend/app/api/didit/[type]/create-session/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createDiditSession } from '@/lib/diditServer';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ type: string }> }
) {
  try {
    const { type } = await context.params;
    const body = await request.json();
    const { userId } = body;

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    if (type !== 'kyc' && type !== 'kyb') {
      return NextResponse.json({ error: `Invalid verification type: "${type}". Use "kyc" or "kyb".` }, { status: 400 });
    }

    const session = await createDiditSession(type, userId);
    return NextResponse.json(session);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to create Didit session';
    console.error('[API Didit create-session error]:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
