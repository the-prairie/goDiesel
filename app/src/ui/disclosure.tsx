import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

export function Disclosure({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <details className="group border-t border-line text-sm">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 py-3 font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        {title}
        <ChevronDown
          className="size-4 shrink-0 transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="pb-4 pt-1">{children}</div>
    </details>
  );
}
