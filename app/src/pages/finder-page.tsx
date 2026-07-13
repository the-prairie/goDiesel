import { PageTitle } from "@/components/page-title";

export function FinderPage() {
  return (
    <section className="grid gap-6">
      <PageTitle
        eyebrow="Finder"
        title="Plan the next day."
        copy="Future routes live here until a completed activity turns them into Atlas memories."
      />
      <div className="rounded-md border border-dashed border-border bg-card p-6 text-muted-foreground">
        Route planning arrives after completed-route parity.
      </div>
    </section>
  );
}
