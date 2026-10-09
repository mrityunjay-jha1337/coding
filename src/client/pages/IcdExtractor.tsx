import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ActivitySquare, Languages, ShieldCheck } from 'lucide-react';
import type { PipelineResult } from '@shared/types';
import { processingApi } from '../api/processing.api';
import { MetricCard } from '../components/MetricCard';
import { PageHeader } from '../components/PageHeader';
import ResultsPanel from '../components/ResultsPanel';
import UploadPanel from '../components/UploadPanel';
import { useAuthStore } from '../stores/authStore';

import { IcdSearchBox } from '../components/IcdSearchBox';

export default function IcdExtractor() {
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState('');
  const queueQuery = useQuery({ queryKey: ['queue-icd'], queryFn: () => processingApi.queueStats() });

  const handleUpload = useCallback(async (file: File) => {
    setLoading(true);
    setError(null);
    setResult(null);
    setPdfFile(file);
    setProgress('Uploading PDF');

    const formData = new FormData();
    formData.append('pdf', file);

    try {
      setProgress('Processing claim file and extracting coding evidence');
      const token = useAuthStore.getState().accessToken;
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 600_000);
      const response = await fetch('/api/process', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
        signal: controller.signal,
      });
      window.clearTimeout(timeoutId);

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string; details?: string };
        throw new Error(data.error || data.details || 'Processing failed');
      }

      const data = (await response.json()) as PipelineResult;
      setResult(data);
      setProgress('');
    } catch (uploadError) {
      const message = uploadError instanceof Error ? uploadError.message : 'Unexpected processing error';
      setError(message);
      setProgress('');
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Agentic ICD Workspace"
        title="ICD-10 Intelligence"
        description="Search global medical codes manually or use the AI extraction engine for medical document parsing."
      />

      <div className="stats-grid">
        <MetricCard label="Waiting jobs" value={String((queueQuery.data?.processing?.waiting ?? 0) + (queueQuery.data?.ingestion?.waiting ?? 0))} icon={<ActivitySquare size={18} />} />
        <MetricCard label="Translation stage" value="Enabled" delta="Multi-language source text supported" accent="indigo" icon={<Languages size={18} />} />
        <MetricCard label="Validation model" value="Human-assisted" delta="Evidence and confidence shown in the review pane" accent="green" icon={<ShieldCheck size={18} />} />
      </div>

      <div className="icd-main-layout">
        <div className="icd-search-section surface-card">
          <div className="section-header">
            <h2>Manual code lookup</h2>
          </div>
          <IcdSearchBox />
        </div>

        <div className="icd-grid-layout">
          <section className="surface-card">
            <div className="section-header">
              <h2>Document extraction workbench</h2>
            </div>
            {!result ? (
              <UploadPanel onUpload={handleUpload} loading={loading} error={error} progress={progress} />
            ) : (
              <ResultsPanel result={result} onReset={() => setResult(null)} pdfFile={pdfFile} />
            )}
          </section>

          <aside className="surface-card">
            <div className="section-header">
              <h2>Operator guidance</h2>
            </div>
            <div className="list-stack">
              <div className="list-item compact">
                <strong>Best input shape</strong>
                <p className="muted-copy">Clean 1 to 5 page PDFs with diagnosis context and typed notes generate the strongest evidence matches.</p>
              </div>
              <div className="list-item compact">
                <strong>Confidence handling</strong>
                <p className="muted-copy">Use the evidence drawer to confirm whether the code is grounded in source or translated text.</p>
              </div>
              <div className="list-item compact">
                <strong>Escalation rule</strong>
                <p className="muted-copy">If a recommendation is unsupported, route the claim to the main queue and assign a specialist reviewer.</p>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
