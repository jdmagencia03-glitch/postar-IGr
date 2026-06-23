export default function DashboardLoading() {
  return (
    <div className="mx-auto max-w-6xl animate-pulse space-y-4 py-2">
      <div className="h-8 w-56 rounded-lg bg-ig-secondary" />
      <div className="h-4 w-96 max-w-full rounded bg-ig-secondary" />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="h-48 rounded-2xl bg-ig-secondary" />
        <div className="h-48 rounded-2xl bg-ig-secondary" />
      </div>
    </div>
  );
}
