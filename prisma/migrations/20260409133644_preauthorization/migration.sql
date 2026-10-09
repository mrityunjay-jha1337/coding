-- CreateEnum
CREATE TYPE "PreAuthStatus" AS ENUM ('REQUESTED', 'APPROVED', 'DENIED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AppealStatus" AS ENUM ('SUBMITTED', 'UNDER_REVIEW', 'UPHELD', 'OVERTURNED');

-- CreateTable
CREATE TABLE "pre_authorizations" (
    "id" TEXT NOT NULL,
    "claim_id" TEXT,
    "member_id" TEXT NOT NULL,
    "requested_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_date" TIMESTAMP(3),
    "denied_date" TIMESTAMP(3),
    "status" "PreAuthStatus" NOT NULL DEFAULT 'REQUESTED',
    "treatment_type" TEXT NOT NULL,
    "authorized_amount" DOUBLE PRECISION,
    "authorized_procedures" JSONB NOT NULL DEFAULT '[]',
    "authorization_number" TEXT,
    "valid_from" TIMESTAMP(3),
    "valid_to" TIMESTAMP(3),
    "requested_by" TEXT NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pre_authorizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appeals" (
    "id" TEXT NOT NULL,
    "claim_id" TEXT NOT NULL,
    "appeal_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT NOT NULL,
    "supporting_docs" JSONB NOT NULL DEFAULT '[]',
    "status" "AppealStatus" NOT NULL DEFAULT 'SUBMITTED',
    "reviewed_by" TEXT,
    "review_date" TIMESTAMP(3),
    "outcome" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appeals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pre_authorizations_authorization_number_key" ON "pre_authorizations"("authorization_number");

-- CreateIndex
CREATE INDEX "pre_authorizations_member_id_idx" ON "pre_authorizations"("member_id");

-- CreateIndex
CREATE INDEX "pre_authorizations_claim_id_idx" ON "pre_authorizations"("claim_id");

-- CreateIndex
CREATE INDEX "pre_authorizations_authorization_number_idx" ON "pre_authorizations"("authorization_number");

-- CreateIndex
CREATE INDEX "appeals_claim_id_idx" ON "appeals"("claim_id");
