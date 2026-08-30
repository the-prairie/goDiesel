import { Suspense, useRef } from "react";
import { Outlet } from "react-router-dom";

import { useNavigationContinuity } from "@/app/navigation-continuity";

export function AppShell() {
  const mainRef = useRef<HTMLElement>(null);
  useNavigationContinuity(mainRef);

  return (
    <div className="weathered-atlas field-guide-theme relative flex min-h-dvh bg-background text-foreground">
      <div className="flex min-h-dvh min-w-0 flex-1 flex-col">
        <main
          ref={mainRef}
          tabIndex={-1}
          className="min-h-0 w-full flex-1 overflow-hidden focus:outline-none"
        >
          <Suspense
            fallback={
              <div
                role="status"
                aria-live="polite"
                className="rounded-md border border-border bg-card p-5 text-sm text-muted-foreground"
              >
                Loading view.
              </div>
            }
          >
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
