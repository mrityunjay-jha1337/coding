-- ClaimsIntell Seed — translated from prisma/seed.ts
-- Runnable in DBeaver console against a Postgres DB with the Prisma schema applied.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $seed$
DECLARE
  -- Role ids
  v_super_role_id        uuid;
  v_bpo_admin_role_id    uuid;
  v_team_lead_role_id    uuid;
  v_bpo_user_role_id     uuid;
  v_client_role_id       uuid;

  -- Org / user / client / team ids
  v_org_id               uuid;
  v_admin_user_id        uuid;
  v_lead_user_id         uuid;
  v_client1_id           uuid;
  v_client2_id           uuid;
  v_team1_id             uuid;
  v_team2_id             uuid;

  -- Member group
  v_acme_group_id        uuid;

  -- Plan ids by tier
  v_plan_major           uuid;
  v_plan_select          uuid;
  v_plan_premier         uuid;
  v_plan_elite           uuid;
  v_plan_ultimate        uuid;

  -- Bulk id arrays
  v_member_ids           uuid[] := '{}';
  v_provider_ids         uuid[] := '{}';
  v_provider_names       text[] := '{}';
  v_provider_in_network  boolean[] := '{}';

  v_tmp_id               uuid;
  v_claim_id             uuid;
  v_provider_id          uuid;

  v_pwd                  text := crypt('ChangeMe123!', gen_salt('bf', 12));

  v_tier                 text;
  v_consult              numeric;
  v_procedure            numeric;
  i                      int;
