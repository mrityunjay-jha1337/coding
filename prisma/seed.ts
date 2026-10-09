import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();

const adapter = new PrismaPg(process.env.DATABASE_URL!);
const prisma = new PrismaClient({ adapter });

// ─── SYSTEM ROLES ────────────────────────────────────────

const SYSTEM_ROLES = {
  SUPER_ADMIN: ['*'],
  BPO_ADMIN: [
    'users:create', 'users:read', 'users:update', 'users:delete',
    'teams:create', 'teams:read', 'teams:update', 'teams:delete',
    'clients:create', 'clients:read', 'clients:update',
    'claims:read', 'claims:update', 'claims:delete', 'claims:reassign', 'claims:override',
    'config:read', 'config:update',
    'analytics:read', 'analytics:export', 'analytics:custom',
    'audit:read', 'audit:compliance',
    'connectors:manage',
    'billing:read',
  ],
  TEAM_LEAD: [
    'users:read:team', 'users:invite:team',
    'claims:read:team', 'claims:reassign:team', 'claims:override:team', 'claims:escalate',
    'claims:quality_review:team',
    'config:read:team', 'config:update:team',
    'analytics:read:team', 'analytics:export:team',
    'audit:read:team',
    'notifications:manage:team',
  ],
  BPO_USER: [
    'claims:read:assigned', 'claims:read:queue',
    'claims:self_assign', 'claims:process', 'claims:review_coding',
    'claims:add_notes', 'claims:reprocess', 'claims:escalate',
    'correspondence:read:assigned', 'correspondence:draft', 'correspondence:send',
    'analytics:read:own',
    'audit:read:own',
  ],
  CLIENT: [
    'claims:read:own', 'claims:download:own', 'claims:comment:own', 'claims:flag:own',
    'analytics:read:own', 'analytics:export:own',
    'audit:read:own',
    'config:update:own_preferences',
  ],
};

// ─── HEALTH PLAN BENEFIT TEMPLATES ───────────────────────

function createMajorMedicalBenefits() {
  return {
    outPatientDayCare: { covered: true, limit: 'Reasonable and customary charges', subLimit: null },
    outPatientSurgical: { covered: true, limit: 'Reasonable and customary charges', subLimit: null },
    pathologyScans: { covered: true, limit: 'As part of treatment', subLimit: null },
    specialistConsultations: { covered: true, limit: 'Referred by GP only', subLimit: null },
    prescribedDrugs: { covered: true, limit: 'As part of in-patient/day-care treatment', subLimit: null },
    hospitalAccommodation: { covered: true, limit: 'Semi-private room', subLimit: null },
    operatingRoom: { covered: true, limit: 'Reasonable and customary charges', subLimit: null },
    surgery: { covered: true, limit: 'Reasonable and customary charges', subLimit: null },
    intensiveCare: { covered: true, limit: 'Reasonable and customary charges', subLimit: null },
    rehabilitation: { covered: true, limit: 'Up to 30 days per policy year', subLimit: 30 },
    cancerTreatment: { covered: true, limit: 'Full cover including chemotherapy and radiotherapy', subLimit: null },
    transplant: { covered: true, limit: 'Organ transplant - recipient only', subLimit: null },
    kidneyDialysis: { covered: true, limit: 'Reasonable and customary charges', subLimit: null },
    maternity: { covered: false, limit: 'Not covered', subLimit: null },
    dental: { covered: false, limit: 'Not covered', subLimit: null },
    optical: { covered: false, limit: 'Not covered', subLimit: null },
    evacuation: { covered: true, limit: 'USD 100,000 per incident', subLimit: 100000 },
    repatriation: { covered: true, limit: 'USD 50,000 per incident', subLimit: 50000 },
  };
}

function createSelectBenefits() {
  return {
    outPatientDayCare: { covered: true, limit: 'Reasonable and customary charges', subLimit: null },
    outPatientSurgical: { covered: true, limit: 'Reasonable and customary charges', subLimit: null },
    pathologyScans: { covered: true, limit: 'Full cover', subLimit: null },
    specialistConsultations: { covered: true, limit: 'Direct access, no referral required', subLimit: null },
    prescribedDrugs: { covered: true, limit: 'In-patient and out-patient', subLimit: null },
    hospitalAccommodation: { covered: true, limit: 'Private room', subLimit: null },
    operatingRoom: { covered: true, limit: 'Reasonable and customary charges', subLimit: null },
    surgery: { covered: true, limit: 'Reasonable and customary charges', subLimit: null },
    intensiveCare: { covered: true, limit: 'Reasonable and customary charges', subLimit: null },
    rehabilitation: { covered: true, limit: 'Up to 45 days per policy year', subLimit: 45 },
    cancerTreatment: { covered: true, limit: 'Full cover including chemotherapy, radiotherapy, and immunotherapy', subLimit: null },
    transplant: { covered: true, limit: 'Organ transplant - recipient only', subLimit: null },
    kidneyDialysis: { covered: true, limit: 'Reasonable and customary charges', subLimit: null },
    maternity: { covered: false, limit: 'Not covered', subLimit: null },
    dental: { covered: true, limit: 'USD 1,500 per policy year', subLimit: 1500 },
    optical: { covered: true, limit: 'USD 300 per policy year', subLimit: 300 },
    evacuation: { covered: true, limit: 'USD 250,000 per incident', subLimit: 250000 },
    repatriation: { covered: true, limit: 'USD 75,000 per incident', subLimit: 75000 },
  };
}

function createPremierBenefits() {
  return {
    outPatientDayCare: { covered: true, limit: 'Full cover', subLimit: null },
    outPatientSurgical: { covered: true, limit: 'Full cover', subLimit: null },
    pathologyScans: { covered: true, limit: 'Full cover including advanced imaging (MRI, PET, CT)', subLimit: null },
    specialistConsultations: { covered: true, limit: 'Direct access, no referral required', subLimit: null },
    prescribedDrugs: { covered: true, limit: 'In-patient and out-patient, including biologics', subLimit: null },
    hospitalAccommodation: { covered: true, limit: 'Private room', subLimit: null },
    operatingRoom: { covered: true, limit: 'Full cover', subLimit: null },
    surgery: { covered: true, limit: 'Full cover including robotic surgery', subLimit: null },
    intensiveCare: { covered: true, limit: 'Full cover', subLimit: null },
    rehabilitation: { covered: true, limit: 'Up to 60 days per policy year', subLimit: 60 },
    cancerTreatment: { covered: true, limit: 'Full cover including experimental treatments with prior approval', subLimit: null },
    transplant: { covered: true, limit: 'Organ transplant - recipient and donor costs', subLimit: null },
    kidneyDialysis: { covered: true, limit: 'Full cover', subLimit: null },
    maternity: { covered: false, limit: 'Not covered', subLimit: null },
    dental: { covered: true, limit: 'USD 3,000 per policy year', subLimit: 3000 },
    optical: { covered: true, limit: 'USD 500 per policy year', subLimit: 500 },
    evacuation: { covered: true, limit: 'USD 500,000 per incident', subLimit: 500000 },
    repatriation: { covered: true, limit: 'USD 100,000 per incident', subLimit: 100000 },
  };
}

function createEliteBenefits() {
  return {
    outPatientDayCare: { covered: true, limit: 'Full cover', subLimit: null },
    outPatientSurgical: { covered: true, limit: 'Full cover', subLimit: null },
    pathologyScans: { covered: true, limit: 'Full cover including advanced imaging', subLimit: null },
    specialistConsultations: { covered: true, limit: 'Direct access worldwide', subLimit: null },
    prescribedDrugs: { covered: true, limit: 'Full cover including biologics and gene therapy drugs', subLimit: null },
    hospitalAccommodation: { covered: true, limit: 'Private suite', subLimit: null },
    operatingRoom: { covered: true, limit: 'Full cover', subLimit: null },
    surgery: { covered: true, limit: 'Full cover including robotic and laparoscopic surgery', subLimit: null },
    intensiveCare: { covered: true, limit: 'Full cover, no day limit', subLimit: null },
    rehabilitation: { covered: true, limit: 'Up to 90 days per policy year', subLimit: 90 },
    cancerTreatment: { covered: true, limit: 'Full cover including experimental and targeted therapies', subLimit: null },
    transplant: { covered: true, limit: 'Full cover - recipient, donor costs, and search fees', subLimit: null },
    kidneyDialysis: { covered: true, limit: 'Full cover', subLimit: null },
    maternity: { covered: true, limit: 'USD 15,000 normal delivery, USD 20,000 complications', subLimit: 20000 },
    dental: { covered: true, limit: 'USD 5,000 per policy year', subLimit: 5000 },
    optical: { covered: true, limit: 'USD 750 per policy year', subLimit: 750 },
    evacuation: { covered: true, limit: 'Unlimited', subLimit: null },
    repatriation: { covered: true, limit: 'USD 250,000 per incident', subLimit: 250000 },
  };
}

function createUltimateBenefits() {
  return {
    outPatientDayCare: { covered: true, limit: 'Full cover', subLimit: null },
    outPatientSurgical: { covered: true, limit: 'Full cover', subLimit: null },
    pathologyScans: { covered: true, limit: 'Full cover', subLimit: null },
    specialistConsultations: { covered: true, limit: 'Full cover, direct access worldwide', subLimit: null },
    prescribedDrugs: { covered: true, limit: 'Full cover', subLimit: null },
    hospitalAccommodation: { covered: true, limit: 'Private suite or deluxe room', subLimit: null },
    operatingRoom: { covered: true, limit: 'Full cover', subLimit: null },
    surgery: { covered: true, limit: 'Full cover', subLimit: null },
    intensiveCare: { covered: true, limit: 'Full cover, no day limit', subLimit: null },
    rehabilitation: { covered: true, limit: 'Up to 120 days per policy year', subLimit: 120 },
    cancerTreatment: { covered: true, limit: 'Full cover including all experimental and cutting-edge treatments', subLimit: null },
    transplant: { covered: true, limit: 'Full cover - all associated costs including international search', subLimit: null },
    kidneyDialysis: { covered: true, limit: 'Full cover', subLimit: null },
    maternity: { covered: true, limit: 'USD 25,000 normal delivery, USD 40,000 complications, newborn cover 90 days', subLimit: 40000 },
    dental: { covered: true, limit: 'USD 10,000 per policy year including orthodontics', subLimit: 10000 },
    optical: { covered: true, limit: 'USD 1,000 per policy year including laser surgery', subLimit: 1000 },
    evacuation: { covered: true, limit: 'Unlimited', subLimit: null },
    repatriation: { covered: true, limit: 'Unlimited', subLimit: null },
  };
}

// ─── HEALTH PLAN DEFINITIONS ─────────────────────────────

const HEALTH_PLANS = [
  {
    name: 'Major Medical',
    tier: 'MAJOR_MEDICAL' as const,
    annualMaximumUsd: 4500000,
    annualMaximumHkd: 35100000,
    geographicOptions: [
      { name: 'Worldwide excluding USA', code: 'WORLDWIDE_EXCL_US' },
      { name: 'Worldwide', code: 'WORLDWIDE' },
    ],
    networkOptions: [
      { name: 'Standard', code: 'STANDARD' },
    ],
    deductibleOptions: [
      { amount: 4000, currency: 'USD' },
      { amount: 10000, currency: 'USD' },
    ],
    coInsuranceOption: null,
    benefits: createMajorMedicalBenefits(),
    exclusions: [
      'Pre-existing conditions (first 2 years unless declared and accepted)',
      'Cosmetic or aesthetic treatment',
      'Infertility treatment',
      'Self-inflicted injuries',
      'Experimental treatment without prior approval',
      'War and terrorism (unless covered by rider)',
      'Dental treatment (not covered under this plan)',
      'Optical treatment (not covered under this plan)',
      'Maternity and childbirth',
      'Routine health checks',
    ],
    waitingPeriods: {
      general: '0 months',
      maternity: 'Not applicable - not covered',
      dental: 'Not applicable - not covered',
      optical: 'Not applicable - not covered',
      preExistingConditions: '24 months moratorium',
      cancerTreatment: '0 months',
    },
    effectiveFrom: new Date('2025-01-01'),
    effectiveTo: null,
  },
  {
    name: 'Select',
    tier: 'SELECT' as const,
    annualMaximumUsd: 4500000,
    annualMaximumHkd: 35100000,
    geographicOptions: [
      { name: 'Worldwide excluding USA', code: 'WORLDWIDE_EXCL_US' },
      { name: 'Worldwide', code: 'WORLDWIDE' },
    ],
    networkOptions: [
      { name: 'Standard', code: 'STANDARD' },
      { name: 'Comprehensive', code: 'COMPREHENSIVE' },
    ],
    deductibleOptions: [
      { amount: 1500, currency: 'USD' },
      { amount: 4000, currency: 'USD' },
      { amount: 10000, currency: 'USD' },
    ],
    coInsuranceOption: { rate: 0.15, description: 'Optional 15% co-insurance for premium discount' },
    benefits: createSelectBenefits(),
    exclusions: [
      'Pre-existing conditions (first 2 years unless declared and accepted)',
      'Cosmetic or aesthetic treatment',
      'Infertility treatment',
      'Self-inflicted injuries',
      'Experimental treatment without prior approval',
      'War and terrorism (unless covered by rider)',
      'Maternity and childbirth',
      'Routine health checks (unless wellness rider purchased)',
    ],
    waitingPeriods: {
      general: '0 months',
      maternity: 'Not applicable - not covered',
      dental: '6 months',
      optical: '6 months',
      preExistingConditions: '24 months moratorium',
      cancerTreatment: '0 months',
    },
    effectiveFrom: new Date('2025-01-01'),
    effectiveTo: null,
  },
  {
    name: 'Premier',
    tier: 'PREMIER' as const,
    annualMaximumUsd: 5000000,
    annualMaximumHkd: 39000000,
    geographicOptions: [
      { name: 'Worldwide excluding USA', code: 'WORLDWIDE_EXCL_US' },
      { name: 'Worldwide', code: 'WORLDWIDE' },
    ],
    networkOptions: [
      { name: 'Standard', code: 'STANDARD' },
      { name: 'Comprehensive', code: 'COMPREHENSIVE' },
    ],
    deductibleOptions: [
      { amount: 1500, currency: 'USD' },
      { amount: 4000, currency: 'USD' },
      { amount: 10000, currency: 'USD' },
    ],
    coInsuranceOption: { rate: 0.15, description: 'Optional 15% co-insurance for premium discount' },
    benefits: createPremierBenefits(),
    exclusions: [
      'Pre-existing conditions (first 2 years unless declared and accepted)',
      'Cosmetic or aesthetic treatment',
      'Infertility treatment (unless rider purchased)',
      'Self-inflicted injuries',
      'War and terrorism (unless covered by rider)',
      'Maternity and childbirth',
      'Routine health checks (unless wellness rider purchased)',
    ],
    waitingPeriods: {
      general: '0 months',
      maternity: 'Not applicable - not covered',
      dental: '6 months',
      optical: '6 months',
      preExistingConditions: '24 months moratorium',
      cancerTreatment: '0 months',
    },
    effectiveFrom: new Date('2025-01-01'),
    effectiveTo: null,
  },
  {
    name: 'Elite',
    tier: 'ELITE' as const,
    annualMaximumUsd: 10000000,
    annualMaximumHkd: 78000000,
    geographicOptions: [
      { name: 'Worldwide excluding USA', code: 'WORLDWIDE_EXCL_US' },
      { name: 'Worldwide', code: 'WORLDWIDE' },
    ],
    networkOptions: [
      { name: 'Standard', code: 'STANDARD' },
      { name: 'Comprehensive', code: 'COMPREHENSIVE' },
    ],
    deductibleOptions: [
      { amount: 4000, currency: 'USD' },
      { amount: 10000, currency: 'USD' },
    ],
    coInsuranceOption: null,
    benefits: createEliteBenefits(),
    exclusions: [
      'Pre-existing conditions (first 2 years unless declared and accepted)',
      'Cosmetic or aesthetic treatment',
      'Self-inflicted injuries',
      'War and terrorism (unless covered by rider)',
      'Routine health checks (unless wellness rider purchased)',
    ],
    waitingPeriods: {
      general: '0 months',
      maternity: '18 months',
      dental: '6 months',
      optical: '6 months',
      preExistingConditions: '24 months moratorium',
      cancerTreatment: '0 months',
    },
    effectiveFrom: new Date('2025-01-01'),
    effectiveTo: null,
  },
  {
    name: 'Ultimate',
    tier: 'ULTIMATE' as const,
    annualMaximumUsd: null,
    annualMaximumHkd: null,
    geographicOptions: [
      { name: 'Worldwide', code: 'WORLDWIDE' },
    ],
    networkOptions: [
      { name: 'Comprehensive', code: 'COMPREHENSIVE' },
    ],
    deductibleOptions: [],
    coInsuranceOption: null,
    benefits: createUltimateBenefits(),
    exclusions: [
      'Cosmetic or aesthetic treatment (unless reconstructive after accident)',
      'Self-inflicted injuries',
      'War and terrorism (unless covered by rider)',
    ],
    waitingPeriods: {
      general: '0 months',
      maternity: '18 months',
      dental: '6 months',
      optical: '6 months',
      preExistingConditions: '12 months moratorium',
      cancerTreatment: '0 months',
    },
    effectiveFrom: new Date('2025-01-01'),
    effectiveTo: null,
  },
];

