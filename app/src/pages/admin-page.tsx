import { PageTitle } from "@/components/page-title";

export function AdminPage() {
  return (
    <section className="grid gap-6">
      <PageTitle
        eyebrow="Admin"
        title="Route curation."
        copy="The existing owner workflow remains local while its data contract moves into the React app."
      />
      <div className="w-fit rounded-md border border-dashed border-border bg-card px-4 py-3 text-sm text-muted-foreground">
        Local Admin remains a separate process for now.
      </div>
    </section>
  );
}
