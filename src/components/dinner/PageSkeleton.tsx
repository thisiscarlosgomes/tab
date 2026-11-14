export function PageSkeleton({ chat = false }: { chat?: boolean }) {
  return (
    <div
      className={`dinner-page-skeleton${chat ? " is-chat" : ""}`}
      role="status"
      aria-label="Loading page"
      aria-busy="true"
    >
      <span className="sr-only">Loading…</span>
      <div aria-hidden="true">
        <div className="dinner-skeleton dinner-skeleton-heading" />
        <div className="dinner-skeleton dinner-skeleton-subtitle" />
        {[0, 1, 2].map((row) => (
          <div className="dinner-skeleton-row" key={row}>
            <div className="dinner-skeleton dinner-skeleton-avatar" />
            <div className="dinner-skeleton-lines">
              <div className="dinner-skeleton" />
              <div className="dinner-skeleton" />
            </div>
          </div>
        ))}
        {chat && <div className="dinner-skeleton dinner-skeleton-composer" />}
      </div>
    </div>
  );
}
