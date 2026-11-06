// Grey shapes in the layout's place while the first load runs.
export function Skeleton() {
  return (
    <main className="page" role="status" aria-label="Loading">
      <div className="stack-tight">
        <div className="skeleton skeleton-hero" />
        <div className="chips">
          <div className="skeleton skeleton-chip" />
          <div className="skeleton skeleton-chip" />
          <div className="skeleton skeleton-chip" />
        </div>
      </div>
      <div className="stack-tight">
        <div className="skeleton skeleton-row" />
        <div className="skeleton skeleton-row" />
      </div>
    </main>
  )
}
