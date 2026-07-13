export function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold text-primary">{label}</dt>
      <dd className="mt-1 text-base text-foreground">{value}</dd>
    </div>
  );
}
