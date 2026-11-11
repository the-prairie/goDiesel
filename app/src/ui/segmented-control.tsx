import { useId } from "react";
import { RadioGroup } from "radix-ui";
import { cn } from "@/ui/utils";

export function SegmentedControl({
  label,
  value,
  options,
  onChange,
  disabled = false,
  className,
}: {
  label: string;
  value: string;
  options: readonly (readonly [string, string])[];
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn("grid min-w-0 gap-1.5 text-control", className)}>
      <span id={id} className="font-medium text-ink-secondary">
        {label}
      </span>
      <RadioGroup.Root
        aria-labelledby={id}
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        orientation="horizontal"
        className="flex min-w-0 gap-1 rounded-[var(--radius-control)] bg-surface-raised p-1"
      >
        {options.map(([optionValue, optionLabel]) => (
          <RadioGroup.Item
            key={optionValue}
            value={optionValue}
            className="min-h-11 min-w-0 flex-1 rounded-[var(--radius-control)] px-3 py-2 text-control font-medium text-ink-secondary outline-none transition-colors hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-[var(--forest-active)] data-[state=checked]:text-ink"
          >
            {optionLabel}
          </RadioGroup.Item>
        ))}
      </RadioGroup.Root>
    </div>
  );
}
