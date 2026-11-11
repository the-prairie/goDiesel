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
    <div className="max-w-3xl">
      <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-accent-foreground">{eyebrow}</div>
      <h1 className="font-editorial text-4xl font-semibold tracking-tight sm:text-5xl">{title}</h1>
      <p className="story-copy mt-2 max-w-xl text-muted-foreground">{copy}</p>
    </div>
  );
}
