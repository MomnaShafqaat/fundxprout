// frontend/lib/diditServer.ts
import { supabaseAdmin } from '@/utils/supabase/admin';

export async function createDiditSession(type: 'kyc' | 'kyb', userId: string) {
  const apiKey = process.env.DIDIT_API_KEY;
  const kycWorkflow = process.env.DIDIT_KYC_WORKFLOW_ID;
  const kybWorkflow = process.env.DIDIT_KYB_WORKFLOW_ID;
  const appUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

  if (!apiKey) {
    throw new Error('DIDIT_API_KEY is not configured in environment variables');
  }

  const workflowId = type === 'kyc' ? kycWorkflow : kybWorkflow;
  if (!workflowId) {
    throw new Error(`DIDIT_${type.toUpperCase()}_WORKFLOW_ID is not configured in environment variables`);
  }

  let vendorData = userId;
  let entityType = 'user';
  let entityId = userId;

  if (type === 'kyb') {
    const { data: business } = await supabaseAdmin
      .from('businesses')
      .select('id')
      .eq('owner_id', userId)
      .maybeSingle();

    if (!business) {
      throw new Error('Please create a business profile first before initiating KYB verification');
    }
    vendorData = business.id;
    entityType = 'business';
    entityId = business.id;
  }

  const callbackUrl = `${appUrl}/profile?${type}=complete`;

  const response = await fetch('https://verification.didit.me/v3/session/', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      workflow_id: workflowId,
      callback: callbackUrl,
      redirect_url: callbackUrl,
      return_url: callbackUrl,
      vendor_data: vendorData,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Didit API error (${response.status}): ${errorText}`);
  }

  const session = await response.json();

  if (!session.url || !session.session_id) {
    throw new Error('Didit API did not return a valid session URL or session_id');
  }

  // Save session record in Supabase verification_sessions
  await supabaseAdmin.from('verification_sessions').upsert(
    {
      entity_type: entityType,
      entity_id: entityId,
      didit_session_id: session.session_id,
      session_kind: type.toUpperCase(),
      status: session.status || 'Not Started',
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'didit_session_id' }
  );

  return { url: session.url, session_id: session.session_id };
}

export async function fetchAndStoreDiditDecision(sessionId: string) {
  const apiKey = process.env.DIDIT_API_KEY;
  if (!apiKey || !sessionId) return null;

  try {
    // 1. Fetch main session object (contains status, decision, warnings, vendor_data, workflow, and features)
    let sessionData: Record<string, any> = {};
    try {
      const sRes = await fetch(`https://verification.didit.me/v3/session/${sessionId}/`, {
        headers: { 'x-api-key': apiKey },
        cache: 'no-store',
      });
      if (sRes.ok) {
        sessionData = await sRes.json();
      } else {
        console.warn(`[Didit] Session details API returned status ${sRes.status}`);
      }
    } catch (e) {
      console.warn('[Didit] Error fetching session details:', e);
    }

    // 2. Also try fetching decision endpoint if available
    let decisionData: Record<string, any> = {};
    try {
      const dRes = await fetch(`https://verification.didit.me/v3/session/${sessionId}/decision/`, {
        headers: { 'x-api-key': apiKey },
        cache: 'no-store',
      });
      if (dRes.ok) {
        decisionData = await dRes.json();
      }
    } catch (e) {
      // Non-fatal, decision endpoint may return 404 for unsubmitted sessions
    }

    // If both failed or empty, return null
    if (Object.keys(sessionData).length === 0 && Object.keys(decisionData).length === 0) {
      console.warn(`[Didit] Could not fetch session or decision data for ${sessionId}`);
      return null;
    }

    // Merge session and decision payloads
    const d: Record<string, any> = {
      ...sessionData,
      ...decisionData,
      features: {
        ...(sessionData.features || {}),
        ...(decisionData.features || {}),
      },
    };

    // Extract features across all Didit v3 variations
    const feats = d.features || {};
    const idFeat = feats.id_verification || feats.document_verification || feats.kyc || {};
    const idProps = idFeat.properties || idFeat.data || idFeat.extracted_data || {};
    const kyc = { ...idProps, ...(d.kyc || {}), ...(d.id_verification || {}), ...(d.personal_data || {}) };

    const livenessFeat = feats.liveness || feats.passive_liveness || {};
    const liveness = { ...livenessFeat, ...(d.liveness || {}), ...(d.passive_liveness || {}) };

    const faceMatchFeat = feats.face_match || feats.face_comparison || {};
    const faceMatch = { ...faceMatchFeat, ...(d.face_match || {}), ...(d.face_comparison || {}) };

    const amlFeat = feats.aml || feats.aml_screening || {};
    const aml = { ...amlFeat, ...(d.aml || {}), ...(d.aml_screening || {}) };

    const deviceFeat = feats.ip_analysis || feats.device_analysis || feats.device_ip_analysis || {};
    const device = { ...deviceFeat, ...(d.device_analysis || {}), ...(d.device_ip_analysis || {}), ...(d.device || {}) };

    const kybFeat = feats.company_registry || feats.kyb || {};
    const kyb = { ...kybFeat, ...(d.company_registry || {}), ...(d.kyb || {}) };
    const keyPeople = d.key_people || d.kyb_key_people || kyb.key_people || kybFeat.key_people || null;

    // Resolve liveness score (0..1 or 0..100)
    let livenessScore: number | null = null;
    const rawLivenessScore = liveness.score ?? liveness.value ?? liveness.confidence ?? liveness.liveness_score;
    if (rawLivenessScore !== undefined && rawLivenessScore !== null && !isNaN(Number(rawLivenessScore))) {
      livenessScore = Number(rawLivenessScore);
    }

    // Resolve face match score
    let faceMatchScore: number | null = null;
    const rawFaceScore = faceMatch.score ?? faceMatch.value ?? faceMatch.similarity ?? faceMatch.match_score;
    if (rawFaceScore !== undefined && rawFaceScore !== null && !isNaN(Number(rawFaceScore))) {
      faceMatchScore = Number(rawFaceScore);
    }

    // Resolve warnings (e.g. "MRZ is not valid", "Face not matched")
    const warnings = d.warnings || sessionData.warnings || [];

    const enrichment = {
      didit_decision_payload: d,
      status: d.status || sessionData.status || undefined,
      decision: d.decision || sessionData.decision || (warnings.length > 0 ? (typeof warnings[0] === 'string' ? warnings[0] : warnings[0].message || warnings[0].code) : null),
      updated_at: new Date().toISOString(),
      first_name: kyc.first_name || d.first_name || null,
      last_name: kyc.last_name || d.last_name || null,
      date_of_birth: kyc.date_of_birth || d.date_of_birth || null,
      nationality: kyc.nationality || d.nationality || null,
      document_type: kyc.document_type || d.document_type || null,
      document_number: kyc.document_number || d.document_number || null,
      personal_number: kyc.personal_number || d.personal_number || null,
      issuing_state: kyc.issuing_state || kyc.issuing_country || d.issuing_state || null,
      expiration_date: kyc.expiration_date || d.expiration_date || null,
      gender: kyc.gender || d.gender || null,
      liveness_score: livenessScore,
      liveness_status: liveness.status || liveness.result || null,
      face_match_score: faceMatchScore,
      face_match_status: faceMatch.status || faceMatch.result || null,
      aml_status: aml.status || aml.result || null,
      aml_hits: Number(aml.hits_count || aml.hits || 0),
      device_ip: device.ip || device.ip_address || null,
      device_country: device.country || device.country_name || null,
      device_platform: device.platform || device.device_platform || device.os || null,
      is_vpn: device.is_vpn === true || device.vpn === true,
      company_name: kyb.company_name || d.company_name || null,
      registration_number: kyb.registration_number || d.registration_number || null,
      company_type: kyb.company_type || d.company_type || null,
      incorporation_date: kyb.incorporation_date || d.incorporation_date || null,
      company_status: kyb.status || d.company_status || null,
      company_country: kyb.country || d.company_country || null,
      kyb_key_people: Array.isArray(keyPeople) ? keyPeople : null,
    };

    // Attempt to update verification_sessions with all columns
    const { error: updateError } = await supabaseAdmin
      .from('verification_sessions')
      .update(enrichment)
      .eq('didit_session_id', sessionId);

    if (updateError) {
      console.warn('[Didit] Full column update failed (migration 0009 may need to be run in Supabase SQL editor):', updateError.message);
      // Fallback: update only base columns so status and decision are never lost
      await supabaseAdmin
        .from('verification_sessions')
        .update({
          status: enrichment.status,
          decision: enrichment.decision,
          updated_at: enrichment.updated_at,
        })
        .eq('didit_session_id', sessionId);
    }

    return enrichment;
  } catch (err) {
    console.warn('[Didit] fetchAndStoreDiditDecision error:', err);
    return null;
  }
}

