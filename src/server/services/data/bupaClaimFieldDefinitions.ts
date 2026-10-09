// Field definitions for the Bupa Global Claim Form (STH) completeness check.
// Extracted from completenessCheck.service.ts to keep file sizes manageable.

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FieldDefinition {
  readonly path: string;
  readonly label: string;
  readonly section: string;
  readonly category: string;
  readonly severity: 'critical' | 'important' | 'optional';
  readonly queryTarget: 'member' | 'provider' | 'either';
}

// ─── Category Weights ─────────────────────────────────────────────────────────

/** Weight categories as percentages of total score. */
export const CATEGORY_WEIGHTS: Readonly<Record<string, number>> = {
  PATIENT_IDENTITY: 25,
  TREATMENT_DETAILS: 25,
  MEDICAL_DETAILS: 20,
  FINANCIAL: 15,
  PAYMENT: 10,
  DECLARATION: 5,
} as const;

// ─── Scored Field Definitions ─────────────────────────────────────────────────

/**
 * All scored fields with their category, severity, and query-target assignments.
 * Each category's fields are weighted equally within that category.
 */
export const FIELD_DEFINITIONS: readonly FieldDefinition[] = [
  // ── Patient Identity (25%) ──
  {
    path: 'patientDetails.membershipNumber',
    label: 'Membership Number',
    section: 'Patient Details',
    category: 'PATIENT_IDENTITY',
    severity: 'critical',
    queryTarget: 'member',
  },
  {
    path: 'patientDetails.firstName',
    label: 'First Name',
    section: 'Patient Details',
    category: 'PATIENT_IDENTITY',
    severity: 'critical',
    queryTarget: 'member',
  },
  {
    path: 'patientDetails.lastName',
    label: 'Last Name',
    section: 'Patient Details',
    category: 'PATIENT_IDENTITY',
    severity: 'critical',
    queryTarget: 'member',
  },
  {
    path: 'patientDetails.dateOfBirth',
    label: 'Date of Birth',
    section: 'Patient Details',
    category: 'PATIENT_IDENTITY',
    severity: 'critical',
    queryTarget: 'member',
  },

  // ── Treatment Details (25%) ──
  {
    path: 'medicalDetails.treatmentCountry',
    label: 'Treatment Country',
    section: 'Claim / Medical Details',
    category: 'TREATMENT_DETAILS',
    severity: 'important',
    queryTarget: 'provider',
  },
  {
    path: 'medicalDetails.treatmentDate',
    label: 'Treatment Date',
    section: 'Claim / Medical Details',
    category: 'TREATMENT_DETAILS',
    severity: 'critical',
    queryTarget: 'provider',
  },
  {
    path: 'medicalDetails.reasonForTreatment',
    label: 'Reason for Treatment',
    section: 'Claim / Medical Details',
    category: 'TREATMENT_DETAILS',
    severity: 'critical',
    queryTarget: 'provider',
  },
  {
    path: 'medicalDetails.treatmentDescription',
    label: 'Treatment Description',
    section: 'Claim / Medical Details',
    category: 'TREATMENT_DETAILS',
    severity: 'important',
    queryTarget: 'provider',
  },

  // ── Medical Details (20%) ──
  {
    path: 'medicalDetails.practitionerName',
    label: 'Practitioner Name',
    section: 'Claim / Medical Details',
    category: 'MEDICAL_DETAILS',
    severity: 'important',
    queryTarget: 'provider',
  },
  {
    path: 'medicalDetails.practitionerSpecialty',
    label: 'Practitioner Specialty',
    section: 'Claim / Medical Details',
    category: 'MEDICAL_DETAILS',
    severity: 'optional',
    queryTarget: 'provider',
  },
  {
    path: 'medicalDetails.facilityName',
    label: 'Facility Name',
    section: 'Claim / Medical Details',
    category: 'MEDICAL_DETAILS',
    severity: 'important',
    queryTarget: 'provider',
  },
  {
    path: 'medicalDetails.symptomStartDate',
    label: 'Symptom Start Date',
    section: 'Claim / Medical Details',
    category: 'MEDICAL_DETAILS',
    severity: 'important',
    queryTarget: 'member',
  },

  // ── Financial (15%) ──
  {
    path: 'medicalDetails.totalClaimedAmount',
    label: 'Total Claimed Amount',
    section: 'Claim / Medical Details',
    category: 'FINANCIAL',
    severity: 'critical',
    queryTarget: 'either',
  },
  {
    path: 'medicalDetails.invoiceCurrency',
    label: 'Invoice Currency',
    section: 'Claim / Medical Details',
    category: 'FINANCIAL',
    severity: 'critical',
    queryTarget: 'either',
  },
  {
    path: 'medicalDetails.treatmentType',
    label: 'Treatment Type',
    section: 'Claim / Medical Details',
    category: 'FINANCIAL',
    severity: 'important',
    queryTarget: 'either',
  },

  // ── Payment (10%) ──
  {
    path: 'paymentDetails.payeeType',
    label: 'Payee Type',
    section: 'Payment Details',
    category: 'PAYMENT',
    severity: 'important',
    queryTarget: 'member',
  },
  {
    path: 'paymentDetails.bankName',
    label: 'Bank Name',
    section: 'Payment Details',
    category: 'PAYMENT',
    severity: 'important',
    queryTarget: 'member',
  },
  {
    path: 'paymentDetails.accountHolderName',
    label: 'Account Holder Name',
    section: 'Payment Details',
    category: 'PAYMENT',
    severity: 'important',
    queryTarget: 'member',
  },

  // ── Declaration (5%) ──
  {
    path: 'declaration.signaturePresent',
    label: 'Signature Present',
    section: 'Declaration',
    category: 'DECLARATION',
    severity: 'important',
    queryTarget: 'member',
  },
  {
    path: 'declaration.signatureDate',
    label: 'Signature Date',
    section: 'Declaration',
    category: 'DECLARATION',
    severity: 'important',
    queryTarget: 'member',
  },
  {
    path: 'declaration.printName',
    label: 'Print Name',
    section: 'Declaration',
    category: 'DECLARATION',
    severity: 'optional',
    queryTarget: 'member',
  },
] as const;

