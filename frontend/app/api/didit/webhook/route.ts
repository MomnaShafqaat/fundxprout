// frontend/app/api/didit/webhook/route.ts
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabaseAdmin } from '@/utils/supabase/admin';
import { fetchAndStoreDiditDecision } from '@/lib/diditServer';

function shortenFloats(data: any): any {
  if (Array.isArray(data)) return data.map(shortenFloats);
  if (data !== null && typeof data === 'object') {
    return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, shortenFloats(v)]));
  }
  return data;
}

function sortKeys(obj: any): any {
  if (Array.isArray(obj)) return obj.map(sortKeys);
  if (obj !== null && typeof obj === 'object') {
    return Object.keys(obj).sort().reduce((acc: any, k: string) => {
      acc[k] = sortKeys(obj[k]);
      return acc;
    }, {});
  }
  return obj;
}

function verifySignature(rawBody: string, signature: string, timestamp: string, secret: string) {
  try {
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - parseInt(timestamp, 10)) > 600) return false;
    const canonical = JSON.stringify(sortKeys(shortenFloats(JSON.parse(rawBody))));
    const expected = crypto.createHmac('sha256', secret).update(canonical, 'utf8').digest('hex');
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(signature, 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

async function createNotification(userId: string, title: string, message: string, type: string = 'kyc_status') {
  try {
    await supabaseAdmin.from('notifications').insert([
      {
        user_id: userId,
        type,
        title,
        message,
        link: '/profile',
        metadata: { source: 'didit_webhook' },
      },
    ]);
  } catch (err) {
    console.error('[Didit Webhook Notification Error]:', err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get('x-signature-v2');
    const timestamp = request.headers.get('x-timestamp');
    const secret = process.env.DIDIT_WEBHOOK_SECRET;

    // Signature verification (if secret is configured, verify; otherwise log warning in dev)
    if (secret && signature && timestamp) {
      const isValid = verifySignature(rawBody, signature, timestamp, secret);
      if (!isValid) {
        console.warn('[Didit Webhook] Signature verification failed. Proceeding with caution.');
      }
    }

    const payload = JSON.parse(rawBody);
    console.log('[Didit Webhook Received]:', JSON.stringify(payload, null, 2));

    const sessionId = payload.session_id || payload.id || payload.session?.id || payload.session?.session_id;
    const status = payload.status || payload.session_status || payload.session?.status;
    const decision = payload.decision || payload.decision_status || payload.session?.decision || null;

    let entityId = payload.vendor_data || payload.session?.vendor_data;
    let sessionKind = payload.session_kind || payload.type || payload.session?.session_kind || 'KYC';

    if (!sessionId) {
      return NextResponse.json({ message: 'No session_id in webhook' }, { status: 200 });
    }

    // Lookup session in DB if entityId is missing
    const { data: dbSession } = await supabaseAdmin
      .from('verification_sessions')
      .select('*')
      .eq('didit_session_id', sessionId)
      .maybeSingle();

    if (dbSession) {
      if (!entityId) entityId = dbSession.entity_id;
      if (!sessionKind) sessionKind = dbSession.session_kind;
    }

    const statusLower = (status || '').toLowerCase();
    const decisionLower = (decision || '').toLowerCase();
    const isApproved = statusLower === 'approved' || statusLower === 'completed' || decisionLower === 'approved';
    const isDeclined = statusLower === 'declined' || statusLower === 'rejected' || decisionLower === 'declined' || decisionLower === 'rejected';
    const isInReview = statusLower.includes('review') || statusLower.includes('progress') || statusLower.includes('needs');

    // Update verification_sessions table
    await supabaseAdmin
      .from('verification_sessions')
      .upsert(
        {
          didit_session_id: sessionId,
          entity_type: sessionKind === 'KYB' ? 'business' : 'user',
          entity_id: entityId || '00000000-0000-0000-0000-000000000000',
          session_kind: sessionKind,
          status: status || 'Pending',
          decision: decision || status || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'didit_session_id' }
      );

    // Fetch and store enriched decision data (scores, biometrics, device data)
    await fetchAndStoreDiditDecision(sessionId);

    // Update profiles and send notifications
    if (entityId && entityId !== '00000000-0000-0000-0000-000000000000') {
      if (isApproved) {
        if (sessionKind === 'KYC') {
          await supabaseAdmin.from('profiles').update({ identity_verified: true }).eq('user_id', entityId);
          await createNotification(
            entityId,
            'Identity Verified ✓',
            'Your KYC identity verification has been approved by Didit! You can now invest and trade on FundXprout.'
          );
        } else if (sessionKind === 'KYB') {
          await supabaseAdmin.from('businesses').update({ kyb_verified: true }).or(`id.eq.${entityId},owner_id.eq.${entityId}`);
          await createNotification(
            entityId,
            'Business Verified ✓',
            'Your KYB business verification has been approved by Didit! You can now launch fundraising campaigns.',
            'kyb_status'
          );
        }
      } else if (isDeclined) {
        if (sessionKind === 'KYC') {
          await supabaseAdmin.from('profiles').update({ identity_verified: false }).eq('user_id', entityId);
          await createNotification(
            entityId,
            'KYC Verification Declined',
            `Your KYC verification could not be approved. Reason: ${decision || 'Document validation criteria not met'}. Please re-submit or contact support.`
          );
        }
      } else if (isInReview) {
        await createNotification(
          entityId,
          'KYC Submission Under Review',
          'Your identity verification documents have been received and are currently undergoing compliance review by our team. Check back shortly.'
        );
      }
    }

    return NextResponse.json({ success: true, sessionId, status, decision });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Webhook processing error';
    console.error('[Didit Webhook Error]:', msg);
    return NextResponse.json({ error: msg }, { status: 200 }); // Always 200 to Didit so it doesn't fail
  }
}