export async function syncDiditStatus(userId: string) {
  const apiKey = process.env.DIDIT_API_KEY;
  if (!userId) throw new Error('userId is required');

  const { data: kycSession } = await supabaseAdmin
    .from('verification_sessions')
    .select('*')
    .eq('entity_id', userId)
    .eq('session_kind', 'KYC')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!kycSession) {
    return { updated: false, message: 'No KYC session found for user' };
  }

  if (!apiKey) {
    return { updated: false, message: 'DIDIT_API_KEY not set' };
  }

  const diditRes = await fetch(`https://verification.didit.me/v3/session/${kycSession.didit_session_id}/`, {
    headers: { 'x-api-key': apiKey },
  });

  if (!diditRes.ok) {
    return { updated: false, message: `Didit API returned ${diditRes.status}` };
  }

  const diditData = await diditRes.json();
  const syncStatus = (diditData.status || '').toLowerCase();
  const syncDecision = (diditData.decision || '').toLowerCase();

  const isApproved = syncStatus === 'approved' || syncStatus === 'completed' || syncDecision === 'approved';
  const isDeclined = syncStatus === 'declined' || syncStatus === 'rejected' || syncDecision === 'declined';
  const isInReview = syncStatus.includes('review') || syncStatus.includes('progress');

  await supabaseAdmin
    .from('verification_sessions')
    .update({
      status: diditData.status || kycSession.status,
      decision: diditData.decision || null,
      updated_at: new Date().toISOString(),
    })
    .eq('didit_session_id', kycSession.didit_session_id);

  // Helper to persist system notification to user
  const notifyUser = async (title: string, message: string) => {
    try {
      await supabaseAdmin.from('notifications').insert([
        {
          user_id: userId,
          type: 'kyc_status',
          title,
          message,
          link: '/profile',
          metadata: { session_id: kycSession.didit_session_id, status: diditData.status },
        },
      ]);
    } catch (err) {
      console.warn('[syncDiditStatus] notification insert error:', err);
    }
  };

  if (isApproved) {
    await supabaseAdmin.from('profiles').update({ identity_verified: true }).eq('user_id', userId);
    await fetchAndStoreDiditDecision(kycSession.didit_session_id);
    await notifyUser(
      'Identity Verified ✓',
      'Your KYC identity verification has been approved! You can now invest and trade on FundXprout.'
    );
    return { updated: true, status: diditData.status, decision: diditData.decision };
  } else if (isDeclined) {
    await supabaseAdmin.from('profiles').update({ identity_verified: false }).eq('user_id', userId);
    await fetchAndStoreDiditDecision(kycSession.didit_session_id);
    await notifyUser(
      'KYC Verification Declined',
      `Your KYC verification could not be approved. Reason: ${diditData.decision || 'Requirements not met'}. Please re-submit or contact support.`
    );
    return { updated: false, status: diditData.status, decision: diditData.decision, declined: true };
  } else if (isInReview) {
    await fetchAndStoreDiditDecision(kycSession.didit_session_id);
    await notifyUser(
      'KYC Submission Under Review',
      'Your identity documents have been submitted and are currently awaiting compliance review by our team.'
    );
    return { updated: false, status: diditData.status, inReview: true };
  }

  return { updated: false, status: diditData.status };
}