// ─── MEMBER DEFINITIONS ──────────────────────────────────

const MEMBERS = [
  {
    membershipNumber: 'BI-6000-9000-9009',
    title: 'Mr',
    firstName: 'Johnny',
    lastName: 'Depp',
    dateOfBirth: new Date('1963-06-09'),
    email: 'johnny.depp@example.com',
    phone: '+852-9123-4567',
    address: {
      line1: '15 Peak Road',
      line2: 'The Peak',
      city: 'Hong Kong',
      state: '',
      postalCode: '',
      country: 'HK',
    },
    preferredLanguage: 'en',
    planTier: 'PREMIER' as const,
    // Widened to cover resources/1-hospital-receipt-sth.pdf (08-May-2024 admission)
    policyStartDate: new Date('2024-01-01'),
    policyEndDate: new Date('2026-12-31'),
    deductibleAmount: 1500,
    deductibleCurrency: 'USD',
    deductibleUsed: 0,
    coInsuranceRate: null,
    networkOption: 'COMPREHENSIVE' as const,
    geographicCover: 'WORLDWIDE' as const,
    preExistingConditions: [],
    status: 'MEMBER_ACTIVE' as const,
    renewalDate: new Date('2026-03-01'),
  },
  {
    membershipNumber: 'BI-6001-1234-5678',
    title: 'Ms',
    firstName: 'Maria',
    lastName: 'Chen',
    dateOfBirth: new Date('1985-03-15'),
    email: 'rahul@quickscribe.co',
    phone: '+86-138-0013-8000',
    address: {
      line1: '88 Century Avenue',
      line2: 'Pudong New District',
      city: 'Shanghai',
      state: 'Shanghai',
      postalCode: '200120',
      country: 'CN',
    },
    preferredLanguage: 'zh',
    planTier: 'ULTIMATE' as const,
    policyStartDate: new Date('2025-01-01'),
    policyEndDate: new Date('2025-12-31'),
    deductibleAmount: null,
    deductibleCurrency: null,
    deductibleUsed: 0,
    coInsuranceRate: null,
    networkOption: 'COMPREHENSIVE' as const,
    geographicCover: 'WORLDWIDE' as const,
    preExistingConditions: [],
    status: 'MEMBER_ACTIVE' as const,
    renewalDate: new Date('2025-12-01'),
  },
  {
    membershipNumber: 'BI-6002-2345-6789',
    title: 'Mr',
    firstName: 'Ahmed',
    lastName: 'Al-Rashid',
    dateOfBirth: new Date('1978-11-22'),
    email: 'ahmed.alrashid@example.com',
    phone: '+971-50-123-4567',
    address: {
      line1: 'Villa 42, Al Wasl Road',
      line2: 'Jumeirah 2',
      city: 'Dubai',
      state: 'Dubai',
      postalCode: '00000',
      country: 'AE',
    },
    preferredLanguage: 'ar',
    planTier: 'ELITE' as const,
    policyStartDate: new Date('2025-06-01'),
    policyEndDate: new Date('2026-05-31'),
    deductibleAmount: 4000,
    deductibleCurrency: 'USD',
    deductibleUsed: 1200,
    coInsuranceRate: null,
    networkOption: 'COMPREHENSIVE' as const,
    geographicCover: 'WORLDWIDE' as const,
    preExistingConditions: ['Hypertension - declared and accepted'],
    status: 'MEMBER_ACTIVE' as const,
    renewalDate: new Date('2026-05-01'),
  },
  {
    membershipNumber: 'BI-6003-3456-7890',
    title: 'Ms',
    firstName: 'Yuki',
    lastName: 'Tanaka',
    dateOfBirth: new Date('1990-07-08'),
    email: 'yuki.tanaka@example.com',
    phone: '+81-90-1234-5678',
    address: {
      line1: '3-1-2 Roppongi',
      line2: 'Minato-ku',
      city: 'Tokyo',
      state: 'Tokyo',
      postalCode: '106-0032',
      country: 'JP',
    },
    preferredLanguage: 'ja',
    planTier: 'SELECT' as const,
    policyStartDate: new Date('2025-03-01'),
    policyEndDate: new Date('2026-02-28'),
    deductibleAmount: 1500,
    deductibleCurrency: 'USD',
    deductibleUsed: 500,
    coInsuranceRate: 0.15,
    networkOption: 'STANDARD' as const,
    geographicCover: 'WORLDWIDE_EXCL_US' as const,
    preExistingConditions: [],
    status: 'MEMBER_ACTIVE' as const,
    renewalDate: new Date('2026-02-01'),
  },
  {
    membershipNumber: 'BI-6004-4567-8901',
    title: 'Mrs',
    firstName: 'Sophie',
    lastName: 'Laurent',
    dateOfBirth: new Date('1975-12-03'),
    email: 'rahul@quickscribe.co',
    phone: '+33-6-12-34-56-78',
    address: {
      line1: '25 Avenue Montaigne',
      line2: '',
      city: 'Paris',
      state: 'Ile-de-France',
      postalCode: '75008',
      country: 'FR',
    },
    preferredLanguage: 'fr',
    planTier: 'MAJOR_MEDICAL' as const,
    policyStartDate: new Date('2025-07-01'),
    policyEndDate: new Date('2026-06-30'),
    deductibleAmount: 4000,
    deductibleCurrency: 'USD',
    deductibleUsed: 0,
    coInsuranceRate: null,
    networkOption: 'STANDARD' as const,
    geographicCover: 'WORLDWIDE_EXCL_US' as const,
    preExistingConditions: [],
    status: 'MEMBER_ACTIVE' as const,
    renewalDate: new Date('2026-06-01'),
  },
  {
    membershipNumber: 'BI-6005-5678-9012',
    title: 'Mr',
    firstName: 'Raj',
    lastName: 'Patel',
    dateOfBirth: new Date('1982-04-18'),
    email: 'raj.patel@example.com',
    phone: '+91-98765-43210',
    address: {
      line1: '12 Marine Drive',
      line2: 'Nariman Point',
      city: 'Mumbai',
      state: 'Maharashtra',
      postalCode: '400021',
      country: 'IN',
    },
    preferredLanguage: 'hi',
    planTier: 'PREMIER' as const,
    policyStartDate: new Date('2025-02-01'),
    policyEndDate: new Date('2026-01-31'),
    deductibleAmount: 1500,
    deductibleCurrency: 'USD',
    deductibleUsed: 0,
    coInsuranceRate: null,
    networkOption: 'STANDARD' as const,
    geographicCover: 'WORLDWIDE_EXCL_US' as const,
    preExistingConditions: ['Type 2 Diabetes - declared and accepted'],
    status: 'MEMBER_ACTIVE' as const,
    renewalDate: new Date('2026-01-01'),
  },
  {
    membershipNumber: 'BI-6006-6789-0123',
    title: 'Mr',
    firstName: 'Hans',
    lastName: 'Mueller',
    dateOfBirth: new Date('1972-08-14'),
    email: 'hans.mueller@example.com',
    phone: '+49-170-1234567',
    address: {
      line1: 'Kurfurstendamm 195',
      line2: '',
      city: 'Berlin',
      state: 'Berlin',
      postalCode: '10707',
      country: 'DE',
    },
    preferredLanguage: 'de',
    planTier: 'ELITE' as const,
    policyStartDate: new Date('2025-05-01'),
    policyEndDate: new Date('2026-04-30'),
    deductibleAmount: 4000,
    deductibleCurrency: 'USD',
    deductibleUsed: 0,
    coInsuranceRate: null,
    networkOption: 'COMPREHENSIVE' as const,
    geographicCover: 'WORLDWIDE' as const,
    preExistingConditions: [],
    status: 'MEMBER_ACTIVE' as const,
    renewalDate: new Date('2026-04-01'),
  },
  {
    membershipNumber: 'BI-6007-7890-1234',
    title: 'Ms',
    firstName: 'Suki',
    lastName: 'Watanabe',
    dateOfBirth: new Date('1992-03-22'),
    email: 'suki.watanabe@example.com',
    phone: '+81-80-9876-5432',
    address: {
      line1: '2-4-8 Shibuya',
      line2: 'Shibuya-ku',
      city: 'Tokyo',
      state: 'Tokyo',
      postalCode: '150-0002',
      country: 'JP',
    },
    preferredLanguage: 'ja',
    planTier: 'SELECT' as const,
    policyStartDate: new Date('2025-08-01'),
    policyEndDate: new Date('2026-07-31'),
    deductibleAmount: 1500,
    deductibleCurrency: 'USD',
    deductibleUsed: 0,
    coInsuranceRate: 0.15,
    networkOption: 'STANDARD' as const,
    geographicCover: 'WORLDWIDE_EXCL_US' as const,
    preExistingConditions: [],
    status: 'MEMBER_ACTIVE' as const,
    renewalDate: new Date('2026-07-01'),
  },
  {
    membershipNumber: 'BI-6008-8901-2345',
    title: 'Mr',
    firstName: 'Li',
    lastName: 'Wei',
    dateOfBirth: new Date('1968-05-30'),
    email: 'li.wei@example.com',
    phone: '+86-139-0013-9000',
    address: {
      line1: '1 Jianguomenwai Dajie',
      line2: 'Chaoyang District',
      city: 'Beijing',
      state: 'Beijing',
      postalCode: '100004',
      country: 'CN',
    },
    preferredLanguage: 'zh',
    planTier: 'ULTIMATE' as const,
    policyStartDate: new Date('2025-01-01'),
    policyEndDate: new Date('2025-12-31'),
    deductibleAmount: null,
    deductibleCurrency: null,
    deductibleUsed: 0,
    coInsuranceRate: null,
    networkOption: 'COMPREHENSIVE' as const,
    geographicCover: 'WORLDWIDE' as const,
    preExistingConditions: [],
    status: 'MEMBER_ACTIVE' as const,
    renewalDate: new Date('2025-12-01'),
  },
  {
    membershipNumber: 'BI-6009-9012-3456',
    title: 'Mr',
    firstName: 'Carlos',
    lastName: 'Silva',
    dateOfBirth: new Date('1980-06-25'),
    email: 'carlos.silva@example.com',
    phone: '+55-11-98765-4321',
    address: {
      line1: 'Rua Oscar Freire 379',
      line2: 'Jardins',
      city: 'Sao Paulo',
      state: 'SP',
      postalCode: '01426-001',
      country: 'BR',
    },
    preferredLanguage: 'pt',
    planTier: 'MAJOR_MEDICAL' as const,
    policyStartDate: new Date('2025-01-15'),
    policyEndDate: new Date('2026-01-14'),
    deductibleAmount: 4000,
    deductibleCurrency: 'USD',
    deductibleUsed: 0,
    coInsuranceRate: null,
    networkOption: 'STANDARD' as const,
    geographicCover: 'WORLDWIDE_EXCL_US' as const,
    preExistingConditions: [],
    status: 'MEMBER_ACTIVE' as const,
    renewalDate: new Date('2026-01-01'),
  },
  {
    membershipNumber: 'BG-2025-HK-00123',
    title: 'Mr',
    firstName: 'Wei',
    lastName: 'Chen',
    dateOfBirth: new Date('1985-03-15'),
    email: 'wei.chen@example.com',
    phone: '+852-9123-4567',
    address: {
      line1: '88 Queensway',
      line2: 'Admiralty',
      city: 'Hong Kong',
      state: '',
      postalCode: '999077',
      country: 'HK',
    },
    preferredLanguage: 'en',
    planTier: 'PREMIER' as const,
    policyStartDate: new Date('2025-01-01'),
    policyEndDate: new Date('2025-12-31'),
    deductibleAmount: 1500,
    deductibleCurrency: 'USD',
    deductibleUsed: 0,
    coInsuranceRate: null,
    networkOption: 'COMPREHENSIVE' as const,
    geographicCover: 'WORLDWIDE' as const,
    preExistingConditions: [],
    status: 'MEMBER_ACTIVE' as const,
    renewalDate: new Date('2025-12-01'),
  },
  {
    membershipNumber: 'BG-2025-US-00999',
    title: 'Mr',
    firstName: 'John',
    lastName: 'Smith',
    dateOfBirth: new Date('1990-01-15'),
    email: 'john.smith@example.com',
    phone: '+1-555-123-4567',
    address: {
      line1: '123 Main Street',
      line2: '',
      city: 'New York',
      state: 'NY',
      postalCode: '10001',
      country: 'US',
    },
    preferredLanguage: 'en',
    planTier: 'ELITE' as const,
    policyStartDate: new Date('2025-01-01'),
    policyEndDate: new Date('2025-12-31'),
    deductibleAmount: 4000,
    deductibleCurrency: 'USD',
    deductibleUsed: 0,
    coInsuranceRate: null,
    networkOption: 'COMPREHENSIVE' as const,
    geographicCover: 'WORLDWIDE' as const,
    preExistingConditions: [],
    status: 'MEMBER_ACTIVE' as const,
    renewalDate: new Date('2025-12-01'),
  },
  {
    membershipNumber: 'BG-2025-UK-00888',
    title: 'Ms',
    firstName: 'Jane',
    lastName: 'Doe',
    dateOfBirth: new Date('1985-03-20'),
    email: 'jane.doe@example.com',
    phone: '+44-20-1234-5678',
    address: {
      line1: '10 Downing Street',
      line2: '',
      city: 'London',
      state: '',
      postalCode: 'SW1A 2AA',
      country: 'GB',
    },
    preferredLanguage: 'en',
    planTier: 'SELECT' as const,
    policyStartDate: new Date('2025-01-01'),
    policyEndDate: new Date('2025-12-31'),
    deductibleAmount: 1500,
    deductibleCurrency: 'USD',
    deductibleUsed: 0,
    coInsuranceRate: 0.15,
    networkOption: 'STANDARD' as const,
    geographicCover: 'WORLDWIDE_EXCL_US' as const,
    preExistingConditions: [],
    status: 'MEMBER_ACTIVE' as const,
    renewalDate: new Date('2025-12-01'),
  },
  // ─── PDF-derived members (resources/*.pdf) ────────────────
  // Source: resources/8-145518-2180-001.pdf (Union Hospital Polyclinic)
  // Patient: Jason Momoa, A-No: TWC-23-071034, Visit: 28/12/2023
  // BI-formatted key so the Bupa extractor (which normalises to BI-XXXX-XXXX-XXXX) matches.
  {
    membershipNumber: 'BI-TWC2-3071-0340',
    title: 'Mr',
    firstName: 'Jason',
    lastName: 'Momoa',
    dateOfBirth: new Date('1979-08-01'),
    email: 'jason.momoa@example.com',
    phone: '+852-9876-5432',
    address: {
      line1: '68 Chung On Street',
      line2: 'Tsuen Wan',
      city: 'Hong Kong',
      state: 'New Territories',
      postalCode: '',
      country: 'HK',
    },
    preferredLanguage: 'en',
    planTier: 'SELECT' as const,
    policyStartDate: new Date('2023-01-01'),
    policyEndDate: new Date('2025-12-31'),
    deductibleAmount: 1500,
    deductibleCurrency: 'USD',
    deductibleUsed: 0,
    coInsuranceRate: 0.15,
    networkOption: 'STANDARD' as const,
    geographicCover: 'WORLDWIDE' as const,
    preExistingConditions: [],
    status: 'MEMBER_ACTIVE' as const,
    renewalDate: new Date('2025-12-01'),
  },
  // Raw-format fallback in case the extractor returns the A-No unchanged.
  {
    membershipNumber: 'TWC-23-071034',
    title: 'Mr',
    firstName: 'Jason',
    lastName: 'Momoa',
    dateOfBirth: new Date('1979-08-01'),
    email: 'rahul@quickscribe.co',
    phone: '+852-9876-5432',
    address: {
      line1: '68 Chung On Street',
      line2: 'Tsuen Wan',
      city: 'Hong Kong',
      state: 'New Territories',
      postalCode: '',
      country: 'HK',
    },
    preferredLanguage: 'en',
    planTier: 'SELECT' as const,
    policyStartDate: new Date('2023-01-01'),
    policyEndDate: new Date('2025-12-31'),
    deductibleAmount: 1500,
    deductibleCurrency: 'USD',
    deductibleUsed: 0,
    coInsuranceRate: 0.15,
    networkOption: 'STANDARD' as const,
    geographicCover: 'WORLDWIDE' as const,
    preExistingConditions: [],
    status: 'MEMBER_ACTIVE' as const,
    renewalDate: new Date('2025-12-01'),
  },
  // Source: resources/1-hospital-receipt-sth.pdf (St. Teresa's Hospital)
  // Patient: Johnny Depp, Patient No: 6000-9000-9009, Admission: 08-May-2024, Discharge: 09-May-2024
  // Raw-format alt so extraction without the "BI-" prefix still matches.
  {
    membershipNumber: '6000-9000-9009',
    title: 'Mr',
    firstName: 'Johnny',
    lastName: 'Depp',
    dateOfBirth: new Date('1963-06-09'),
    email: 'johnny.depp@example.com',
    phone: '+852-9123-4567',
    address: {
      line1: '15 Peak Road',
      line2: 'The Peak',
      city: 'Hong Kong',
      state: '',
      postalCode: '',
      country: 'HK',
    },
    preferredLanguage: 'en',
    planTier: 'PREMIER' as const,
    policyStartDate: new Date('2024-01-01'),
    policyEndDate: new Date('2026-12-31'),
    deductibleAmount: 1500,
    deductibleCurrency: 'USD',
    deductibleUsed: 0,
    coInsuranceRate: null,
    networkOption: 'COMPREHENSIVE' as const,
    geographicCover: 'WORLDWIDE' as const,
    preExistingConditions: [],
    status: 'MEMBER_ACTIVE' as const,
    renewalDate: new Date('2026-12-01'),
  },
];

