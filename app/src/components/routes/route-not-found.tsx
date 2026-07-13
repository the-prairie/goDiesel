import { Link } from "react-router-dom";

import { PageTitle } from "@/components/page-title";
import { Button } from "@/components/ui/button";
import { APP_PATHS } from "@/navigation";

export function RouteNotFound() {
  return (
    <section className="grid max-w-xl gap-5">
      <PageTitle
        eyebrow="Route unavailable"
        title="This route could not be found."
        copy="The route may have moved or the shared link may be incomplete."
      />
      <Button asChild className="w-fit">
        <Link to={APP_PATHS.routes}>Browse routes</Link>
      </Button>
    </section>
  );
}
