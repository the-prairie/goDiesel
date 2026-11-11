import { Link } from "react-router-dom";

import { APP_PATHS } from "@/app/route-paths";
import { Button } from "@/ui/button";
import { PageTitle } from "@/ui/page-title";

// An unknown or stale link. It stays inside the shell, so the primary
// navigation is still there, and it says so instead of silently opening Atlas.
export function NotFoundPage() {
  return (
    <section data-testid="not-found" className="grid max-w-xl content-start gap-5">
      <PageTitle
        eyebrow="Page not found"
        title="There’s nothing at this address."
        copy="The link may be mistyped or out of date. Atlas has every route you’ve recorded."
      />
      <div className="flex flex-wrap gap-3">
        <Button asChild>
          <Link to={APP_PATHS.atlas}>Open Atlas</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link to={APP_PATHS.routes}>Browse routes</Link>
        </Button>
      </div>
    </section>
  );
}