// ─── PROVIDER DEFINITIONS ────────────────────────────────

const PROVIDERS = [
  {
    providerName: 'Hong Kong Sanatorium & Hospital',
    facilityName: 'Hong Kong Sanatorium & Hospital',
    providerType: 'HOSPITAL' as const,
    specialty: ['General Surgery', 'Internal Medicine', 'Orthopaedics', 'Cardiology', 'Gastroenterology', 'Oncology'],
    licenseNumber: 'HK-HOSP-002345',
    address: {
      line1: '2 Village Road',
      line2: 'Happy Valley',
      city: 'Hong Kong',
      state: '',
      postalCode: '999078',
      country: 'HK',
    },
    email: 'enquiry@hksh.com',
    phone: '+852-2572-0211',
    networkStatus: 'IN_NETWORK' as const,
    networkType: 'COMPREHENSIVE' as const,
    bupaProviderId: 'BUPA-HK-0003',
    accreditationStatus: 'ACCREDITED' as const,
    country: 'HK',
    defaultCurrency: 'HKD',
    lastVerifiedAt: new Date('2025-08-10'),
  },
  {
    providerName: 'Shanghai First People\'s Hospital',
    facilityName: 'Shanghai First People\'s Hospital',
    providerType: 'HOSPITAL' as const,
    specialty: ['General Medicine', 'Internal Medicine', 'Cardiology', 'Endocrinology', 'Gastroenterology'],
    licenseNumber: 'CN-HOSP-SH-00100',
    address: {
      line1: '100 Haining Road',
      line2: 'Hongkou District',
      city: 'Shanghai',
      state: 'Shanghai',
      postalCode: '200080',
      country: 'CN',
    },
    email: 'international@shfph.com',
    phone: '+86-21-6324-0090',
    networkStatus: 'IN_NETWORK' as const,
    networkType: 'COMPREHENSIVE' as const,
    bupaProviderId: 'BUPA-CN-0001',
    accreditationStatus: 'ACCREDITED' as const,
    country: 'CN',
    defaultCurrency: 'CNY',
    lastVerifiedAt: new Date('2025-07-20'),
  },
  {
    providerName: "St. Teresa's Hospital",
    facilityName: "St. Teresa's Hospital",
    providerType: 'HOSPITAL' as const,
    specialty: ['General Surgery', 'Internal Medicine', 'Orthopaedics', 'Cardiology', 'Oncology'],
    licenseNumber: 'HK-HOSP-001234',
    address: {
      line1: '327 Prince Edward Road West',
      line2: 'Kowloon',
      city: 'Hong Kong',
      state: '',
      postalCode: '',
      country: 'HK',
    },
    email: 'admin@stteresa.org.hk',
    phone: '+852-2200-3434',
    networkStatus: 'IN_NETWORK' as const,
    networkType: 'COMPREHENSIVE' as const,
    bupaProviderId: 'BUPA-HK-0001',
    accreditationStatus: 'ACCREDITED' as const,
    country: 'HK',
    defaultCurrency: 'HKD',
    lastVerifiedAt: new Date('2025-06-15'),
  },
  {
    providerName: 'Queen Mary Hospital',
    facilityName: 'Queen Mary Hospital',
    providerType: 'HOSPITAL' as const,
    specialty: ['General Medicine', 'Cardiothoracic Surgery', 'Neurosurgery', 'Paediatrics', 'Obstetrics'],
    licenseNumber: 'HK-HOSP-000102',
    address: {
      line1: '102 Pokfulam Road',
      line2: 'Pok Fu Lam',
      city: 'Hong Kong',
      state: '',
      postalCode: '',
      country: 'HK',
    },
    email: 'enquiry@ha.org.hk',
    phone: '+852-2255-3838',
    networkStatus: 'IN_NETWORK' as const,
    networkType: 'COMPREHENSIVE' as const,
    bupaProviderId: 'BUPA-HK-0002',
    accreditationStatus: 'ACCREDITED' as const,
    country: 'HK',
    defaultCurrency: 'HKD',
    lastVerifiedAt: new Date('2025-05-20'),
  },
  {
    providerName: 'Bumrungrad International Hospital',
    facilityName: 'Bumrungrad International Hospital',
    providerType: 'HOSPITAL' as const,
    specialty: ['General Surgery', 'Cardiology', 'Oncology', 'Orthopaedics', 'Gastroenterology', 'Dermatology'],
    licenseNumber: 'TH-HOSP-BKK-0033',
    address: {
      line1: '33 Sukhumvit Soi 3',
      line2: 'Wattana',
      city: 'Bangkok',
      state: 'Bangkok',
      postalCode: '10110',
      country: 'TH',
    },
    email: 'info@bumrungrad.com',
    phone: '+66-2-066-8888',
    networkStatus: 'IN_NETWORK' as const,
    networkType: 'COMPREHENSIVE' as const,
    bupaProviderId: 'BUPA-TH-0001',
    accreditationStatus: 'ACCREDITED' as const,
    country: 'TH',
    defaultCurrency: 'THB',
    lastVerifiedAt: new Date('2025-07-01'),
  },
  {
    providerName: 'Mount Elizabeth Hospital',
    facilityName: 'Mount Elizabeth Hospital',
    providerType: 'HOSPITAL' as const,
    specialty: ['General Surgery', 'Cardiology', 'Neurology', 'Oncology', 'Urology', 'ENT'],
    licenseNumber: 'SG-HOSP-MEH-001',
    address: {
      line1: '3 Mount Elizabeth',
      line2: '',
      city: 'Singapore',
      state: '',
      postalCode: '228510',
      country: 'SG',
    },
    email: 'enquiry@mountelizabeth.com.sg',
    phone: '+65-6250-0000',
    networkStatus: 'IN_NETWORK' as const,
    networkType: 'COMPREHENSIVE' as const,
    bupaProviderId: 'BUPA-SG-0001',
    accreditationStatus: 'ACCREDITED' as const,
    country: 'SG',
    defaultCurrency: 'SGD',
    lastVerifiedAt: new Date('2025-04-10'),
  },
  {
    providerName: 'Harley Street Clinic',
    facilityName: 'The Harley Street Clinic',
    providerType: 'CLINIC' as const,
    specialty: ['Cardiology', 'Oncology', 'Orthopaedics', 'Neurology', 'Diagnostics'],
    licenseNumber: 'GB-CQC-1-101448082',
    address: {
      line1: '35 Weymouth Street',
      line2: '',
      city: 'London',
      state: 'England',
      postalCode: 'W1G 8BJ',
      country: 'GB',
    },
    email: 'appointments@theharleystreetclinic.com',
    phone: '+44-20-7935-7700',
    networkStatus: 'IN_NETWORK' as const,
    networkType: 'COMPREHENSIVE' as const,
    bupaProviderId: 'BUPA-GB-0001',
    accreditationStatus: 'ACCREDITED' as const,
    country: 'GB',
    defaultCurrency: 'GBP',
    lastVerifiedAt: new Date('2025-08-01'),
  },
  {
    providerName: 'Tokyo Medical University Hospital',
    facilityName: 'Tokyo Medical University Hospital',
    providerType: 'HOSPITAL' as const,
    specialty: ['General Medicine', 'Surgery', 'Paediatrics', 'Obstetrics', 'Psychiatry', 'Radiology'],
    licenseNumber: 'JP-HOSP-TMU-00160',
    address: {
      line1: '6-7-1 Nishi-Shinjuku',
      line2: 'Shinjuku-ku',
      city: 'Tokyo',
      state: 'Tokyo',
      postalCode: '160-0023',
      country: 'JP',
    },
    email: 'international@tokyo-med.ac.jp',
    phone: '+81-3-3342-6111',
    networkStatus: 'IN_NETWORK' as const,
    networkType: 'STANDARD' as const,
    bupaProviderId: 'BUPA-JP-0001',
    accreditationStatus: 'ACCREDITED' as const,
    country: 'JP',
    defaultCurrency: 'JPY',
    lastVerifiedAt: new Date('2025-03-15'),
  },
  {
    providerName: 'American Hospital Dubai',
    facilityName: 'American Hospital Dubai',
    providerType: 'HOSPITAL' as const,
    specialty: ['General Surgery', 'Cardiology', 'Orthopaedics', 'Oncology', 'Maternity', 'Emergency Medicine'],
    licenseNumber: 'AE-DHA-F-0000002',
    address: {
      line1: '19th Street, Oud Metha',
      line2: '',
      city: 'Dubai',
      state: 'Dubai',
      postalCode: '5566',
      country: 'AE',
    },
    email: 'info@ahdubai.com',
    phone: '+971-4-377-6000',
    networkStatus: 'IN_NETWORK' as const,
    networkType: 'COMPREHENSIVE' as const,
    bupaProviderId: 'BUPA-AE-0001',
    accreditationStatus: 'ACCREDITED' as const,
    country: 'AE',
    defaultCurrency: 'AED',
    lastVerifiedAt: new Date('2025-09-01'),
  },
  {
    providerName: 'Dr. Sophie Martin Cardiology',
    facilityName: 'Cabinet de Cardiologie Dr. Martin',
    providerType: 'PRACTITIONER' as const,
    specialty: ['Cardiology', 'Interventional Cardiology'],
    licenseNumber: 'FR-RPPS-10003456789',
    address: {
      line1: '14 Rue de la Paix',
      line2: '',
      city: 'Paris',
      state: 'Ile-de-France',
      postalCode: '75002',
      country: 'FR',
    },
    email: 'dr.martin@cardiologie-paris.fr',
    phone: '+33-1-42-68-53-00',
    networkStatus: 'OUT_OF_NETWORK' as const,
    networkType: 'STANDARD' as const,
    bupaProviderId: 'BUPA-FR-0042',
    accreditationStatus: 'ACCREDITED' as const,
    country: 'FR',
    defaultCurrency: 'EUR',
    lastVerifiedAt: new Date('2025-02-28'),
  },
  {
    providerName: 'Bangkok Dental Clinic',
    facilityName: 'Bangkok Dental Clinic',
    providerType: 'CLINIC' as const,
    specialty: ['General Dentistry', 'Orthodontics', 'Oral Surgery', 'Prosthodontics'],
    licenseNumber: 'TH-DENT-BKK-0588',
    address: {
      line1: '120 Silom Road',
      line2: 'Bang Rak',
      city: 'Bangkok',
      state: 'Bangkok',
      postalCode: '10500',
      country: 'TH',
    },
    email: 'info@bangkokdentalclinic.com',
    phone: '+66-2-636-9000',
    networkStatus: 'OUT_OF_NETWORK' as const,
    networkType: 'STANDARD' as const,
    bupaProviderId: 'BUPA-TH-0099',
    accreditationStatus: 'PENDING_ACCREDITATION' as const,
    country: 'TH',
    defaultCurrency: 'THB',
    lastVerifiedAt: null,
  },
  {
    providerName: 'Rural Health Centre Nairobi',
    facilityName: 'Kibera Community Health Centre',
    providerType: 'CLINIC' as const,
    specialty: ['General Practice', 'Maternal Health', 'Paediatrics', 'HIV/AIDS Treatment'],
    licenseNumber: 'KE-MoH-NBI-04521',
    address: {
      line1: 'Olympic Estate Road',
      line2: 'Kibera',
      city: 'Nairobi',
      state: 'Nairobi County',
      postalCode: '00100',
      country: 'KE',
    },
    email: 'admin@kiberahealth.or.ke',
    phone: '+254-20-387-2000',
    networkStatus: 'PENDING_VERIFICATION' as const,
    networkType: 'STANDARD' as const,
    bupaProviderId: 'BUPA-KE-0010',
    accreditationStatus: 'PENDING_ACCREDITATION' as const,
    country: 'KE',
    defaultCurrency: 'KES',
    lastVerifiedAt: null,
  },
  {
    providerName: 'Dr. Sarah Lam',
    facilityName: 'Hong Kong Sanatorium & Hospital',
    providerType: 'PRACTITIONER' as const,
    specialty: ['General Surgery'],
    licenseNumber: 'HK-MED-123456',
    address: {
      line1: '2 Village Road',
      line2: 'Happy Valley',
      city: 'Hong Kong',
      state: '',
      postalCode: '999078',
      country: 'HK',
    },
    email: 'sarah.lam@hksh.com',
    phone: '+852-2572-0211',
    networkStatus: 'IN_NETWORK' as const,
    networkType: 'COMPREHENSIVE' as const,
    bupaProviderId: 'BUPA-HK-P001',
    accreditationStatus: 'ACCREDITED' as const,
    country: 'HK',
    defaultCurrency: 'HKD',
    lastVerifiedAt: new Date('2025-08-10'),
  },
  {
    providerName: 'CUHK Medical Centre',
    facilityName: 'CUHK Medical Centre',
    providerType: 'HOSPITAL' as const,
    specialty: ['General Surgery', 'Internal Medicine', 'Cardiology', 'Oncology'],
    licenseNumber: 'HK-HOSP-009999',
    address: {
      line1: '9 Chak Cheung Street',
      line2: 'Shatin',
      city: 'Hong Kong',
      state: 'New Territories',
      postalCode: '',
      country: 'HK',
    },
    email: 'info@cuhkmc.hk',
    phone: '+852-3946-6888',
    networkStatus: 'IN_NETWORK' as const,
    networkType: 'COMPREHENSIVE' as const,
    bupaProviderId: 'BUPA-HK-0009',
    accreditationStatus: 'ACCREDITED' as const,
    country: 'HK',
    defaultCurrency: 'HKD',
    lastVerifiedAt: new Date('2025-09-01'),
  },
  // Source: resources/8-145518-2180-001.pdf (Union Hospital Polyclinic Tsuen Wan)
  {
    providerName: 'Union Hospital Polyclinic (Tsuen Wan)',
    facilityName: 'Union Hospital Polyclinic (Tsuen Wan)',
    providerType: 'CLINIC' as const,
    specialty: ['General Practice', 'Internal Medicine', 'Gastroenterology'],
    licenseNumber: 'HK-CLIN-TWC-071034',
    address: {
      line1: 'Room 1204-1206 & 1209-1210, 12/F, KOLOUR - Tsuen Wan I',
      line2: '68 Chung On Street, Tsuen Wan',
      city: 'Hong Kong',
      state: 'New Territories',
      postalCode: '',
      country: 'HK',
    },
    email: 'tsuenwan@union.org',
    phone: '+852-2608-3399',
    networkStatus: 'IN_NETWORK' as const,
    networkType: 'STANDARD' as const,
    bupaProviderId: 'BUPA-HK-0011',
    accreditationStatus: 'ACCREDITED' as const,
    country: 'HK',
    defaultCurrency: 'HKD',
    lastVerifiedAt: new Date('2025-10-01'),
  },
  // Attending physician on resources/8-145518-2180-001.pdf
  {
    providerName: 'Dr. Lau Wai',
    facilityName: 'Union Hospital Polyclinic (Tsuen Wan)',
    providerType: 'PRACTITIONER' as const,
    specialty: ['General Practice', 'Internal Medicine'],
    licenseNumber: 'HK-MED-TWC-LAUWAI',
    address: {
      line1: 'Room 1204-1206 & 1209-1210, 12/F, KOLOUR - Tsuen Wan I',
      line2: '68 Chung On Street, Tsuen Wan',
      city: 'Hong Kong',
      state: 'New Territories',
      postalCode: '',
      country: 'HK',
    },
    email: 'lau.wai@union.org',
    phone: '+852-2608-3399',
    networkStatus: 'IN_NETWORK' as const,
    networkType: 'STANDARD' as const,
    bupaProviderId: 'BUPA-HK-P011',
    accreditationStatus: 'ACCREDITED' as const,
    country: 'HK',
    defaultCurrency: 'HKD',
    lastVerifiedAt: new Date('2025-10-01'),
  },
];

