import { useCallback, useRef, useState } from 'react';
import { FileText, FileUp, LoaderCircle } from 'lucide-react';

interface UploadPanelProps {
  onUpload: (file: File) => void;
  loading: boolean;
  error: string | null;
  progress: string;
}

export default function UploadPanel({ onUpload, loading, error, progress }: UploadPanelProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((file: File) => {
    if (file.type !== 'application/pdf') {
      return;
    }
    setSelectedFile(file);
  }, []);

  return (
    <div className="uploader-panel">
      <div className="pill-row">
        <span className="meta-pill">PDF input</span>
        <span className="meta-pill">Evidence extraction</span>
        <span className="meta-pill">Multilingual review</span>
      </div>

      <div
        className={`dropzone ${dragOver ? 'active' : ''} ${loading ? 'disabled' : ''}`}
        onClick={() => !loading && inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragOver(false);
          const file = event.dataTransfer.files?.[0];
          if (file) {
            handleFile(file);
          }
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,application/pdf"
          hidden
          disabled={loading}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              handleFile(file);
            }
          }}
        />

        {selectedFile ? (
          <div className="selected-file">
            <div className="file-mark"><FileText size={18} /></div>
            <div>
              <strong>{selectedFile.name}</strong>
              <p className="muted-copy">{(selectedFile.size / 1024 / 1024).toFixed(2)} MB</p>
            </div>
          </div>
        ) : (
          <div className="dropzone-body">
            <div className="dropzone-icon"><FileUp size={28} /></div>
            <h3>Drop a PDF here or browse your device</h3>
            <p className="muted-copy">Supports claim notes, scanned correspondence, and source documents up to 50MB.</p>
          </div>
        )}
      </div>

      {selectedFile && !loading ? (
        <div className="button-row">
          <button className="btn btn-primary" onClick={() => selectedFile && onUpload(selectedFile)}>
            Extract ICD suggestions
          </button>
          <button className="btn btn-ghost" onClick={() => setSelectedFile(null)}>
            Clear selection
          </button>
        </div>
      ) : null}

      {loading ? (
        <div className="loading-callout">
          <LoaderCircle className="animate-spin" size={18} />
          <div>
            <strong>{progress || 'Processing file'}</strong>
            <p className="muted-copy">This flow runs OCR, language handling, coding extraction, and reconciliation.</p>
          </div>
        </div>
      ) : null}

      {error ? <div className="error-banner">{error}</div> : null}
    </div>
  );
}
