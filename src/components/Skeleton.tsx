export function SkeletonCard() {
  return (
    <div className="rounded-card border border-border bg-surface p-5 shadow-card">
      <div className="skeleton h-3 w-20 rounded-full" />
      <div className="skeleton mt-3 h-5 w-4/5 rounded" />
      <div className="skeleton mt-3 h-3 w-full rounded" />
      <div className="skeleton mt-2 h-3 w-2/3 rounded" />
      <div className="mt-4 flex gap-4">
        <div className="skeleton h-3 w-12 rounded" />
        <div className="skeleton h-3 w-12 rounded" />
      </div>
    </div>
  );
}

export function SkeletonGrid({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}
