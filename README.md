# Genpact ICD-10 Claim Processing System: Technical Architecture & Pipeline

This document provides a deep, modular breakdown of the Genpact ICD-10 Claim Processing System. The system is designed as a highly scalable, event-driven, and distributed microservices architecture tailored for medical Revenue Cycle Mapanagement (RCM).

---

## 🏗️ 1. High-Level Architecture Overview

The system transitions away from a monolithic Express application into isolated, horizontally scalable containers coordinated via Docker Compose.

### Core Microservices

1. **API Service (`api`)**: A stateless Node.js/Express server exposing REST/GraphQL endpoints for the frontend UI. It strictly handles reads/writes to the database and dispatches jobs. It does *not* execute heavy computational tasks.
2. **Ingestion Worker (`worker-ingestion`)**: A BullMQ consumer dedicated exclusively to polling Gmail, classifying inbound correspondence, deduplication, and deterministic routing.
3. **Processing Worker (`worker-processing`)**: A heavy-compute BullMQ consumer that orchestrates a Directed Acyclic Graph (DAG) for OCR extraction, clinical translation, ICD-10 medical coding (via Claude 3.5 Sonnet), and claim adjudication.

### Core Infrastructure

* **PostgreSQL (`db`)**: The primary source of truth, managing relational data (Claims, Correspondences, Organizations).
* **Redis**: Powers BullMQ for distributed job queues, rate limiting, and cron scheduling.
* **Shared Storage Volume (`uploads`)**: All attachments (PDFs/Images) are streamed to a shared volume accessible by all workers, mimicking production cloud storage (AWS S3).

---

## 📥 2. Module: The Ingestion & Routing Pipeline

The `worker-ingestion` service is the gatekeeper. It must handle messy, real-world inbox traffic (`claims@genpact.com`) and route it precisely without hallucination.

### 2.1 Deduplication

Before any AI runs, the system calculates a SHA-256 hash of the email body and attachments. If a matching hash exists in the database within a specific timeframe, the email is dropped as a duplicate to save compute costs.

### 2.2 Classification (The AI Gatekeeper)

To prevent wasting expensive OCR compute on spam or complaints, the `ClassificationAgent` determines the correspondence type.

1. **Dynamic Rules**: Hard-coded exclusions (e.g., `sender == newsletter@hospital.com`) bypass the AI and immediately flag the email as `NOT_A_CLAIM`.
2. **AI Classification**: Uses a lightweight model (e.g., Claude 3 Haiku) to classify the email into strict enums: `FNOL` (New Claim), `INVOICE`, `SUPPORTING_DOC`, `STATUS_ENQUIRY`, `COMPLAINT`, `SOLICITOR_CORRESPONDENCE`, or `NOT_A_CLAIM`.
3. **Priority Tagging**: The AI assigns a priority (`urgent`, `high`, `normal`, `low`). For example, legal complaints receive `urgent` priority, forcing them to the front of the BullMQ queue.

### 2.3 Deterministic Routing (Anti-Hallucination)

The system avoids "fuzzy AI matching" for routing. It uses a strict hierarchy to map an email to a Claim ID:

```typescript
// 1. Thread Match (Highest Confidence)
if (existingThreadMatch) {
  claimId = existingThreadMatch.claim.id;
} 
// 2. Strict Regex Matching (CLM-XXXX)
else if (regexExtractedRefs.length > 0) {
  claimId = findClaimInDb(regexExtractedRefs);
} 
// 3. Triage / New Claim (Lowest Confidence)
else {
  claimId = createNewClaimForHumanReview();
}
```

### 2.4 Queue Dispatch

Once routed and attachments are saved to the shared volume, the job is pushed to the `processingQueue`.

```typescript
await processingQueue.add('process-claim', jobData, {
  priority: queuePriority // e.g., 1 for Solicitor emails to jump the queue
});
```

---

## ⚙️ 3. Module: The Processing DAG

The `worker-processing` service picks up the job. This is where the heavy clinical and financial logic resides, powered primarily by frontier models like Claude 3.5 Sonnet.

