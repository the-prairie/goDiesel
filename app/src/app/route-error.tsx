import { useRouteError } from "react-router-dom";
import { isChunkLoadError } from "@/app/chunk-recovery";
import { singleRouteMicrosite } from "@/app/single-route-microsite";
import { Button } from "@/ui/button";

export function RouteError() {
  const error = useRouteError();
  const loading = isChunkLoadError(error);
  return (
    <main className="weathered-atlas field-guide-theme grid min-h-dvh place-items-center bg-background px-6 text-foreground">
      <section role="alert" className="w-full max-w-md space-y-5">
        <p className="text-sm text-muted-foreground">goDiesel</p>
        <h1 className="text-3xl font-medium">{loading ? "Let’s get you back on track." : "This view couldn’t open."}</h1>
        <p className="text-base leading-7 text-muted-foreground">
          {loading ? "This page couldn’t finish loading. Check your connection and try again." : "Try opening this page again, or return to your routes."}
        </p>
        <div className="flex flex-wrap gap-3">
          <Button onClick={() => window.location.reload()}>Try again</Button>
          <Button variant="outline" asChild>
            <a href={singleRouteMicrosite?.guidePath ? `#${singleRouteMicrosite.guidePath}` : "#/routes"} onClick={(event) => {
              event.preventDefault();
              window.location.hash = singleRouteMicrosite?.guidePath ?? "/routes";
              window.location.reload();
            }}>Back to routes</a>
          </Button>
        </div>
      </section>
    </main>
  );
}
