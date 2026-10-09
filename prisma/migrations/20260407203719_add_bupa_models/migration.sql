-- CreateEnum
CREATE TYPE "PlanTier" AS ENUM ('MAJOR_MEDICAL', 'SELECT', 'PREMIER', 'ELITE', 'ULTIMATE');

-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'LAPSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NetworkOption" AS ENUM ('STANDARD', 'COMPREHENSIVE');

-- CreateEnum
CREATE TYPE "GeoCover" AS ENUM ('WORLDWIDE', 'WORLDWIDE_EXCL_US');

-- CreateEnum
CREATE TYPE "ProviderType" AS ENUM ('HOSPITAL', 'CLINIC', 'PRACTITIONER', 'LABORATORY', 'PHARMACY');

-- CreateEnum
CREATE TYPE "ProviderNetwork" AS ENUM ('IN_NETWORK', 'OUT_OF_NETWORK', 'PENDING_VERIFICATION');

-- CreateEnum
CREATE TYPE "AccreditationStatus" AS ENUM ('ACCREDITED', 'PENDING', 'SUSPENDED', 'REVOKED');

-- CreateTable
CREATE TABLE "health_plans" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tier" "PlanTier" NOT NULL,
    "annual_maximum_usd" DOUBLE PRECISION,
    "annual_maximum_hkd" DOUBLE PRECISION,
    "geographic_options" JSONB NOT NULL DEFAULT '[]',
    "network_options" JSONB NOT NULL DEFAULT '[]',
    "deductible_options" JSONB NOT NULL DEFAULT '[]',
    "co_insurance_option" JSONB,
    "benefits" JSONB NOT NULL DEFAULT '{}',
    "exclusions" JSONB NOT NULL DEFAULT '[]',
    "waiting_periods" JSONB NOT NULL DEFAULT '{}',
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_to" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "health_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_groups" (
    "id" TEXT NOT NULL,
    "group_name" TEXT NOT NULL,
    "company_name" TEXT NOT NULL,
    "contact_email" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "members" (
    "id" TEXT NOT NULL,
    "membership_number" TEXT NOT NULL,
    "group_id" TEXT,
    "title" TEXT,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "date_of_birth" TIMESTAMP(3) NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "address" JSONB NOT NULL DEFAULT '{}',
    "preferred_language" TEXT NOT NULL DEFAULT 'en',
    "plan_id" TEXT NOT NULL,
    "plan_tier" "PlanTier" NOT NULL,
    "policy_start_date" TIMESTAMP(3) NOT NULL,
    "policy_end_date" TIMESTAMP(3) NOT NULL,
    "deductible_amount" DOUBLE PRECISION,
    "deductible_currency" TEXT,
    "deductible_used" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "co_insurance_rate" DOUBLE PRECISION,
    "network_option" "NetworkOption" NOT NULL DEFAULT 'STANDARD',
    "geographic_cover" "GeoCover" NOT NULL DEFAULT 'WORLDWIDE',
    "pre_existing_conditions" JSONB NOT NULL DEFAULT '[]',
    "status" "MemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "renewal_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_details" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "payee_type" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "bank_name" TEXT,
    "swift_code" TEXT,
    "account_number" TEXT,
    "sort_code" TEXT,
    "iban" TEXT,
    "account_holder_name" TEXT,
    "account_currency" TEXT,
    "cheque_currency" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "providers" (
    "id" TEXT NOT NULL,
    "provider_name" TEXT NOT NULL,
    "facility_name" TEXT,
    "provider_type" "ProviderType" NOT NULL,
    "specialty" JSONB NOT NULL DEFAULT '[]',
    "license_number" TEXT,
    "address" JSONB NOT NULL DEFAULT '{}',
    "email" TEXT,
    "phone" TEXT,
    "bank_details" TEXT,
    "network_status" "ProviderNetwork" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "network_type" "NetworkOption" NOT NULL DEFAULT 'STANDARD',
    "bupa_provider_id" TEXT,
    "accreditation_status" "AccreditationStatus" NOT NULL DEFAULT 'PENDING',
    "country" TEXT NOT NULL,
    "default_currency" TEXT,
    "last_verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_network_mapping" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "plan_tier" "PlanTier" NOT NULL,
    "is_in_network" BOOLEAN NOT NULL,
    "negotiated_rates" JSONB,

    CONSTRAINT "provider_network_mapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_claims" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "claim_id" TEXT NOT NULL,

    CONSTRAINT "member_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_claims" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "claim_id" TEXT NOT NULL,

    CONSTRAINT "provider_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coverage_decisions" (
    "id" TEXT NOT NULL,
    "claim_id" TEXT NOT NULL,
    "line_item_index" INTEGER NOT NULL,
    "benefit_name" TEXT NOT NULL,
    "is_covered" BOOLEAN NOT NULL,
    "coverage_limit" DOUBLE PRECISION,
    "amount_claimed" DOUBLE PRECISION NOT NULL,
    "amount_payable" DOUBLE PRECISION NOT NULL,
    "deductible_applied" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "co_insurance_applied" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "network_penalty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "denial_reason" TEXT,
    "exclusion_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coverage_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "edi_transactions" (
    "id" TEXT NOT NULL,
    "claim_id" TEXT NOT NULL,
    "edi_type" TEXT NOT NULL,
    "edi_content" TEXT NOT NULL,
    "control_number" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'GENERATED',
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "edi_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "members_membership_number_key" ON "members"("membership_number");

-- CreateIndex
CREATE INDEX "members_membership_number_idx" ON "members"("membership_number");

-- CreateIndex
CREATE INDEX "members_plan_id_idx" ON "members"("plan_id");

-- CreateIndex
CREATE INDEX "payment_details_member_id_idx" ON "payment_details"("member_id");

-- CreateIndex
CREATE INDEX "providers_provider_name_idx" ON "providers"("provider_name");

-- CreateIndex
CREATE INDEX "providers_country_idx" ON "providers"("country");

-- CreateIndex
CREATE UNIQUE INDEX "provider_network_mapping_provider_id_plan_tier_key" ON "provider_network_mapping"("provider_id", "plan_tier");

-- CreateIndex
CREATE INDEX "member_claims_claim_id_idx" ON "member_claims"("claim_id");

-- CreateIndex
CREATE UNIQUE INDEX "member_claims_member_id_claim_id_key" ON "member_claims"("member_id", "claim_id");

-- CreateIndex
CREATE INDEX "provider_claims_claim_id_idx" ON "provider_claims"("claim_id");

-- CreateIndex
CREATE UNIQUE INDEX "provider_claims_provider_id_claim_id_key" ON "provider_claims"("provider_id", "claim_id");

-- CreateIndex
CREATE INDEX "coverage_decisions_claim_id_idx" ON "coverage_decisions"("claim_id");

-- CreateIndex
CREATE INDEX "edi_transactions_claim_id_idx" ON "edi_transactions"("claim_id");

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "health_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "member_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_details" ADD CONSTRAINT "payment_details_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_network_mapping" ADD CONSTRAINT "provider_network_mapping_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_claims" ADD CONSTRAINT "member_claims_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_claims" ADD CONSTRAINT "provider_claims_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
