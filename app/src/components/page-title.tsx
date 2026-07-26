export function PageTitle({
  eyebrow,
  title,
  copy,
}: {
  eyebrow: string;
  title: string;
  copy: string;
}) {
  return (
    <div className="max-w-2xl motion-settle">
      <div className="mb-3 text-micro font-semibold uppercase tracking-[0.14em] text-forest">
        {eyebrow}
      </div>
      <h1 className="text-balance font-editorial text-3xl font-medium tracking-[0.01em] text-ink sm:text-5xl">
        {title}
      </h1>
      <p className="mt-4 max-w-prose text-body leading-7 text-ink-secondary">{copy}</p>
    </div>
  );
}