// ─── Optional (Non-Scored) Field Definitions ──────────────────────────────────

/**
 * Optional fields that do not contribute to the weighted score but are still
 * reported if missing.
 */
export const OPTIONAL_FIELD_DEFINITIONS: readonly FieldDefinition[] = [
  {
    path: 'patientDetails.groupName',
    label: 'Group Name',
    section: 'Patient Details',
    category: 'PATIENT_IDENTITY',
    severity: 'optional',
    queryTarget: 'member',
  },
  {
    path: 'patientDetails.title',
    label: 'Title',
    section: 'Patient Details',
    category: 'PATIENT_IDENTITY',
    severity: 'optional',
    queryTarget: 'member',
  },
  {
    path: 'patientDetails.address.building',
    label: 'Building',
    section: 'Patient Details',
    category: 'PATIENT_IDENTITY',
    severity: 'optional',
    queryTarget: 'member',
  },
  {
    path: 'patientDetails.address.street',
    label: 'Street',
    section: 'Patient Details',
    category: 'PATIENT_IDENTITY',
    severity: 'optional',
    queryTarget: 'member',
  },
  {
    path: 'patientDetails.address.town',
    label: 'Town',
    section: 'Patient Details',
    category: 'PATIENT_IDENTITY',
    severity: 'optional',
    queryTarget: 'member',
  },
  {
    path: 'patientDetails.address.areaCode',
    label: 'Area Code',
    section: 'Patient Details',
    category: 'PATIENT_IDENTITY',
    severity: 'optional',
    queryTarget: 'member',
  },
  {
    path: 'patientDetails.address.region',
    label: 'Region',
    section: 'Patient Details',
    category: 'PATIENT_IDENTITY',
    severity: 'optional',
    queryTarget: 'member',
  },
  {
    path: 'patientDetails.address.country',
    label: 'Country',
    section: 'Patient Details',
    category: 'PATIENT_IDENTITY',
    severity: 'optional',
    queryTarget: 'member',
  },
  {
    path: 'patientDetails.telephone',
    label: 'Telephone',
    section: 'Patient Details',
    category: 'PATIENT_IDENTITY',
    severity: 'optional',
    queryTarget: 'member',
  },
  {
    path: 'patientDetails.email',
    label: 'Email',
    section: 'Patient Details',
    category: 'PATIENT_IDENTITY',
    severity: 'optional',
    queryTarget: 'member',
  },
  {
    path: 'medicalDetails.surgeryDate',
    label: 'Surgery Date',
    section: 'Claim / Medical Details',
    category: 'TREATMENT_DETAILS',
    severity: 'optional',
    queryTarget: 'provider',
  },
  {
    path: 'medicalDetails.facilityAddress',
    label: 'Facility Address',
    section: 'Claim / Medical Details',
    category: 'MEDICAL_DETAILS',
    severity: 'optional',
    queryTarget: 'provider',
  },
  {
    path: 'medicalDetails.admissionDate',
    label: 'Admission Date',
    section: 'Claim / Medical Details',
    category: 'MEDICAL_DETAILS',
    severity: 'optional',
    queryTarget: 'provider',
  },
  {
    path: 'medicalDetails.dischargeDate',
    label: 'Discharge Date',
    section: 'Claim / Medical Details',
    category: 'MEDICAL_DETAILS',
    severity: 'optional',
    queryTarget: 'provider',
  },
  {
    path: 'medicalDetails.hospitalName',
    label: 'Hospital Name',
    section: 'Claim / Medical Details',
    category: 'MEDICAL_DETAILS',
    severity: 'optional',
    queryTarget: 'provider',
  },
  {
    path: 'thirdParty.name',
    label: 'Third Party Name',
    section: 'Third Party',
    category: 'PAYMENT',
    severity: 'optional',
    queryTarget: 'member',
  },
  {
    path: 'thirdParty.contact',
    label: 'Third Party Contact',
    section: 'Third Party',
    category: 'PAYMENT',
    severity: 'optional',
    queryTarget: 'member',
  },
] as const;

// ─── Treatment-Type Constants ─────────────────────────────────────────────────

export const INPATIENT_TREATMENT_TYPES = ['inpatient', 'surgical'] as const;

export const OPTICAL_PHARMACY_TREATMENT_TYPES = [
  'opticians', 'optical', 'pharmacy', 'dental',
] as const;
