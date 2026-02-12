"use client";

/**
 * Dropdown widget - renders a select/combobox dropdown.
 *
 * Maps to ipywidgets DropdownModel.
 */

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { WidgetComponentProps } from "../widget-registry";
import {
  useWidgetModelValue,
  useWidgetStoreRequired,
} from "../widget-store-context";

export function DropdownWidget({ modelId, className }: WidgetComponentProps) {
  const { sendUpdate } = useWidgetStoreRequired();

  // Subscribe to individual state keys
  const options =
    useWidgetModelValue<string[]>(modelId, "_options_labels") ?? [];
  const index = useWidgetModelValue<number | null>(modelId, "index");
  const description = useWidgetModelValue<string>(modelId, "description");
  const disabled = useWidgetModelValue<boolean>(modelId, "disabled") ?? false;

  // Convert index to string value for Select (Radix Select uses string values)
  const value =
    index !== null && index !== undefined && index >= 0
      ? String(index)
      : undefined;

  const handleValueChange = (newValue: string) => {
    const newIndex = parseInt(newValue, 10);
    if (!Number.isNaN(newIndex)) {
      sendUpdate(modelId, { index: newIndex });
    }
  };

  return (
    <div
      className={cn("flex items-center gap-3", className)}
      data-widget-id={modelId}
      data-widget-type="Dropdown"
    >
      {description && <Label className="shrink-0 text-sm">{description}</Label>}
      <Select
        value={value}
        onValueChange={handleValueChange}
        disabled={disabled}
      >
        <SelectTrigger className="w-48">
          <SelectValue placeholder="Select..." />
        </SelectTrigger>
        <SelectContent>
          {options.map((option, idx) => (
            <SelectItem key={idx} value={String(idx)}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export default DropdownWidget;
