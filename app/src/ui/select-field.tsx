import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { Select } from "radix-ui";
import { useId } from "react";

import { cn } from "@/ui/utils";

export function SelectField({
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
    <div
      className={cn("grid min-w-0 gap-1.5 text-control font-medium", className)}
    >
      <label htmlFor={id} id={`${id}-label`} className="text-ink-secondary">
        {label}
      </label>
      <Select.Root
        value={`option:${value}`}
        onValueChange={(next) => onChange(next.slice("option:".length))}
        disabled={disabled}
      >
        <Select.Trigger
          id={id}
          aria-labelledby={`${id}-label`}
          className="flex min-h-11 w-full min-w-0 items-center justify-between gap-3 rounded-[var(--radius-control)] border border-line bg-surface-raised px-3 py-2 text-left text-control font-normal text-ink outline-none transition-colors hover:border-line-strong focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-50 [&>span:first-child]:truncate"
        >
          <Select.Value />
          <Select.Icon asChild>
            <ChevronDown
              className="size-4 shrink-0 text-ink-secondary"
              aria-hidden="true"
            />
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content
            aria-labelledby={`${id}-label`}
            position="popper"
            sideOffset={6}
            collisionPadding={16}
            className="field-guide-theme z-[var(--z-overlay)] max-h-[min(20rem,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] max-w-[calc(100vw-2rem)] overflow-hidden rounded-[var(--radius-control)] border border-line bg-surface text-control text-ink backdrop-blur-xl"
          >
            <Select.ScrollUpButton className="flex h-7 items-center justify-center text-ink-secondary">
              <ChevronUp className="size-4" aria-hidden="true" />
            </Select.ScrollUpButton>
            <Select.Viewport className="p-1">
              {options.map(([optionValue, optionLabel]) => (
                <Select.Item
                  key={optionValue}
                  value={`option:${optionValue}`}
                  className="relative flex min-h-11 cursor-default select-none items-center rounded-[var(--radius-control)] py-2 pr-3 pl-9 outline-none data-[state=checked]:bg-surface-muted data-[highlighted]:bg-surface-raised data-[highlighted]:ring-1 data-[highlighted]:ring-inset data-[highlighted]:ring-ring"
                >
                  <Select.ItemIndicator className="absolute left-3 inline-flex items-center text-ink">
                    <Check className="size-4" aria-hidden="true" />
                  </Select.ItemIndicator>
                  <Select.ItemText>{optionLabel}</Select.ItemText>
                </Select.Item>
              ))}
            </Select.Viewport>
            <Select.ScrollDownButton className="flex h-7 items-center justify-center text-ink-secondary">
              <ChevronDown className="size-4" aria-hidden="true" />
            </Select.ScrollDownButton>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
    </div>
  );
}
