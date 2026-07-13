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
      <div className="mb-3 text-xs font-semibold text-primary">{eyebrow}</div>
      <h1 className="text-3xl font-bold sm:text-5xl">{title}</h1>
      <p className="mt-4 text-base leading-7 text-muted-foreground">{copy}</p>
    </div>
  );
}
