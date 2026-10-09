import { ArrowRight, BarChart3, Bot, ShieldCheck, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';

const features = [
  {
    title: 'Autonomous claims flow',
    copy: 'Ingestion, document extraction, coding review, reassignment, and SLA visibility in one operating layer.',
    icon: Bot,
  },
  {
    title: 'Human-in-the-loop coding',
    copy: 'Review ICD recommendations with evidence, confidence, and auditability built into the workbench.',
    icon: ShieldCheck,
  },
  {
    title: 'Leadership telemetry',
    copy: 'Real-time queue pressure, handler productivity, correction rates, and client SLA breach risk.',
    icon: BarChart3,
  },
];

export default function Landing() {
  return (
    <div className="landing-shell">
      <header className="landing-header">
        <div className="brand-lockup">
          <div className="brand-mark">CI</div>
          <div>
            <div className="brand-title">ClaimsIntell</div>
            <div className="brand-subtitle">High-trust claims automation</div>
          </div>
        </div>
        <div className="landing-actions">
          <Link className="btn btn-secondary" to="/login">
            Sign in
          </Link>
          <Link className="btn btn-primary" to="/signup">
            Create workspace
          </Link>
        </div>
      </header>

      <section className="hero-grid">
        <div className="hero-copy surface-panel">
          <div className="eyebrow">
            <Sparkles size={14} />
            Revenue cycle command center
          </div>
          <h1>Claims orchestration, coding review, and operational analytics in one modern work surface.</h1>
          <p className="muted-copy lead-copy">
            ClaimsIntell turns fragmented RCM operations into a coordinated workflow with live queues, assisted review, audit-ready actions, and cleaner handoffs between automation and human specialists.
          </p>
          <div className="hero-cta-row">
            <Link className="btn btn-primary" to="/signup">
              Start secure onboarding
              <ArrowRight size={16} />
            </Link>
            <Link className="btn btn-secondary" to="/login">
              Open operator console
            </Link>
          </div>
          <div className="hero-stats">
            <div>
              <strong>57</strong>
              <span>API endpoints already wired</span>
            </div>
            <div>
              <strong>13</strong>
              <span>claim lifecycle stages tracked</span>
            </div>
            <div>
              <strong>Live</strong>
              <span>JWT auth, queue metrics, audit views</span>
            </div>
          </div>
        </div>

        <div className="surface-panel showcase-panel">
          <div className="showcase-window">
            <div className="window-chrome">
              <span />
              <span />
              <span />
            </div>
            <div className="showcase-body">
              <div className="showcase-card accent-blue">
                <span className="showcase-label">Today</span>
                <strong>184 queued claims</strong>
                <p>12 high-priority files moved to review automatically.</p>
              </div>
              <div className="showcase-card accent-green">
                <span className="showcase-label">Coding</span>
                <strong>94.2% validated suggestions</strong>
                <p>Evidence-linked recommendations surfaced for every flagged diagnosis.</p>
              </div>
              <div className="showcase-stream">
                <div>Client SLA risk detected for Blue Harbor Health</div>
                <div>New escalation created for claim CLM-2026-8K2JD</div>
                <div>Queue latency dropped 18% after reassignment</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="feature-grid">
        {features.map((feature) => {
          const Icon = feature.icon;
          return (
            <article key={feature.title} className="surface-card feature-card">
              <div className="feature-icon">
                <Icon size={18} />
              </div>
              <h3>{feature.title}</h3>
              <p className="muted-copy">{feature.copy}</p>
            </article>
          );
        })}
      </section>
    </div>
  );
}
