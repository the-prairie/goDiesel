import type { ReactNode } from "react";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface MarginProps {
  children: ReactNode;
  className?: string;
  /** desktop column vs mobile fold presentation */
  presentation?: "column" | "fold";
  onClose?: () => void;
  closeLabel?: string;
  "aria-label"?: string;
}

/**
 * Shared detail system — marginalia beside the terrain, never a modal.
 */
export function Margin({
  children,
  className,
  presentation = "column",
  onClose,
  closeLabel = "Close",
  "aria-label": ariaLabel = "Details",
}: MarginProps) {
  return (
    <aside
      aria-label={ariaLabel}
      data-testid="atlas-margin"
      data-presentation={presentation}
      className={cn(
        "motion-settle z-[var(--z-inspector)] flex min-h-0 flex-col overflow-hidden text-ink",
        presentation === "column"
          ? "atlas-margin w-full max-w-[var(--margin-width)]"
          : "atlas-margin-fold",
        className,
      )}
    >
      {onClose ? (
        <div className="flex shrink-0 justify-end px-3 pt-3">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={closeLabel}
            onClick={onClose}
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        </div>
      ) : null}
      <div className="grid min-h-0 flex-1 gap-8 overflow-y-auto px-5 pb-6 pt-2 sm:px-6">
        {children}
      </div>
    </aside>
  );
}

export function MarginSection({
  children,
  className,
  delayMs = 0,
}: {
  children: ReactNode;
  className?: string;
  delayMs?: number;
}) {
  return (
    <section
      className={cn("motion-settle grid gap-3", className)}
      style={{ animationDelay: `${delayMs}ms` }}
    >
      {children}
    </section>
  );
}

export function MarginEyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-micro font-semibold uppercase tracking-[0.14em] text-forest">
      {children}
    </p>
  );
}

export function MarginNote({ children }: { children: ReactNode }) {
  return <p className="font-marginalia text-body text-ink-secondary">{children}</p>;
}

export function MarginLedger({
  items,
}: {
  items: Array<{ label: string; value: string }>;
}) {
  return (
    <dl className="grid gap-3 border-y border-line py-4">
      {items.map((item) => (
        <div key={item.label} className="flex items-baseline justify-between gap-4">
          <dt className="text-caption text-ink-muted">{item.label}</dt>
          <dd className="font-tabular text-control text-ink">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
