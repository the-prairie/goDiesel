import { Link } from "react-router-dom";

import { PageTitle } from "@/ui/page-title";
import { Button } from "@/ui/button";
import { APP_PATHS } from "@/app/route-paths";

// Route guide and Replay are immersive surfaces whose <main> has no padding,
// so this page brings the content workspace's gutter (`p-4 sm:p-6`) itself.
export function RouteNotFound() {
  return (
    <div className="mx-auto w-full max-w-7xl p-4 sm:p-6">
      <section className="grid max-w-xl gap-5 py-4 sm:py-6">
        <PageTitle
          eyebrow="Route unavailable"
          title="This route could not be found."
          copy="The route may have moved or the shared link may be incomplete."
        />
        <Button asChild className="w-fit">
          <Link to={APP_PATHS.routes}>Browse routes</Link>
        </Button>
      </section>
    </div>
  );
}
