export default function ReportsLoading() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="space-y-2">
        <div className="h-8 w-64 rounded-lg bg-ig-secondary" />
        <div className="h-4 w-full max-w-xl rounded bg-ig-secondary" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-24 rounded-2xl bg-ig-secondary" />
        ))}
      </div>
      <div className="h-96 rounded-2xl bg-ig-secondary" />
    </div>
  );
}
