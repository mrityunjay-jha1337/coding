import { getStatusTone, titleizeStatus } from '../utils/status';

export function StatusBadge({ status }: { status: string }) {
  const tone = getStatusTone(status);
  return <span className={`status-badge status-${tone}`}>{status}</span>;
}