### 3.1 Step 1: Extraction (OCR & Vision)

* **Action**: The system loads the raw PDFs/Images from the shared `uploads` volume.
* **Execution**: It feeds the raw bytes into a Multimodal AI (Claude 3.5 Sonnet Vision). The model is instructed to extract structured JSON containing patient details, provider details, clinical notes, and line-item invoice amounts.
* **State Update**: Claim status moves to `EXTRACTING`.

### 3.2 Step 2: Language Detection & Translation

* **Action**: Medical claims may originate globally (e.g., Mandarin, Spanish).
* **Execution**: The AI detects the source language. If it is non-English, it performs a zero-shot translation of the clinical notes and diagnoses into standard English medical terminology to ensure accurate coding in the next step.
* **State Update**: Claim status moves to `TRANSLATING`.

### 3.3 Step 3: Medical Coding (ICD-10)

* **Action**: Converting written diagnoses into standardized alphanumeric ICD-10 codes.
* **Data Source**: The API pre-loads the official `icd10-codes.json` dataset from S3 (or bundled local fallback) into memory on boot.
* **Execution**: The AI acts as a medical coder, reasoning through the translated clinical text (e.g., distinguishing between "initial encounter" vs "subsequent encounter") and mapping it to the exact ICD-10 code.
* **State Update**: Claim status moves to `CODING`.

### 3.4 Step 4: Rule-Based Validation

Before final adjudication, the system runs strict deterministic validations against the extracted data.

* **Member Eligibility (`memberValidation.service.ts`)**: Queries the DB to ensure the member's policy was active on the date of service.
* **Provider Validation (`providerValidation.service.ts`)**: Verifies the hospital/doctor is in-network or recognized.
* **Completeness Check`: Ensures signatures and mandatory financial fields are present.

### 3.5 Step 5: The Adjudication Engine (Decision Logic)

The final step synthesizes the AI's confidence score with the hard validation rules to determine the claim's fate.

```typescript
// Example Adjudication Logic Flow
const eligibilityExplicitlyFailed = bupaResults.eligibilityChecked && !bupaResults.eligibilityPassed;
const manualReviewRequired = bupaResults.manualInterventionRequired || confidenceScore < 85;

let finalStatus: string;
if (bupaResults.isDuplicate) {
  finalStatus = 'DUPLICATE';
} else if (bupaResults.autoDenied) {
  finalStatus = 'DENIED';
} else if (eligibilityExplicitlyFailed || manualReviewRequired) {
  finalStatus = 'REVIEWING'; // Hard block: Escalate to a human adjudicator
} else if (bupaResults.shouldHold) {
  finalStatus = 'ON_HOLD'; // Waiting for a Query Response
} else {
  finalStatus = 'COMPLETE'; // Auto-approved for payment
}

await updateClaimStatus(claimId, finalStatus);
```

---

## 🛡️ 4. Resilience & Error Handling

### 4.1 Job Retries (BullMQ)

Cloud APIs (AWS Bedrock, Gmail API) are prone to rate-limiting and timeouts. The workers utilize BullMQ's exponential backoff. If AWS Bedrock throws a `503 Service Unavailable`, the job is marked as `failed`, returned to the queue, and retried automatically.

### 4.2 Application State Boundaries

* **Fail-Fast Startup**: If the API cannot fetch the critical ICD-10 S3 dataset on boot, it executes `process.exit(1)` rather than starting as a "zombie" instance that miscodes claims.
* **Strict Env Validation**: The system uses Zod to validate `process.env` on startup. If `JWT_ACCESS_SECRET` is missing, the container refuses to boot, preventing runtime cryptographic crashes.

### 4.3 Cron Management

Scheduled tasks (like renewing Gmail Pub/Sub watches) are handled via BullMQ Repeatable Jobs (Redis Distributed Locks) rather than simple `setInterval` loops. This ensures that even if you scale to 50 ingestion workers, the cron job is only executed exactly once per interval.
