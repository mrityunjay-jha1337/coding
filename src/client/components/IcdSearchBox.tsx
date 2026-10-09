import React, { useState, useEffect, useRef } from 'react';
import { Search, Info, Check, Copy, ExternalLink, Hash, BookOpen } from 'lucide-react';
import { claimsApi } from '../api/claims.api';

interface IcdCode {
  code: string;
  short: string;
  long: string;
}

export const IcdSearchBox: React.FC = () => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<IcdCode[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const debouncedSearchTerm = useDebounce(query, 300);

  useEffect(() => {
    if (debouncedSearchTerm && debouncedSearchTerm.length >= 2) {
      handleSearch(debouncedSearchTerm);
    } else {
      setResults([]);
    }
  }, [debouncedSearchTerm]);

  const handleSearch = async (searchTerm: string) => {
    setIsSearching(true);
    setError(null);
    try {
      const results = await claimsApi.searchCodes(searchTerm);
      setResults(results || []);
    } catch (err) {
      console.error('Search failed', err);
      setError('Failed to search codes');
    } finally {
      setIsSearching(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCode(text);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  return (
    <div className="icd-search-container">
      <div className="search-input-wrapper">
        <Search className="search-icon" size={20} />
        <input
          type="text"
          placeholder="Search by diagnosis, symptom or ICD-10 code (e.g. diabetes, M17.1)..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="search-field"
        />
        {isSearching && <div className="spinner-small" />}
      </div>

      <div className="search-results-viewport">
        {results.length > 0 ? (
          <div className="results-list">
            {results.map((item) => (
              <div key={item.code} className="result-item">
                <div className="result-main">
                  <div className="code-badge-wrapper">
                    <span className="code-badge">{item.code}</span>
                    <button 
                      className="copy-btn" 
                      onClick={() => copyToClipboard(item.code)}
                      title="Copy code"
                    >
                      {copiedCode === item.code ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                  </div>
                  <div className="text-content">
                    <h4 className="short-desc">{item.short}</h4>
                    <p className="long-desc">{item.long}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : query.length >= 2 && !isSearching ? (
          <div className="empty-results">
            <Info size={40} className="empty-icon" />
            <h3>No results found</h3>
            <p>Try different keywords or check for typos.</p>
          </div>
        ) : (
          <div className="search-placeholder">
            <BookOpen size={40} className="placeholder-icon" />
            <p>Enter at least 2 characters to begin searching the ICD-10 directory</p>
          </div>
        )}
      </div>

      {error && <div className="search-error">{error}</div>}
    </div>
  );
};

// Hook for debouncing
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);
    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);
  return debouncedValue;
}
