export function DashboardLoadErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-ig-danger/30 bg-ig-danger/10 px-4 py-3 text-sm text-ig-danger">
      {message}
    </div>
  );
}
