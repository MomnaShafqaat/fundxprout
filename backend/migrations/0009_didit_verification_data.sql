-- backend/migrations/0009_didit_verification_data.sql
-- Enriches the verification_sessions table to store full Didit decision payloads.
-- This allows the admin dashboard to display the complete KYC/KYB data from Didit
-- without needing to re-query the Didit API every time.
-- Run this in the Supabase SQL editor.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Create verification_sessions table if it doesn't exist yet
--    (some installs may not have it if they skipped the Didit integration step)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.verification_sessions (
  didit_session_id  text PRIMARY KEY,
  entity_type       text NOT NULL DEFAULT 'user',   -- 'user' | 'business'
  entity_id         uuid NOT NULL,
  session_kind      text NOT NULL DEFAULT 'KYC',    -- 'KYC' | 'KYB'
  status            text,                            -- 'Not Started' | 'In Progress' | 'Approved' | 'Declined' | 'Expired'
  decision          text,                            -- Free-text decision label from Didit
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vsessions_entity_id    ON public.verification_sessions(entity_id);
CREATE INDEX IF NOT EXISTS idx_vsessions_session_kind ON public.verification_sessions(session_kind);
CREATE INDEX IF NOT EXISTS idx_vsessions_status       ON public.verification_sessions(status);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Add enriched columns for the full Didit decision payload
-- ─────────────────────────────────────────────────────────────────────────────

-- Personal / Document identity fields (KYC)
ALTER TABLE public.verification_sessions
  ADD COLUMN IF NOT EXISTS first_name            text,
  ADD COLUMN IF NOT EXISTS last_name             text,
  ADD COLUMN IF NOT EXISTS date_of_birth         text,
  ADD COLUMN IF NOT EXISTS nationality           text,
  ADD COLUMN IF NOT EXISTS document_type         text,
  ADD COLUMN IF NOT EXISTS document_number       text,
  ADD COLUMN IF NOT EXISTS personal_number       text,
  ADD COLUMN IF NOT EXISTS issuing_state         text,
  ADD COLUMN IF NOT EXISTS expiration_date       text,
  ADD COLUMN IF NOT EXISTS gender                text,

  -- Check scores / results
  ADD COLUMN IF NOT EXISTS liveness_score        numeric,
  ADD COLUMN IF NOT EXISTS liveness_status       text,
  ADD COLUMN IF NOT EXISTS face_match_score      numeric,
  ADD COLUMN IF NOT EXISTS face_match_status     text,
  ADD COLUMN IF NOT EXISTS aml_status            text,
  ADD COLUMN IF NOT EXISTS aml_hits              integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS device_ip             text,
  ADD COLUMN IF NOT EXISTS device_country        text,
  ADD COLUMN IF NOT EXISTS device_platform       text,
  ADD COLUMN IF NOT EXISTS is_vpn                boolean DEFAULT false,

  -- KYB-specific fields
  ADD COLUMN IF NOT EXISTS company_name          text,
  ADD COLUMN IF NOT EXISTS registration_number   text,
  ADD COLUMN IF NOT EXISTS company_type          text,
  ADD COLUMN IF NOT EXISTS incorporation_date    text,
  ADD COLUMN IF NOT EXISTS company_status        text,
  ADD COLUMN IF NOT EXISTS company_country       text,
  ADD COLUMN IF NOT EXISTS kyb_key_people        jsonb,     -- Array of officers/UBOs

  -- Admin override
  ADD COLUMN IF NOT EXISTS admin_override_status text,      -- Admin can manually set: 'Approved' | 'Declined' | null
  ADD COLUMN IF NOT EXISTS admin_override_reason text,
  ADD COLUMN IF NOT EXISTS admin_override_by     uuid REFERENCES public.profiles(user_id),
  ADD COLUMN IF NOT EXISTS admin_override_at     timestamptz,

  -- Full raw payload from Didit (stored for audit purposes)
  ADD COLUMN IF NOT EXISTS didit_decision_payload jsonb,   -- Full GET /v3/session/{id}/decision/ response
  ADD COLUMN IF NOT EXISTS didit_raw_events       jsonb;   -- Raw webhook events array

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Computed helper view for the admin dashboard
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_admin_verifications AS
SELECT
  vs.didit_session_id,
  vs.entity_type,
  vs.entity_id,
  vs.session_kind,
  -- Effective status: use admin override if set, else Didit status
  COALESCE(vs.admin_override_status, vs.status) AS effective_status,
  vs.status                     AS didit_status,
  vs.admin_override_status,
  vs.admin_override_reason,
  vs.decision,
  vs.created_at,
  vs.updated_at,

  -- KYC personal data
  vs.first_name,
  vs.last_name,
  vs.date_of_birth,
  vs.nationality,
  vs.document_type,
  vs.document_number,
  vs.personal_number,
  vs.issuing_state,
  vs.expiration_date,
  vs.gender,

  -- Verification check results
  vs.liveness_score,
  vs.liveness_status,
  vs.face_match_score,
  vs.face_match_status,
  vs.aml_status,
  vs.aml_hits,
  vs.device_ip,
  vs.device_country,
  vs.device_platform,
  vs.is_vpn,

  -- KYB fields
  vs.company_name,
  vs.registration_number,
  vs.company_type,
  vs.incorporation_date,
  vs.company_status,
  vs.company_country,
  vs.kyb_key_people,

  -- Linked user profile (for KYC sessions)
  p.full_name         AS user_full_name,
  p.user_id           AS user_id,
  p.identity_verified AS platform_kyc_status,
  p.wallet_address    AS user_wallet,

  -- Linked business (for KYB sessions)
  b.business_name     AS business_name,
  b.owner_id          AS business_owner_id,
  b.kyb_verified      AS platform_kyb_status

FROM public.verification_sessions vs
LEFT JOIN public.profiles  p ON (vs.session_kind = 'KYC' AND p.user_id = vs.entity_id)
LEFT JOIN public.businesses b ON (vs.session_kind = 'KYB' AND b.id = vs.entity_id);

COMMENT ON VIEW public.v_admin_verifications IS 'Admin view joining Didit session data with platform profile/business data for the admin KYC/KYB dashboard.';