export async function syncAllDiditSessions() {
  const apiKey = process.env.DIDIT_API_KEY;
  if (!apiKey) return { count: 0, message: 'DIDIT_API_KEY not configured' };

  const { data: sessions } = await supabaseAdmin
    .from('verification_sessions')
    .select('didit_session_id, status, decision, entity_id')
    .order('created_at', { ascending: false })
    .limit(50);

  if (!sessions || sessions.length === 0) return { count: 0, message: 'No sessions found in database' };

  let updatedCount = 0;
  for (const s of sessions) {
    try {
      const res = await fetch(`https://verification.didit.me/v3/session/${s.didit_session_id}/`, {
        headers: { 'x-api-key': apiKey },
        cache: 'no-store',
      });
      if (res.ok) {
        const d = await res.json();
        if (d.status && (d.status !== s.status || d.decision !== s.decision)) {
          await supabaseAdmin
            .from('verification_sessions')
            .update({
              status: d.status,
              decision: d.decision || null,
              updated_at: new Date().toISOString(),
            })
            .eq('didit_session_id', s.didit_session_id);

          await fetchAndStoreDiditDecision(s.didit_session_id);
          updatedCount++;
        }
      }
    } catch (err) {
      console.warn(`Error syncing session ${s.didit_session_id}:`, err);
    }
  }

  return { count: updatedCount, total: sessions.length };
}
