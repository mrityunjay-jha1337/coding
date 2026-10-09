import type { ReactNode } from 'react';

interface MetricCardProps {
  label: string;
  value: string;
  delta?: string;
  accent?: string;
  icon?: ReactNode;
}

export function MetricCard({ label, value, delta, accent = 'blue', icon }: MetricCardProps) {
  return (
    <div className={`surface-card metric-card accent-${accent}`}>
      <div className="metric-card-top">
        <span className="metric-label">{label}</span>
        {icon ? <span className="metric-icon">{icon}</span> : null}
      </div>
      <div className="metric-value">{value}</div>
      {delta ? <div className="metric-delta">{delta}</div> : null}
    </div>
  );
}
