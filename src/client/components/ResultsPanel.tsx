import { useMemo, useState } from 'react';
import type { ICDCode, PipelineResult } from '@shared/types';
import { EmptyState } from './EmptyState';
import { claimsApi } from '../api/claims.api';
import toast from 'react-hot-toast';

interface ResultsPanelProps {
  result: PipelineResult;
  onReset: () => void;
  pdfFile: File | null;
}

export default function ResultsPanel({ result, onReset }: ResultsPanelProps) {
  const [selectedCode, setSelectedCode] = useState<ICDCode | null>(null);
  const [accepted, setAccepted] = useState<Record<string, 'accepted' | 'rejected' | 'pending'>>({});
  const warnings = Array.from(
    new Set([...(result.errors ?? []), ...(result.reconciliation.warnings ?? [])].filter(Boolean))
  );

  const claimId = result.claimId;

  const codes = result.reconciliation.finalCodes;
  const summary = useMemo(() => {
    const statuses = Object.values(accepted);
    return {
      accepted: statuses.filter((status) => status === 'accepted').length,
      rejected: statuses.filter((status) => status === 'rejected').length,
    };
  }, [accepted]);

  return (
    <div className="results-panel">
      <div className="results-header">
        <div>
          <h2>{result.fileName}</h2>
          <p className="muted-copy">
            {codes.length} codes - {result.languageDetection.specificLanguage || result.languageDetection.language} -{' '}
            {(result.processingTimeMs / 1000).toFixed(1)}s
          </p>
        </div>
        <button className="btn btn-secondary" onClick={onReset}>
          Upload another file
        </button>
      </div>

      <div className="pill-row">
        <span className="meta-pill">Accepted {summary.accepted}</span>
        <span className="meta-pill">Rejected {summary.rejected}</span>
        <span className="meta-pill">Validated {codes.filter((code) => code.isValidated !== false).length}</span>
      </div>

      {warnings.length > 0 ? (
        <section className="surface-subpanel">
          <div className="section-header">
            <h3>Processing warnings</h3>
          </div>
          <div className="list-stack">
            {warnings.map((warning, index) => (
              <div key={`${warning}-${index}`} className="error-banner">
                {warning}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <div className="icd-results-layout">
        <section className="surface-subpanel">
          <div className="section-header">
            <h3>Suggested codes</h3>
          </div>
          {codes.length === 0 ? (
            <EmptyState title="No codes extracted" description="The parser returned no ICD code recommendations for this document." />
          ) : (
            <div className="list-stack">
              {codes.map((code, index) => {
                const key = `${code.code}-${index}`;
                const decision = accepted[key] || 'pending';
                return (
                  <div key={key} className={`coding-card ${selectedCode?.code === code.code ? 'active' : ''}`}>
                    <div className="coding-head">
                      <div>
                        <strong>{code.code}</strong>
                        <span className="muted-copy">{code.description}</span>
                      </div>
                      <span
                        className={`status-badge status-${decision === 'accepted' ? 'success' : decision === 'rejected' ? 'danger' : 'warning'}`}
                      >
                        {decision}
                      </span>
                    </div>
                    <p className="muted-copy">{code.reasoningSummary}</p>
                    <div className="coding-meta">
                      <span>Confidence {(code.confidence > 1 ? code.confidence : code.confidence * 100).toFixed(1)}%</span>
                      <span>Section {code.section || 'n/a'}</span>
                      <span>Page {code.pageNumber ?? 'n/a'}</span>
                    </div>
                    <div className="button-row">
                      <button className="btn btn-secondary" onClick={() => setSelectedCode(code)}>
                        View evidence
                      </button>
                      <button
                        className="btn btn-primary"
                        onClick={async () => {
                          console.log(`[ResultsPanel] Accepting code ${code.code}, claimId: ${claimId}, code.id: ${code.id}`);
                          setAccepted((current) => ({ ...current, [key]: 'accepted' }));
                          if (claimId && code.id) {
                            try {
                              await claimsApi.reviewCoding(claimId, code.id, { reviewerAction: 'accepted' });
                              toast.success(`Code ${code.code} accepted`);
                            } catch (e) {
                              console.error('[ResultsPanel] Acceptance failed:', e);
                              toast.error('Failed to persist decision');
                            }
                          } else {
                            console.warn('[ResultsPanel] Cannot persist decision: claimId or code.id is missing');
                          }
                        }}
                      >
                        Accept
                      </button>
                      <button
                        className="btn btn-ghost"
                        onClick={async () => {
                          console.log(`[ResultsPanel] Rejecting code ${code.code}, claimId: ${claimId}, code.id: ${code.id}`);
                          setAccepted((current) => ({ ...current, [key]: 'rejected' }));
                          if (claimId && code.id) {
                            try {
                              await claimsApi.reviewCoding(claimId, code.id, { reviewerAction: 'rejected' });
                              toast.success(`Code ${code.code} rejected`);
                            } catch (e) {
                              console.error('[ResultsPanel] Rejection failed:', e);
                              toast.error('Failed to persist decision');
                            }
                          } else {
                            console.warn('[ResultsPanel] Cannot persist decision: claimId or code.id is missing');
                          }
                        }}
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <aside className="surface-subpanel">
          <div className="section-header">
            <h3>Evidence viewer</h3>
          </div>
          {selectedCode ? (
            <div className="list-stack">
              <div className="list-item compact">
                <strong>{selectedCode.code}</strong>
                <p className="muted-copy">{selectedCode.description}</p>
              </div>
              <div className="evidence-box">
                <div className="eyebrow">Source evidence</div>
                <p>{selectedCode.evidenceSourceText || 'No source evidence returned.'}</p>
              </div>
              {selectedCode.evidenceTranslatedText ? (
                <div className="evidence-box">
                  <div className="eyebrow">Translated evidence</div>
                  <p>{selectedCode.evidenceTranslatedText}</p>
                </div>
              ) : null}
            </div>
          ) : (
            <EmptyState title="Select a code" description="Choose a suggested code to inspect the supporting evidence and reasoning summary." />
          )}
        </aside>
      </div>

      <section className="surface-subpanel">
        <div className="section-header">
          <h3>Extracted text</h3>
        </div>
        <pre className="text-preview">{result.translation?.translatedText || result.extraction.fullText}</pre>
      </section>
    </div>
  );
}
