"use client";

/**
 * Datetime widget - renders a datetime-local input field.
 *
 * Maps to ipywidgets DatetimeModel and NaiveDatetimeModel.
 */

import { useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { WidgetComponentProps } from "../widget-registry";
import {
  useWidgetModelValue,
  useWidgetStoreRequired,
} from "../widget-store-context";

type DatetimeValue =
  | {
      year: number;
      month: number;
      date: number;
      hour: number;
      minute: number;
      second: number;
      microsecond?: number;
    }
  | string
  | null;

// Convert datetime value to datetime-local input format (YYYY-MM-DDTHH:MM)
function toDatetimeLocalString(value: DatetimeValue): string {
  if (!value) return "";
  if (typeof value === "string") {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const year = String(date.getFullYear()).padStart(4, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  }
  // ipywidgets sends month as 0-indexed
  const year = String(value.year).padStart(4, "0");
  const month = String(value.month + 1).padStart(2, "0");
  const date = String(value.date).padStart(2, "0");
  const hour = String(value.hour).padStart(2, "0");
  const minute = String(value.minute).padStart(2, "0");
  return `${year}-${month}-${date}T${hour}:${minute}`;
}

export function DatetimeWidget({ modelId, className }: WidgetComponentProps) {
  const { sendUpdate } = useWidgetStoreRequired();

  // Subscribe to individual state keys
  const value = useWidgetModelValue<DatetimeValue>(modelId, "value") ?? null;
  const min = useWidgetModelValue<DatetimeValue>(modelId, "min") ?? null;
  const max = useWidgetModelValue<DatetimeValue>(modelId, "max") ?? null;
  const description = useWidgetModelValue<string>(modelId, "description");
  const disabled = useWidgetModelValue<boolean>(modelId, "disabled") ?? false;

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = e.target.value;
      if (newValue) {
        const d = new Date(newValue);
        sendUpdate(modelId, {
          value: {
            year: d.getFullYear(),
            month: d.getMonth(),
            date: d.getDate(),
            hour: d.getHours(),
            minute: d.getMinutes(),
            second: d.getSeconds(),
            microsecond: 0,
          },
        });
      } else {
        sendUpdate(modelId, { value: null });
      }
    },
    [modelId, sendUpdate],
  );

  return (
    <div
      className={cn("flex items-center gap-3", className)}
      data-widget-id={modelId}
      data-widget-type="Datetime"
    >
      {description && <Label className="shrink-0 text-sm">{description}</Label>}
      <Input
        type="datetime-local"
        value={toDatetimeLocalString(value)}
        min={toDatetimeLocalString(min)}
        max={toDatetimeLocalString(max)}
        disabled={disabled}
        onChange={handleChange}
        className="w-52"
      />
    </div>
  );
}

export default DatetimeWidget;