BEGIN
  -- ══════════════════════════════════════════════════════════
  -- ── Phase 1: Clear existing data in FK-safe order ──
  -- ══════════════════════════════════════════════════════════
  DELETE FROM provider_network_mapping;
  DELETE FROM provider_claims;
  DELETE FROM member_claims;
  DELETE FROM coverage_decisions;
  DELETE FROM payment_details;
  DELETE FROM members;
  DELETE FROM member_groups;
  DELETE FROM health_plans;
  DELETE FROM providers;
  DELETE FROM audit_events WHERE target_type = 'CLAIM';
  DELETE FROM claim_coding;
  DELETE FROM claim_documents;
  DELETE FROM claims;

  -- ══════════════════════════════════════════════════════════
  -- ── Phase 2: System Roles (upsert by name + is_system=true) ──
  -- ══════════════════════════════════════════════════════════

  -- SUPER_ADMIN
  SELECT id INTO v_super_role_id FROM roles WHERE name = 'SUPER_ADMIN' AND is_system = true LIMIT 1;
  IF v_super_role_id IS NULL THEN
    INSERT INTO roles (id, name, permissions, is_system)
    VALUES (gen_random_uuid(), 'SUPER_ADMIN', '["*"]'::jsonb, true)
    RETURNING id INTO v_super_role_id;
  ELSE
    UPDATE roles SET permissions = '["*"]'::jsonb WHERE id = v_super_role_id;
  END IF;

  -- BPO_ADMIN
  SELECT id INTO v_bpo_admin_role_id FROM roles WHERE name = 'BPO_ADMIN' AND is_system = true LIMIT 1;
  IF v_bpo_admin_role_id IS NULL THEN
    INSERT INTO roles (id, name, permissions, is_system)
    VALUES (
      gen_random_uuid(),
      'BPO_ADMIN',
      '["users:create","users:read","users:update","users:delete","teams:create","teams:read","teams:update","teams:delete","clients:create","clients:read","clients:update","claims:read","claims:update","claims:delete","claims:reassign","claims:override","config:read","config:update","analytics:read","analytics:export","analytics:custom","audit:read","audit:compliance","connectors:manage","billing:read"]'::jsonb,
      true
    )
    RETURNING id INTO v_bpo_admin_role_id;
  ELSE
    UPDATE roles SET permissions = '["users:create","users:read","users:update","users:delete","teams:create","teams:read","teams:update","teams:delete","clients:create","clients:read","clients:update","claims:read","claims:update","claims:delete","claims:reassign","claims:override","config:read","config:update","analytics:read","analytics:export","analytics:custom","audit:read","audit:compliance","connectors:manage","billing:read"]'::jsonb WHERE id = v_bpo_admin_role_id;
  END IF;

  -- TEAM_LEAD
  SELECT id INTO v_team_lead_role_id FROM roles WHERE name = 'TEAM_LEAD' AND is_system = true LIMIT 1;
  IF v_team_lead_role_id IS NULL THEN
    INSERT INTO roles (id, name, permissions, is_system)
    VALUES (
      gen_random_uuid(),
      'TEAM_LEAD',
      '["users:read:team","users:invite:team","claims:read:team","claims:reassign:team","claims:override:team","claims:escalate","claims:quality_review:team","config:read:team","config:update:team","analytics:read:team","analytics:export:team","audit:read:team","notifications:manage:team"]'::jsonb,
      true
    )
    RETURNING id INTO v_team_lead_role_id;
  ELSE
    UPDATE roles SET permissions = '["users:read:team","users:invite:team","claims:read:team","claims:reassign:team","claims:override:team","claims:escalate","claims:quality_review:team","config:read:team","config:update:team","analytics:read:team","analytics:export:team","audit:read:team","notifications:manage:team"]'::jsonb WHERE id = v_team_lead_role_id;
  END IF;

  -- BPO_USER
  SELECT id INTO v_bpo_user_role_id FROM roles WHERE name = 'BPO_USER' AND is_system = true LIMIT 1;
  IF v_bpo_user_role_id IS NULL THEN
    INSERT INTO roles (id, name, permissions, is_system)
    VALUES (
      gen_random_uuid(),
      'BPO_USER',
      '["claims:read:assigned","claims:read:queue","claims:self_assign","claims:process","claims:review_coding","claims:add_notes","claims:reprocess","claims:escalate","correspondence:read:assigned","correspondence:draft","correspondence:send","analytics:read:own","audit:read:own"]'::jsonb,
      true
    )
    RETURNING id INTO v_bpo_user_role_id;
  ELSE
    UPDATE roles SET permissions = '["claims:read:assigned","claims:read:queue","claims:self_assign","claims:process","claims:review_coding","claims:add_notes","claims:reprocess","claims:escalate","correspondence:read:assigned","correspondence:draft","correspondence:send","analytics:read:own","audit:read:own"]'::jsonb WHERE id = v_bpo_user_role_id;
  END IF;

  -- CLIENT
  SELECT id INTO v_client_role_id FROM roles WHERE name = 'CLIENT' AND is_system = true LIMIT 1;
  IF v_client_role_id IS NULL THEN
    INSERT INTO roles (id, name, permissions, is_system)
    VALUES (
      gen_random_uuid(),
      'CLIENT',
      '["claims:read:own","claims:download:own","claims:comment:own","claims:flag:own","analytics:read:own","analytics:export:own","audit:read:own","config:update:own_preferences"]'::jsonb,
      true
    )
    RETURNING id INTO v_client_role_id;
  ELSE
    UPDATE roles SET permissions = '["claims:read:own","claims:download:own","claims:comment:own","claims:flag:own","analytics:read:own","analytics:export:own","audit:read:own","config:update:own_preferences"]'::jsonb WHERE id = v_client_role_id;
  END IF;

  -- ══════════════════════════════════════════════════════════
  -- ── Phase 3: Organisation ──
  -- ══════════════════════════════════════════════════════════

  SELECT id INTO v_org_id FROM organisations WHERE name = 'ClaimsIntell System' LIMIT 1;
  IF v_org_id IS NULL THEN
    INSERT INTO organisations (id, name, type, settings, created_at, updated_at)
    VALUES (gen_random_uuid(), 'ClaimsIntell System', 'BPO', '{}'::jsonb, now(), now())
    RETURNING id INTO v_org_id;
  END IF;

  -- ══════════════════════════════════════════════════════════
  -- ── Phase 4: Default users ──
  -- ══════════════════════════════════════════════════════════

  SELECT id INTO v_admin_user_id FROM users WHERE email = 'admin@claimsintell.com' LIMIT 1;
  IF v_admin_user_id IS NULL THEN
    INSERT INTO users (id, org_id, email, password_hash, name, role_id, status, email_verified, password_history, created_at, updated_at)
    VALUES (gen_random_uuid(), v_org_id, 'admin@claimsintell.com', v_pwd, 'System Admin', v_super_role_id, 'ACTIVE', true, ARRAY[v_pwd], now(), now())
    RETURNING id INTO v_admin_user_id;
  END IF;

  SELECT id INTO v_lead_user_id FROM users WHERE email = 'lead@claimsintell.com' LIMIT 1;
  IF v_lead_user_id IS NULL THEN
    INSERT INTO users (id, org_id, email, password_hash, name, role_id, status, email_verified, created_at, updated_at)
    VALUES (gen_random_uuid(), v_org_id, 'lead@claimsintell.com', v_pwd, 'QA Team Lead', v_team_lead_role_id, 'ACTIVE', true, now(), now())
    RETURNING id INTO v_lead_user_id;
  END IF;

  -- ══════════════════════════════════════════════════════════
  -- ── Phase 5: Clients and teams ──
  -- ══════════════════════════════════════════════════════════

  SELECT id INTO v_client1_id FROM clients WHERE name = 'Blue Harbor Health' LIMIT 1;
  IF v_client1_id IS NULL THEN
    INSERT INTO clients (id, org_id, name, contact_email, created_at, updated_at)
    VALUES (gen_random_uuid(), v_org_id, 'Blue Harbor Health', 'contact@blueharbor.com', now(), now())
    RETURNING id INTO v_client1_id;
  END IF;

  SELECT id INTO v_client2_id FROM clients WHERE name = 'Atlas Travel Protect' LIMIT 1;
  IF v_client2_id IS NULL THEN
    INSERT INTO clients (id, org_id, name, contact_email, created_at, updated_at)
    VALUES (gen_random_uuid(), v_org_id, 'Atlas Travel Protect', 'info@atlastravel.com', now(), now())
    RETURNING id INTO v_client2_id;
  END IF;

  SELECT id INTO v_team1_id FROM teams WHERE name = 'GI Claims Team' LIMIT 1;
  IF v_team1_id IS NULL THEN
    INSERT INTO teams (id, org_id, name, created_at)
    VALUES (gen_random_uuid(), v_org_id, 'GI Claims Team', now())
    RETURNING id INTO v_team1_id;
  END IF;

  SELECT id INTO v_team2_id FROM teams WHERE name = 'Travel Claims Team' LIMIT 1;
  IF v_team2_id IS NULL THEN
    INSERT INTO teams (id, org_id, name, created_at)
    VALUES (gen_random_uuid(), v_org_id, 'Travel Claims Team', now())
    RETURNING id INTO v_team2_id;
  END IF;

  -- ══════════════════════════════════════════════════════════
  -- ── Phase 6: Welcome notification + Gmail connector ──
  -- ══════════════════════════════════════════════════════════

  IF NOT EXISTS (SELECT 1 FROM notifications WHERE user_id = v_admin_user_id AND title = 'Welcome to ClaimsIntell') THEN
    INSERT INTO notifications (id, user_id, type, title, body, data, channel, created_at)
    VALUES (gen_random_uuid(), v_admin_user_id, 'SYSTEM', 'Welcome to ClaimsIntell', 'System has been seeded with test data.', '{}'::jsonb, 'in_app', now());
  END IF;

  IF NOT EXISTS (SELECT 1 FROM gmail_connectors WHERE email = 'qa.inbox@claimsintell.com') THEN
    INSERT INTO gmail_connectors (id, org_id, email, oauth_tokens, labels_config, filter_rules, status, last_sync_at, created_at, updated_at)
    VALUES (gen_random_uuid(), v_org_id, 'qa.inbox@claimsintell.com', '{"access_token":"dummy"}', '{}'::jsonb, '[]'::jsonb, 'CONNECTED', now(), now(), now());
  END IF;

  -- ══════════════════════════════════════════════════════════
  -- ── Phase 7: Bupa Global Health Plans ──
  -- ══════════════════════════════════════════════════════════

  INSERT INTO health_plans (id, name, tier, annual_maximum_usd, annual_maximum_hkd, geographic_options, network_options, deductible_options, co_insurance_option, benefits, exclusions, waiting_periods, effective_from, effective_to, created_at)
  VALUES (
    gen_random_uuid(), 'Major Medical', 'MAJOR_MEDICAL', 4500000, 35100000,
    '[{"name":"Worldwide excluding USA","code":"WORLDWIDE_EXCL_US"},{"name":"Worldwide","code":"WORLDWIDE"}]'::jsonb,
    '[{"name":"Standard","code":"STANDARD"}]'::jsonb,
    '[{"amount":4000,"currency":"USD"},{"amount":10000,"currency":"USD"}]'::jsonb,
    NULL,
    $json${"outPatientDayCare":{"covered":true,"limit":"Reasonable and customary charges","subLimit":null},"outPatientSurgical":{"covered":true,"limit":"Reasonable and customary charges","subLimit":null},"pathologyScans":{"covered":true,"limit":"As part of treatment","subLimit":null},"specialistConsultations":{"covered":true,"limit":"Referred by GP only","subLimit":null},"prescribedDrugs":{"covered":true,"limit":"As part of in-patient/day-care treatment","subLimit":null},"hospitalAccommodation":{"covered":true,"limit":"Semi-private room","subLimit":null},"operatingRoom":{"covered":true,"limit":"Reasonable and customary charges","subLimit":null},"surgery":{"covered":true,"limit":"Reasonable and customary charges","subLimit":null},"intensiveCare":{"covered":true,"limit":"Reasonable and customary charges","subLimit":null},"rehabilitation":{"covered":true,"limit":"Up to 30 days per policy year","subLimit":30},"cancerTreatment":{"covered":true,"limit":"Full cover including chemotherapy and radiotherapy","subLimit":null},"transplant":{"covered":true,"limit":"Organ transplant - recipient only","subLimit":null},"kidneyDialysis":{"covered":true,"limit":"Reasonable and customary charges","subLimit":null},"maternity":{"covered":false,"limit":"Not covered","subLimit":null},"dental":{"covered":false,"limit":"Not covered","subLimit":null},"optical":{"covered":false,"limit":"Not covered","subLimit":null},"evacuation":{"covered":true,"limit":"USD 100,000 per incident","subLimit":100000},"repatriation":{"covered":true,"limit":"USD 50,000 per incident","subLimit":50000}}$json$::jsonb,
    $json$["Pre-existing conditions (first 2 years unless declared and accepted)","Cosmetic or aesthetic treatment","Infertility treatment","Self-inflicted injuries","Experimental treatment without prior approval","War and terrorism (unless covered by rider)","Dental treatment (not covered under this plan)","Optical treatment (not covered under this plan)","Maternity and childbirth","Routine health checks"]$json$::jsonb,
    $json${"general":"0 months","maternity":"Not applicable - not covered","dental":"Not applicable - not covered","optical":"Not applicable - not covered","preExistingConditions":"24 months moratorium","cancerTreatment":"0 months"}$json$::jsonb,
    '2025-01-01'::timestamp, NULL, now()
  ) RETURNING id INTO v_plan_major;

  INSERT INTO health_plans (id, name, tier, annual_maximum_usd, annual_maximum_hkd, geographic_options, network_options, deductible_options, co_insurance_option, benefits, exclusions, waiting_periods, effective_from, effective_to, created_at)
  VALUES (
    gen_random_uuid(), 'Select', 'SELECT', 4500000, 35100000,
    '[{"name":"Worldwide excluding USA","code":"WORLDWIDE_EXCL_US"},{"name":"Worldwide","code":"WORLDWIDE"}]'::jsonb,
    '[{"name":"Standard","code":"STANDARD"},{"name":"Comprehensive","code":"COMPREHENSIVE"}]'::jsonb,
    '[{"amount":1500,"currency":"USD"},{"amount":4000,"currency":"USD"},{"amount":10000,"currency":"USD"}]'::jsonb,
    '{"rate":0.15,"description":"Optional 15% co-insurance for premium discount"}'::jsonb,
    $json${"outPatientDayCare":{"covered":true,"limit":"Reasonable and customary charges","subLimit":null},"outPatientSurgical":{"covered":true,"limit":"Reasonable and customary charges","subLimit":null},"pathologyScans":{"covered":true,"limit":"Full cover","subLimit":null},"specialistConsultations":{"covered":true,"limit":"Direct access, no referral required","subLimit":null},"prescribedDrugs":{"covered":true,"limit":"In-patient and out-patient","subLimit":null},"hospitalAccommodation":{"covered":true,"limit":"Private room","subLimit":null},"operatingRoom":{"covered":true,"limit":"Reasonable and customary charges","subLimit":null},"surgery":{"covered":true,"limit":"Reasonable and customary charges","subLimit":null},"intensiveCare":{"covered":true,"limit":"Reasonable and customary charges","subLimit":null},"rehabilitation":{"covered":true,"limit":"Up to 45 days per policy year","subLimit":45},"cancerTreatment":{"covered":true,"limit":"Full cover including chemotherapy, radiotherapy, and immunotherapy","subLimit":null},"transplant":{"covered":true,"limit":"Organ transplant - recipient only","subLimit":null},"kidneyDialysis":{"covered":true,"limit":"Reasonable and customary charges","subLimit":null},"maternity":{"covered":false,"limit":"Not covered","subLimit":null},"dental":{"covered":true,"limit":"USD 1,500 per policy year","subLimit":1500},"optical":{"covered":true,"limit":"USD 300 per policy year","subLimit":300},"evacuation":{"covered":true,"limit":"USD 250,000 per incident","subLimit":250000},"repatriation":{"covered":true,"limit":"USD 75,000 per incident","subLimit":75000}}$json$::jsonb,
    $json$["Pre-existing conditions (first 2 years unless declared and accepted)","Cosmetic or aesthetic treatment","Infertility treatment","Self-inflicted injuries","Experimental treatment without prior approval","War and terrorism (unless covered by rider)","Maternity and childbirth","Routine health checks (unless wellness rider purchased)"]$json$::jsonb,
    $json${"general":"0 months","maternity":"Not applicable - not covered","dental":"6 months","optical":"6 months","preExistingConditions":"24 months moratorium","cancerTreatment":"0 months"}$json$::jsonb,
    '2025-01-01'::timestamp, NULL, now()
  ) RETURNING id INTO v_plan_select;

  INSERT INTO health_plans (id, name, tier, annual_maximum_usd, annual_maximum_hkd, geographic_options, network_options, deductible_options, co_insurance_option, benefits, exclusions, waiting_periods, effective_from, effective_to, created_at)
  VALUES (
    gen_random_uuid(), 'Premier', 'PREMIER', 5000000, 39000000,
    '[{"name":"Worldwide excluding USA","code":"WORLDWIDE_EXCL_US"},{"name":"Worldwide","code":"WORLDWIDE"}]'::jsonb,
    '[{"name":"Standard","code":"STANDARD"},{"name":"Comprehensive","code":"COMPREHENSIVE"}]'::jsonb,
    '[{"amount":1500,"currency":"USD"},{"amount":4000,"currency":"USD"},{"amount":10000,"currency":"USD"}]'::jsonb,
    '{"rate":0.15,"description":"Optional 15% co-insurance for premium discount"}'::jsonb,
    $json${"outPatientDayCare":{"covered":true,"limit":"Full cover","subLimit":null},"outPatientSurgical":{"covered":true,"limit":"Full cover","subLimit":null},"pathologyScans":{"covered":true,"limit":"Full cover including advanced imaging (MRI, PET, CT)","subLimit":null},"specialistConsultations":{"covered":true,"limit":"Direct access, no referral required","subLimit":null},"prescribedDrugs":{"covered":true,"limit":"In-patient and out-patient, including biologics","subLimit":null},"hospitalAccommodation":{"covered":true,"limit":"Private room","subLimit":null},"operatingRoom":{"covered":true,"limit":"Full cover","subLimit":null},"surgery":{"covered":true,"limit":"Full cover including robotic surgery","subLimit":null},"intensiveCare":{"covered":true,"limit":"Full cover","subLimit":null},"rehabilitation":{"covered":true,"limit":"Up to 60 days per policy year","subLimit":60},"cancerTreatment":{"covered":true,"limit":"Full cover including experimental treatments with prior approval","subLimit":null},"transplant":{"covered":true,"limit":"Organ transplant - recipient and donor costs","subLimit":null},"kidneyDialysis":{"covered":true,"limit":"Full cover","subLimit":null},"maternity":{"covered":false,"limit":"Not covered","subLimit":null},"dental":{"covered":true,"limit":"USD 3,000 per policy year","subLimit":3000},"optical":{"covered":true,"limit":"USD 500 per policy year","subLimit":500},"evacuation":{"covered":true,"limit":"USD 500,000 per incident","subLimit":500000},"repatriation":{"covered":true,"limit":"USD 100,000 per incident","subLimit":100000}}$json$::jsonb,
    $json$["Pre-existing conditions (first 2 years unless declared and accepted)","Cosmetic or aesthetic treatment","Infertility treatment (unless rider purchased)","Self-inflicted injuries","War and terrorism (unless covered by rider)","Maternity and childbirth","Routine health checks (unless wellness rider purchased)"]$json$::jsonb,
    $json${"general":"0 months","maternity":"Not applicable - not covered","dental":"6 months","optical":"6 months","preExistingConditions":"24 months moratorium","cancerTreatment":"0 months"}$json$::jsonb,
    '2025-01-01'::timestamp, NULL, now()
  ) RETURNING id INTO v_plan_premier;

  INSERT INTO health_plans (id, name, tier, annual_maximum_usd, annual_maximum_hkd, geographic_options, network_options, deductible_options, co_insurance_option, benefits, exclusions, waiting_periods, effective_from, effective_to, created_at)
  VALUES (
    gen_random_uuid(), 'Elite', 'ELITE', 10000000, 78000000,
    '[{"name":"Worldwide excluding USA","code":"WORLDWIDE_EXCL_US"},{"name":"Worldwide","code":"WORLDWIDE"}]'::jsonb,
    '[{"name":"Standard","code":"STANDARD"},{"name":"Comprehensive","code":"COMPREHENSIVE"}]'::jsonb,
    '[{"amount":4000,"currency":"USD"},{"amount":10000,"currency":"USD"}]'::jsonb,
    NULL,
    $json${"outPatientDayCare":{"covered":true,"limit":"Full cover","subLimit":null},"outPatientSurgical":{"covered":true,"limit":"Full cover","subLimit":null},"pathologyScans":{"covered":true,"limit":"Full cover including advanced imaging","subLimit":null},"specialistConsultations":{"covered":true,"limit":"Direct access worldwide","subLimit":null},"prescribedDrugs":{"covered":true,"limit":"Full cover including biologics and gene therapy drugs","subLimit":null},"hospitalAccommodation":{"covered":true,"limit":"Private suite","subLimit":null},"operatingRoom":{"covered":true,"limit":"Full cover","subLimit":null},"surgery":{"covered":true,"limit":"Full cover including robotic and laparoscopic surgery","subLimit":null},"intensiveCare":{"covered":true,"limit":"Full cover, no day limit","subLimit":null},"rehabilitation":{"covered":true,"limit":"Up to 90 days per policy year","subLimit":90},"cancerTreatment":{"covered":true,"limit":"Full cover including experimental and targeted therapies","subLimit":null},"transplant":{"covered":true,"limit":"Full cover - recipient, donor costs, and search fees","subLimit":null},"kidneyDialysis":{"covered":true,"limit":"Full cover","subLimit":null},"maternity":{"covered":true,"limit":"USD 15,000 normal delivery, USD 20,000 complications","subLimit":20000},"dental":{"covered":true,"limit":"USD 5,000 per policy year","subLimit":5000},"optical":{"covered":true,"limit":"USD 750 per policy year","subLimit":750},"evacuation":{"covered":true,"limit":"Unlimited","subLimit":null},"repatriation":{"covered":true,"limit":"USD 250,000 per incident","subLimit":250000}}$json$::jsonb,
    $json$["Pre-existing conditions (first 2 years unless declared and accepted)","Cosmetic or aesthetic treatment","Self-inflicted injuries","War and terrorism (unless covered by rider)","Routine health checks (unless wellness rider purchased)"]$json$::jsonb,
    $json${"general":"0 months","maternity":"18 months","dental":"6 months","optical":"6 months","preExistingConditions":"24 months moratorium","cancerTreatment":"0 months"}$json$::jsonb,
    '2025-01-01'::timestamp, NULL, now()
  ) RETURNING id INTO v_plan_elite;

  INSERT INTO health_plans (id, name, tier, annual_maximum_usd, annual_maximum_hkd, geographic_options, network_options, deductible_options, co_insurance_option, benefits, exclusions, waiting_periods, effective_from, effective_to, created_at)
  VALUES (
    gen_random_uuid(), 'Ultimate', 'ULTIMATE', NULL, NULL,
    '[{"name":"Worldwide","code":"WORLDWIDE"}]'::jsonb,
    '[{"name":"Comprehensive","code":"COMPREHENSIVE"}]'::jsonb,
    '[]'::jsonb,
    NULL,
    $json${"outPatientDayCare":{"covered":true,"limit":"Full cover","subLimit":null},"outPatientSurgical":{"covered":true,"limit":"Full cover","subLimit":null},"pathologyScans":{"covered":true,"limit":"Full cover","subLimit":null},"specialistConsultations":{"covered":true,"limit":"Full cover, direct access worldwide","subLimit":null},"prescribedDrugs":{"covered":true,"limit":"Full cover","subLimit":null},"hospitalAccommodation":{"covered":true,"limit":"Private suite or deluxe room","subLimit":null},"operatingRoom":{"covered":true,"limit":"Full cover","subLimit":null},"surgery":{"covered":true,"limit":"Full cover","subLimit":null},"intensiveCare":{"covered":true,"limit":"Full cover, no day limit","subLimit":null},"rehabilitation":{"covered":true,"limit":"Up to 120 days per policy year","subLimit":120},"cancerTreatment":{"covered":true,"limit":"Full cover including all experimental and cutting-edge treatments","subLimit":null},"transplant":{"covered":true,"limit":"Full cover - all associated costs including international search","subLimit":null},"kidneyDialysis":{"covered":true,"limit":"Full cover","subLimit":null},"maternity":{"covered":true,"limit":"USD 25,000 normal delivery, USD 40,000 complications, newborn cover 90 days","subLimit":40000},"dental":{"covered":true,"limit":"USD 10,000 per policy year including orthodontics","subLimit":10000},"optical":{"covered":true,"limit":"USD 1,000 per policy year including laser surgery","subLimit":1000},"evacuation":{"covered":true,"limit":"Unlimited","subLimit":null},"repatriation":{"covered":true,"limit":"Unlimited","subLimit":null}}$json$::jsonb,
    $json$["Cosmetic or aesthetic treatment (unless reconstructive after accident)","Self-inflicted injuries","War and terrorism (unless covered by rider)"]$json$::jsonb,
    $json${"general":"0 months","maternity":"18 months","dental":"6 months","optical":"6 months","preExistingConditions":"12 months moratorium","cancerTreatment":"0 months"}$json$::jsonb,
    '2025-01-01'::timestamp, NULL, now()
  ) RETURNING id INTO v_plan_ultimate;

  -- ══════════════════════════════════════════════════════════
  -- ── Phase 8: Member Group ──
  -- ══════════════════════════════════════════════════════════

  INSERT INTO member_groups (id, group_name, company_name, contact_email, created_at)
  VALUES (gen_random_uuid(), 'Acme Corporation Group Plan', 'Acme Corporation', 'hr@acmecorp.com', now())
  RETURNING id INTO v_acme_group_id;

  -- ══════════════════════════════════════════════════════════
  -- ── Phase 9: Members (indices 0-15) ──
  -- ACME_MEMBER_INDICES = [0, 4, 5]
  -- ══════════════════════════════════════════════════════════

  -- Index 0: Johnny Depp (PREMIER, HK) - Acme
  INSERT INTO members (id, membership_number, group_id, title, first_name, last_name, date_of_birth, email, phone, address, preferred_language, plan_id, plan_tier, policy_start_date, policy_end_date, deductible_amount, deductible_currency, deductible_used, co_insurance_rate, network_option, geographic_cover, pre_existing_conditions, status, renewal_date, created_at, updated_at)
  VALUES (gen_random_uuid(), 'BI-6000-9000-9009', v_acme_group_id, 'Mr', 'Johnny', 'Depp', '1963-06-09', 'johnny.depp@example.com', '+852-9123-4567',
    '{"line1":"15 Peak Road","line2":"The Peak","city":"Hong Kong","state":"","postalCode":"","country":"HK"}'::jsonb,
    'en', v_plan_premier, 'PREMIER', '2024-01-01', '2026-12-31', 1500, 'USD', 0, NULL, 'COMPREHENSIVE', 'WORLDWIDE', '[]'::jsonb, 'ACTIVE', '2026-03-01', now(), now())
  RETURNING id INTO v_tmp_id;
  v_member_ids := v_member_ids || v_tmp_id;

  -- Index 1: Maria Chen (ULTIMATE, CN)
  INSERT INTO members (id, membership_number, group_id, title, first_name, last_name, date_of_birth, email, phone, address, preferred_language, plan_id, plan_tier, policy_start_date, policy_end_date, deductible_amount, deductible_currency, deductible_used, co_insurance_rate, network_option, geographic_cover, pre_existing_conditions, status, renewal_date, created_at, updated_at)
  VALUES (gen_random_uuid(), 'BI-6001-1234-5678', NULL, 'Ms', 'Maria', 'Chen', '1985-03-15', 'rahul@quickscribe.co', '+86-138-0013-8000',
    '{"line1":"88 Century Avenue","line2":"Pudong New District","city":"Shanghai","state":"Shanghai","postalCode":"200120","country":"CN"}'::jsonb,
    'zh', v_plan_ultimate, 'ULTIMATE', '2025-01-01', '2025-12-31', NULL, NULL, 0, NULL, 'COMPREHENSIVE', 'WORLDWIDE', '[]'::jsonb, 'ACTIVE', '2025-12-01', now(), now())
  RETURNING id INTO v_tmp_id;
  v_member_ids := v_member_ids || v_tmp_id;

  -- Index 2: Ahmed Al-Rashid (ELITE, AE)
  INSERT INTO members (id, membership_number, group_id, title, first_name, last_name, date_of_birth, email, phone, address, preferred_language, plan_id, plan_tier, policy_start_date, policy_end_date, deductible_amount, deductible_currency, deductible_used, co_insurance_rate, network_option, geographic_cover, pre_existing_conditions, status, renewal_date, created_at, updated_at)
  VALUES (gen_random_uuid(), 'BI-6002-2345-6789', NULL, 'Mr', 'Ahmed', 'Al-Rashid', '1978-11-22', 'ahmed.alrashid@example.com', '+971-50-123-4567',
    '{"line1":"Villa 42, Al Wasl Road","line2":"Jumeirah 2","city":"Dubai","state":"Dubai","postalCode":"00000","country":"AE"}'::jsonb,
    'ar', v_plan_elite, 'ELITE', '2025-06-01', '2026-05-31', 4000, 'USD', 1200, NULL, 'COMPREHENSIVE', 'WORLDWIDE',
    '["Hypertension - declared and accepted"]'::jsonb, 'ACTIVE', '2026-05-01', now(), now())
  RETURNING id INTO v_tmp_id;
  v_member_ids := v_member_ids || v_tmp_id;

  -- Index 3: Yuki Tanaka (SELECT, JP)
  INSERT INTO members (id, membership_number, group_id, title, first_name, last_name, date_of_birth, email, phone, address, preferred_language, plan_id, plan_tier, policy_start_date, policy_end_date, deductible_amount, deductible_currency, deductible_used, co_insurance_rate, network_option, geographic_cover, pre_existing_conditions, status, renewal_date, created_at, updated_at)
  VALUES (gen_random_uuid(), 'BI-6003-3456-7890', NULL, 'Ms', 'Yuki', 'Tanaka', '1990-07-08', 'yuki.tanaka@example.com', '+81-90-1234-5678',
    '{"line1":"3-1-2 Roppongi","line2":"Minato-ku","city":"Tokyo","state":"Tokyo","postalCode":"106-0032","country":"JP"}'::jsonb,
    'ja', v_plan_select, 'SELECT', '2025-03-01', '2026-02-28', 1500, 'USD', 500, 0.15, 'STANDARD', 'WORLDWIDE_EXCL_US', '[]'::jsonb, 'ACTIVE', '2026-02-01', now(), now())
  RETURNING id INTO v_tmp_id;
  v_member_ids := v_member_ids || v_tmp_id;

  -- Index 4: Sophie Laurent (MAJOR_MEDICAL, FR) - Acme
  INSERT INTO members (id, membership_number, group_id, title, first_name, last_name, date_of_birth, email, phone, address, preferred_language, plan_id, plan_tier, policy_start_date, policy_end_date, deductible_amount, deductible_currency, deductible_used, co_insurance_rate, network_option, geographic_cover, pre_existing_conditions, status, renewal_date, created_at, updated_at)
  VALUES (gen_random_uuid(), 'BI-6004-4567-8901', v_acme_group_id, 'Mrs', 'Sophie', 'Laurent', '1975-12-03', 'rahul@quickscribe.co', '+33-6-12-34-56-78',
    '{"line1":"25 Avenue Montaigne","line2":"","city":"Paris","state":"Ile-de-France","postalCode":"75008","country":"FR"}'::jsonb,
    'fr', v_plan_major, 'MAJOR_MEDICAL', '2025-07-01', '2026-06-30', 4000, 'USD', 0, NULL, 'STANDARD', 'WORLDWIDE_EXCL_US', '[]'::jsonb, 'ACTIVE', '2026-06-01', now(), now())
  RETURNING id INTO v_tmp_id;
  v_member_ids := v_member_ids || v_tmp_id;

  -- Index 5: Raj Patel (PREMIER, IN) - Acme
  INSERT INTO members (id, membership_number, group_id, title, first_name, last_name, date_of_birth, email, phone, address, preferred_language, plan_id, plan_tier, policy_start_date, policy_end_date, deductible_amount, deductible_currency, deductible_used, co_insurance_rate, network_option, geographic_cover, pre_existing_conditions, status, renewal_date, created_at, updated_at)
  VALUES (gen_random_uuid(), 'BI-6005-5678-9012', v_acme_group_id, 'Mr', 'Raj', 'Patel', '1982-04-18', 'raj.patel@example.com', '+91-98765-43210',
    '{"line1":"12 Marine Drive","line2":"Nariman Point","city":"Mumbai","state":"Maharashtra","postalCode":"400021","country":"IN"}'::jsonb,
    'hi', v_plan_premier, 'PREMIER', '2025-02-01', '2026-01-31', 1500, 'USD', 0, NULL, 'STANDARD', 'WORLDWIDE_EXCL_US',
    '["Type 2 Diabetes - declared and accepted"]'::jsonb, 'ACTIVE', '2026-01-01', now(), now())
  RETURNING id INTO v_tmp_id;
  v_member_ids := v_member_ids || v_tmp_id;

  -- Index 6: Hans Mueller (ELITE, DE)
  INSERT INTO members (id, membership_number, group_id, title, first_name, last_name, date_of_birth, email, phone, address, preferred_language, plan_id, plan_tier, policy_start_date, policy_end_date, deductible_amount, deductible_currency, deductible_used, co_insurance_rate, network_option, geographic_cover, pre_existing_conditions, status, renewal_date, created_at, updated_at)
  VALUES (gen_random_uuid(), 'BI-6006-6789-0123', NULL, 'Mr', 'Hans', 'Mueller', '1972-08-14', 'hans.mueller@example.com', '+49-170-1234567',
    '{"line1":"Kurfurstendamm 195","line2":"","city":"Berlin","state":"Berlin","postalCode":"10707","country":"DE"}'::jsonb,
    'de', v_plan_elite, 'ELITE', '2025-05-01', '2026-04-30', 4000, 'USD', 0, NULL, 'COMPREHENSIVE', 'WORLDWIDE', '[]'::jsonb, 'ACTIVE', '2026-04-01', now(), now())
  RETURNING id INTO v_tmp_id;
  v_member_ids := v_member_ids || v_tmp_id;

  -- Index 7: Suki Watanabe (SELECT, JP)
  INSERT INTO members (id, membership_number, group_id, title, first_name, last_name, date_of_birth, email, phone, address, preferred_language, plan_id, plan_tier, policy_start_date, policy_end_date, deductible_amount, deductible_currency, deductible_used, co_insurance_rate, network_option, geographic_cover, pre_existing_conditions, status, renewal_date, created_at, updated_at)
  VALUES (gen_random_uuid(), 'BI-6007-7890-1234', NULL, 'Ms', 'Suki', 'Watanabe', '1992-03-22', 'suki.watanabe@example.com', '+81-80-9876-5432',
    '{"line1":"2-4-8 Shibuya","line2":"Shibuya-ku","city":"Tokyo","state":"Tokyo","postalCode":"150-0002","country":"JP"}'::jsonb,
    'ja', v_plan_select, 'SELECT', '2025-08-01', '2026-07-31', 1500, 'USD', 0, 0.15, 'STANDARD', 'WORLDWIDE_EXCL_US', '[]'::jsonb, 'ACTIVE', '2026-07-01', now(), now())
  RETURNING id INTO v_tmp_id;
  v_member_ids := v_member_ids || v_tmp_id;

  -- Index 8: Li Wei (ULTIMATE, CN)
  INSERT INTO members (id, membership_number, group_id, title, first_name, last_name, date_of_birth, email, phone, address, preferred_language, plan_id, plan_tier, policy_start_date, policy_end_date, deductible_amount, deductible_currency, deductible_used, co_insurance_rate, network_option, geographic_cover, pre_existing_conditions, status, renewal_date, created_at, updated_at)
  VALUES (gen_random_uuid(), 'BI-6008-8901-2345', NULL, 'Mr', 'Li', 'Wei', '1968-05-30', 'li.wei@example.com', '+86-139-0013-9000',
    '{"line1":"1 Jianguomenwai Dajie","line2":"Chaoyang District","city":"Beijing","state":"Beijing","postalCode":"100004","country":"CN"}'::jsonb,
    'zh', v_plan_ultimate, 'ULTIMATE', '2025-01-01', '2025-12-31', NULL, NULL, 0, NULL, 'COMPREHENSIVE', 'WORLDWIDE', '[]'::jsonb, 'ACTIVE', '2025-12-01', now(), now())
  RETURNING id INTO v_tmp_id;
  v_member_ids := v_member_ids || v_tmp_id;

  -- Index 9: Carlos Silva (MAJOR_MEDICAL, BR)
  INSERT INTO members (id, membership_number, group_id, title, first_name, last_name, date_of_birth, email, phone, address, preferred_language, plan_id, plan_tier, policy_start_date, policy_end_date, deductible_amount, deductible_currency, deductible_used, co_insurance_rate, network_option, geographic_cover, pre_existing_conditions, status, renewal_date, created_at, updated_at)
  VALUES (gen_random_uuid(), 'BI-6009-9012-3456', NULL, 'Mr', 'Carlos', 'Silva', '1980-06-25', 'carlos.silva@example.com', '+55-11-98765-4321',
    '{"line1":"Rua Oscar Freire 379","line2":"Jardins","city":"Sao Paulo","state":"SP","postalCode":"01426-001","country":"BR"}'::jsonb,
    'pt', v_plan_major, 'MAJOR_MEDICAL', '2025-01-15', '2026-01-14', 4000, 'USD', 0, NULL, 'STANDARD', 'WORLDWIDE_EXCL_US', '[]'::jsonb, 'ACTIVE', '2026-01-01', now(), now())
  RETURNING id INTO v_tmp_id;
  v_member_ids := v_member_ids || v_tmp_id;

  -- Index 10: Wei Chen (PREMIER, HK)
  INSERT INTO members (id, membership_number, group_id, title, first_name, last_name, date_of_birth, email, phone, address, preferred_language, plan_id, plan_tier, policy_start_date, policy_end_date, deductible_amount, deductible_currency, deductible_used, co_insurance_rate, network_option, geographic_cover, pre_existing_conditions, status, renewal_date, created_at, updated_at)
  VALUES (gen_random_uuid(), 'BG-2025-HK-00123', NULL, 'Mr', 'Wei', 'Chen', '1985-03-15', 'wei.chen@example.com', '+852-9123-4567',
    '{"line1":"88 Queensway","line2":"Admiralty","city":"Hong Kong","state":"","postalCode":"999077","country":"HK"}'::jsonb,
    'en', v_plan_premier, 'PREMIER', '2025-01-01', '2025-12-31', 1500, 'USD', 0, NULL, 'COMPREHENSIVE', 'WORLDWIDE', '[]'::jsonb, 'ACTIVE', '2025-12-01', now(), now())
  RETURNING id INTO v_tmp_id;
  v_member_ids := v_member_ids || v_tmp_id;

  -- Index 11: John Smith (ELITE, US)
  INSERT INTO members (id, membership_number, group_id, title, first_name, last_name, date_of_birth, email, phone, address, preferred_language, plan_id, plan_tier, policy_start_date, policy_end_date, deductible_amount, deductible_currency, deductible_used, co_insurance_rate, network_option, geographic_cover, pre_existing_conditions, status, renewal_date, created_at, updated_at)
  VALUES (gen_random_uuid(), 'BG-2025-US-00999', NULL, 'Mr', 'John', 'Smith', '1990-01-15', 'john.smith@example.com', '+1-555-123-4567',
    '{"line1":"123 Main Street","line2":"","city":"New York","state":"NY","postalCode":"10001","country":"US"}'::jsonb,
    'en', v_plan_elite, 'ELITE', '2025-01-01', '2025-12-31', 4000, 'USD', 0, NULL, 'COMPREHENSIVE', 'WORLDWIDE', '[]'::jsonb, 'ACTIVE', '2025-12-01', now(), now())
  RETURNING id INTO v_tmp_id;
  v_member_ids := v_member_ids || v_tmp_id;

  -- Index 12: Jane Doe (SELECT, GB)
  INSERT INTO members (id, membership_number, group_id, title, first_name, last_name, date_of_birth, email, phone, address, preferred_language, plan_id, plan_tier, policy_start_date, policy_end_date, deductible_amount, deductible_currency, deductible_used, co_insurance_rate, network_option, geographic_cover, pre_existing_conditions, status, renewal_date, created_at, updated_at)
  VALUES (gen_random_uuid(), 'BG-2025-UK-00888', NULL, 'Ms', 'Jane', 'Doe', '1985-03-20', 'jane.doe@example.com', '+44-20-1234-5678',
    '{"line1":"10 Downing Street","line2":"","city":"London","state":"","postalCode":"SW1A 2AA","country":"GB"}'::jsonb,
    'en', v_plan_select, 'SELECT', '2025-01-01', '2025-12-31', 1500, 'USD', 0, 0.15, 'STANDARD', 'WORLDWIDE_EXCL_US', '[]'::jsonb, 'ACTIVE', '2025-12-01', now(), now())
  RETURNING id INTO v_tmp_id;
  v_member_ids := v_member_ids || v_tmp_id;

  -- Index 13: Jason Momoa (SELECT, HK) — BI-TWC2-3071-0340
  INSERT INTO members (id, membership_number, group_id, title, first_name, last_name, date_of_birth, email, phone, address, preferred_language, plan_id, plan_tier, policy_start_date, policy_end_date, deductible_amount, deductible_currency, deductible_used, co_insurance_rate, network_option, geographic_cover, pre_existing_conditions, status, renewal_date, created_at, updated_at)
  VALUES (gen_random_uuid(), 'BI-TWC2-3071-0340', NULL, 'Mr', 'Jason', 'Momoa', '1979-08-01', 'jason.momoa@example.com', '+852-9876-5432',
    '{"line1":"68 Chung On Street","line2":"Tsuen Wan","city":"Hong Kong","state":"New Territories","postalCode":"","country":"HK"}'::jsonb,
    'en', v_plan_select, 'SELECT', '2023-01-01', '2025-12-31', 1500, 'USD', 0, 0.15, 'STANDARD', 'WORLDWIDE', '[]'::jsonb, 'ACTIVE', '2025-12-01', now(), now())
  RETURNING id INTO v_tmp_id;
  v_member_ids := v_member_ids || v_tmp_id;

  -- Index 14: Jason Momoa (SELECT, HK) — TWC-23-071034 raw
  INSERT INTO members (id, membership_number, group_id, title, first_name, last_name, date_of_birth, email, phone, address, preferred_language, plan_id, plan_tier, policy_start_date, policy_end_date, deductible_amount, deductible_currency, deductible_used, co_insurance_rate, network_option, geographic_cover, pre_existing_conditions, status, renewal_date, created_at, updated_at)
  VALUES (gen_random_uuid(), 'TWC-23-071034', NULL, 'Mr', 'Jason', 'Momoa', '1979-08-01', 'rahul@quickscribe.co', '+852-9876-5432',
    '{"line1":"68 Chung On Street","line2":"Tsuen Wan","city":"Hong Kong","state":"New Territories","postalCode":"","country":"HK"}'::jsonb,
    'en', v_plan_select, 'SELECT', '2023-01-01', '2025-12-31', 1500, 'USD', 0, 0.15, 'STANDARD', 'WORLDWIDE', '[]'::jsonb, 'ACTIVE', '2025-12-01', now(), now())
  RETURNING id INTO v_tmp_id;
  v_member_ids := v_member_ids || v_tmp_id;

  -- Index 15: Johnny Depp (PREMIER, HK) — 6000-9000-9009 raw
  INSERT INTO members (id, membership_number, group_id, title, first_name, last_name, date_of_birth, email, phone, address, preferred_language, plan_id, plan_tier, policy_start_date, policy_end_date, deductible_amount, deductible_currency, deductible_used, co_insurance_rate, network_option, geographic_cover, pre_existing_conditions, status, renewal_date, created_at, updated_at)
  VALUES (gen_random_uuid(), '6000-9000-9009', NULL, 'Mr', 'Johnny', 'Depp', '1963-06-09', 'johnny.depp@example.com', '+852-9123-4567',
    '{"line1":"15 Peak Road","line2":"The Peak","city":"Hong Kong","state":"","postalCode":"","country":"HK"}'::jsonb,
    'en', v_plan_premier, 'PREMIER', '2024-01-01', '2026-12-31', 1500, 'USD', 0, NULL, 'COMPREHENSIVE', 'WORLDWIDE', '[]'::jsonb, 'ACTIVE', '2026-12-01', now(), now())
  RETURNING id INTO v_tmp_id;
  v_member_ids := v_member_ids || v_tmp_id;

  -- ══════════════════════════════════════════════════════════
  -- ── Phase 10: Payment Details (11 rows) ──
  -- ══════════════════════════════════════════════════════════

  -- 1: Johnny Depp
  INSERT INTO payment_details (id, member_id, payee_type, method, bank_name, swift_code, account_number, sort_code, iban, account_holder_name, account_currency, cheque_currency, is_default, created_at)
  VALUES (gen_random_uuid(), v_member_ids[1], 'MEMBER', 'BANK_TRANSFER', 'HSBC Hong Kong', 'HSBCHKHHHKH', '400-123456-838', NULL, NULL, 'Johnny Depp', 'HKD', NULL, true, now());

  -- 2: Maria Chen
  INSERT INTO payment_details (id, member_id, payee_type, method, bank_name, swift_code, account_number, sort_code, iban, account_holder_name, account_currency, cheque_currency, is_default, created_at)
  VALUES (gen_random_uuid(), v_member_ids[2], 'MEMBER', 'BANK_TRANSFER', 'Bank of China Shanghai', 'BKCHCNBJ300', '6217-0000-1234-5678', NULL, NULL, 'Maria Chen', 'CNY', NULL, true, now());

  -- 3: Ahmed Al-Rashid
  INSERT INTO payment_details (id, member_id, payee_type, method, bank_name, swift_code, account_number, sort_code, iban, account_holder_name, account_currency, cheque_currency, is_default, created_at)
  VALUES (gen_random_uuid(), v_member_ids[3], 'MEMBER', 'BANK_TRANSFER', 'Emirates NBD', 'EABORUMRXXX', '1012345678901', NULL, 'AE070331234567890123456', 'Ahmed Al-Rashid', 'AED', NULL, true, now());

  -- 6: Raj Patel
  INSERT INTO payment_details (id, member_id, payee_type, method, bank_name, swift_code, account_number, sort_code, iban, account_holder_name, account_currency, cheque_currency, is_default, created_at)
  VALUES (gen_random_uuid(), v_member_ids[6], 'MEMBER', 'BANK_TRANSFER', 'HDFC Bank Mumbai', 'HDFCINBBXXX', '00011234567890', NULL, NULL, 'Raj Patel', 'INR', NULL, true, now());

  -- 9: Li Wei
  INSERT INTO payment_details (id, member_id, payee_type, method, bank_name, swift_code, account_number, sort_code, iban, account_holder_name, account_currency, cheque_currency, is_default, created_at)
  VALUES (gen_random_uuid(), v_member_ids[9], 'MEMBER', 'BANK_TRANSFER', 'Industrial and Commercial Bank of China', 'ICBKCNBJBJM', '6222-0200-0012-3456-789', NULL, NULL, 'Li Wei', 'CNY', NULL, true, now());

  -- 4: Yuki Tanaka
  INSERT INTO payment_details (id, member_id, payee_type, method, bank_name, swift_code, account_number, sort_code, iban, account_holder_name, account_currency, cheque_currency, is_default, created_at)
  VALUES (gen_random_uuid(), v_member_ids[4], 'MEMBER', 'BANK_TRANSFER', 'Mizuho Bank Tokyo', 'MHCBJPJT', '1234567', NULL, NULL, 'Yuki Tanaka', 'JPY', NULL, true, now());

  -- 5: Sophie Laurent
  INSERT INTO payment_details (id, member_id, payee_type, method, bank_name, swift_code, account_number, sort_code, iban, account_holder_name, account_currency, cheque_currency, is_default, created_at)
  VALUES (gen_random_uuid(), v_member_ids[5], 'MEMBER', 'BANK_TRANSFER', 'BNP Paribas Paris', 'BNPAFRPP', '30004-01234-0000012345Z-67', NULL, 'FR7630004012340000012345Z67', 'Sophie Laurent', 'EUR', NULL, true, now());

  -- 7: Hans Mueller
  INSERT INTO payment_details (id, member_id, payee_type, method, bank_name, swift_code, account_number, sort_code, iban, account_holder_name, account_currency, cheque_currency, is_default, created_at)
  VALUES (gen_random_uuid(), v_member_ids[7], 'MEMBER', 'BANK_TRANSFER', 'Deutsche Bank Berlin', 'DEUTDEFF', '0012345678', NULL, 'DE89370400440532013000', 'Hans Mueller', 'EUR', NULL, true, now());

  -- 8: Suki Watanabe
  INSERT INTO payment_details (id, member_id, payee_type, method, bank_name, swift_code, account_number, sort_code, iban, account_holder_name, account_currency, cheque_currency, is_default, created_at)
  VALUES (gen_random_uuid(), v_member_ids[8], 'MEMBER', 'BANK_TRANSFER', 'Sumitomo Mitsui Banking', 'SMBCJPJT', '7654321', NULL, NULL, 'Suki Watanabe', 'JPY', NULL, true, now());

  -- 10: Carlos Silva
  INSERT INTO payment_details (id, member_id, payee_type, method, bank_name, swift_code, account_number, sort_code, iban, account_holder_name, account_currency, cheque_currency, is_default, created_at)
  VALUES (gen_random_uuid(), v_member_ids[10], 'MEMBER', 'BANK_TRANSFER', 'Banco do Brasil', 'BRASBRRJSPO', '12345-6', NULL, NULL, 'Carlos Silva', 'BRL', NULL, true, now());

  -- 14: Jason Momoa
  INSERT INTO payment_details (id, member_id, payee_type, method, bank_name, swift_code, account_number, sort_code, iban, account_holder_name, account_currency, cheque_currency, is_default, created_at)
  VALUES (gen_random_uuid(), v_member_ids[14], 'MEMBER', 'BANK_TRANSFER', 'HSBC Hong Kong', 'HSBCHKHHHKH', '400-987654-838', NULL, NULL, 'Jason Momoa', 'HKD', NULL, true, now());

  -- ══════════════════════════════════════════════════════════
  -- ── Phase 11: Providers (16 rows) ──
  -- ══════════════════════════════════════════════════════════

  -- 0: Hong Kong Sanatorium & Hospital (IN_NETWORK)
  INSERT INTO providers (id, provider_name, facility_name, provider_type, specialty, license_number, address, email, phone, network_status, network_type, bupa_provider_id, accreditation_status, country, default_currency, last_verified_at, created_at, updated_at)
  VALUES (gen_random_uuid(), 'Hong Kong Sanatorium & Hospital', 'Hong Kong Sanatorium & Hospital', 'HOSPITAL',
    '["General Surgery","Internal Medicine","Orthopaedics","Cardiology","Gastroenterology","Oncology"]'::jsonb, 'HK-HOSP-002345',
    '{"line1":"2 Village Road","line2":"Happy Valley","city":"Hong Kong","state":"","postalCode":"999078","country":"HK"}'::jsonb,
    'enquiry@hksh.com', '+852-2572-0211', 'IN_NETWORK', 'COMPREHENSIVE', 'BUPA-HK-0003', 'ACCREDITED', 'HK', 'HKD', '2025-08-10', now(), now())
  RETURNING id INTO v_tmp_id;
  v_provider_ids := v_provider_ids || v_tmp_id;
  v_provider_names := v_provider_names || 'Hong Kong Sanatorium & Hospital';
  v_provider_in_network := v_provider_in_network || true;

  -- 1: Shanghai First People's Hospital (IN_NETWORK)
  INSERT INTO providers (id, provider_name, facility_name, provider_type, specialty, license_number, address, email, phone, network_status, network_type, bupa_provider_id, accreditation_status, country, default_currency, last_verified_at, created_at, updated_at)
  VALUES (gen_random_uuid(), 'Shanghai First People''s Hospital', 'Shanghai First People''s Hospital', 'HOSPITAL',
    '["General Medicine","Internal Medicine","Cardiology","Endocrinology","Gastroenterology"]'::jsonb, 'CN-HOSP-SH-00100',
    '{"line1":"100 Haining Road","line2":"Hongkou District","city":"Shanghai","state":"Shanghai","postalCode":"200080","country":"CN"}'::jsonb,
    'international@shfph.com', '+86-21-6324-0090', 'IN_NETWORK', 'COMPREHENSIVE', 'BUPA-CN-0001', 'ACCREDITED', 'CN', 'CNY', '2025-07-20', now(), now())
  RETURNING id INTO v_tmp_id;
  v_provider_ids := v_provider_ids || v_tmp_id;
  v_provider_names := v_provider_names || 'Shanghai First People''s Hospital';
  v_provider_in_network := v_provider_in_network || true;

  -- 2: St. Teresa's Hospital (IN_NETWORK)
  INSERT INTO providers (id, provider_name, facility_name, provider_type, specialty, license_number, address, email, phone, network_status, network_type, bupa_provider_id, accreditation_status, country, default_currency, last_verified_at, created_at, updated_at)
  VALUES (gen_random_uuid(), 'St. Teresa''s Hospital', 'St. Teresa''s Hospital', 'HOSPITAL',
    '["General Surgery","Internal Medicine","Orthopaedics","Cardiology","Oncology"]'::jsonb, 'HK-HOSP-001234',
    '{"line1":"327 Prince Edward Road West","line2":"Kowloon","city":"Hong Kong","state":"","postalCode":"","country":"HK"}'::jsonb,
    'admin@stteresa.org.hk', '+852-2200-3434', 'IN_NETWORK', 'COMPREHENSIVE', 'BUPA-HK-0001', 'ACCREDITED', 'HK', 'HKD', '2025-06-15', now(), now())
  RETURNING id INTO v_tmp_id;
  v_provider_ids := v_provider_ids || v_tmp_id;
  v_provider_names := v_provider_names || 'St. Teresa''s Hospital';
  v_provider_in_network := v_provider_in_network || true;

  -- 3: Queen Mary Hospital (IN_NETWORK)
  INSERT INTO providers (id, provider_name, facility_name, provider_type, specialty, license_number, address, email, phone, network_status, network_type, bupa_provider_id, accreditation_status, country, default_currency, last_verified_at, created_at, updated_at)
  VALUES (gen_random_uuid(), 'Queen Mary Hospital', 'Queen Mary Hospital', 'HOSPITAL',
    '["General Medicine","Cardiothoracic Surgery","Neurosurgery","Paediatrics","Obstetrics"]'::jsonb, 'HK-HOSP-000102',
    '{"line1":"102 Pokfulam Road","line2":"Pok Fu Lam","city":"Hong Kong","state":"","postalCode":"","country":"HK"}'::jsonb,
    'enquiry@ha.org.hk', '+852-2255-3838', 'IN_NETWORK', 'COMPREHENSIVE', 'BUPA-HK-0002', 'ACCREDITED', 'HK', 'HKD', '2025-05-20', now(), now())
  RETURNING id INTO v_tmp_id;
  v_provider_ids := v_provider_ids || v_tmp_id;
  v_provider_names := v_provider_names || 'Queen Mary Hospital';
  v_provider_in_network := v_provider_in_network || true;

  -- 4: Bumrungrad International Hospital (IN_NETWORK)
  INSERT INTO providers (id, provider_name, facility_name, provider_type, specialty, license_number, address, email, phone, network_status, network_type, bupa_provider_id, accreditation_status, country, default_currency, last_verified_at, created_at, updated_at)
  VALUES (gen_random_uuid(), 'Bumrungrad International Hospital', 'Bumrungrad International Hospital', 'HOSPITAL',
    '["General Surgery","Cardiology","Oncology","Orthopaedics","Gastroenterology","Dermatology"]'::jsonb, 'TH-HOSP-BKK-0033',
    '{"line1":"33 Sukhumvit Soi 3","line2":"Wattana","city":"Bangkok","state":"Bangkok","postalCode":"10110","country":"TH"}'::jsonb,
    'info@bumrungrad.com', '+66-2-066-8888', 'IN_NETWORK', 'COMPREHENSIVE', 'BUPA-TH-0001', 'ACCREDITED', 'TH', 'THB', '2025-07-01', now(), now())
  RETURNING id INTO v_tmp_id;
  v_provider_ids := v_provider_ids || v_tmp_id;
  v_provider_names := v_provider_names || 'Bumrungrad International Hospital';
  v_provider_in_network := v_provider_in_network || true;

  -- 5: Mount Elizabeth Hospital (IN_NETWORK)
  INSERT INTO providers (id, provider_name, facility_name, provider_type, specialty, license_number, address, email, phone, network_status, network_type, bupa_provider_id, accreditation_status, country, default_currency, last_verified_at, created_at, updated_at)
  VALUES (gen_random_uuid(), 'Mount Elizabeth Hospital', 'Mount Elizabeth Hospital', 'HOSPITAL',
    '["General Surgery","Cardiology","Neurology","Oncology","Urology","ENT"]'::jsonb, 'SG-HOSP-MEH-001',
    '{"line1":"3 Mount Elizabeth","line2":"","city":"Singapore","state":"","postalCode":"228510","country":"SG"}'::jsonb,
    'enquiry@mountelizabeth.com.sg', '+65-6250-0000', 'IN_NETWORK', 'COMPREHENSIVE', 'BUPA-SG-0001', 'ACCREDITED', 'SG', 'SGD', '2025-04-10', now(), now())
  RETURNING id INTO v_tmp_id;
  v_provider_ids := v_provider_ids || v_tmp_id;
  v_provider_names := v_provider_names || 'Mount Elizabeth Hospital';
  v_provider_in_network := v_provider_in_network || true;

  -- 6: Harley Street Clinic (IN_NETWORK)
  INSERT INTO providers (id, provider_name, facility_name, provider_type, specialty, license_number, address, email, phone, network_status, network_type, bupa_provider_id, accreditation_status, country, default_currency, last_verified_at, created_at, updated_at)
  VALUES (gen_random_uuid(), 'Harley Street Clinic', 'The Harley Street Clinic', 'CLINIC',
    '["Cardiology","Oncology","Orthopaedics","Neurology","Diagnostics"]'::jsonb, 'GB-CQC-1-101448082',
    '{"line1":"35 Weymouth Street","line2":"","city":"London","state":"England","postalCode":"W1G 8BJ","country":"GB"}'::jsonb,
    'appointments@theharleystreetclinic.com', '+44-20-7935-7700', 'IN_NETWORK', 'COMPREHENSIVE', 'BUPA-GB-0001', 'ACCREDITED', 'GB', 'GBP', '2025-08-01', now(), now())
  RETURNING id INTO v_tmp_id;
  v_provider_ids := v_provider_ids || v_tmp_id;
  v_provider_names := v_provider_names || 'Harley Street Clinic';
  v_provider_in_network := v_provider_in_network || true;

  -- 7: Tokyo Medical University Hospital (IN_NETWORK)
  INSERT INTO providers (id, provider_name, facility_name, provider_type, specialty, license_number, address, email, phone, network_status, network_type, bupa_provider_id, accreditation_status, country, default_currency, last_verified_at, created_at, updated_at)
  VALUES (gen_random_uuid(), 'Tokyo Medical University Hospital', 'Tokyo Medical University Hospital', 'HOSPITAL',
    '["General Medicine","Surgery","Paediatrics","Obstetrics","Psychiatry","Radiology"]'::jsonb, 'JP-HOSP-TMU-00160',
    '{"line1":"6-7-1 Nishi-Shinjuku","line2":"Shinjuku-ku","city":"Tokyo","state":"Tokyo","postalCode":"160-0023","country":"JP"}'::jsonb,
    'international@tokyo-med.ac.jp', '+81-3-3342-6111', 'IN_NETWORK', 'STANDARD', 'BUPA-JP-0001', 'ACCREDITED', 'JP', 'JPY', '2025-03-15', now(), now())
  RETURNING id INTO v_tmp_id;
  v_provider_ids := v_provider_ids || v_tmp_id;
  v_provider_names := v_provider_names || 'Tokyo Medical University Hospital';
  v_provider_in_network := v_provider_in_network || true;

  -- 8: American Hospital Dubai (IN_NETWORK)
  INSERT INTO providers (id, provider_name, facility_name, provider_type, specialty, license_number, address, email, phone, network_status, network_type, bupa_provider_id, accreditation_status, country, default_currency, last_verified_at, created_at, updated_at)
  VALUES (gen_random_uuid(), 'American Hospital Dubai', 'American Hospital Dubai', 'HOSPITAL',
    '["General Surgery","Cardiology","Orthopaedics","Oncology","Maternity","Emergency Medicine"]'::jsonb, 'AE-DHA-F-0000002',
    '{"line1":"19th Street, Oud Metha","line2":"","city":"Dubai","state":"Dubai","postalCode":"5566","country":"AE"}'::jsonb,
    'info@ahdubai.com', '+971-4-377-6000', 'IN_NETWORK', 'COMPREHENSIVE', 'BUPA-AE-0001', 'ACCREDITED', 'AE', 'AED', '2025-09-01', now(), now())
  RETURNING id INTO v_tmp_id;
  v_provider_ids := v_provider_ids || v_tmp_id;
  v_provider_names := v_provider_names || 'American Hospital Dubai';
  v_provider_in_network := v_provider_in_network || true;

  -- 9: Dr. Sophie Martin Cardiology (OUT_OF_NETWORK)
  INSERT INTO providers (id, provider_name, facility_name, provider_type, specialty, license_number, address, email, phone, network_status, network_type, bupa_provider_id, accreditation_status, country, default_currency, last_verified_at, created_at, updated_at)
  VALUES (gen_random_uuid(), 'Dr. Sophie Martin Cardiology', 'Cabinet de Cardiologie Dr. Martin', 'PRACTITIONER',
    '["Cardiology","Interventional Cardiology"]'::jsonb, 'FR-RPPS-10003456789',
    '{"line1":"14 Rue de la Paix","line2":"","city":"Paris","state":"Ile-de-France","postalCode":"75002","country":"FR"}'::jsonb,
    'dr.martin@cardiologie-paris.fr', '+33-1-42-68-53-00', 'OUT_OF_NETWORK', 'STANDARD', 'BUPA-FR-0042', 'ACCREDITED', 'FR', 'EUR', '2025-02-28', now(), now())
  RETURNING id INTO v_tmp_id;
  v_provider_ids := v_provider_ids || v_tmp_id;
  v_provider_names := v_provider_names || 'Dr. Sophie Martin Cardiology';
  v_provider_in_network := v_provider_in_network || false;

  -- 10: Bangkok Dental Clinic (OUT_OF_NETWORK)
  INSERT INTO providers (id, provider_name, facility_name, provider_type, specialty, license_number, address, email, phone, network_status, network_type, bupa_provider_id, accreditation_status, country, default_currency, last_verified_at, created_at, updated_at)
  VALUES (gen_random_uuid(), 'Bangkok Dental Clinic', 'Bangkok Dental Clinic', 'CLINIC',
    '["General Dentistry","Orthodontics","Oral Surgery","Prosthodontics"]'::jsonb, 'TH-DENT-BKK-0588',
    '{"line1":"120 Silom Road","line2":"Bang Rak","city":"Bangkok","state":"Bangkok","postalCode":"10500","country":"TH"}'::jsonb,
    'info@bangkokdentalclinic.com', '+66-2-636-9000', 'OUT_OF_NETWORK', 'STANDARD', 'BUPA-TH-0099', 'PENDING', 'TH', 'THB', NULL, now(), now())
  RETURNING id INTO v_tmp_id;
  v_provider_ids := v_provider_ids || v_tmp_id;
  v_provider_names := v_provider_names || 'Bangkok Dental Clinic';
  v_provider_in_network := v_provider_in_network || false;

  -- 11: Rural Health Centre Nairobi (PENDING_VERIFICATION)
  INSERT INTO providers (id, provider_name, facility_name, provider_type, specialty, license_number, address, email, phone, network_status, network_type, bupa_provider_id, accreditation_status, country, default_currency, last_verified_at, created_at, updated_at)
  VALUES (gen_random_uuid(), 'Rural Health Centre Nairobi', 'Kibera Community Health Centre', 'CLINIC',
    '["General Practice","Maternal Health","Paediatrics","HIV/AIDS Treatment"]'::jsonb, 'KE-MoH-NBI-04521',
    '{"line1":"Olympic Estate Road","line2":"Kibera","city":"Nairobi","state":"Nairobi County","postalCode":"00100","country":"KE"}'::jsonb,
    'admin@kiberahealth.or.ke', '+254-20-387-2000', 'PENDING_VERIFICATION', 'STANDARD', 'BUPA-KE-0010', 'PENDING', 'KE', 'KES', NULL, now(), now())
  RETURNING id INTO v_tmp_id;
  v_provider_ids := v_provider_ids || v_tmp_id;
  v_provider_names := v_provider_names || 'Rural Health Centre Nairobi';
  v_provider_in_network := v_provider_in_network || false;

  -- 12: Dr. Sarah Lam (IN_NETWORK)
  INSERT INTO providers (id, provider_name, facility_name, provider_type, specialty, license_number, address, email, phone, network_status, network_type, bupa_provider_id, accreditation_status, country, default_currency, last_verified_at, created_at, updated_at)
  VALUES (gen_random_uuid(), 'Dr. Sarah Lam', 'Hong Kong Sanatorium & Hospital', 'PRACTITIONER',
    '["General Surgery"]'::jsonb, 'HK-MED-123456',
    '{"line1":"2 Village Road","line2":"Happy Valley","city":"Hong Kong","state":"","postalCode":"999078","country":"HK"}'::jsonb,
    'sarah.lam@hksh.com', '+852-2572-0211', 'IN_NETWORK', 'COMPREHENSIVE', 'BUPA-HK-P001', 'ACCREDITED', 'HK', 'HKD', '2025-08-10', now(), now())
  RETURNING id INTO v_tmp_id;
  v_provider_ids := v_provider_ids || v_tmp_id;
  v_provider_names := v_provider_names || 'Dr. Sarah Lam';
  v_provider_in_network := v_provider_in_network || true;

  -- 13: CUHK Medical Centre (IN_NETWORK)
  INSERT INTO providers (id, provider_name, facility_name, provider_type, specialty, license_number, address, email, phone, network_status, network_type, bupa_provider_id, accreditation_status, country, default_currency, last_verified_at, created_at, updated_at)
  VALUES (gen_random_uuid(), 'CUHK Medical Centre', 'CUHK Medical Centre', 'HOSPITAL',
    '["General Surgery","Internal Medicine","Cardiology","Oncology"]'::jsonb, 'HK-HOSP-009999',
    '{"line1":"9 Chak Cheung Street","line2":"Shatin","city":"Hong Kong","state":"New Territories","postalCode":"","country":"HK"}'::jsonb,
    'info@cuhkmc.hk', '+852-3946-6888', 'IN_NETWORK', 'COMPREHENSIVE', 'BUPA-HK-0009', 'ACCREDITED', 'HK', 'HKD', '2025-09-01', now(), now())
  RETURNING id INTO v_tmp_id;
  v_provider_ids := v_provider_ids || v_tmp_id;
  v_provider_names := v_provider_names || 'CUHK Medical Centre';
  v_provider_in_network := v_provider_in_network || true;

  -- 14: Union Hospital Polyclinic (Tsuen Wan) (IN_NETWORK)
  INSERT INTO providers (id, provider_name, facility_name, provider_type, specialty, license_number, address, email, phone, network_status, network_type, bupa_provider_id, accreditation_status, country, default_currency, last_verified_at, created_at, updated_at)
  VALUES (gen_random_uuid(), 'Union Hospital Polyclinic (Tsuen Wan)', 'Union Hospital Polyclinic (Tsuen Wan)', 'CLINIC',
    '["General Practice","Internal Medicine","Gastroenterology"]'::jsonb, 'HK-CLIN-TWC-071034',
    '{"line1":"Room 1204-1206 & 1209-1210, 12/F, KOLOUR - Tsuen Wan I","line2":"68 Chung On Street, Tsuen Wan","city":"Hong Kong","state":"New Territories","postalCode":"","country":"HK"}'::jsonb,
    'tsuenwan@union.org', '+852-2608-3399', 'IN_NETWORK', 'STANDARD', 'BUPA-HK-0011', 'ACCREDITED', 'HK', 'HKD', '2025-10-01', now(), now())
  RETURNING id INTO v_tmp_id;
  v_provider_ids := v_provider_ids || v_tmp_id;
  v_provider_names := v_provider_names || 'Union Hospital Polyclinic (Tsuen Wan)';
  v_provider_in_network := v_provider_in_network || true;

  -- 15: Dr. Lau Wai (IN_NETWORK)
  INSERT INTO providers (id, provider_name, facility_name, provider_type, specialty, license_number, address, email, phone, network_status, network_type, bupa_provider_id, accreditation_status, country, default_currency, last_verified_at, created_at, updated_at)
  VALUES (gen_random_uuid(), 'Dr. Lau Wai', 'Union Hospital Polyclinic (Tsuen Wan)', 'PRACTITIONER',
    '["General Practice","Internal Medicine"]'::jsonb, 'HK-MED-TWC-LAUWAI',
    '{"line1":"Room 1204-1206 & 1209-1210, 12/F, KOLOUR - Tsuen Wan I","line2":"68 Chung On Street, Tsuen Wan","city":"Hong Kong","state":"New Territories","postalCode":"","country":"HK"}'::jsonb,
    'lau.wai@union.org', '+852-2608-3399', 'IN_NETWORK', 'STANDARD', 'BUPA-HK-P011', 'ACCREDITED', 'HK', 'HKD', '2025-10-01', now(), now())
  RETURNING id INTO v_tmp_id;
  v_provider_ids := v_provider_ids || v_tmp_id;
  v_provider_names := v_provider_names || 'Dr. Lau Wai';
  v_provider_in_network := v_provider_in_network || true;

  -- ══════════════════════════════════════════════════════════
  -- ── Phase 12: Provider Network Mappings (5 tiers × in-network providers) ──
  -- ══════════════════════════════════════════════════════════

  FOR i IN 1..array_length(v_provider_ids, 1) LOOP
    IF v_provider_in_network[i] THEN
      FOREACH v_tier IN ARRAY ARRAY['MAJOR_MEDICAL','SELECT','PREMIER','ELITE','ULTIMATE'] LOOP
        v_consult := CASE WHEN v_tier = 'ULTIMATE' THEN 0.20 WHEN v_tier = 'ELITE' THEN 0.15 ELSE 0.10 END;
        v_procedure := CASE WHEN v_tier = 'ULTIMATE' THEN 0.25 WHEN v_tier = 'ELITE' THEN 0.20 ELSE 0.12 END;
        INSERT INTO provider_network_mapping (id, provider_id, plan_tier, is_in_network, negotiated_rates)
        VALUES (gen_random_uuid(), v_provider_ids[i], v_tier, true,
          jsonb_build_object(
            'consultationDiscount', v_consult,
            'procedureDiscount', v_procedure,
            'roomRateAgreed', true
          )
        );
      END LOOP;
    END IF;
  END LOOP;

  -- ══════════════════════════════════════════════════════════
  -- ── Phase 13: Sample Claims ──
  -- ══════════════════════════════════════════════════════════

  -- ── TC-001: Standard Inpatient Surgery (Johnny Depp, PREMIER, HK) ──
  INSERT INTO claims (id, org_id, client_id, team_id, claim_reference, status, priority, assigned_to, claimant, policy, incident, treatment, financials, coverage_analysis, overall_confidence, completed_at, created_at, updated_at)
  VALUES (
    gen_random_uuid(), v_org_id, v_client1_id, v_team1_id, 'CLM-2026-A1B2C', 'COMPLETE', 50, v_admin_user_id,
    '{"membershipNumber":"BI-6000-9000-9009","firstName":"Johnny","lastName":"Depp","dateOfBirth":"1963-06-09","email":"johnny.depp@example.com"}'::jsonb,
    '{"planTier":"PREMIER","policyNumber":"BI-6000-9000-9009","policyStartDate":"2025-04-01","policyEndDate":"2026-03-31","networkOption":"COMPREHENSIVE","geographicCover":"WORLDWIDE"}'::jsonb,
    '{"description":"Gallstone attack requiring emergency surgery","symptomStartDate":"2026-03-10","treatmentDate":"2026-03-15"}'::jsonb,
    '{"treatmentType":"inpatient","treatmentCountry":"HK","treatmentDate":"2026-03-15","admissionDate":"2026-03-15","dischargeDate":"2026-03-18","practitionerName":"Dr. Sarah Lam","facilityName":"Hong Kong Sanatorium & Hospital","treatmentDescription":"Laparoscopic cholecystectomy for symptomatic gallstones","reasonForTreatment":"Calculus of gallbladder with chronic cholecystitis"}'::jsonb,
    $json${"totalClaimed":48000,"claimCurrency":"HKD","currency":"HKD","totalPayable":42857.14,"paymentCurrency":"HKD","deductibleApplied":1500,"coInsuranceApplied":0,"networkPenaltyApplied":0,"fxRate":null,"itemisedCharges":[{"description":"Laparoscopic cholecystectomy","amount":35000,"covered":true},{"description":"Hospital room (3 nights, private)","amount":9000,"covered":true},{"description":"Anaesthesia","amount":2000,"covered":true},{"description":"Follow-up consultation","amount":2000,"covered":true}],"payeeType":"MEMBER","paymentMethod":"BANK_TRANSFER","eobSummary":"EXPLANATION OF BENEFITS\nMember: Johnny Depp (BI-6000-9000-9009)\nPlan: PREMIER\n\nTotal Claimed: HKD 48,000.00\nDeductible Applied: HKD 1,500.00 (annual deductible)\nCo-Insurance: HKD 0.00\n---\nTotal Payable: HKD 42,857.14"}$json$::jsonb,
    '{"decision":"PARTIALLY_COVERED","planTier":"PREMIER","annualMaximum":{"limit":5000000,"currency":"USD"},"exclusionsTriggered":[],"lineItems":[{"description":"Laparoscopic cholecystectomy","decision":"COVERED","amount":35000},{"description":"Hospital room","decision":"COVERED","amount":9000},{"description":"Anaesthesia","decision":"COVERED","amount":2000},{"description":"Follow-up consultation","decision":"COVERED","amount":2000}]}'::jsonb,
    0.92, '2026-03-15T10:31:24Z', now(), now()
  ) RETURNING id INTO v_claim_id;
  INSERT INTO member_claims (id, member_id, claim_id) VALUES (gen_random_uuid(), v_member_ids[1], v_claim_id);
  v_provider_id := NULL;
  SELECT id INTO v_provider_id FROM providers WHERE provider_name = 'Hong Kong Sanatorium & Hospital' LIMIT 1;
  IF v_provider_id IS NOT NULL THEN
    INSERT INTO provider_claims (id, provider_id, claim_id) VALUES (gen_random_uuid(), v_provider_id, v_claim_id);
  END IF;
  INSERT INTO claim_documents (id, claim_id, file_key, original_filename, mime_type, file_size_bytes, doc_type, processing_status, created_at)
  VALUES (gen_random_uuid(), v_claim_id, 'claims/CLM-2026-A1B2C/invoice.pdf', 'CLM-2026-A1B2C-invoice.pdf', 'application/pdf', 204800, 'INVOICE', 'COMPLETED', now());
  INSERT INTO claim_coding (id, claim_id, code, code_type, description, confidence, is_primary, created_at) VALUES
    (gen_random_uuid(), v_claim_id, 'K80.10', 'ICD10', 'Calculus of gallbladder with chronic cholecystitis', 0.92, true, now()),
    (gen_random_uuid(), v_claim_id, 'K81.0', 'ICD10', 'Acute cholecystitis', 0.85, false, now()),
    (gen_random_uuid(), v_claim_id, '47562', 'CPT', 'Laparoscopic cholecystectomy', 0.94, false, now());
  INSERT INTO audit_events (id, event_type, actor_type, target_type, target_id, action, details, created_at) VALUES
    (gen_random_uuid(), 'INGESTION', 'SYSTEM', 'CLAIM', v_claim_id, 'INGEST_SUCCESS', '{"source":"EMAIL","subject":"Claim - Johnny Depp - HKSH gallbladder surgery"}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_PROCESS', 'SYSTEM', 'CLAIM', v_claim_id, 'START_PROCESSING', '{"stage":"INGESTING"}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_EXTRACT', 'SYSTEM', 'CLAIM', v_claim_id, 'FINANCIALS_EXTRACTED', '{"totalClaimed":48000,"currency":"HKD","lineItemCount":4}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_EXTRACT', 'SYSTEM', 'CLAIM', v_claim_id, 'MEMBER_EXTRACTED', '{"membershipNumber":"BI-6000-9000-9009","language":"english"}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_VALIDATE', 'SYSTEM', 'CLAIM', v_claim_id, 'MEMBER_VALIDATED', '{"membershipNumber":"BI-6000-9000-9009","planTier":"PREMIER","isValid":true}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_VALIDATE', 'SYSTEM', 'CLAIM', v_claim_id, 'COMPLETENESS_CHECKED', '{"score":0.95,"decision":"PROCEED"}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_CODING', 'SYSTEM', 'CLAIM', v_claim_id, 'CODES_EXTRACTED', '{"icd10":["K80.10","K81.0"],"cpt":["47562"],"primaryCode":"K80.10"}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_VALIDATE', 'SYSTEM', 'CLAIM', v_claim_id, 'CLINICAL_VALIDATED', '{"score":0.92,"decision":"PROCEED"}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_COVERAGE', 'SYSTEM', 'CLAIM', v_claim_id, 'COVERAGE_CALCULATED', '{"decision":"PARTIALLY_COVERED","deductibleApplied":1500,"totalPayable":42857.14}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_ADJUDICATE', 'SYSTEM', 'CLAIM', v_claim_id, 'DECISION_MADE', '{"decision":"APPROVED","payeeType":"MEMBER"}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_EDI', 'SYSTEM', 'CLAIM', v_claim_id, 'EDI_GENERATED', '{"ediType":"837I","payable":42857.14}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_STATUS', 'SYSTEM', 'CLAIM', v_claim_id, 'CLAIM_COMPLETE', '{"stp":true,"finalStatus":"COMPLETE"}'::jsonb, now());

  -- ── TC-002: Outpatient Chinese Claim (Maria Chen, ULTIMATE, CN) ──
  INSERT INTO claims (id, org_id, client_id, team_id, claim_reference, status, priority, assigned_to, claimant, policy, incident, treatment, financials, coverage_analysis, overall_confidence, completed_at, created_at, updated_at)
  VALUES (
    gen_random_uuid(), v_org_id, v_client1_id, v_team1_id, 'CLM-2026-D3E4F', 'COMPLETE', 50, v_admin_user_id,
    '{"membershipNumber":"BI-6001-1234-5678","firstName":"Maria","lastName":"Chen","dateOfBirth":"1985-03-15","email":"rahul@quickscribe.co"}'::jsonb,
    '{"planTier":"ULTIMATE","policyNumber":"BI-6001-1234-5678","policyStartDate":"2025-01-01","policyEndDate":"2025-12-31","networkOption":"COMPREHENSIVE","geographicCover":"WORLDWIDE"}'::jsonb,
    '{"description":"Routine hypertension follow-up and blood work","symptomStartDate":"2025-11-01","treatmentDate":"2026-02-20"}'::jsonb,
    '{"treatmentType":"outpatient","treatmentCountry":"CN","treatmentDate":"2026-02-20","practitionerName":"Dr. Zhang Wei","facilityName":"Shanghai First People''s Hospital","treatmentDescription":"Specialist consultation and comprehensive blood panel","reasonForTreatment":"Essential hypertension follow-up","language":"Chinese"}'::jsonb,
    $json${"totalClaimed":3500,"claimCurrency":"CNY","currency":"CNY","totalPayable":3500,"paymentCurrency":"CNY","deductibleApplied":0,"coInsuranceApplied":0,"networkPenaltyApplied":0,"fxRate":null,"itemisedCharges":[{"description":"Specialist consultation","amount":1500,"covered":true},{"description":"Comprehensive blood panel","amount":1200,"covered":true},{"description":"ECG","amount":500,"covered":true},{"description":"Prescription medication","amount":300,"covered":true}],"payeeType":"MEMBER","paymentMethod":"BANK_TRANSFER","eobSummary":"EXPLANATION OF BENEFITS\nMember: Maria Chen (BI-6001-1234-5678)\nPlan: ULTIMATE\n\nTotal Claimed: CNY 3,500.00\nDeductible Applied: CNY 0.00 (ULTIMATE - no deductible)\nCo-Insurance: CNY 0.00\n---\nTotal Payable: CNY 3,500.00\n\nFully covered under ULTIMATE plan."}$json$::jsonb,
    '{"decision":"FULLY_COVERED","planTier":"ULTIMATE","annualMaximum":{"limit":null,"currency":"USD","unlimited":true},"exclusionsTriggered":[]}'::jsonb,
    0.89, '2026-02-20T14:22:00Z', now(), now()
  ) RETURNING id INTO v_claim_id;
  INSERT INTO member_claims (id, member_id, claim_id) VALUES (gen_random_uuid(), v_member_ids[2], v_claim_id);
  v_provider_id := NULL;
  SELECT id INTO v_provider_id FROM providers WHERE provider_name = 'Shanghai First People''s Hospital' LIMIT 1;
  IF v_provider_id IS NOT NULL THEN
    INSERT INTO provider_claims (id, provider_id, claim_id) VALUES (gen_random_uuid(), v_provider_id, v_claim_id);
  END IF;
  INSERT INTO claim_documents (id, claim_id, file_key, original_filename, mime_type, file_size_bytes, doc_type, processing_status, created_at)
  VALUES (gen_random_uuid(), v_claim_id, 'claims/CLM-2026-D3E4F/invoice.pdf', 'CLM-2026-D3E4F-invoice.pdf', 'application/pdf', 204800, 'INVOICE', 'COMPLETED', now());
  INSERT INTO claim_coding (id, claim_id, code, code_type, description, confidence, is_primary, created_at) VALUES
    (gen_random_uuid(), v_claim_id, 'I10', 'ICD10', 'Essential (primary) hypertension', 0.91, true, now()),
    (gen_random_uuid(), v_claim_id, '99213', 'CPT', 'Office/outpatient visit, established patient', 0.90, false, now());
  INSERT INTO audit_events (id, event_type, actor_type, target_type, target_id, action, details, created_at) VALUES
    (gen_random_uuid(), 'INGESTION', 'SYSTEM', 'CLAIM', v_claim_id, 'INGEST_SUCCESS', '{"source":"EMAIL","subject":"Maria Chen - Shanghai hypertension follow-up"}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_PROCESS', 'SYSTEM', 'CLAIM', v_claim_id, 'START_PROCESSING', '{"stage":"INGESTING"}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_EXTRACT', 'SYSTEM', 'CLAIM', v_claim_id, 'FINANCIALS_EXTRACTED', '{"totalClaimed":3500,"currency":"CNY","language":"Chinese"}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_EXTRACT', 'SYSTEM', 'CLAIM', v_claim_id, 'TRANSLATION_COMPLETE', '{"from":"zh-CN","to":"en","model":"claude-haiku"}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_VALIDATE', 'SYSTEM', 'CLAIM', v_claim_id, 'MEMBER_VALIDATED', '{"membershipNumber":"BI-6001-1234-5678","planTier":"ULTIMATE","isValid":true}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_CODING', 'SYSTEM', 'CLAIM', v_claim_id, 'CODES_EXTRACTED', '{"icd10":["I10"],"cpt":["99213"],"primaryCode":"I10"}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_COVERAGE', 'SYSTEM', 'CLAIM', v_claim_id, 'COVERAGE_CALCULATED', '{"decision":"FULLY_COVERED","totalPayable":3500}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_ADJUDICATE', 'SYSTEM', 'CLAIM', v_claim_id, 'DECISION_MADE', '{"decision":"APPROVED"}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_STATUS', 'SYSTEM', 'CLAIM', v_claim_id, 'CLAIM_COMPLETE', '{"stp":true}'::jsonb, now());

  -- ── TC-009: Cosmetic Treatment Denial (Hans Mueller, ELITE) ──
  INSERT INTO claims (id, org_id, client_id, team_id, claim_reference, status, priority, assigned_to, claimant, policy, incident, treatment, financials, coverage_analysis, overall_confidence, created_at, updated_at)
  VALUES (
    gen_random_uuid(), v_org_id, v_client1_id, v_team1_id, 'CLM-2026-G5H6I', 'DENIED', 50, v_admin_user_id,
    '{"membershipNumber":"BI-6006-6789-0123","firstName":"Hans","lastName":"Mueller","dateOfBirth":"1972-08-14","email":"hans.mueller@example.com"}'::jsonb,
    '{"planTier":"ELITE","policyNumber":"BI-6006-6789-0123","policyStartDate":"2025-05-01","policyEndDate":"2026-04-30"}'::jsonb,
    '{"description":"Cosmetic rhinoplasty for aesthetic improvement","symptomStartDate":null,"treatmentDate":"2026-03-01"}'::jsonb,
    '{"treatmentType":"outpatient","treatmentCountry":"GB","treatmentDate":"2026-03-01","practitionerName":"Dr. James Hartley","facilityName":"The Harley Street Clinic","treatmentDescription":"Cosmetic rhinoplasty for aesthetic improvement","reasonForTreatment":"Encounter for cosmetic surgery"}'::jsonb,
    $json${"totalClaimed":8500,"claimCurrency":"GBP","currency":"GBP","totalPayable":0,"paymentCurrency":"GBP","deductibleApplied":0,"coInsuranceApplied":0,"networkPenaltyApplied":0,"itemisedCharges":[{"description":"Rhinoplasty procedure","amount":7000,"covered":false},{"description":"Anaesthesia","amount":1000,"covered":false},{"description":"Post-op dressing","amount":500,"covered":false}],"payeeType":"MEMBER","paymentMethod":"BANK_TRANSFER","eobSummary":"EXPLANATION OF BENEFITS\nMember: Hans Mueller (BI-6006-6789-0123)\nPlan: ELITE\n\nTotal Claimed: GBP 8,500.00\nCoverage Decision: NOT COVERED\nDenial Reason: Cosmetic/aesthetic treatment is a global exclusion.\n---\nTotal Payable: GBP 0.00"}$json$::jsonb,
    '{"decision":"NOT_COVERED","planTier":"ELITE","exclusionsTriggered":["Cosmetic or aesthetic treatment"],"denialReason":"Global exclusion: cosmetic treatment"}'::jsonb,
    0.88, now(), now()
  ) RETURNING id INTO v_claim_id;
  INSERT INTO member_claims (id, member_id, claim_id) VALUES (gen_random_uuid(), v_member_ids[7], v_claim_id);
  v_provider_id := NULL;
  SELECT id INTO v_provider_id FROM providers WHERE provider_name = 'Harley Street Clinic' LIMIT 1;
  IF v_provider_id IS NOT NULL THEN
    INSERT INTO provider_claims (id, provider_id, claim_id) VALUES (gen_random_uuid(), v_provider_id, v_claim_id);
  END IF;
  INSERT INTO claim_documents (id, claim_id, file_key, original_filename, mime_type, file_size_bytes, doc_type, processing_status, created_at)
  VALUES (gen_random_uuid(), v_claim_id, 'claims/CLM-2026-G5H6I/invoice.pdf', 'CLM-2026-G5H6I-invoice.pdf', 'application/pdf', 204800, 'INVOICE', 'COMPLETED', now());
  INSERT INTO claim_coding (id, claim_id, code, code_type, description, confidence, is_primary, created_at) VALUES
    (gen_random_uuid(), v_claim_id, 'Z41.1', 'ICD10', 'Encounter for cosmetic surgery', 0.93, true, now()),
    (gen_random_uuid(), v_claim_id, '30400', 'CPT', 'Rhinoplasty, primary', 0.90, false, now());
  INSERT INTO audit_events (id, event_type, actor_type, target_type, target_id, action, details, created_at) VALUES
    (gen_random_uuid(), 'INGESTION', 'SYSTEM', 'CLAIM', v_claim_id, 'INGEST_SUCCESS', '{"source":"EMAIL"}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_PROCESS', 'SYSTEM', 'CLAIM', v_claim_id, 'START_PROCESSING', '{}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_CODING', 'SYSTEM', 'CLAIM', v_claim_id, 'CODES_EXTRACTED', '{"icd10":["Z41.1"],"cpt":["30400"],"primaryCode":"Z41.1"}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_VALIDATE', 'SYSTEM', 'CLAIM', v_claim_id, 'CLINICAL_VALIDATED', '{"score":0.45,"decision":"COSMETIC_FLAGGED"}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_COVERAGE', 'SYSTEM', 'CLAIM', v_claim_id, 'COVERAGE_CALCULATED', '{"decision":"NOT_COVERED","exclusionsTriggered":["Cosmetic or aesthetic treatment"]}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_ADJUDICATE', 'SYSTEM', 'CLAIM', v_claim_id, 'DECISION_MADE', '{"decision":"DENIED","reason":"Global exclusion: cosmetic treatment"}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_STATUS', 'SYSTEM', 'CLAIM', v_claim_id, 'CLAIM_DENIED', '{"reason":"Global exclusion: cosmetic treatment"}'::jsonb, now());

  -- ── TC-013: MAJOR_MEDICAL Dental Denial (Sophie Laurent) ──
  INSERT INTO claims (id, org_id, client_id, team_id, claim_reference, status, priority, assigned_to, claimant, policy, incident, treatment, financials, coverage_analysis, overall_confidence, created_at, updated_at)
  VALUES (
    gen_random_uuid(), v_org_id, v_client1_id, v_team1_id, 'CLM-2026-J7K8L', 'DENIED', 50, v_admin_user_id,
    '{"membershipNumber":"BI-6004-4567-8901","firstName":"Sophie","lastName":"Laurent","dateOfBirth":"1975-12-03","email":"rahul@quickscribe.co"}'::jsonb,
    '{"planTier":"MAJOR_MEDICAL","policyNumber":"BI-6004-4567-8901","policyStartDate":"2025-07-01","policyEndDate":"2026-06-30"}'::jsonb,
    '{"description":"Routine dental cleaning and check-up","treatmentDate":"2026-02-10"}'::jsonb,
    '{"treatmentType":"outpatient","treatmentCountry":"FR","treatmentDate":"2026-02-10","practitionerName":"Dr. Pierre Dubois","facilityName":"Cabinet Dentaire Dubois","treatmentDescription":"Dental cleaning and check-up","reasonForTreatment":"Routine dental care","category":"DENTAL"}'::jsonb,
    $json${"totalClaimed":200,"claimCurrency":"EUR","currency":"EUR","totalPayable":0,"paymentCurrency":"EUR","deductibleApplied":0,"coInsuranceApplied":0,"networkPenaltyApplied":0,"itemisedCharges":[{"description":"Dental cleaning","amount":120,"covered":false},{"description":"Dental check-up and X-ray","amount":80,"covered":false}],"payeeType":"MEMBER","paymentMethod":"BANK_TRANSFER","eobSummary":"EXPLANATION OF BENEFITS\nMember: Sophie Laurent (BI-6004-4567-8901)\nPlan: MAJOR_MEDICAL\n\nTotal Claimed: EUR 200.00\nCoverage Decision: NOT COVERED\nDenial Reason: Dental treatment is not covered under MAJOR_MEDICAL plan.\n---\nTotal Payable: EUR 0.00"}$json$::jsonb,
    '{"decision":"NOT_COVERED","planTier":"MAJOR_MEDICAL","exclusionsTriggered":["Dental treatment (not covered under this plan)"],"denialReason":"Dental not covered under MAJOR_MEDICAL plan"}'::jsonb,
    0.95, now(), now()
  ) RETURNING id INTO v_claim_id;
  INSERT INTO member_claims (id, member_id, claim_id) VALUES (gen_random_uuid(), v_member_ids[5], v_claim_id);
  -- Sophie Laurent's dental treatment was at "Cabinet Dentaire Dubois" in Paris.
  -- No French dental provider exists in the seed, so the lookup returns NULL and the
  -- guard below skips the provider_claims insert rather than incorrectly linking a
  -- Bangkok-based clinic to a Paris-based treatment.
  v_provider_id := NULL;
  SELECT id INTO v_provider_id FROM providers WHERE provider_name = 'Cabinet Dentaire Dubois' LIMIT 1;
  IF v_provider_id IS NOT NULL THEN
    INSERT INTO provider_claims (id, provider_id, claim_id) VALUES (gen_random_uuid(), v_provider_id, v_claim_id);
  END IF;
  INSERT INTO claim_documents (id, claim_id, file_key, original_filename, mime_type, file_size_bytes, doc_type, processing_status, created_at)
  VALUES (gen_random_uuid(), v_claim_id, 'claims/CLM-2026-J7K8L/invoice.pdf', 'CLM-2026-J7K8L-invoice.pdf', 'application/pdf', 204800, 'INVOICE', 'COMPLETED', now());
  INSERT INTO claim_coding (id, claim_id, code, code_type, description, confidence, is_primary, created_at) VALUES
    (gen_random_uuid(), v_claim_id, 'Z01.20', 'ICD10', 'Encounter for dental examination and cleaning', 0.96, true, now()),
    (gen_random_uuid(), v_claim_id, 'D1110', 'CPT', 'Prophylaxis - adult', 0.94, false, now());
  INSERT INTO audit_events (id, event_type, actor_type, target_type, target_id, action, details, created_at) VALUES
    (gen_random_uuid(), 'INGESTION', 'SYSTEM', 'CLAIM', v_claim_id, 'INGEST_SUCCESS', '{"source":"EMAIL"}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_PROCESS', 'SYSTEM', 'CLAIM', v_claim_id, 'START_PROCESSING', '{}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_CODING', 'SYSTEM', 'CLAIM', v_claim_id, 'CODES_EXTRACTED', '{"icd10":["Z01.20"],"cpt":["D1110"],"primaryCode":"Z01.20"}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_COVERAGE', 'SYSTEM', 'CLAIM', v_claim_id, 'COVERAGE_CALCULATED', '{"decision":"NOT_COVERED","exclusionsTriggered":["Dental treatment (not covered under this plan)"]}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_ADJUDICATE', 'SYSTEM', 'CLAIM', v_claim_id, 'DECISION_MADE', '{"decision":"DENIED","reason":"Dental not covered under MAJOR_MEDICAL plan"}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_STATUS', 'SYSTEM', 'CLAIM', v_claim_id, 'CLAIM_DENIED', '{"reason":"Dental not covered under MAJOR_MEDICAL plan"}'::jsonb, now());

  -- ── TC-014: ULTIMATE Full Coverage Surgery (Maria Chen) ──
  INSERT INTO claims (id, org_id, client_id, team_id, claim_reference, status, priority, assigned_to, claimant, policy, incident, treatment, financials, coverage_analysis, overall_confidence, completed_at, created_at, updated_at)
  VALUES (
    gen_random_uuid(), v_org_id, v_client1_id, v_team1_id, 'CLM-2026-M9N0P', 'COMPLETE', 50, v_admin_user_id,
    '{"membershipNumber":"BI-6001-1234-5678","firstName":"Maria","lastName":"Chen","dateOfBirth":"1985-03-15"}'::jsonb,
    '{"planTier":"ULTIMATE","policyNumber":"BI-6001-1234-5678"}'::jsonb,
    '{"description":"Scheduled appendectomy","symptomStartDate":"2026-03-05","treatmentDate":"2026-03-10"}'::jsonb,
    '{"treatmentType":"inpatient","treatmentCountry":"CN","treatmentDate":"2026-03-10","admissionDate":"2026-03-10","dischargeDate":"2026-03-12","practitionerName":"Dr. Li Ming","facilityName":"Shanghai First People''s Hospital","treatmentDescription":"Laparoscopic appendectomy","reasonForTreatment":"Acute appendicitis"}'::jsonb,
    $json${"totalClaimed":200000,"claimCurrency":"HKD","currency":"HKD","totalPayable":200000,"paymentCurrency":"HKD","deductibleApplied":0,"coInsuranceApplied":0,"networkPenaltyApplied":0,"fxRate":null,"itemisedCharges":[{"description":"Laparoscopic appendectomy","amount":150000,"covered":true},{"description":"Hospital room (2 nights)","amount":30000,"covered":true},{"description":"Anaesthesia & drugs","amount":15000,"covered":true},{"description":"Post-op care","amount":5000,"covered":true}],"payeeType":"MEMBER","paymentMethod":"BANK_TRANSFER","eobSummary":"EXPLANATION OF BENEFITS\nMember: Maria Chen (BI-6001-1234-5678)\nPlan: ULTIMATE\n\nTotal Claimed: HKD 200,000.00\nDeductible: HKD 0.00 (ULTIMATE - no deductible)\nCo-Insurance: HKD 0.00\n---\nTotal Payable: HKD 200,000.00\n\nFully covered."}$json$::jsonb,
    '{"decision":"FULLY_COVERED","planTier":"ULTIMATE","annualMaximum":{"limit":null,"currency":"USD","unlimited":true},"exclusionsTriggered":[]}'::jsonb,
    0.94, '2026-03-12T16:00:00Z', now(), now()
  ) RETURNING id INTO v_claim_id;
  INSERT INTO member_claims (id, member_id, claim_id) VALUES (gen_random_uuid(), v_member_ids[2], v_claim_id);
  v_provider_id := NULL;
  SELECT id INTO v_provider_id FROM providers WHERE provider_name = 'Shanghai First People''s Hospital' LIMIT 1;
  IF v_provider_id IS NOT NULL THEN
    INSERT INTO provider_claims (id, provider_id, claim_id) VALUES (gen_random_uuid(), v_provider_id, v_claim_id);
  END IF;
  INSERT INTO claim_documents (id, claim_id, file_key, original_filename, mime_type, file_size_bytes, doc_type, processing_status, created_at)
  VALUES (gen_random_uuid(), v_claim_id, 'claims/CLM-2026-M9N0P/invoice.pdf', 'CLM-2026-M9N0P-invoice.pdf', 'application/pdf', 204800, 'INVOICE', 'COMPLETED', now());
  INSERT INTO claim_coding (id, claim_id, code, code_type, description, confidence, is_primary, created_at) VALUES
    (gen_random_uuid(), v_claim_id, 'K35.80', 'ICD10', 'Other and unspecified acute appendicitis', 0.93, true, now()),
    (gen_random_uuid(), v_claim_id, '44970', 'CPT', 'Laparoscopic appendectomy', 0.95, false, now());
  INSERT INTO audit_events (id, event_type, actor_type, target_type, target_id, action, details, created_at) VALUES
    (gen_random_uuid(), 'INGESTION', 'SYSTEM', 'CLAIM', v_claim_id, 'INGEST_SUCCESS', '{"source":"EMAIL"}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_PROCESS', 'SYSTEM', 'CLAIM', v_claim_id, 'START_PROCESSING', '{}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_EXTRACT', 'SYSTEM', 'CLAIM', v_claim_id, 'FINANCIALS_EXTRACTED', '{"totalClaimed":200000,"currency":"HKD","lineItemCount":4}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_VALIDATE', 'SYSTEM', 'CLAIM', v_claim_id, 'MEMBER_VALIDATED', '{"membershipNumber":"BI-6001-1234-5678","planTier":"ULTIMATE","isValid":true}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_VALIDATE', 'SYSTEM', 'CLAIM', v_claim_id, 'COMPLETENESS_CHECKED', '{"score":0.95,"decision":"PROCEED"}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_CODING', 'SYSTEM', 'CLAIM', v_claim_id, 'CODES_EXTRACTED', '{"icd10":["K35.80"],"cpt":["44970"],"primaryCode":"K35.80"}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_COVERAGE', 'SYSTEM', 'CLAIM', v_claim_id, 'COVERAGE_CALCULATED', '{"decision":"FULLY_COVERED","totalPayable":200000}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_ADJUDICATE', 'SYSTEM', 'CLAIM', v_claim_id, 'DECISION_MADE', '{"decision":"APPROVED"}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_EDI', 'SYSTEM', 'CLAIM', v_claim_id, 'EDI_GENERATED', '{"ediType":"837I"}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_STATUS', 'SYSTEM', 'CLAIM', v_claim_id, 'CLAIM_COMPLETE', '{"stp":true}'::jsonb, now());

  -- ── TC-015: SELECT Plan with Deductible + Co-Insurance (Yuki Tanaka) ──
  INSERT INTO claims (id, org_id, client_id, team_id, claim_reference, status, priority, assigned_to, claimant, policy, incident, treatment, financials, coverage_analysis, overall_confidence, completed_at, created_at, updated_at)
  VALUES (
    gen_random_uuid(), v_org_id, v_client1_id, v_team1_id, 'CLM-2026-Q1R2S', 'COMPLETE', 50, v_admin_user_id,
    '{"membershipNumber":"BI-6003-3456-7890","firstName":"Yuki","lastName":"Tanaka","dateOfBirth":"1990-07-08"}'::jsonb,
    '{"planTier":"SELECT","policyNumber":"BI-6003-3456-7890","deductible":{"total":1500,"used":500,"remaining":1000},"coInsuranceRate":0.15}'::jsonb,
    '{"description":"Specialist consultation for persistent back pain","symptomStartDate":"2026-01-15","treatmentDate":"2026-02-28"}'::jsonb,
    '{"treatmentType":"outpatient","treatmentCountry":"JP","treatmentDate":"2026-02-28","practitionerName":"Dr. Takeshi Yamamoto","facilityName":"Tokyo Medical University Hospital","treatmentDescription":"Specialist consultation, MRI, and physical therapy assessment","reasonForTreatment":"Chronic lower back pain"}'::jsonb,
    $json${"totalClaimed":5000,"claimCurrency":"USD","currency":"USD","totalPayable":3400,"paymentCurrency":"USD","deductibleApplied":1000,"coInsuranceApplied":600,"networkPenaltyApplied":0,"fxRate":null,"itemisedCharges":[{"description":"Specialist consultation","amount":800,"covered":true},{"description":"MRI lumbar spine","amount":3200,"covered":true},{"description":"Physical therapy assessment","amount":1000,"covered":true}],"payeeType":"MEMBER","paymentMethod":"BANK_TRANSFER","eobSummary":"EXPLANATION OF BENEFITS\nMember: Yuki Tanaka (BI-6003-3456-7890)\nPlan: SELECT\n\nTotal Claimed: USD 5,000.00\nDeductible Applied: USD 1,000.00 (of $1,500 total, $500 previously used)\nAfter Deductible: USD 4,000.00\nCo-Insurance (15%): USD 600.00\n---\nTotal Payable: USD 3,400.00"}$json$::jsonb,
    '{"decision":"PARTIALLY_COVERED","planTier":"SELECT","annualMaximum":{"limit":4500000,"currency":"USD"},"deductibleBreakdown":{"total":1500,"previouslyUsed":500,"appliedThisClaim":1000,"remaining":0},"coInsuranceBreakdown":{"rate":0.15,"baseAmount":4000,"coInsuranceAmount":600},"exclusionsTriggered":[]}'::jsonb,
    0.90, '2026-02-28T12:00:00Z', now(), now()
  ) RETURNING id INTO v_claim_id;
  INSERT INTO member_claims (id, member_id, claim_id) VALUES (gen_random_uuid(), v_member_ids[4], v_claim_id);
  v_provider_id := NULL;
  SELECT id INTO v_provider_id FROM providers WHERE provider_name = 'Tokyo Medical University Hospital' LIMIT 1;
  IF v_provider_id IS NOT NULL THEN
    INSERT INTO provider_claims (id, provider_id, claim_id) VALUES (gen_random_uuid(), v_provider_id, v_claim_id);
  END IF;
  INSERT INTO claim_documents (id, claim_id, file_key, original_filename, mime_type, file_size_bytes, doc_type, processing_status, created_at)
  VALUES (gen_random_uuid(), v_claim_id, 'claims/CLM-2026-Q1R2S/invoice.pdf', 'CLM-2026-Q1R2S-invoice.pdf', 'application/pdf', 204800, 'INVOICE', 'COMPLETED', now());
  INSERT INTO claim_coding (id, claim_id, code, code_type, description, confidence, is_primary, created_at) VALUES
    (gen_random_uuid(), v_claim_id, 'M54.5', 'ICD10', 'Low back pain', 0.91, true, now()),
    (gen_random_uuid(), v_claim_id, '99213', 'CPT', 'Office/outpatient visit, established patient', 0.88, false, now()),
    (gen_random_uuid(), v_claim_id, '72148', 'CPT', 'MRI lumbar spine without contrast', 0.92, false, now());
  INSERT INTO audit_events (id, event_type, actor_type, target_type, target_id, action, details, created_at) VALUES
    (gen_random_uuid(), 'INGESTION', 'SYSTEM', 'CLAIM', v_claim_id, 'INGEST_SUCCESS', '{"source":"EMAIL"}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_PROCESS', 'SYSTEM', 'CLAIM', v_claim_id, 'START_PROCESSING', '{}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_EXTRACT', 'SYSTEM', 'CLAIM', v_claim_id, 'FINANCIALS_EXTRACTED', '{"totalClaimed":5000,"currency":"USD","lineItemCount":3}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_VALIDATE', 'SYSTEM', 'CLAIM', v_claim_id, 'MEMBER_VALIDATED', '{"membershipNumber":"BI-6003-3456-7890","planTier":"SELECT","isValid":true}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_CODING', 'SYSTEM', 'CLAIM', v_claim_id, 'CODES_EXTRACTED', '{"icd10":["M54.5"],"cpt":["99213","72148"],"primaryCode":"M54.5"}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_COVERAGE', 'SYSTEM', 'CLAIM', v_claim_id, 'COVERAGE_CALCULATED', '{"decision":"PARTIALLY_COVERED","deductibleApplied":1000,"coInsuranceApplied":600,"totalPayable":3400}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_ADJUDICATE', 'SYSTEM', 'CLAIM', v_claim_id, 'DECISION_MADE', '{"decision":"APPROVED"}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_EDI', 'SYSTEM', 'CLAIM', v_claim_id, 'EDI_GENERATED', '{"ediType":"837P"}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_STATUS', 'SYSTEM', 'CLAIM', v_claim_id, 'CLAIM_COMPLETE', '{"stp":true}'::jsonb, now());

  -- ── TC-016: Out-of-Network Provider Penalty (Ahmed Al-Rashid, ELITE) ──
  INSERT INTO claims (id, org_id, client_id, team_id, claim_reference, status, priority, assigned_to, claimant, policy, incident, treatment, financials, coverage_analysis, overall_confidence, completed_at, created_at, updated_at)
  VALUES (
    gen_random_uuid(), v_org_id, v_client1_id, v_team1_id, 'CLM-2026-T3U4V', 'COMPLETE', 50, v_admin_user_id,
    '{"membershipNumber":"BI-6002-2345-6789","firstName":"Ahmed","lastName":"Al-Rashid","dateOfBirth":"1978-11-22"}'::jsonb,
    '{"planTier":"ELITE","policyNumber":"BI-6002-2345-6789","deductible":{"total":4000,"used":1200,"remaining":2800}}'::jsonb,
    '{"description":"Cardiology consultation for hypertension management","symptomStartDate":"2025-06-01","treatmentDate":"2026-03-05"}'::jsonb,
    '{"treatmentType":"outpatient","treatmentCountry":"FR","treatmentDate":"2026-03-05","practitionerName":"Dr. Sophie Martin","facilityName":"Cabinet de Cardiologie Dr. Martin","treatmentDescription":"Cardiology consultation, ECG, stress test","reasonForTreatment":"Essential hypertension monitoring"}'::jsonb,
    $json${"totalClaimed":10000,"claimCurrency":"USD","currency":"USD","totalPayable":5200,"paymentCurrency":"USD","deductibleApplied":2800,"coInsuranceApplied":0,"networkPenaltyApplied":2000,"fxRate":null,"itemisedCharges":[{"description":"Cardiology consultation","amount":3000,"covered":true},{"description":"ECG and stress test","amount":5000,"covered":true},{"description":"Blood work panel","amount":2000,"covered":true}],"payeeType":"MEMBER","paymentMethod":"BANK_TRANSFER","eobSummary":"EXPLANATION OF BENEFITS\nMember: Ahmed Al-Rashid (BI-6002-2345-6789)\nPlan: ELITE\n\nTotal Claimed: USD 10,000.00\nNetwork Penalty (20% - out-of-network): USD 2,000.00\nAfter Network Penalty: USD 8,000.00\nDeductible Applied: USD 2,800.00 (of $4,000 total, $1,200 previously used)\nAfter Deductible: USD 5,200.00\n---\nTotal Payable: USD 5,200.00"}$json$::jsonb,
    '{"decision":"PARTIALLY_COVERED","planTier":"ELITE","annualMaximum":{"limit":10000000,"currency":"USD"},"networkPenalty":{"rate":0.20,"amount":2000,"reason":"Provider is out-of-network"},"deductibleBreakdown":{"total":4000,"previouslyUsed":1200,"appliedThisClaim":2800,"remaining":0},"exclusionsTriggered":[]}'::jsonb,
    0.87, '2026-03-05T15:30:00Z', now(), now()
  ) RETURNING id INTO v_claim_id;
  INSERT INTO member_claims (id, member_id, claim_id) VALUES (gen_random_uuid(), v_member_ids[3], v_claim_id);
  v_provider_id := NULL;
  SELECT id INTO v_provider_id FROM providers WHERE provider_name = 'Dr. Sophie Martin Cardiology' LIMIT 1;
  IF v_provider_id IS NOT NULL THEN
    INSERT INTO provider_claims (id, provider_id, claim_id) VALUES (gen_random_uuid(), v_provider_id, v_claim_id);
  END IF;
  INSERT INTO claim_documents (id, claim_id, file_key, original_filename, mime_type, file_size_bytes, doc_type, processing_status, created_at)
  VALUES (gen_random_uuid(), v_claim_id, 'claims/CLM-2026-T3U4V/invoice.pdf', 'CLM-2026-T3U4V-invoice.pdf', 'application/pdf', 204800, 'INVOICE', 'COMPLETED', now());
  INSERT INTO claim_coding (id, claim_id, code, code_type, description, confidence, is_primary, created_at) VALUES
    (gen_random_uuid(), v_claim_id, 'I10', 'ICD10', 'Essential (primary) hypertension', 0.94, true, now()),
    (gen_random_uuid(), v_claim_id, '93000', 'CPT', 'Electrocardiogram, routine ECG', 0.90, false, now()),
    (gen_random_uuid(), v_claim_id, '93015', 'CPT', 'Cardiovascular stress test', 0.88, false, now());
  INSERT INTO audit_events (id, event_type, actor_type, target_type, target_id, action, details, created_at) VALUES
    (gen_random_uuid(), 'INGESTION', 'SYSTEM', 'CLAIM', v_claim_id, 'INGEST_SUCCESS', '{"source":"EMAIL"}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_PROCESS', 'SYSTEM', 'CLAIM', v_claim_id, 'START_PROCESSING', '{}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_VALIDATE', 'SYSTEM', 'CLAIM', v_claim_id, 'PROVIDER_VALIDATED', '{"networkStatus":"OUT_OF_NETWORK","penaltyRate":0.20,"penaltyAmount":2000}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_CODING', 'SYSTEM', 'CLAIM', v_claim_id, 'CODES_EXTRACTED', '{"icd10":["I10"],"cpt":["93000","93015"],"primaryCode":"I10"}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_COVERAGE', 'SYSTEM', 'CLAIM', v_claim_id, 'COVERAGE_CALCULATED', '{"decision":"PARTIALLY_COVERED","deductibleApplied":2800,"networkPenaltyApplied":2000,"totalPayable":5200}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_ADJUDICATE', 'SYSTEM', 'CLAIM', v_claim_id, 'DECISION_MADE', '{"decision":"APPROVED"}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_EDI', 'SYSTEM', 'CLAIM', v_claim_id, 'EDI_GENERATED', '{"ediType":"837P"}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_STATUS', 'SYSTEM', 'CLAIM', v_claim_id, 'CLAIM_COMPLETE', '{"stp":true}'::jsonb, now());

  -- ── TC-017: Global Exclusion - Substance Abuse (Carlos Silva, DENIED) ──
  INSERT INTO claims (id, org_id, client_id, team_id, claim_reference, status, priority, assigned_to, claimant, policy, incident, treatment, financials, coverage_analysis, overall_confidence, created_at, updated_at)
  VALUES (
    gen_random_uuid(), v_org_id, v_client1_id, v_team1_id, 'CLM-2026-W5X6Y', 'DENIED', 50, v_admin_user_id,
    '{"membershipNumber":"BI-6009-9012-3456","firstName":"Carlos","lastName":"Silva","dateOfBirth":"1980-06-25"}'::jsonb,
    '{"planTier":"MAJOR_MEDICAL","policyNumber":"BI-6009-9012-3456"}'::jsonb,
    '{"description":"Substance abuse rehabilitation program","treatmentDate":"2026-02-15"}'::jsonb,
    '{"treatmentType":"inpatient","treatmentCountry":"TH","treatmentDate":"2026-02-15","admissionDate":"2026-02-15","dischargeDate":"2026-03-15","practitionerName":"Dr. Anong Siriwan","facilityName":"Bumrungrad International Hospital","treatmentDescription":"Substance abuse rehabilitation","reasonForTreatment":"Alcohol dependence"}'::jsonb,
    $json${"totalClaimed":25000,"claimCurrency":"USD","currency":"USD","totalPayable":0,"paymentCurrency":"USD","deductibleApplied":0,"coInsuranceApplied":0,"networkPenaltyApplied":0,"itemisedCharges":[{"description":"Inpatient rehabilitation (30 days)","amount":20000,"covered":false},{"description":"Counselling sessions","amount":3000,"covered":false},{"description":"Medication","amount":2000,"covered":false}],"payeeType":"MEMBER","paymentMethod":"BANK_TRANSFER","eobSummary":"EXPLANATION OF BENEFITS\nMember: Carlos Silva (BI-6009-9012-3456)\nPlan: MAJOR_MEDICAL\n\nTotal Claimed: USD 25,000.00\nCoverage Decision: NOT COVERED\nDenial Reason: Global exclusion - hazardous substance abuse.\n---\nTotal Payable: USD 0.00"}$json$::jsonb,
    '{"decision":"NOT_COVERED","planTier":"MAJOR_MEDICAL","exclusionsTriggered":["hazardous substance abuse"],"denialReason":"Global exclusion: substance abuse"}'::jsonb,
    0.91, now(), now()
  ) RETURNING id INTO v_claim_id;
  INSERT INTO member_claims (id, member_id, claim_id) VALUES (gen_random_uuid(), v_member_ids[10], v_claim_id);
  v_provider_id := NULL;
  SELECT id INTO v_provider_id FROM providers WHERE provider_name = 'Bumrungrad International Hospital' LIMIT 1;
  IF v_provider_id IS NOT NULL THEN
    INSERT INTO provider_claims (id, provider_id, claim_id) VALUES (gen_random_uuid(), v_provider_id, v_claim_id);
  END IF;
  INSERT INTO claim_documents (id, claim_id, file_key, original_filename, mime_type, file_size_bytes, doc_type, processing_status, created_at)
  VALUES (gen_random_uuid(), v_claim_id, 'claims/CLM-2026-W5X6Y/invoice.pdf', 'CLM-2026-W5X6Y-invoice.pdf', 'application/pdf', 204800, 'INVOICE', 'COMPLETED', now());
  INSERT INTO claim_coding (id, claim_id, code, code_type, description, confidence, is_primary, created_at) VALUES
    (gen_random_uuid(), v_claim_id, 'F10.20', 'ICD10', 'Alcohol dependence, uncomplicated', 0.95, true, now());
  INSERT INTO audit_events (id, event_type, actor_type, target_type, target_id, action, details, created_at) VALUES
    (gen_random_uuid(), 'INGESTION', 'SYSTEM', 'CLAIM', v_claim_id, 'INGEST_SUCCESS', '{"source":"EMAIL"}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_PROCESS', 'SYSTEM', 'CLAIM', v_claim_id, 'START_PROCESSING', '{}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_CODING', 'SYSTEM', 'CLAIM', v_claim_id, 'CODES_EXTRACTED', '{"icd10":["F10.20"],"primaryCode":"F10.20"}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_COVERAGE', 'SYSTEM', 'CLAIM', v_claim_id, 'COVERAGE_CALCULATED', '{"decision":"NOT_COVERED","exclusionsTriggered":["hazardous substance abuse"]}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_ADJUDICATE', 'SYSTEM', 'CLAIM', v_claim_id, 'DECISION_MADE', '{"decision":"DENIED","reason":"Global exclusion: substance abuse"}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_STATUS', 'SYSTEM', 'CLAIM', v_claim_id, 'CLAIM_DENIED', '{"reason":"Global exclusion: substance abuse"}'::jsonb, now());

  -- ── TC-004: Missing Member Info (QUERYING_MEMBER) ──
  INSERT INTO claims (id, org_id, client_id, team_id, claim_reference, status, priority, assigned_to, claimant, policy, incident, treatment, financials, coverage_analysis, overall_confidence, created_at, updated_at)
  VALUES (
    gen_random_uuid(), v_org_id, v_client1_id, v_team1_id, 'CLM-2026-QRY01', 'QUERYING_MEMBER', 50, v_admin_user_id,
    '{"lastName":"Patel","email":"raj.patel@example.com"}'::jsonb,
    '{}'::jsonb,
    '{"description":"General consultation","treatmentDate":"2026-03-01"}'::jsonb,
    '{"treatmentType":"outpatient","treatmentCountry":"IN","treatmentDate":"2026-03-01","treatmentDescription":"General consultation","reasonForTreatment":"Consultation"}'::jsonb,
    '{"totalClaimed":5000,"claimCurrency":"HKD","currency":"HKD","totalPayable":null,"deductibleApplied":null,"coInsuranceApplied":null,"networkPenaltyApplied":null}'::jsonb,
    NULL,
    0.55,
    now(), now()
  ) RETURNING id INTO v_claim_id;
  INSERT INTO member_claims (id, member_id, claim_id) VALUES (gen_random_uuid(), v_member_ids[6], v_claim_id);
  v_provider_id := NULL;
  SELECT id INTO v_provider_id FROM providers WHERE provider_name = 'Bumrungrad International Hospital' LIMIT 1;
  IF v_provider_id IS NOT NULL THEN
    INSERT INTO provider_claims (id, provider_id, claim_id) VALUES (gen_random_uuid(), v_provider_id, v_claim_id);
  END IF;
  INSERT INTO claim_documents (id, claim_id, file_key, original_filename, mime_type, file_size_bytes, doc_type, processing_status, created_at)
  VALUES (gen_random_uuid(), v_claim_id, 'claims/CLM-2026-QRY01/invoice.pdf', 'CLM-2026-QRY01-invoice.pdf', 'application/pdf', 204800, 'INVOICE', 'COMPLETED', now());
  INSERT INTO audit_events (id, event_type, actor_type, target_type, target_id, action, details, created_at) VALUES
    (gen_random_uuid(), 'INGESTION', 'SYSTEM', 'CLAIM', v_claim_id, 'INGEST_SUCCESS', '{"source":"EMAIL"}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_PROCESS', 'SYSTEM', 'CLAIM', v_claim_id, 'START_PROCESSING', '{}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_VALIDATE', 'SYSTEM', 'CLAIM', v_claim_id, 'COMPLETENESS_CHECKED', '{"score":0.55,"decision":"QUERY_REQUIRED","missingFields":["membershipNumber","firstName","dateOfBirth"]}'::jsonb, now()),
    (gen_random_uuid(), 'VALIDATION_CHECK', 'SYSTEM', 'CLAIM', v_claim_id, 'MANUAL_INTERVENTION_REQUIRED', '{"reason":"Insufficient member identification"}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_CORRESPONDENCE', 'SYSTEM', 'CLAIM', v_claim_id, 'MISSING_INFO_REQUEST_SENT', '{"channel":"EMAIL","recipient":"raj.patel@example.com"}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_STATUS', 'SYSTEM', 'CLAIM', v_claim_id, 'CLAIM_ON_HOLD', '{"reason":"Awaiting member response","newStatus":"QUERYING_MEMBER"}'::jsonb, now());

  -- ── TC-026: Pre-Auth Required (ON_HOLD — Suki Watanabe) ──
  INSERT INTO claims (id, org_id, client_id, team_id, claim_reference, status, priority, assigned_to, claimant, policy, incident, treatment, created_at, updated_at)
  VALUES (
    gen_random_uuid(), v_org_id, v_client1_id, v_team1_id, 'CLM-2026-PA001', 'ON_HOLD', 50, v_admin_user_id,
    '{"membershipNumber":"BI-6007-7890-1234","firstName":"Suki","lastName":"Watanabe","dateOfBirth":"1992-03-22"}'::jsonb,
    '{"planTier":"SELECT","policyNumber":"BI-6007-7890-1234"}'::jsonb,
    '{"description":"Scheduled knee replacement","treatmentDate":"2026-04-15"}'::jsonb,
    '{"treatmentType":"inpatient","treatmentCountry":"JP","treatmentDate":"2026-04-15","practitionerName":"Dr. Kenji Suzuki","facilityName":"Tokyo Medical University Hospital","treatmentDescription":"Total knee replacement surgery","reasonForTreatment":"Osteoarthritis of knee"}'::jsonb,
    now(), now()
  ) RETURNING id INTO v_claim_id;
  INSERT INTO member_claims (id, member_id, claim_id) VALUES (gen_random_uuid(), v_member_ids[8], v_claim_id);
  v_provider_id := NULL;
  SELECT id INTO v_provider_id FROM providers WHERE provider_name = 'Tokyo Medical University Hospital' LIMIT 1;
  IF v_provider_id IS NOT NULL THEN
    INSERT INTO provider_claims (id, provider_id, claim_id) VALUES (gen_random_uuid(), v_provider_id, v_claim_id);
  END IF;
  INSERT INTO claim_documents (id, claim_id, file_key, original_filename, mime_type, file_size_bytes, doc_type, processing_status, created_at)
  VALUES (gen_random_uuid(), v_claim_id, 'claims/CLM-2026-PA001/invoice.pdf', 'CLM-2026-PA001-invoice.pdf', 'application/pdf', 204800, 'INVOICE', 'COMPLETED', now());
  INSERT INTO claim_coding (id, claim_id, code, code_type, description, confidence, is_primary, created_at) VALUES
    (gen_random_uuid(), v_claim_id, 'M17.11', 'ICD10', 'Primary osteoarthritis, right knee', 0.89, true, now()),
    (gen_random_uuid(), v_claim_id, '27447', 'CPT', 'Total knee replacement', 0.91, false, now());
  INSERT INTO audit_events (id, event_type, actor_type, target_type, target_id, action, details, created_at) VALUES
    (gen_random_uuid(), 'INGESTION', 'SYSTEM', 'CLAIM', v_claim_id, 'INGEST_SUCCESS', '{"source":"EMAIL"}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_PROCESS', 'SYSTEM', 'CLAIM', v_claim_id, 'START_PROCESSING', '{}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_VALIDATE', 'SYSTEM', 'CLAIM', v_claim_id, 'PRE_AUTH_REQUIRED', '{"treatmentType":"inpatient","plannedProcedure":"Total knee replacement"}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_CORRESPONDENCE', 'SYSTEM', 'CLAIM', v_claim_id, 'PRE_AUTH_REMINDER_SENT', '{"channel":"EMAIL","recipient":"suki.watanabe@example.com"}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_STATUS', 'SYSTEM', 'CLAIM', v_claim_id, 'CLAIM_ON_HOLD', '{"reason":"Awaiting pre-authorisation","newStatus":"ON_HOLD"}'::jsonb, now());

  -- ── TC-010: Diagnosis-Procedure Mismatch (ESCALATED_CLINICAL — Li Wei) ──
  INSERT INTO claims (id, org_id, client_id, team_id, claim_reference, status, priority, assigned_to, claimant, policy, incident, treatment, overall_confidence, created_at, updated_at)
  VALUES (
    gen_random_uuid(), v_org_id, v_client1_id, v_team1_id, 'CLM-2026-ESC01', 'ESCALATED_CLINICAL', 50, v_admin_user_id,
    '{"membershipNumber":"BI-6008-8901-2345","firstName":"Li","lastName":"Wei","dateOfBirth":"1968-05-30"}'::jsonb,
    '{"planTier":"ULTIMATE","policyNumber":"BI-6008-8901-2345"}'::jsonb,
    '{"description":"Knee surgery with mismatched gallstone diagnosis","treatmentDate":"2026-03-20"}'::jsonb,
    '{"treatmentType":"inpatient","treatmentCountry":"SG","treatmentDate":"2026-03-20","admissionDate":"2026-03-20","dischargeDate":"2026-03-22","practitionerName":"Dr. Tan Wei Lin","facilityName":"Mount Elizabeth Hospital","treatmentDescription":"Total knee replacement surgery","reasonForTreatment":"Gallstones (diagnosis does not match procedure)"}'::jsonb,
    0.42, now(), now()
  ) RETURNING id INTO v_claim_id;
  INSERT INTO member_claims (id, member_id, claim_id) VALUES (gen_random_uuid(), v_member_ids[9], v_claim_id);
  v_provider_id := NULL;
  SELECT id INTO v_provider_id FROM providers WHERE provider_name = 'Mount Elizabeth Hospital' LIMIT 1;
  IF v_provider_id IS NOT NULL THEN
    INSERT INTO provider_claims (id, provider_id, claim_id) VALUES (gen_random_uuid(), v_provider_id, v_claim_id);
  END IF;
  INSERT INTO claim_documents (id, claim_id, file_key, original_filename, mime_type, file_size_bytes, doc_type, processing_status, created_at)
  VALUES (gen_random_uuid(), v_claim_id, 'claims/CLM-2026-ESC01/invoice.pdf', 'CLM-2026-ESC01-invoice.pdf', 'application/pdf', 204800, 'INVOICE', 'COMPLETED', now());
  INSERT INTO claim_coding (id, claim_id, code, code_type, description, confidence, is_primary, created_at) VALUES
    (gen_random_uuid(), v_claim_id, 'K80.10', 'ICD10', 'Calculus of gallbladder with chronic cholecystitis', 0.85, true, now()),
    (gen_random_uuid(), v_claim_id, '27447', 'CPT', 'Total knee replacement', 0.87, false, now());
  INSERT INTO audit_events (id, event_type, actor_type, target_type, target_id, action, details, created_at) VALUES
    (gen_random_uuid(), 'INGESTION', 'SYSTEM', 'CLAIM', v_claim_id, 'INGEST_SUCCESS', '{"source":"EMAIL"}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_PROCESS', 'SYSTEM', 'CLAIM', v_claim_id, 'START_PROCESSING', '{}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_CODING', 'SYSTEM', 'CLAIM', v_claim_id, 'CODES_EXTRACTED', '{"icd10":["K80.10"],"cpt":["27447"],"primaryCode":"K80.10"}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_VALIDATE', 'SYSTEM', 'CLAIM', v_claim_id, 'CLINICAL_VALIDATED', '{"score":0.42,"decision":"CLINICAL_REVIEW_REQUIRED","reason":"Diagnosis/procedure mismatch"}'::jsonb, now()),
    (gen_random_uuid(), 'VALIDATION_CHECK', 'SYSTEM', 'CLAIM', v_claim_id, 'MANUAL_INTERVENTION_REQUIRED', '{"escalateTo":"CLINICAL_REVIEWER"}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_STATUS', 'SYSTEM', 'CLAIM', v_claim_id, 'CLAIM_ON_HOLD', '{"reason":"Escalated to clinical reviewer","newStatus":"ESCALATED_CLINICAL"}'::jsonb, now());

  -- ── TC-018: FX Conversion Claim (Raj Patel, PREMIER) ──
  INSERT INTO claims (id, org_id, client_id, team_id, claim_reference, status, priority, assigned_to, claimant, policy, incident, treatment, financials, coverage_analysis, overall_confidence, completed_at, created_at, updated_at)
  VALUES (
    gen_random_uuid(), v_org_id, v_client1_id, v_team1_id, 'CLM-2026-FX001', 'COMPLETE', 50, v_admin_user_id,
    '{"membershipNumber":"BI-6005-5678-9012","firstName":"Raj","lastName":"Patel","dateOfBirth":"1982-04-18"}'::jsonb,
    '{"planTier":"PREMIER","policyNumber":"BI-6005-5678-9012","deductible":{"total":1500,"used":0,"remaining":1500}}'::jsonb,
    '{"description":"General surgery consultation while travelling","treatmentDate":"2026-03-25"}'::jsonb,
    '{"treatmentType":"outpatient","treatmentCountry":"TH","treatmentDate":"2026-03-25","practitionerName":"Dr. Somchai Jiravong","facilityName":"Bumrungrad International Hospital","treatmentDescription":"Consultation and diagnostic imaging","reasonForTreatment":"Abdominal pain evaluation"}'::jsonb,
    $json${"totalClaimed":78000,"claimCurrency":"HKD","currency":"HKD","totalPayable":7749.45,"paymentCurrency":"GBP","deductibleApplied":1500,"coInsuranceApplied":0,"networkPenaltyApplied":0,"fxRate":0.1013,"fxRateDescription":"GBP/HKD via USD pivot: 0.79 / 7.82","itemisedCharges":[{"description":"Specialist consultation","amount":18000,"covered":true},{"description":"CT scan abdomen","amount":35000,"covered":true},{"description":"Blood panel","amount":15000,"covered":true},{"description":"Ultrasound","amount":10000,"covered":true}],"payeeType":"MEMBER","paymentMethod":"BANK_TRANSFER","eobSummary":"EXPLANATION OF BENEFITS\nMember: Raj Patel (BI-6005-5678-9012)\nPlan: PREMIER\n\nTotal Claimed: HKD 78,000.00\nDeductible Applied: HKD 1,500.00\nAfter Deductible: HKD 76,500.00\nFX Rate: 0.1013 (HKD to GBP)\nPayment Amount: GBP 7,749.45\n---\nTotal Payable: GBP 7,749.45"}$json$::jsonb,
    '{"decision":"PARTIALLY_COVERED","planTier":"PREMIER","annualMaximum":{"limit":5000000,"currency":"USD"},"exclusionsTriggered":[],"fxConversion":{"from":"HKD","to":"GBP","rate":0.1013}}'::jsonb,
    0.86, '2026-03-25T14:00:00Z', now(), now()
  ) RETURNING id INTO v_claim_id;
  INSERT INTO member_claims (id, member_id, claim_id) VALUES (gen_random_uuid(), v_member_ids[6], v_claim_id);
  v_provider_id := NULL;
  SELECT id INTO v_provider_id FROM providers WHERE provider_name = 'Bumrungrad International Hospital' LIMIT 1;
  IF v_provider_id IS NOT NULL THEN
    INSERT INTO provider_claims (id, provider_id, claim_id) VALUES (gen_random_uuid(), v_provider_id, v_claim_id);
  END IF;
  INSERT INTO claim_documents (id, claim_id, file_key, original_filename, mime_type, file_size_bytes, doc_type, processing_status, created_at)
  VALUES (gen_random_uuid(), v_claim_id, 'claims/CLM-2026-FX001/invoice.pdf', 'CLM-2026-FX001-invoice.pdf', 'application/pdf', 204800, 'INVOICE', 'COMPLETED', now());
  INSERT INTO claim_coding (id, claim_id, code, code_type, description, confidence, is_primary, created_at) VALUES
    (gen_random_uuid(), v_claim_id, 'R10.9', 'ICD10', 'Unspecified abdominal pain', 0.84, true, now()),
    (gen_random_uuid(), v_claim_id, '99213', 'CPT', 'Office/outpatient visit', 0.88, false, now()),
    (gen_random_uuid(), v_claim_id, '74177', 'CPT', 'CT abdomen with contrast', 0.90, false, now());
  INSERT INTO audit_events (id, event_type, actor_type, target_type, target_id, action, details, created_at) VALUES
    (gen_random_uuid(), 'INGESTION', 'SYSTEM', 'CLAIM', v_claim_id, 'INGEST_SUCCESS', '{"source":"EMAIL"}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_PROCESS', 'SYSTEM', 'CLAIM', v_claim_id, 'START_PROCESSING', '{}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_EXTRACT', 'SYSTEM', 'CLAIM', v_claim_id, 'FINANCIALS_EXTRACTED', '{"totalClaimed":78000,"currency":"HKD","lineItemCount":4}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_CODING', 'SYSTEM', 'CLAIM', v_claim_id, 'CODES_EXTRACTED', '{"icd10":["R10.9"],"cpt":["99213","74177"],"primaryCode":"R10.9"}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_COVERAGE', 'SYSTEM', 'CLAIM', v_claim_id, 'COVERAGE_CALCULATED', '{"decision":"PARTIALLY_COVERED","deductibleApplied":1500}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_FINANCIALS', 'SYSTEM', 'CLAIM', v_claim_id, 'FX_CONVERSION_APPLIED', '{"fromCurrency":"HKD","toCurrency":"GBP","rate":0.1013,"sourceAmount":76500,"convertedAmount":7749.45}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_ADJUDICATE', 'SYSTEM', 'CLAIM', v_claim_id, 'DECISION_MADE', '{"decision":"APPROVED","payeeType":"MEMBER"}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_EDI', 'SYSTEM', 'CLAIM', v_claim_id, 'EDI_GENERATED', '{"ediType":"837P"}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_STATUS', 'SYSTEM', 'CLAIM', v_claim_id, 'CLAIM_COMPLETE', '{"stp":true}'::jsonb, now());

  -- ── EXTRACTING state (Hans Mueller) ──
  INSERT INTO claims (id, org_id, client_id, team_id, claim_reference, status, priority, assigned_to, claimant, policy, incident, treatment, created_at, updated_at)
  VALUES (
    gen_random_uuid(), v_org_id, v_client1_id, v_team1_id, 'CLM-2026-EXT01', 'EXTRACTING', 50, v_admin_user_id,
    '{"membershipNumber":"BI-6006-6789-0123","firstName":"Hans","lastName":"Mueller"}'::jsonb,
    '{"planTier":"ELITE"}'::jsonb,
    '{"description":"Emergency room visit","treatmentDate":"2026-04-01"}'::jsonb,
    '{"treatmentType":"outpatient","treatmentCountry":"AE","treatmentDate":"2026-04-01","facilityName":"American Hospital Dubai"}'::jsonb,
    now(), now()
  ) RETURNING id INTO v_claim_id;
  INSERT INTO member_claims (id, member_id, claim_id) VALUES (gen_random_uuid(), v_member_ids[7], v_claim_id);
  v_provider_id := NULL;
  SELECT id INTO v_provider_id FROM providers WHERE provider_name = 'American Hospital Dubai' LIMIT 1;
  IF v_provider_id IS NOT NULL THEN
    INSERT INTO provider_claims (id, provider_id, claim_id) VALUES (gen_random_uuid(), v_provider_id, v_claim_id);
  END IF;
  INSERT INTO claim_documents (id, claim_id, file_key, original_filename, mime_type, file_size_bytes, doc_type, processing_status, created_at)
  VALUES (gen_random_uuid(), v_claim_id, 'claims/CLM-2026-EXT01/invoice.pdf', 'CLM-2026-EXT01-invoice.pdf', 'application/pdf', 204800, 'INVOICE', 'COMPLETED', now());
  INSERT INTO audit_events (id, event_type, actor_type, target_type, target_id, action, details, created_at) VALUES
    (gen_random_uuid(), 'INGESTION', 'SYSTEM', 'CLAIM', v_claim_id, 'INGEST_SUCCESS', '{"source":"EMAIL"}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_PROCESS', 'SYSTEM', 'CLAIM', v_claim_id, 'START_PROCESSING', '{"stage":"EXTRACTING"}'::jsonb, now());

  -- ── CODING state (Johnny Depp) ──
  INSERT INTO claims (id, org_id, client_id, team_id, claim_reference, status, priority, assigned_to, claimant, policy, incident, treatment, created_at, updated_at)
  VALUES (
    gen_random_uuid(), v_org_id, v_client1_id, v_team1_id, 'CLM-2026-COD01', 'CODING', 50, v_admin_user_id,
    '{"membershipNumber":"BI-6000-9000-9009","firstName":"Johnny","lastName":"Depp"}'::jsonb,
    '{"planTier":"PREMIER"}'::jsonb,
    '{"description":"Orthopaedic consultation","treatmentDate":"2026-04-05"}'::jsonb,
    '{"treatmentType":"outpatient","treatmentCountry":"HK","treatmentDate":"2026-04-05","practitionerName":"Dr. Wong Kai Fai","facilityName":"Hong Kong Sanatorium & Hospital","treatmentDescription":"Knee pain assessment and X-ray","reasonForTreatment":"Knee pain"}'::jsonb,
    now(), now()
  ) RETURNING id INTO v_claim_id;
  INSERT INTO member_claims (id, member_id, claim_id) VALUES (gen_random_uuid(), v_member_ids[1], v_claim_id);
  v_provider_id := NULL;
  SELECT id INTO v_provider_id FROM providers WHERE provider_name = 'Hong Kong Sanatorium & Hospital' LIMIT 1;
  IF v_provider_id IS NOT NULL THEN
    INSERT INTO provider_claims (id, provider_id, claim_id) VALUES (gen_random_uuid(), v_provider_id, v_claim_id);
  END IF;
  INSERT INTO claim_documents (id, claim_id, file_key, original_filename, mime_type, file_size_bytes, doc_type, processing_status, created_at)
  VALUES (gen_random_uuid(), v_claim_id, 'claims/CLM-2026-COD01/invoice.pdf', 'CLM-2026-COD01-invoice.pdf', 'application/pdf', 204800, 'INVOICE', 'COMPLETED', now());
  INSERT INTO audit_events (id, event_type, actor_type, target_type, target_id, action, details, created_at) VALUES
    (gen_random_uuid(), 'INGESTION', 'SYSTEM', 'CLAIM', v_claim_id, 'INGEST_SUCCESS', '{"source":"EMAIL"}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_PROCESS', 'SYSTEM', 'CLAIM', v_claim_id, 'START_PROCESSING', '{"stage":"CODING"}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_EXTRACT', 'SYSTEM', 'CLAIM', v_claim_id, 'FINANCIALS_EXTRACTED', '{"language":"english"}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_CODING', 'SYSTEM', 'CLAIM', v_claim_id, 'CODING_STARTED', '{"engine":"bedrock-claude","stage":"IN_PROGRESS"}'::jsonb, now());

  -- ── REVIEWING state (Ahmed Al-Rashid) ──
  INSERT INTO claims (id, org_id, client_id, team_id, claim_reference, status, priority, assigned_to, claimant, policy, incident, treatment, financials, coverage_analysis, overall_confidence, created_at, updated_at)
  VALUES (
    gen_random_uuid(), v_org_id, v_client1_id, v_team1_id, 'CLM-2026-REV01', 'REVIEWING', 50, v_admin_user_id,
    '{"membershipNumber":"BI-6002-2345-6789","firstName":"Ahmed","lastName":"Al-Rashid"}'::jsonb,
    '{"planTier":"ELITE","deductible":{"total":4000,"used":4000,"remaining":0}}'::jsonb,
    '{"description":"Follow-up cardiology visit","treatmentDate":"2026-04-02"}'::jsonb,
    '{"treatmentType":"outpatient","treatmentCountry":"AE","treatmentDate":"2026-04-02","practitionerName":"Dr. Khalid Mansour","facilityName":"American Hospital Dubai","treatmentDescription":"Cardiology follow-up and echocardiogram","reasonForTreatment":"Hypertension monitoring"}'::jsonb,
    $json${"totalClaimed":15000,"claimCurrency":"AED","currency":"AED","totalPayable":15000,"paymentCurrency":"AED","deductibleApplied":0,"coInsuranceApplied":0,"networkPenaltyApplied":0,"itemisedCharges":[{"description":"Cardiology consultation","amount":5000,"covered":true},{"description":"Echocardiogram","amount":8000,"covered":true},{"description":"Blood work","amount":2000,"covered":true}],"payeeType":"MEMBER","paymentMethod":"BANK_TRANSFER","eobSummary":"EXPLANATION OF BENEFITS\nTotal Claimed: AED 15,000.00\nDeductible: AED 0.00 (already met)\n---\nTotal Payable: AED 15,000.00"}$json$::jsonb,
    '{"decision":"FULLY_COVERED","planTier":"ELITE"}'::jsonb,
    0.91, now(), now()
  ) RETURNING id INTO v_claim_id;
  INSERT INTO member_claims (id, member_id, claim_id) VALUES (gen_random_uuid(), v_member_ids[3], v_claim_id);
  v_provider_id := NULL;
  SELECT id INTO v_provider_id FROM providers WHERE provider_name = 'American Hospital Dubai' LIMIT 1;
  IF v_provider_id IS NOT NULL THEN
    INSERT INTO provider_claims (id, provider_id, claim_id) VALUES (gen_random_uuid(), v_provider_id, v_claim_id);
  END IF;
  INSERT INTO claim_documents (id, claim_id, file_key, original_filename, mime_type, file_size_bytes, doc_type, processing_status, created_at)
  VALUES (gen_random_uuid(), v_claim_id, 'claims/CLM-2026-REV01/invoice.pdf', 'CLM-2026-REV01-invoice.pdf', 'application/pdf', 204800, 'INVOICE', 'COMPLETED', now());
  INSERT INTO claim_coding (id, claim_id, code, code_type, description, confidence, is_primary, created_at) VALUES
    (gen_random_uuid(), v_claim_id, 'I10', 'ICD10', 'Essential (primary) hypertension', 0.93, true, now()),
    (gen_random_uuid(), v_claim_id, '93306', 'CPT', 'Echocardiography, transthoracic', 0.89, false, now());
  INSERT INTO audit_events (id, event_type, actor_type, target_type, target_id, action, details, created_at) VALUES
    (gen_random_uuid(), 'INGESTION', 'SYSTEM', 'CLAIM', v_claim_id, 'INGEST_SUCCESS', '{"source":"EMAIL"}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_PROCESS', 'SYSTEM', 'CLAIM', v_claim_id, 'START_PROCESSING', '{}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_CODING', 'SYSTEM', 'CLAIM', v_claim_id, 'CODES_EXTRACTED', '{"icd10":["I10"],"cpt":["93306"],"primaryCode":"I10"}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_COVERAGE', 'SYSTEM', 'CLAIM', v_claim_id, 'COVERAGE_CALCULATED', '{"decision":"FULLY_COVERED","totalPayable":15000}'::jsonb, now()),
    (gen_random_uuid(), 'CLAIM_STATUS_CHANGE', 'SYSTEM', 'CLAIM', v_claim_id, 'STATUS_CHANGED', '{"previousStatus":"BUILDING","newStatus":"REVIEWING","reason":"Manual review queue"}'::jsonb, now());

END $seed$;

COMMIT;