// ─── PAYMENT DETAILS ─────────────────────────────────────
// For members at indices 0 (Johnny Depp), 1 (Maria Chen), 2 (Ahmed Al-Rashid),
// 5 (Raj Patel), 8 (Li Wei)

const PAYMENT_DETAILS_CONFIG = [
  {
    memberIndex: 0,
    payeeType: 'MEMBER',
    method: 'BANK_TRANSFER',
    bankName: 'HSBC Hong Kong',
    swiftCode: 'HSBCHKHHHKH',
    accountNumber: '400-123456-838',
    sortCode: null,
    iban: null,
    accountHolderName: 'Johnny Depp',
    accountCurrency: 'HKD',
    chequeCurrency: null,
    isDefault: true,
  },
  {
    memberIndex: 1,
    payeeType: 'MEMBER',
    method: 'BANK_TRANSFER',
    bankName: 'Bank of China Shanghai',
    swiftCode: 'BKCHCNBJ300',
    accountNumber: '6217-0000-1234-5678',
    sortCode: null,
    iban: null,
    accountHolderName: 'Maria Chen',
    accountCurrency: 'CNY',
    chequeCurrency: null,
    isDefault: true,
  },
  {
    memberIndex: 2,
    payeeType: 'MEMBER',
    method: 'BANK_TRANSFER',
    bankName: 'Emirates NBD',
    swiftCode: 'EABORUMRXXX',
    accountNumber: '1012345678901',
    sortCode: null,
    iban: 'AE070331234567890123456',
    accountHolderName: 'Ahmed Al-Rashid',
    accountCurrency: 'AED',
    chequeCurrency: null,
    isDefault: true,
  },
  {
    memberIndex: 5,
    payeeType: 'MEMBER',
    method: 'BANK_TRANSFER',
    bankName: 'HDFC Bank Mumbai',
    swiftCode: 'HDFCINBBXXX',
    accountNumber: '00011234567890',
    sortCode: null,
    iban: null,
    accountHolderName: 'Raj Patel',
    accountCurrency: 'INR',
    chequeCurrency: null,
    isDefault: true,
  },
  {
    memberIndex: 8,
    payeeType: 'MEMBER',
    method: 'BANK_TRANSFER',
    bankName: 'Industrial and Commercial Bank of China',
    swiftCode: 'ICBKCNBJBJM',
    accountNumber: '6222-0200-0012-3456-789',
    sortCode: null,
    iban: null,
    accountHolderName: 'Li Wei',
    accountCurrency: 'CNY',
    chequeCurrency: null,
    isDefault: true,
  },
  {
    memberIndex: 3,
    payeeType: 'MEMBER',
    method: 'BANK_TRANSFER',
    bankName: 'Mizuho Bank Tokyo',
    swiftCode: 'MHCBJPJT',
    accountNumber: '1234567',
    sortCode: null,
    iban: null,
    accountHolderName: 'Yuki Tanaka',
    accountCurrency: 'JPY',
    chequeCurrency: null,
    isDefault: true,
  },
  {
    memberIndex: 4,
    payeeType: 'MEMBER',
    method: 'BANK_TRANSFER',
    bankName: 'BNP Paribas Paris',
    swiftCode: 'BNPAFRPP',
    accountNumber: '30004-01234-0000012345Z-67',
    sortCode: null,
    iban: 'FR7630004012340000012345Z67',
    accountHolderName: 'Sophie Laurent',
    accountCurrency: 'EUR',
    chequeCurrency: null,
    isDefault: true,
  },
  {
    memberIndex: 6,
    payeeType: 'MEMBER',
    method: 'BANK_TRANSFER',
    bankName: 'Deutsche Bank Berlin',
    swiftCode: 'DEUTDEFF',
    accountNumber: '0012345678',
    sortCode: null,
    iban: 'DE89370400440532013000',
    accountHolderName: 'Hans Mueller',
    accountCurrency: 'EUR',
    chequeCurrency: null,
    isDefault: true,
  },
  {
    memberIndex: 7,
    payeeType: 'MEMBER',
    method: 'BANK_TRANSFER',
    bankName: 'Sumitomo Mitsui Banking',
    swiftCode: 'SMBCJPJT',
    accountNumber: '7654321',
    sortCode: null,
    iban: null,
    accountHolderName: 'Suki Watanabe',
    accountCurrency: 'JPY',
    chequeCurrency: null,
    isDefault: true,
  },
  {
    memberIndex: 9,
    payeeType: 'MEMBER',
    method: 'BANK_TRANSFER',
    bankName: 'Banco do Brasil',
    swiftCode: 'BRASBRRJSPO',
    accountNumber: '12345-6',
    sortCode: null,
    iban: null,
    accountHolderName: 'Carlos Silva',
    accountCurrency: 'BRL',
    chequeCurrency: null,
    isDefault: true,
  },
  // Jason Momoa (BI-formatted entry) — resources/8-145518-2180-001.pdf
  {
    memberIndex: 13,
    payeeType: 'MEMBER',
    method: 'BANK_TRANSFER',
    bankName: 'HSBC Hong Kong',
    swiftCode: 'HSBCHKHHHKH',
    accountNumber: '400-987654-838',
    sortCode: null,
    iban: null,
    accountHolderName: 'Jason Momoa',
    accountCurrency: 'HKD',
    chequeCurrency: null,
    isDefault: true,
  },
];

// ─── MAIN SEED FUNCTION ──────────────────────────────────

