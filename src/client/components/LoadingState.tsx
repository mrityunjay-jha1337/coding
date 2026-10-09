export function FullPageLoader({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="centered-screen">
      <div className="loader-block">
        <div className="loader-orbit" />
        <p>{label}</p>
      </div>
    </div>
  );
}

export function SkeletonGrid({ items = 4 }: { items?: number }) {
  return (
    <div className="stats-grid">
      {Array.from({ length: items }).map((_, index) => (
        <div key={index} className="surface-card skeleton-card">
          <div className="skeleton skeleton-line short" />
          <div className="skeleton skeleton-line large" />
          <div className="skeleton skeleton-line medium" />
        </div>
      ))}
    </div>
  );
}
