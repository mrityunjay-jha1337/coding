export function getStatusTone(status: string) {
  const normalized = status.toUpperCase();
  if (['COMPLETE', 'ACTIVE', 'CONNECTED', 'ACCEPTED'].includes(normalized)) return 'success';
  if (['REJECTED', 'ERROR', 'CLOSED', 'INACTIVE', 'DENIED', 'DUPLICATE'].includes(normalized)) return 'danger';
  if (['REVIEWING', 'QUERYING', 'QUERYING_MEMBER', 'QUERYING_PROVIDER', 'VALIDATING', 'ON_HOLD', 'AUTH_EXPIRED', 'ESCALATED_HANDLER', 'ESCALATED_CLINICAL'].includes(normalized)) return 'warning';
  if (['CODING', 'BUILDING', 'INGESTING', 'EXTRACTING', 'TRANSLATING', 'NEW', 'REOPENED'].includes(normalized)) return 'info';
  return 'neutral';
}

export function titleizeStatus(status: string) {
  return status
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
