-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ClaimStatus" ADD VALUE 'QUERYING_MEMBER';
ALTER TYPE "ClaimStatus" ADD VALUE 'QUERYING_PROVIDER';
ALTER TYPE "ClaimStatus" ADD VALUE 'ESCALATED_HANDLER';
ALTER TYPE "ClaimStatus" ADD VALUE 'ESCALATED_CLINICAL';
ALTER TYPE "ClaimStatus" ADD VALUE 'DENIED';