async function main() {
  console.log('=== Seeding database ===');

  // ── Phase 1: Clear Bupa-specific tables in correct FK order ──

  console.log('\n--- Clearing existing Bupa data ---');

  await prisma.providerNetworkMapping.deleteMany();
  console.log('  Cleared provider_network_mapping');

  await prisma.providerClaim.deleteMany();
  console.log('  Cleared provider_claims');

  await prisma.memberClaim.deleteMany();
  console.log('  Cleared member_claims');

  await prisma.coverageDecision.deleteMany();
  console.log('  Cleared coverage_decisions');

  await prisma.paymentDetail.deleteMany();
  console.log('  Cleared payment_details');

  await prisma.member.deleteMany();
  console.log('  Cleared members');

  await prisma.memberGroup.deleteMany();
  console.log('  Cleared member_groups');

  await prisma.healthPlan.deleteMany();
  console.log('  Cleared health_plans');

  await prisma.provider.deleteMany();
  console.log('  Cleared providers');

  // ── Phase 2: System roles ──

  console.log('\n--- Seeding system roles ---');
  const roleMap: Record<string, string> = {};

  for (const [roleName, permissions] of Object.entries(SYSTEM_ROLES)) {
    const existing = await prisma.role.findFirst({
      where: { name: roleName, isSystem: true },
    });

    if (existing) {
      await prisma.role.update({
        where: { id: existing.id },
        data: { permissions },
      });
      roleMap[roleName] = existing.id;
      console.log(`  Updated role: ${roleName}`);
    } else {
      const role = await prisma.role.create({
        data: {
          name: roleName,
          permissions,
          isSystem: true,
        },
      });
      roleMap[roleName] = role.id;
      console.log(`  Created role: ${roleName}`);
    }
  }

  // ── Phase 3: Organisation ──

  console.log('\n--- Seeding organisation ---');
  let org = await prisma.organisation.findFirst({
    where: { name: 'ClaimsIntell System' },
  });

  if (!org) {
    org = await prisma.organisation.create({
      data: {
        name: 'ClaimsIntell System',
        type: 'BPO',
      },
    });
    console.log(`  Created organisation: ${org.name}`);
  } else {
    console.log(`  Organisation already exists: ${org.name}`);
  }

  if (!org) {
    throw new Error('Failed to find or create organisation');
  }

  // ── Phase 4: Default users ──

  console.log('\n--- Seeding users ---');
  const adminExists = await prisma.user.findUnique({
    where: { email: 'admin@claimsintell.com' },
  });

  if (!adminExists) {
    const passwordHash = await bcrypt.hash('ChangeMe123!', 12);
    await prisma.user.create({
      data: {
        orgId: org.id,
        email: 'admin@claimsintell.com',
        passwordHash,
        name: 'System Admin',
        roleId: roleMap['SUPER_ADMIN'],
        status: 'ACTIVE',
        emailVerified: true,
        passwordHistory: [passwordHash],
      },
    });
    console.log('  Created super admin: admin@claimsintell.com');
  } else {
    console.log('  Super admin already exists');
  }

  let leadUser = await prisma.user.findFirst({ where: { email: 'lead@claimsintell.com' } });
  if (!leadUser) {
    const passwordHash = await bcrypt.hash('ChangeMe123!', 12);
    leadUser = await prisma.user.create({
      data: {
        orgId: org.id,
        email: 'lead@claimsintell.com',
        passwordHash,
        name: 'QA Team Lead',
        roleId: roleMap['TEAM_LEAD'],
        status: 'ACTIVE',
      },
    });
    console.log('  Created team lead: lead@claimsintell.com');
  }

  // ── Phase 5: Clients and teams ──

  console.log('\n--- Seeding clients and teams ---');
  let client1 = await prisma.client.findFirst({ where: { name: 'Blue Harbor Health' } });
  if (!client1) {
    client1 = await prisma.client.create({
      data: { orgId: org.id, name: 'Blue Harbor Health', contactEmail: 'contact@blueharbor.com' },
    });
  }

  if (!client1) {
    throw new Error('Failed to find or create client1');
  }

  let client2 = await prisma.client.findFirst({ where: { name: 'Atlas Travel Protect' } });
  if (!client2) {
    client2 = await prisma.client.create({
      data: { orgId: org.id, name: 'Atlas Travel Protect', contactEmail: 'info@atlastravel.com' },
    });
  }

  let team1 = await prisma.team.findFirst({ where: { name: 'GI Claims Team' } });
  if (!team1) {
    team1 = await prisma.team.create({ data: { orgId: org.id, name: 'GI Claims Team' } });
  }

  if (!team1) {
    throw new Error('Failed to find or create team1');
  }

  let team2 = await prisma.team.findFirst({ where: { name: 'Travel Claims Team' } });
  if (!team2) {
    team2 = await prisma.team.create({ data: { orgId: org.id, name: 'Travel Claims Team' } });
  }
  console.log('  Clients and teams ready');

  // Forward-declare arrays that get populated in Phases 10 and 12 but are
  // referenced inside seedClaim (Phase 14).
  const createdMembers: Array<{ id: string; membershipNumber: string }> = [];
  const createdProviders: Array<{ id: string; providerName: string; networkStatus: string }> = [];

  // ── Phase 6: Notifications and connectors ──

  console.log('\n--- Seeding notifications and connectors ---');
  if (adminExists) {
    const notif = await prisma.notification.findFirst({
      where: { userId: adminExists.id, title: 'Welcome to ClaimsIntell' },
    });
    if (!notif) {
      await prisma.notification.create({
        data: {
          userId: adminExists.id,
          type: 'SYSTEM',
          title: 'Welcome to ClaimsIntell',
          body: 'System has been seeded with test data.',
        },
      });
    }
  }

  const conn = await prisma.gmailConnector.findFirst({ where: { email: 'qa.inbox@claimsintell.com' } });
  if (!conn) {
    await prisma.gmailConnector.create({
      data: {
        orgId: org.id,
        email: 'qa.inbox@claimsintell.com',
        oauthTokens: '{"access_token":"dummy"}',
        status: 'CONNECTED',
        lastSyncAt: new Date(),
      },
    });
  }
  console.log('  Notifications and connectors ready');

  // ── Phase 6b: seedClaim helper + sample claims (deferred to Phase 14) ──
  // The seedClaim helper is defined here but calls are in Phase 14 after members/providers exist.

  console.log('\n--- Defining claim seeding helper ---');

  // Helper to create a claim with full data, coding, documents, and audit trail
  async function seedClaim(opts: {
    ref: string;
    status: string;
    memberIndex: number;
    providerName: string;
    claimant: any;
    policy: any;
    incident: any;
    treatment: any;
    financials: any | null;
    coverageAnalysis: any | null;
    overallConfidence: number | null;
    codes: Array<{ code: string; codeType: string; description: string; confidence: number; isPrimary: boolean }>;
    /**
     * Audit events follow the production convention used by audit.service.ts and
     * processing.worker.ts: eventType is a category (INGESTION, CLAIM_PROCESS,
     * CLAIM_EXTRACT, CLAIM_CODING, CLAIM_VALIDATE, CLAIM_COVERAGE,
     * CLAIM_ADJUDICATE, CLAIM_EDI, CLAIM_STATUS, CLAIM_CORRESPONDENCE,
     * CLAIM_FINANCIALS, VALIDATION_CHECK, CLAIM_STATUS_CHANGE, etc.) and
     * action is the specific action code (INGEST_SUCCESS, START_PROCESSING,
     * CODES_EXTRACTED, COVERAGE_CALCULATED, CLAIM_DENIED, …). Optional
     * `details` is a free-form JSON payload mirroring the production schema.
     */
    auditEvents: Array<{
      eventType: string;
      action: string;
      details?: Record<string, unknown>;
      actorType?: string;
    }>;
    completedAt?: Date | null;
    priority?: number;
  }) {
    const existing = await prisma.claim.findFirst({ where: { claimReference: opts.ref } });
    if (existing) return existing;

    const member = createdMembers[opts.memberIndex];
    if (!member) throw new Error(`Member at index ${opts.memberIndex} not found`);
    const memberDef = MEMBERS[opts.memberIndex];

    const c = await prisma.claim.create({
      data: {
        orgId: org!.id,
        clientId: client1!.id,
        teamId: team1!.id,
        claimReference: opts.ref,
        status: opts.status as any,
        assignedTo: adminExists?.id ?? undefined,
        priority: opts.priority ?? 50,
        claimant: opts.claimant,
        policy: opts.policy,
        incident: opts.incident,
        treatment: opts.treatment,
        financials: opts.financials ?? undefined,
        coverageAnalysis: opts.coverageAnalysis ?? undefined,
        overallConfidence: opts.overallConfidence,
        completedAt: opts.completedAt ?? null,
      },
    });

    // Link member
    await prisma.memberClaim.create({
      data: { memberId: member.id, claimId: c.id },
    });

    // Link provider
    const provider = createdProviders.find((p) => p.providerName === opts.providerName);
    if (provider) {
      await prisma.providerClaim.create({
        data: { providerId: provider.id, claimId: c.id },
      });
    }

    // Document
    await prisma.claimDocument.create({
      data: {
        claimId: c.id,
        fileKey: `claims/${opts.ref}/invoice.pdf`,
        originalFilename: `${opts.ref}-invoice.pdf`,
        mimeType: 'application/pdf',
        fileSizeBytes: 204800,
        docType: 'INVOICE',
        processingStatus: 'COMPLETED',
      },
    });

    // Coding
    for (const code of opts.codes) {
      await prisma.claimCoding.create({
        data: {
          claimId: c.id,
          code: code.code,
          codeType: code.codeType as any,
          description: code.description,
          confidence: code.confidence,
          isPrimary: code.isPrimary,
        },
      });
    }

    // Audit events — structure matches AuditService.logEvent in production
    for (const evt of opts.auditEvents) {
      await prisma.auditEvent.create({
        data: {
          eventType: evt.eventType,
          actorType: evt.actorType ?? 'SYSTEM',
          targetType: 'CLAIM',
          targetId: c.id,
          action: evt.action,
          details: (evt.details ?? {}) as Prisma.InputJsonValue,
        },
      });
    }

    console.log(`  Created claim: ${opts.ref} (${opts.status}) - ${memberDef.firstName} ${memberDef.lastName}`);
    return c;
  }

  // NOTE: seedClaim() calls are in Phase 14, after members and providers are created.

  // ══════════════════════════════════════════════════════════
  // ── Phase 7: (was previously here — moved to Phase 6) ──
  // ══════════════════════════════════════════════════════════

  // ══════════════════════════════════════════════════════════
  // ANCHOR_PHASE_7_PLACEHOLDER
  // ══════════════════════════════════════════════════════════

  // ══════════════════════════════════════════════════════════
  // ── Phase 8: Bupa Global Health Plans ──
  // ══════════════════════════════════════════════════════════

  console.log('\n--- Seeding Bupa Global Health Plans ---');

  const planIdMap: Record<string, string> = {};

  for (const planDef of HEALTH_PLANS) {
    const plan = await prisma.healthPlan.create({
      data: {
        name: planDef.name,
        tier: planDef.tier,
        annualMaximumUsd: planDef.annualMaximumUsd,
        annualMaximumHkd: planDef.annualMaximumHkd,
        geographicOptions: planDef.geographicOptions,
        networkOptions: planDef.networkOptions,
        deductibleOptions: planDef.deductibleOptions,
        coInsuranceOption: planDef.coInsuranceOption ?? Prisma.DbNull,
        benefits: planDef.benefits,
        exclusions: planDef.exclusions,
        waitingPeriods: planDef.waitingPeriods,
        effectiveFrom: planDef.effectiveFrom,
        effectiveTo: planDef.effectiveTo,
      },
    });
    planIdMap[planDef.tier] = plan.id;
    console.log(`  Created health plan: ${planDef.name} (${planDef.tier})`);
  }

  // ══════════════════════════════════════════════════════════
  // ── Phase 9: Member Group ──
  // ══════════════════════════════════════════════════════════

  console.log('\n--- Seeding Member Group ---');

  const acmeGroup = await prisma.memberGroup.create({
    data: {
      groupName: 'Acme Corporation Group Plan',
      companyName: 'Acme Corporation',
      contactEmail: 'hr@acmecorp.com',
    },
  });
  console.log(`  Created member group: ${acmeGroup.companyName}`);

  // ══════════════════════════════════════════════════════════
  // ── Phase 10: Members ──
  // ══════════════════════════════════════════════════════════

  console.log('\n--- Seeding Members ---');

  // Members at indices 0 (Johnny Depp), 4 (Sophie Laurent), 5 (Raj Patel) belong to Acme group
  const ACME_MEMBER_INDICES = [0, 4, 5];

  for (let i = 0; i < MEMBERS.length; i++) {
    const m = MEMBERS[i];
    const groupId = ACME_MEMBER_INDICES.includes(i) ? acmeGroup.id : null;

    const member = await prisma.member.create({
      data: {
        membershipNumber: m.membershipNumber,
        groupId,
        title: m.title,
        firstName: m.firstName,
        lastName: m.lastName,
        dateOfBirth: m.dateOfBirth,
        email: m.email,
        phone: m.phone,
        address: m.address,
        preferredLanguage: m.preferredLanguage,
        planId: planIdMap[m.planTier],
        planTier: m.planTier,
        policyStartDate: m.policyStartDate,
        policyEndDate: m.policyEndDate,
        deductibleAmount: m.deductibleAmount,
        deductibleCurrency: m.deductibleCurrency,
        deductibleUsed: m.deductibleUsed,
        coInsuranceRate: m.coInsuranceRate,
        networkOption: m.networkOption,
        geographicCover: m.geographicCover,
        preExistingConditions: m.preExistingConditions,
        status: m.status,
        renewalDate: m.renewalDate,
      },
    });
    createdMembers.push({ id: member.id, membershipNumber: member.membershipNumber });
    console.log(`  Created member: ${m.firstName} ${m.lastName} (${m.membershipNumber})`);
  }

  // ══════════════════════════════════════════════════════════
  // ── Phase 11: Payment Details ──
  // ══════════════════════════════════════════════════════════

  console.log('\n--- Seeding Payment Details ---');

  for (const pd of PAYMENT_DETAILS_CONFIG) {
    const memberId = createdMembers[pd.memberIndex].id;
    await prisma.paymentDetail.create({
      data: {
        memberId,
        payeeType: pd.payeeType,
        method: pd.method,
        bankName: pd.bankName,
        swiftCode: pd.swiftCode,
        accountNumber: pd.accountNumber,
        sortCode: pd.sortCode,
        iban: pd.iban,
        accountHolderName: pd.accountHolderName,
        accountCurrency: pd.accountCurrency,
        chequeCurrency: pd.chequeCurrency,
        isDefault: pd.isDefault,
      },
    });
    console.log(`  Created payment details for member index ${pd.memberIndex}: ${pd.bankName}`);
  }

  // ══════════════════════════════════════════════════════════
  // ── Phase 12: Providers ──
  // ══════════════════════════════════════════════════════════

  console.log('\n--- Seeding Providers ---');

  for (const prov of PROVIDERS) {
    const provider = await prisma.provider.create({
      data: {
        providerName: prov.providerName,
        facilityName: prov.facilityName,
        providerType: prov.providerType,
        specialty: prov.specialty,
        licenseNumber: prov.licenseNumber,
        address: prov.address,
        email: prov.email,
        phone: prov.phone,
        networkStatus: prov.networkStatus,
        networkType: prov.networkType,
        bupaProviderId: prov.bupaProviderId,
        accreditationStatus: prov.accreditationStatus,
        country: prov.country,
        defaultCurrency: prov.defaultCurrency,
        lastVerifiedAt: prov.lastVerifiedAt,
      },
    });
    createdProviders.push({
      id: provider.id,
      providerName: prov.providerName,
      networkStatus: prov.networkStatus,
    });
    console.log(`  Created provider: ${prov.providerName} (${prov.country})`);
  }

  // ══════════════════════════════════════════════════════════
  // ── Phase 13: Provider Network Mappings ──
  // ══════════════════════════════════════════════════════════

  console.log('\n--- Seeding Provider Network Mappings ---');

  const ALL_PLAN_TIERS: Array<'MAJOR_MEDICAL' | 'SELECT' | 'PREMIER' | 'ELITE' | 'ULTIMATE'> = [
    'MAJOR_MEDICAL', 'SELECT', 'PREMIER', 'ELITE', 'ULTIMATE',
  ];

  // Only create mappings for in-network providers (indices 0-6)
  const inNetworkProviders = createdProviders.filter((p) => p.networkStatus === 'IN_NETWORK');

  let mappingCount = 0;
  for (const provider of inNetworkProviders) {
    for (const tier of ALL_PLAN_TIERS) {
      await prisma.providerNetworkMapping.create({
        data: {
          providerId: provider.id,
          planTier: tier,
          isInNetwork: true,
          negotiatedRates: {
            consultationDiscount: tier === 'ULTIMATE' ? 0.20 : tier === 'ELITE' ? 0.15 : 0.10,
            procedureDiscount: tier === 'ULTIMATE' ? 0.25 : tier === 'ELITE' ? 0.20 : 0.12,
            roomRateAgreed: true,
          },
        },
      });
      mappingCount++;
    }
  }
  console.log(`  Created ${mappingCount} provider-network mappings for ${inNetworkProviders.length} in-network providers across ${ALL_PLAN_TIERS.length} plan tiers`);

  // ══════════════════════════════════════════════════════════


  // ══════════════════════════════════════════════════════════
  // ── Phase 14: Sample Claims (after members/providers exist) ──
  // ══════════════════════════════════════════════════════════

  console.log('\n--- Seeding sample claims ---');

  // ── TC-001: Standard Inpatient Surgery (Johnny Depp, PREMIER, HK) ──
  await seedClaim({
    ref: 'CLM-2026-A1B2C',
    status: 'COMPLETE',
    memberIndex: 0,
    providerName: 'Hong Kong Sanatorium & Hospital',
    claimant: {
      membershipNumber: 'BI-6000-9000-9009',
      firstName: 'Johnny',
      lastName: 'Depp',
      dateOfBirth: '1963-06-09',
      email: 'johnny.depp@example.com',
    },
    policy: {
      planTier: 'PREMIER',
      policyNumber: 'BI-6000-9000-9009',
      policyStartDate: '2025-04-01',
      policyEndDate: '2026-03-31',
      networkOption: 'COMPREHENSIVE',
      geographicCover: 'WORLDWIDE',
    },
    incident: {
      description: 'Gallstone attack requiring emergency surgery',
      symptomStartDate: '2026-03-10',
      treatmentDate: '2026-03-15',
    },
    treatment: {
      treatmentType: 'inpatient',
      treatmentCountry: 'HK',
      treatmentDate: '2026-03-15',
      admissionDate: '2026-03-15',
      dischargeDate: '2026-03-18',
      practitionerName: 'Dr. Sarah Lam',
      facilityName: 'Hong Kong Sanatorium & Hospital',
      treatmentDescription: 'Laparoscopic cholecystectomy for symptomatic gallstones',
      reasonForTreatment: 'Calculus of gallbladder with chronic cholecystitis',
    },
    financials: {
      totalClaimed: 48000,
      claimCurrency: 'HKD',
      currency: 'HKD',
      totalPayable: 42857.14,
      paymentCurrency: 'HKD',
      deductibleApplied: 1500,
      coInsuranceApplied: 0,
      networkPenaltyApplied: 0,
      fxRate: null,
      itemisedCharges: [
        { description: 'Laparoscopic cholecystectomy', amount: 35000, covered: true },
        { description: 'Hospital room (3 nights, private)', amount: 9000, covered: true },
        { description: 'Anaesthesia', amount: 2000, covered: true },
        { description: 'Follow-up consultation', amount: 2000, covered: true },
      ],
      payeeType: 'MEMBER',
      paymentMethod: 'BANK_TRANSFER',
      eobSummary: 'EXPLANATION OF BENEFITS\nMember: Johnny Depp (BI-6000-9000-9009)\nPlan: PREMIER\n\nTotal Claimed: HKD 48,000.00\nDeductible Applied: HKD 1,500.00 (annual deductible)\nCo-Insurance: HKD 0.00\n---\nTotal Payable: HKD 42,857.14',
    },
    coverageAnalysis: {
      decision: 'PARTIALLY_COVERED',
      planTier: 'PREMIER',
      annualMaximum: { limit: 5000000, currency: 'USD' },
      exclusionsTriggered: [],
      lineItems: [
        { description: 'Laparoscopic cholecystectomy', decision: 'COVERED', amount: 35000 },
        { description: 'Hospital room', decision: 'COVERED', amount: 9000 },
        { description: 'Anaesthesia', decision: 'COVERED', amount: 2000 },
        { description: 'Follow-up consultation', decision: 'COVERED', amount: 2000 },
      ],
    },
    overallConfidence: 0.92,
    codes: [
      { code: 'K80.10', codeType: 'ICD10', description: 'Calculus of gallbladder with chronic cholecystitis', confidence: 0.92, isPrimary: true },
      { code: 'K81.0', codeType: 'ICD10', description: 'Acute cholecystitis', confidence: 0.85, isPrimary: false },
      { code: '47562', codeType: 'CPT', description: 'Laparoscopic cholecystectomy', confidence: 0.94, isPrimary: false },
    ],
    auditEvents: [
      { eventType: 'INGESTION', action: 'INGEST_SUCCESS', details: { source: 'EMAIL', subject: 'Claim - Johnny Depp - HKSH gallbladder surgery' } },
      { eventType: 'CLAIM_PROCESS', action: 'START_PROCESSING', details: { stage: 'INGESTING' } },
      { eventType: 'CLAIM_EXTRACT', action: 'FINANCIALS_EXTRACTED', details: { totalClaimed: 48000, currency: 'HKD', lineItemCount: 4 } },
      { eventType: 'CLAIM_EXTRACT', action: 'MEMBER_EXTRACTED', details: { membershipNumber: 'BI-6000-9000-9009', language: 'english' } },
      { eventType: 'CLAIM_VALIDATE', action: 'MEMBER_VALIDATED', details: { membershipNumber: 'BI-6000-9000-9009', planTier: 'PREMIER', isValid: true } },
      { eventType: 'CLAIM_VALIDATE', action: 'COMPLETENESS_CHECKED', details: { score: 0.95, decision: 'PROCEED' } },
      { eventType: 'CLAIM_CODING', action: 'CODES_EXTRACTED', details: { icd10: ['K80.10', 'K81.0'], cpt: ['47562'], primaryCode: 'K80.10' } },
      { eventType: 'CLAIM_VALIDATE', action: 'CLINICAL_VALIDATED', details: { score: 0.92, decision: 'PROCEED' } },
      { eventType: 'CLAIM_COVERAGE', action: 'COVERAGE_CALCULATED', details: { decision: 'PARTIALLY_COVERED', deductibleApplied: 1500, totalPayable: 42857.14 } },
      { eventType: 'CLAIM_ADJUDICATE', action: 'DECISION_MADE', details: { decision: 'APPROVED', payeeType: 'MEMBER' } },
      { eventType: 'CLAIM_EDI', action: 'EDI_GENERATED', details: { ediType: '837I', payable: 42857.14 } },
      { eventType: 'CLAIM_STATUS', action: 'CLAIM_COMPLETE', details: { stp: true, finalStatus: 'COMPLETE' } },
    ],
    completedAt: new Date('2026-03-15T10:31:24Z'),
  });

  // ── TC-002: Outpatient Chinese Claim (Maria Chen, ULTIMATE, CN) ──
  await seedClaim({
    ref: 'CLM-2026-D3E4F',
    status: 'COMPLETE',
    memberIndex: 1,
    providerName: 'Shanghai First People\'s Hospital',
    claimant: {
      membershipNumber: 'BI-6001-1234-5678',
      firstName: 'Maria',
      lastName: 'Chen',
      dateOfBirth: '1985-03-15',
      email: 'rahul@quickscribe.co',
    },
    policy: {
      planTier: 'ULTIMATE',
      policyNumber: 'BI-6001-1234-5678',
      policyStartDate: '2025-01-01',
      policyEndDate: '2025-12-31',
      networkOption: 'COMPREHENSIVE',
      geographicCover: 'WORLDWIDE',
    },
    incident: {
      description: 'Routine hypertension follow-up and blood work',
      symptomStartDate: '2025-11-01',
      treatmentDate: '2026-02-20',
    },
    treatment: {
      treatmentType: 'outpatient',
      treatmentCountry: 'CN',
      treatmentDate: '2026-02-20',
      practitionerName: 'Dr. Zhang Wei',
      facilityName: 'Shanghai First People\'s Hospital',
      treatmentDescription: 'Specialist consultation and comprehensive blood panel',
      reasonForTreatment: 'Essential hypertension follow-up',
      language: 'Chinese',
    },
    financials: {
      totalClaimed: 3500,
      claimCurrency: 'CNY',
      currency: 'CNY',
      totalPayable: 3500,
      paymentCurrency: 'CNY',
      deductibleApplied: 0,
      coInsuranceApplied: 0,
      networkPenaltyApplied: 0,
      fxRate: null,
      itemisedCharges: [
        { description: 'Specialist consultation', amount: 1500, covered: true },
        { description: 'Comprehensive blood panel', amount: 1200, covered: true },
        { description: 'ECG', amount: 500, covered: true },
        { description: 'Prescription medication', amount: 300, covered: true },
      ],
      payeeType: 'MEMBER',
      paymentMethod: 'BANK_TRANSFER',
      eobSummary: 'EXPLANATION OF BENEFITS\nMember: Maria Chen (BI-6001-1234-5678)\nPlan: ULTIMATE\n\nTotal Claimed: CNY 3,500.00\nDeductible Applied: CNY 0.00 (ULTIMATE - no deductible)\nCo-Insurance: CNY 0.00\n---\nTotal Payable: CNY 3,500.00\n\nFully covered under ULTIMATE plan.',
    },
    coverageAnalysis: {
      decision: 'FULLY_COVERED',
      planTier: 'ULTIMATE',
      annualMaximum: { limit: null, currency: 'USD', unlimited: true },
      exclusionsTriggered: [],
    },
    overallConfidence: 0.89,
    codes: [
      { code: 'I10', codeType: 'ICD10', description: 'Essential (primary) hypertension', confidence: 0.91, isPrimary: true },
      { code: '99213', codeType: 'CPT', description: 'Office/outpatient visit, established patient', confidence: 0.90, isPrimary: false },
    ],
    auditEvents: [
      { eventType: 'INGESTION', action: 'INGEST_SUCCESS', details: { source: 'EMAIL', subject: 'Maria Chen - Shanghai hypertension follow-up' } },
      { eventType: 'CLAIM_PROCESS', action: 'START_PROCESSING', details: { stage: 'INGESTING' } },
      { eventType: 'CLAIM_EXTRACT', action: 'FINANCIALS_EXTRACTED', details: { totalClaimed: 3500, currency: 'CNY', language: 'Chinese' } },
      { eventType: 'CLAIM_EXTRACT', action: 'TRANSLATION_COMPLETE', details: { from: 'zh-CN', to: 'en', model: 'claude-haiku' } },
      { eventType: 'CLAIM_VALIDATE', action: 'MEMBER_VALIDATED', details: { membershipNumber: 'BI-6001-1234-5678', planTier: 'ULTIMATE', isValid: true } },
      { eventType: 'CLAIM_CODING', action: 'CODES_EXTRACTED', details: { icd10: ['I10'], cpt: ['99213'], primaryCode: 'I10' } },
      { eventType: 'CLAIM_COVERAGE', action: 'COVERAGE_CALCULATED', details: { decision: 'FULLY_COVERED', totalPayable: 3500 } },
      { eventType: 'CLAIM_ADJUDICATE', action: 'DECISION_MADE', details: { decision: 'APPROVED' } },
      { eventType: 'CLAIM_STATUS', action: 'CLAIM_COMPLETE', details: { stp: true } },
    ],
    completedAt: new Date('2026-02-20T14:22:00Z'),
  });

  // ── TC-009: Cosmetic Treatment Denial ──
  await seedClaim({
    ref: 'CLM-2026-G5H6I',
    status: 'DENIED',
    memberIndex: 6,
    providerName: 'Harley Street Clinic',
    claimant: {
      membershipNumber: 'BI-6006-6789-0123',
      firstName: 'Hans',
      lastName: 'Mueller',
      dateOfBirth: '1972-08-14',
      email: 'hans.mueller@example.com',
    },
    policy: {
      planTier: 'ELITE',
      policyNumber: 'BI-6006-6789-0123',
      policyStartDate: '2025-05-01',
      policyEndDate: '2026-04-30',
    },
    incident: {
      description: 'Cosmetic rhinoplasty for aesthetic improvement',
      symptomStartDate: null,
      treatmentDate: '2026-03-01',
    },
    treatment: {
      treatmentType: 'outpatient',
      treatmentCountry: 'GB',
      treatmentDate: '2026-03-01',
      practitionerName: 'Dr. James Hartley',
      facilityName: 'The Harley Street Clinic',
      treatmentDescription: 'Cosmetic rhinoplasty for aesthetic improvement',
      reasonForTreatment: 'Encounter for cosmetic surgery',
    },
    financials: {
      totalClaimed: 8500,
      claimCurrency: 'GBP',
      currency: 'GBP',
      totalPayable: 0,
      paymentCurrency: 'GBP',
      deductibleApplied: 0,
      coInsuranceApplied: 0,
      networkPenaltyApplied: 0,
      itemisedCharges: [
        { description: 'Rhinoplasty procedure', amount: 7000, covered: false },
        { description: 'Anaesthesia', amount: 1000, covered: false },
        { description: 'Post-op dressing', amount: 500, covered: false },
      ],
      payeeType: 'MEMBER',
      paymentMethod: 'BANK_TRANSFER',
      eobSummary: 'EXPLANATION OF BENEFITS\nMember: Hans Mueller (BI-6006-6789-0123)\nPlan: ELITE\n\nTotal Claimed: GBP 8,500.00\nCoverage Decision: NOT COVERED\nDenial Reason: Cosmetic/aesthetic treatment is a global exclusion.\n---\nTotal Payable: GBP 0.00',
    },
    coverageAnalysis: {
      decision: 'NOT_COVERED',
      planTier: 'ELITE',
      exclusionsTriggered: ['Cosmetic or aesthetic treatment'],
      denialReason: 'Global exclusion: cosmetic treatment',
    },
    overallConfidence: 0.88,
    codes: [
      { code: 'Z41.1', codeType: 'ICD10', description: 'Encounter for cosmetic surgery', confidence: 0.93, isPrimary: true },
      { code: '30400', codeType: 'CPT', description: 'Rhinoplasty, primary', confidence: 0.90, isPrimary: false },
    ],
    auditEvents: [
      { eventType: 'INGESTION', action: 'INGEST_SUCCESS', details: { source: 'EMAIL' } },
      { eventType: 'CLAIM_PROCESS', action: 'START_PROCESSING' },
      { eventType: 'CLAIM_CODING', action: 'CODES_EXTRACTED', details: { icd10: ['Z41.1'], cpt: ['30400'], primaryCode: 'Z41.1' } },
      { eventType: 'CLAIM_VALIDATE', action: 'CLINICAL_VALIDATED', details: { score: 0.45, decision: 'COSMETIC_FLAGGED' } },
      { eventType: 'CLAIM_COVERAGE', action: 'COVERAGE_CALCULATED', details: { decision: 'NOT_COVERED', exclusionsTriggered: ['Cosmetic or aesthetic treatment'] } },
      { eventType: 'CLAIM_ADJUDICATE', action: 'DECISION_MADE', details: { decision: 'DENIED', reason: 'Global exclusion: cosmetic treatment' } },
      { eventType: 'CLAIM_STATUS', action: 'CLAIM_DENIED', details: { reason: 'Global exclusion: cosmetic treatment' } },
    ],
  });

  // ── TC-013: MAJOR_MEDICAL Dental Denial (Sophie Laurent) ──
  await seedClaim({
    ref: 'CLM-2026-J7K8L',
    status: 'DENIED',
    memberIndex: 4,
    providerName: 'Bangkok Dental Clinic',
    claimant: {
      membershipNumber: 'BI-6004-4567-8901',
      firstName: 'Sophie',
      lastName: 'Laurent',
      dateOfBirth: '1975-12-03',
      email: 'rahul@quickscribe.co',
    },
    policy: {
      planTier: 'MAJOR_MEDICAL',
      policyNumber: 'BI-6004-4567-8901',
      policyStartDate: '2025-07-01',
      policyEndDate: '2026-06-30',
    },
    incident: {
      description: 'Routine dental cleaning and check-up',
      treatmentDate: '2026-02-10',
    },
    treatment: {
      treatmentType: 'outpatient',
      treatmentCountry: 'FR',
      treatmentDate: '2026-02-10',
      practitionerName: 'Dr. Pierre Dubois',
      facilityName: 'Cabinet Dentaire Dubois',
      treatmentDescription: 'Dental cleaning and check-up',
      reasonForTreatment: 'Routine dental care',
      category: 'DENTAL',
    },
    financials: {
      totalClaimed: 200,
      claimCurrency: 'EUR',
      currency: 'EUR',
      totalPayable: 0,
      paymentCurrency: 'EUR',
      deductibleApplied: 0,
      coInsuranceApplied: 0,
      networkPenaltyApplied: 0,
      itemisedCharges: [
        { description: 'Dental cleaning', amount: 120, covered: false },
        { description: 'Dental check-up and X-ray', amount: 80, covered: false },
      ],
      payeeType: 'MEMBER',
      paymentMethod: 'BANK_TRANSFER',
      eobSummary: 'EXPLANATION OF BENEFITS\nMember: Sophie Laurent (BI-6004-4567-8901)\nPlan: MAJOR_MEDICAL\n\nTotal Claimed: EUR 200.00\nCoverage Decision: NOT COVERED\nDenial Reason: Dental treatment is not covered under MAJOR_MEDICAL plan.\n---\nTotal Payable: EUR 0.00',
    },
    coverageAnalysis: {
      decision: 'NOT_COVERED',
      planTier: 'MAJOR_MEDICAL',
      exclusionsTriggered: ['Dental treatment (not covered under this plan)'],
      denialReason: 'Dental not covered under MAJOR_MEDICAL plan',
    },
    overallConfidence: 0.95,
    codes: [
      { code: 'Z01.20', codeType: 'ICD10', description: 'Encounter for dental examination and cleaning', confidence: 0.96, isPrimary: true },
      { code: 'D1110', codeType: 'CPT', description: 'Prophylaxis - adult', confidence: 0.94, isPrimary: false },
    ],
    auditEvents: [
      { eventType: 'INGESTION', action: 'INGEST_SUCCESS', details: { source: 'EMAIL' } },
      { eventType: 'CLAIM_PROCESS', action: 'START_PROCESSING' },
      { eventType: 'CLAIM_CODING', action: 'CODES_EXTRACTED', details: { icd10: ['Z01.20'], cpt: ['D1110'], primaryCode: 'Z01.20' } },
      { eventType: 'CLAIM_COVERAGE', action: 'COVERAGE_CALCULATED', details: { decision: 'NOT_COVERED', exclusionsTriggered: ['Dental treatment (not covered under this plan)'] } },
      { eventType: 'CLAIM_ADJUDICATE', action: 'DECISION_MADE', details: { decision: 'DENIED', reason: 'Dental not covered under MAJOR_MEDICAL plan' } },
      { eventType: 'CLAIM_STATUS', action: 'CLAIM_DENIED', details: { reason: 'Dental not covered under MAJOR_MEDICAL plan' } },
    ],
  });

  // ── TC-014: ULTIMATE Full Coverage Surgery (Maria Chen) ──
  await seedClaim({
    ref: 'CLM-2026-M9N0P',
    status: 'COMPLETE',
    memberIndex: 1,
    providerName: 'Shanghai First People\'s Hospital',
    claimant: {
      membershipNumber: 'BI-6001-1234-5678',
      firstName: 'Maria',
      lastName: 'Chen',
      dateOfBirth: '1985-03-15',
    },
    policy: {
      planTier: 'ULTIMATE',
      policyNumber: 'BI-6001-1234-5678',
    },
    incident: {
      description: 'Scheduled appendectomy',
      symptomStartDate: '2026-03-05',
      treatmentDate: '2026-03-10',
    },
    treatment: {
      treatmentType: 'inpatient',
      treatmentCountry: 'CN',
      treatmentDate: '2026-03-10',
      admissionDate: '2026-03-10',
      dischargeDate: '2026-03-12',
      practitionerName: 'Dr. Li Ming',
      facilityName: 'Shanghai First People\'s Hospital',
      treatmentDescription: 'Laparoscopic appendectomy',
      reasonForTreatment: 'Acute appendicitis',
    },
    financials: {
      totalClaimed: 200000,
      claimCurrency: 'HKD',
      currency: 'HKD',
      totalPayable: 200000,
      paymentCurrency: 'HKD',
      deductibleApplied: 0,
      coInsuranceApplied: 0,
      networkPenaltyApplied: 0,
      fxRate: null,
      itemisedCharges: [
        { description: 'Laparoscopic appendectomy', amount: 150000, covered: true },
        { description: 'Hospital room (2 nights)', amount: 30000, covered: true },
        { description: 'Anaesthesia & drugs', amount: 15000, covered: true },
        { description: 'Post-op care', amount: 5000, covered: true },
      ],
      payeeType: 'MEMBER',
      paymentMethod: 'BANK_TRANSFER',
      eobSummary: 'EXPLANATION OF BENEFITS\nMember: Maria Chen (BI-6001-1234-5678)\nPlan: ULTIMATE\n\nTotal Claimed: HKD 200,000.00\nDeductible: HKD 0.00 (ULTIMATE - no deductible)\nCo-Insurance: HKD 0.00\n---\nTotal Payable: HKD 200,000.00\n\nFully covered.',
    },
    coverageAnalysis: {
      decision: 'FULLY_COVERED',
      planTier: 'ULTIMATE',
      annualMaximum: { limit: null, currency: 'USD', unlimited: true },
      exclusionsTriggered: [],
    },
    overallConfidence: 0.94,
    codes: [
      { code: 'K35.80', codeType: 'ICD10', description: 'Other and unspecified acute appendicitis', confidence: 0.93, isPrimary: true },
      { code: '44970', codeType: 'CPT', description: 'Laparoscopic appendectomy', confidence: 0.95, isPrimary: false },
    ],
    auditEvents: [
      { eventType: 'INGESTION', action: 'INGEST_SUCCESS', details: { source: 'EMAIL' } },
      { eventType: 'CLAIM_PROCESS', action: 'START_PROCESSING' },
      { eventType: 'CLAIM_EXTRACT', action: 'FINANCIALS_EXTRACTED', details: { totalClaimed: 200000, currency: 'HKD', lineItemCount: 4 } },
      { eventType: 'CLAIM_VALIDATE', action: 'MEMBER_VALIDATED', details: { membershipNumber: 'BI-6001-1234-5678', planTier: 'ULTIMATE', isValid: true } },
      { eventType: 'CLAIM_VALIDATE', action: 'COMPLETENESS_CHECKED', details: { score: 0.95, decision: 'PROCEED' } },
      { eventType: 'CLAIM_CODING', action: 'CODES_EXTRACTED', details: { icd10: ['K35.80'], cpt: ['44970'], primaryCode: 'K35.80' } },
      { eventType: 'CLAIM_COVERAGE', action: 'COVERAGE_CALCULATED', details: { decision: 'FULLY_COVERED', totalPayable: 200000 } },
      { eventType: 'CLAIM_ADJUDICATE', action: 'DECISION_MADE', details: { decision: 'APPROVED' } },
      { eventType: 'CLAIM_EDI', action: 'EDI_GENERATED', details: { ediType: '837I' } },
      { eventType: 'CLAIM_STATUS', action: 'CLAIM_COMPLETE', details: { stp: true } },
    ],
    completedAt: new Date('2026-03-12T16:00:00Z'),
  });

  // ── TC-015: SELECT Plan with Deductible + Co-Insurance (Yuki Tanaka) ──
  await seedClaim({
    ref: 'CLM-2026-Q1R2S',
    status: 'COMPLETE',
    memberIndex: 3,
    providerName: 'Tokyo Medical University Hospital',
    claimant: {
      membershipNumber: 'BI-6003-3456-7890',
      firstName: 'Yuki',
      lastName: 'Tanaka',
      dateOfBirth: '1990-07-08',
    },
    policy: {
      planTier: 'SELECT',
      policyNumber: 'BI-6003-3456-7890',
      deductible: { total: 1500, used: 500, remaining: 1000 },
      coInsuranceRate: 0.15,
    },
    incident: {
      description: 'Specialist consultation for persistent back pain',
      symptomStartDate: '2026-01-15',
      treatmentDate: '2026-02-28',
    },
    treatment: {
      treatmentType: 'outpatient',
      treatmentCountry: 'JP',
      treatmentDate: '2026-02-28',
      practitionerName: 'Dr. Takeshi Yamamoto',
      facilityName: 'Tokyo Medical University Hospital',
      treatmentDescription: 'Specialist consultation, MRI, and physical therapy assessment',
      reasonForTreatment: 'Chronic lower back pain',
    },
    financials: {
      totalClaimed: 5000,
      claimCurrency: 'USD',
      currency: 'USD',
      totalPayable: 3400,
      paymentCurrency: 'USD',
      deductibleApplied: 1000,
      coInsuranceApplied: 600,
      networkPenaltyApplied: 0,
      fxRate: null,
      itemisedCharges: [
        { description: 'Specialist consultation', amount: 800, covered: true },
        { description: 'MRI lumbar spine', amount: 3200, covered: true },
        { description: 'Physical therapy assessment', amount: 1000, covered: true },
      ],
      payeeType: 'MEMBER',
      paymentMethod: 'BANK_TRANSFER',
      eobSummary: 'EXPLANATION OF BENEFITS\nMember: Yuki Tanaka (BI-6003-3456-7890)\nPlan: SELECT\n\nTotal Claimed: USD 5,000.00\nDeductible Applied: USD 1,000.00 (of $1,500 total, $500 previously used)\nAfter Deductible: USD 4,000.00\nCo-Insurance (15%): USD 600.00\n---\nTotal Payable: USD 3,400.00',
    },
    coverageAnalysis: {
      decision: 'PARTIALLY_COVERED',
      planTier: 'SELECT',
      annualMaximum: { limit: 4500000, currency: 'USD' },
      deductibleBreakdown: { total: 1500, previouslyUsed: 500, appliedThisClaim: 1000, remaining: 0 },
      coInsuranceBreakdown: { rate: 0.15, baseAmount: 4000, coInsuranceAmount: 600 },
      exclusionsTriggered: [],
    },
    overallConfidence: 0.90,
    codes: [
      { code: 'M54.5', codeType: 'ICD10', description: 'Low back pain', confidence: 0.91, isPrimary: true },
      { code: '99213', codeType: 'CPT', description: 'Office/outpatient visit, established patient', confidence: 0.88, isPrimary: false },
      { code: '72148', codeType: 'CPT', description: 'MRI lumbar spine without contrast', confidence: 0.92, isPrimary: false },
    ],
    auditEvents: [
      { eventType: 'INGESTION', action: 'INGEST_SUCCESS', details: { source: 'EMAIL' } },
      { eventType: 'CLAIM_PROCESS', action: 'START_PROCESSING' },
      { eventType: 'CLAIM_EXTRACT', action: 'FINANCIALS_EXTRACTED', details: { totalClaimed: 5000, currency: 'USD', lineItemCount: 3 } },
      { eventType: 'CLAIM_VALIDATE', action: 'MEMBER_VALIDATED', details: { membershipNumber: 'BI-6003-3456-7890', planTier: 'SELECT', isValid: true } },
      { eventType: 'CLAIM_CODING', action: 'CODES_EXTRACTED', details: { icd10: ['M54.5'], cpt: ['99213', '72148'], primaryCode: 'M54.5' } },
      { eventType: 'CLAIM_COVERAGE', action: 'COVERAGE_CALCULATED', details: { decision: 'PARTIALLY_COVERED', deductibleApplied: 1000, coInsuranceApplied: 600, totalPayable: 3400 } },
      { eventType: 'CLAIM_ADJUDICATE', action: 'DECISION_MADE', details: { decision: 'APPROVED' } },
      { eventType: 'CLAIM_EDI', action: 'EDI_GENERATED', details: { ediType: '837P' } },
      { eventType: 'CLAIM_STATUS', action: 'CLAIM_COMPLETE', details: { stp: true } },
    ],
    completedAt: new Date('2026-02-28T12:00:00Z'),
  });

  // ── TC-016: Out-of-Network Provider Penalty (Ahmed Al-Rashid, ELITE) ──
  await seedClaim({
    ref: 'CLM-2026-T3U4V',
    status: 'COMPLETE',
    memberIndex: 2,
    providerName: 'Dr. Sophie Martin Cardiology',
    claimant: {
      membershipNumber: 'BI-6002-2345-6789',
      firstName: 'Ahmed',
      lastName: 'Al-Rashid',
      dateOfBirth: '1978-11-22',
    },
    policy: {
      planTier: 'ELITE',
      policyNumber: 'BI-6002-2345-6789',
      deductible: { total: 4000, used: 1200, remaining: 2800 },
    },
    incident: {
      description: 'Cardiology consultation for hypertension management',
      symptomStartDate: '2025-06-01',
      treatmentDate: '2026-03-05',
    },
    treatment: {
      treatmentType: 'outpatient',
      treatmentCountry: 'FR',
      treatmentDate: '2026-03-05',
      practitionerName: 'Dr. Sophie Martin',
      facilityName: 'Cabinet de Cardiologie Dr. Martin',
      treatmentDescription: 'Cardiology consultation, ECG, stress test',
      reasonForTreatment: 'Essential hypertension monitoring',
    },
    financials: {
      totalClaimed: 10000,
      claimCurrency: 'USD',
      currency: 'USD',
      totalPayable: 4160,
      paymentCurrency: 'USD',
      deductibleApplied: 2800,
      coInsuranceApplied: 0,
      networkPenaltyApplied: 2000,
      fxRate: null,
      itemisedCharges: [
        { description: 'Cardiology consultation', amount: 3000, covered: true },
        { description: 'ECG and stress test', amount: 5000, covered: true },
        { description: 'Blood work panel', amount: 2000, covered: true },
      ],
      payeeType: 'MEMBER',
      paymentMethod: 'BANK_TRANSFER',
      eobSummary: 'EXPLANATION OF BENEFITS\nMember: Ahmed Al-Rashid (BI-6002-2345-6789)\nPlan: ELITE\n\nTotal Claimed: USD 10,000.00\nNetwork Penalty (20% - out-of-network): USD 2,000.00\nAfter Network Penalty: USD 8,000.00\nDeductible Applied: USD 2,800.00 (of $4,000 total, $1,200 previously used)\nAfter Deductible: USD 5,200.00\n---\nTotal Payable: USD 5,200.00',
    },
    coverageAnalysis: {
      decision: 'PARTIALLY_COVERED',
      planTier: 'ELITE',
      annualMaximum: { limit: 10000000, currency: 'USD' },
      networkPenalty: { rate: 0.20, amount: 2000, reason: 'Provider is out-of-network' },
      deductibleBreakdown: { total: 4000, previouslyUsed: 1200, appliedThisClaim: 2800, remaining: 0 },
      exclusionsTriggered: [],
    },
    overallConfidence: 0.87,
    codes: [
      { code: 'I10', codeType: 'ICD10', description: 'Essential (primary) hypertension', confidence: 0.94, isPrimary: true },
      { code: '93000', codeType: 'CPT', description: 'Electrocardiogram, routine ECG', confidence: 0.90, isPrimary: false },
      { code: '93015', codeType: 'CPT', description: 'Cardiovascular stress test', confidence: 0.88, isPrimary: false },
    ],
    auditEvents: [
      { eventType: 'INGESTION', action: 'INGEST_SUCCESS', details: { source: 'EMAIL' } },
      { eventType: 'CLAIM_PROCESS', action: 'START_PROCESSING' },
      { eventType: 'CLAIM_VALIDATE', action: 'PROVIDER_VALIDATED', details: { networkStatus: 'OUT_OF_NETWORK', penaltyRate: 0.20, penaltyAmount: 2000 } },
      { eventType: 'CLAIM_CODING', action: 'CODES_EXTRACTED', details: { icd10: ['I10'], cpt: ['93000', '93015'], primaryCode: 'I10' } },
      { eventType: 'CLAIM_COVERAGE', action: 'COVERAGE_CALCULATED', details: { decision: 'PARTIALLY_COVERED', deductibleApplied: 2800, networkPenaltyApplied: 2000, totalPayable: 5200 } },
      { eventType: 'CLAIM_ADJUDICATE', action: 'DECISION_MADE', details: { decision: 'APPROVED' } },
      { eventType: 'CLAIM_EDI', action: 'EDI_GENERATED', details: { ediType: '837P' } },
      { eventType: 'CLAIM_STATUS', action: 'CLAIM_COMPLETE', details: { stp: true } },
    ],
    completedAt: new Date('2026-03-05T15:30:00Z'),
  });

  // ── TC-017: Global Exclusion - Substance Abuse (Denied) ──
  await seedClaim({
    ref: 'CLM-2026-W5X6Y',
    status: 'DENIED',
    memberIndex: 9,
    providerName: 'Bumrungrad International Hospital',
    claimant: {
      membershipNumber: 'BI-6009-9012-3456',
      firstName: 'Carlos',
      lastName: 'Silva',
      dateOfBirth: '1980-06-25',
    },
    policy: {
      planTier: 'MAJOR_MEDICAL',
      policyNumber: 'BI-6009-9012-3456',
    },
    incident: {
      description: 'Substance abuse rehabilitation program',
      treatmentDate: '2026-02-15',
    },
    treatment: {
      treatmentType: 'inpatient',
      treatmentCountry: 'TH',
      treatmentDate: '2026-02-15',
      admissionDate: '2026-02-15',
      dischargeDate: '2026-03-15',
      practitionerName: 'Dr. Anong Siriwan',
      facilityName: 'Bumrungrad International Hospital',
      treatmentDescription: 'Substance abuse rehabilitation',
      reasonForTreatment: 'Alcohol dependence',
    },
    financials: {
      totalClaimed: 25000,
      claimCurrency: 'USD',
      currency: 'USD',
      totalPayable: 0,
      paymentCurrency: 'USD',
      deductibleApplied: 0,
      coInsuranceApplied: 0,
      networkPenaltyApplied: 0,
      itemisedCharges: [
        { description: 'Inpatient rehabilitation (30 days)', amount: 20000, covered: false },
        { description: 'Counselling sessions', amount: 3000, covered: false },
        { description: 'Medication', amount: 2000, covered: false },
      ],
      payeeType: 'MEMBER',
      paymentMethod: 'BANK_TRANSFER',
      eobSummary: 'EXPLANATION OF BENEFITS\nMember: Carlos Silva (BI-6009-9012-3456)\nPlan: MAJOR_MEDICAL\n\nTotal Claimed: USD 25,000.00\nCoverage Decision: NOT COVERED\nDenial Reason: Global exclusion - hazardous substance abuse.\n---\nTotal Payable: USD 0.00',
    },
    coverageAnalysis: {
      decision: 'NOT_COVERED',
      planTier: 'MAJOR_MEDICAL',
      exclusionsTriggered: ['hazardous substance abuse'],
      denialReason: 'Global exclusion: substance abuse',
    },
    overallConfidence: 0.91,
    codes: [
      { code: 'F10.20', codeType: 'ICD10', description: 'Alcohol dependence, uncomplicated', confidence: 0.95, isPrimary: true },
    ],
    auditEvents: [
      { eventType: 'INGESTION', action: 'INGEST_SUCCESS', details: { source: 'EMAIL' } },
      { eventType: 'CLAIM_PROCESS', action: 'START_PROCESSING' },
      { eventType: 'CLAIM_CODING', action: 'CODES_EXTRACTED', details: { icd10: ['F10.20'], primaryCode: 'F10.20' } },
      { eventType: 'CLAIM_COVERAGE', action: 'COVERAGE_CALCULATED', details: { decision: 'NOT_COVERED', exclusionsTriggered: ['hazardous substance abuse'] } },
      { eventType: 'CLAIM_ADJUDICATE', action: 'DECISION_MADE', details: { decision: 'DENIED', reason: 'Global exclusion: substance abuse' } },
      { eventType: 'CLAIM_STATUS', action: 'CLAIM_DENIED', details: { reason: 'Global exclusion: substance abuse' } },
    ],
  });

  // ── TC-004: Missing Member Info (Querying Member) ──
  await seedClaim({
    ref: 'CLM-2026-QRY01',
    status: 'QUERYING_MEMBER',
    memberIndex: 5,
    providerName: 'Bumrungrad International Hospital',
    claimant: {
      lastName: 'Patel',
      email: 'raj.patel@example.com',
    },
    policy: {},
    incident: {
      description: 'General consultation',
      treatmentDate: '2026-03-01',
    },
    treatment: {
      treatmentType: 'outpatient',
      treatmentCountry: 'IN',
      treatmentDate: '2026-03-01',
      treatmentDescription: 'General consultation',
      reasonForTreatment: 'Consultation',
      totalClaimedAmount: 5000,
      invoiceCurrency: 'HKD',
    },
    financials: null,
    coverageAnalysis: null,
    overallConfidence: null,
    codes: [],
    auditEvents: [
      { eventType: 'INGESTION', action: 'INGEST_SUCCESS', details: { source: 'EMAIL' } },
      { eventType: 'CLAIM_PROCESS', action: 'START_PROCESSING' },
      { eventType: 'CLAIM_VALIDATE', action: 'COMPLETENESS_CHECKED', details: { score: 0.55, decision: 'QUERY_REQUIRED', missingFields: ['membershipNumber', 'firstName', 'dateOfBirth'] } },
      { eventType: 'VALIDATION_CHECK', action: 'MANUAL_INTERVENTION_REQUIRED', details: { reason: 'Insufficient member identification' } },
      { eventType: 'CLAIM_CORRESPONDENCE', action: 'MISSING_INFO_REQUEST_SENT', details: { channel: 'EMAIL', recipient: 'raj.patel@example.com' } },
      { eventType: 'CLAIM_STATUS', action: 'CLAIM_ON_HOLD', details: { reason: 'Awaiting member response', newStatus: 'QUERYING_MEMBER' } },
    ],
  });

  // ── TC-026: Pre-Auth Required (Inpatient, ON_HOLD) ──
  await seedClaim({
    ref: 'CLM-2026-PA001',
    status: 'ON_HOLD',
    memberIndex: 7,
    providerName: 'Tokyo Medical University Hospital',
    claimant: {
      membershipNumber: 'BI-6007-7890-1234',
      firstName: 'Suki',
      lastName: 'Watanabe',
      dateOfBirth: '1992-03-22',
    },
    policy: {
      planTier: 'SELECT',
      policyNumber: 'BI-6007-7890-1234',
    },
    incident: {
      description: 'Scheduled knee replacement',
      treatmentDate: '2026-04-15',
    },
    treatment: {
      treatmentType: 'inpatient',
      treatmentCountry: 'JP',
      treatmentDate: '2026-04-15',
      practitionerName: 'Dr. Kenji Suzuki',
      facilityName: 'Tokyo Medical University Hospital',
      treatmentDescription: 'Total knee replacement surgery',
      reasonForTreatment: 'Osteoarthritis of knee',
    },
    financials: null,
    coverageAnalysis: null,
    overallConfidence: null,
    codes: [
      { code: 'M17.11', codeType: 'ICD10', description: 'Primary osteoarthritis, right knee', confidence: 0.89, isPrimary: true },
      { code: '27447', codeType: 'CPT', description: 'Total knee replacement', confidence: 0.91, isPrimary: false },
    ],
    auditEvents: [
      { eventType: 'INGESTION', action: 'INGEST_SUCCESS', details: { source: 'EMAIL' } },
      { eventType: 'CLAIM_PROCESS', action: 'START_PROCESSING' },
      { eventType: 'CLAIM_VALIDATE', action: 'PRE_AUTH_REQUIRED', details: { treatmentType: 'inpatient', plannedProcedure: 'Total knee replacement' } },
      { eventType: 'CLAIM_CORRESPONDENCE', action: 'PRE_AUTH_REMINDER_SENT', details: { channel: 'EMAIL', recipient: 'suki.watanabe@example.com' } },
      { eventType: 'CLAIM_STATUS', action: 'CLAIM_ON_HOLD', details: { reason: 'Awaiting pre-authorisation', newStatus: 'ON_HOLD' } },
    ],
  });

  // ── TC-010: Diagnosis-Procedure Mismatch (Escalated Clinical) ──
  await seedClaim({
    ref: 'CLM-2026-ESC01',
    status: 'ESCALATED_CLINICAL',
    memberIndex: 8,
    providerName: 'Mount Elizabeth Hospital',
    claimant: {
      membershipNumber: 'BI-6008-8901-2345',
      firstName: 'Li',
      lastName: 'Wei',
      dateOfBirth: '1968-05-30',
    },
    policy: {
      planTier: 'ULTIMATE',
      policyNumber: 'BI-6008-8901-2345',
    },
    incident: {
      description: 'Knee surgery with mismatched gallstone diagnosis',
      treatmentDate: '2026-03-20',
    },
    treatment: {
      treatmentType: 'inpatient',
      treatmentCountry: 'SG',
      treatmentDate: '2026-03-20',
      admissionDate: '2026-03-20',
      dischargeDate: '2026-03-22',
      practitionerName: 'Dr. Tan Wei Lin',
      facilityName: 'Mount Elizabeth Hospital',
      treatmentDescription: 'Total knee replacement surgery',
      reasonForTreatment: 'Gallstones (diagnosis does not match procedure)',
    },
    financials: null,
    coverageAnalysis: null,
    overallConfidence: 0.42,
    codes: [
      { code: 'K80.10', codeType: 'ICD10', description: 'Calculus of gallbladder with chronic cholecystitis', confidence: 0.85, isPrimary: true },
      { code: '27447', codeType: 'CPT', description: 'Total knee replacement', confidence: 0.87, isPrimary: false },
    ],
    auditEvents: [
      { eventType: 'INGESTION', action: 'INGEST_SUCCESS', details: { source: 'EMAIL' } },
      { eventType: 'CLAIM_PROCESS', action: 'START_PROCESSING' },
      { eventType: 'CLAIM_CODING', action: 'CODES_EXTRACTED', details: { icd10: ['K80.10'], cpt: ['27447'], primaryCode: 'K80.10' } },
      { eventType: 'CLAIM_VALIDATE', action: 'CLINICAL_VALIDATED', details: { score: 0.42, decision: 'CLINICAL_REVIEW_REQUIRED', reason: 'Diagnosis/procedure mismatch' } },
      { eventType: 'VALIDATION_CHECK', action: 'MANUAL_INTERVENTION_REQUIRED', details: { escalateTo: 'CLINICAL_REVIEWER' } },
      { eventType: 'CLAIM_STATUS', action: 'CLAIM_ON_HOLD', details: { reason: 'Escalated to clinical reviewer', newStatus: 'ESCALATED_CLINICAL' } },
    ],
  });

  // ── TC-018: FX Conversion Claim (Raj Patel, PREMIER) ──
  await seedClaim({
    ref: 'CLM-2026-FX001',
    status: 'COMPLETE',
    memberIndex: 5,
    providerName: 'Bumrungrad International Hospital',
    claimant: {
      membershipNumber: 'BI-6005-5678-9012',
      firstName: 'Raj',
      lastName: 'Patel',
      dateOfBirth: '1982-04-18',
    },
    policy: {
      planTier: 'PREMIER',
      policyNumber: 'BI-6005-5678-9012',
      deductible: { total: 1500, used: 0, remaining: 1500 },
    },
    incident: {
      description: 'General surgery consultation while travelling',
      treatmentDate: '2026-03-25',
    },
    treatment: {
      treatmentType: 'outpatient',
      treatmentCountry: 'TH',
      treatmentDate: '2026-03-25',
      practitionerName: 'Dr. Somchai Jiravong',
      facilityName: 'Bumrungrad International Hospital',
      treatmentDescription: 'Consultation and diagnostic imaging',
      reasonForTreatment: 'Abdominal pain evaluation',
    },
    financials: {
      totalClaimed: 78000,
      claimCurrency: 'HKD',
      currency: 'HKD',
      totalPayable: 6401.30,
      paymentCurrency: 'GBP',
      deductibleApplied: 1500,
      coInsuranceApplied: 0,
      networkPenaltyApplied: 0,
      fxRate: 0.1013,
      fxRateDescription: 'GBP/HKD via USD pivot: 0.79 / 7.82',
      itemisedCharges: [
        { description: 'Specialist consultation', amount: 18000, covered: true },
        { description: 'CT scan abdomen', amount: 35000, covered: true },
        { description: 'Blood panel', amount: 15000, covered: true },
        { description: 'Ultrasound', amount: 10000, covered: true },
      ],
      payeeType: 'MEMBER',
      paymentMethod: 'BANK_TRANSFER',
      eobSummary: 'EXPLANATION OF BENEFITS\nMember: Raj Patel (BI-6005-5678-9012)\nPlan: PREMIER\n\nTotal Claimed: HKD 78,000.00\nDeductible Applied: HKD 1,500.00\nAfter Deductible: HKD 76,500.00\nFX Rate: 0.1013 (HKD to GBP)\nPayment Amount: GBP 7,749.45\n---\nTotal Payable: GBP 7,749.45',
    },
    coverageAnalysis: {
      decision: 'PARTIALLY_COVERED',
      planTier: 'PREMIER',
      annualMaximum: { limit: 5000000, currency: 'USD' },
      exclusionsTriggered: [],
      fxConversion: { from: 'HKD', to: 'GBP', rate: 0.1013 },
    },
    overallConfidence: 0.86,
    codes: [
      { code: 'R10.9', codeType: 'ICD10', description: 'Unspecified abdominal pain', confidence: 0.84, isPrimary: true },
      { code: '99213', codeType: 'CPT', description: 'Office/outpatient visit', confidence: 0.88, isPrimary: false },
      { code: '74177', codeType: 'CPT', description: 'CT abdomen with contrast', confidence: 0.90, isPrimary: false },
    ],
    auditEvents: [
      { eventType: 'INGESTION', action: 'INGEST_SUCCESS', details: { source: 'EMAIL' } },
      { eventType: 'CLAIM_PROCESS', action: 'START_PROCESSING' },
      { eventType: 'CLAIM_EXTRACT', action: 'FINANCIALS_EXTRACTED', details: { totalClaimed: 78000, currency: 'HKD', lineItemCount: 4 } },
      { eventType: 'CLAIM_CODING', action: 'CODES_EXTRACTED', details: { icd10: ['R10.9'], cpt: ['99213', '74177'], primaryCode: 'R10.9' } },
      { eventType: 'CLAIM_COVERAGE', action: 'COVERAGE_CALCULATED', details: { decision: 'PARTIALLY_COVERED', deductibleApplied: 1500 } },
      { eventType: 'CLAIM_FINANCIALS', action: 'FX_CONVERSION_APPLIED', details: { fromCurrency: 'HKD', toCurrency: 'GBP', rate: 0.1013, sourceAmount: 76500, convertedAmount: 7749.45 } },
      { eventType: 'CLAIM_ADJUDICATE', action: 'DECISION_MADE', details: { decision: 'APPROVED', payeeType: 'MEMBER' } },
      { eventType: 'CLAIM_EDI', action: 'EDI_GENERATED', details: { ediType: '837P' } },
      { eventType: 'CLAIM_STATUS', action: 'CLAIM_COMPLETE', details: { stp: true } },
    ],
    completedAt: new Date('2026-03-25T14:00:00Z'),
  });

  // ── Additional pipeline-stage claims for UI testing ──

  // EXTRACTING state
  await seedClaim({
    ref: 'CLM-2026-EXT01',
    status: 'EXTRACTING',
    memberIndex: 6,
    providerName: 'American Hospital Dubai',
    claimant: {
      membershipNumber: 'BI-6006-6789-0123',
      firstName: 'Hans',
      lastName: 'Mueller',
    },
    policy: { planTier: 'ELITE' },
    incident: { description: 'Emergency room visit', treatmentDate: '2026-04-01' },
    treatment: {
      treatmentType: 'outpatient',
      treatmentCountry: 'AE',
      treatmentDate: '2026-04-01',
      facilityName: 'American Hospital Dubai',
    },
    financials: null,
    coverageAnalysis: null,
    overallConfidence: null,
    codes: [],
    auditEvents: [
      { eventType: 'INGESTION', action: 'INGEST_SUCCESS', details: { source: 'EMAIL' } },
      { eventType: 'CLAIM_PROCESS', action: 'START_PROCESSING', details: { stage: 'EXTRACTING' } },
    ],
  });

  // CODING state
  await seedClaim({
    ref: 'CLM-2026-COD01',
    status: 'CODING',
    memberIndex: 0,
    providerName: 'Hong Kong Sanatorium & Hospital',
    claimant: {
      membershipNumber: 'BI-6000-9000-9009',
      firstName: 'Johnny',
      lastName: 'Depp',
    },
    policy: { planTier: 'PREMIER' },
    incident: { description: 'Orthopaedic consultation', treatmentDate: '2026-04-05' },
    treatment: {
      treatmentType: 'outpatient',
      treatmentCountry: 'HK',
      treatmentDate: '2026-04-05',
      practitionerName: 'Dr. Wong Kai Fai',
      facilityName: 'Hong Kong Sanatorium & Hospital',
      treatmentDescription: 'Knee pain assessment and X-ray',
      reasonForTreatment: 'Knee pain',
    },
    financials: null,
    coverageAnalysis: null,
    overallConfidence: null,
    codes: [],
    auditEvents: [
      { eventType: 'INGESTION', action: 'INGEST_SUCCESS', details: { source: 'EMAIL' } },
      { eventType: 'CLAIM_PROCESS', action: 'START_PROCESSING', details: { stage: 'CODING' } },
      { eventType: 'CLAIM_EXTRACT', action: 'FINANCIALS_EXTRACTED', details: { language: 'english' } },
      { eventType: 'CLAIM_CODING', action: 'CODING_STARTED', details: { engine: 'bedrock-claude', stage: 'IN_PROGRESS' } },
    ],
  });

  // REVIEWING state
  await seedClaim({
    ref: 'CLM-2026-REV01',
    status: 'REVIEWING',
    memberIndex: 2,
    providerName: 'American Hospital Dubai',
    claimant: {
      membershipNumber: 'BI-6002-2345-6789',
      firstName: 'Ahmed',
      lastName: 'Al-Rashid',
    },
    policy: { planTier: 'ELITE', deductible: { total: 4000, used: 4000, remaining: 0 } },
    incident: { description: 'Follow-up cardiology visit', treatmentDate: '2026-04-02' },
    treatment: {
      treatmentType: 'outpatient',
      treatmentCountry: 'AE',
      treatmentDate: '2026-04-02',
      practitionerName: 'Dr. Khalid Mansour',
      facilityName: 'American Hospital Dubai',
      treatmentDescription: 'Cardiology follow-up and echocardiogram',
      reasonForTreatment: 'Hypertension monitoring',
    },
    financials: {
      totalClaimed: 15000,
      claimCurrency: 'AED',
      currency: 'AED',
      totalPayable: 15000,
      paymentCurrency: 'AED',
      deductibleApplied: 0,
      coInsuranceApplied: 0,
      networkPenaltyApplied: 0,
      itemisedCharges: [
        { description: 'Cardiology consultation', amount: 5000, covered: true },
        { description: 'Echocardiogram', amount: 8000, covered: true },
        { description: 'Blood work', amount: 2000, covered: true },
      ],
      payeeType: 'MEMBER',
      paymentMethod: 'BANK_TRANSFER',
      eobSummary: 'EXPLANATION OF BENEFITS\nTotal Claimed: AED 15,000.00\nDeductible: AED 0.00 (already met)\n---\nTotal Payable: AED 15,000.00',
    },
    coverageAnalysis: {
      decision: 'FULLY_COVERED',
      planTier: 'ELITE',
    },
    overallConfidence: 0.91,
    codes: [
      { code: 'I10', codeType: 'ICD10', description: 'Essential (primary) hypertension', confidence: 0.93, isPrimary: true },
      { code: '93306', codeType: 'CPT', description: 'Echocardiography, transthoracic', confidence: 0.89, isPrimary: false },
    ],
    auditEvents: [
      { eventType: 'INGESTION', action: 'INGEST_SUCCESS', details: { source: 'EMAIL' } },
      { eventType: 'CLAIM_PROCESS', action: 'START_PROCESSING' },
      { eventType: 'CLAIM_CODING', action: 'CODES_EXTRACTED', details: { icd10: ['I10'], cpt: ['93306'], primaryCode: 'I10' } },
      { eventType: 'CLAIM_COVERAGE', action: 'COVERAGE_CALCULATED', details: { decision: 'FULLY_COVERED', totalPayable: 15000 } },
      { eventType: 'CLAIM_STATUS_CHANGE', action: 'STATUS_CHANGED', details: { previousStatus: 'BUILDING', newStatus: 'REVIEWING', reason: 'Manual review queue' } },
    ],
  });

  console.log('  Sample claims ready');

  console.log('\n=== Seed complete ===');
  console.log(`  Health Plans:     ${HEALTH_PLANS.length}`);
  console.log(`  Members:          ${MEMBERS.length}`);
  console.log(`  Member Group:     1 (Acme Corporation)`);
  console.log(`  Payment Details:  ${PAYMENT_DETAILS_CONFIG.length}`);
  console.log(`  Providers:        ${PROVIDERS.length}`);
  console.log(`  Network Mappings: ${mappingCount}`);
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
