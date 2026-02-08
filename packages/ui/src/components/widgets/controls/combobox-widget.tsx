"use client";

/**
 * Combobox widget - text input with autocomplete suggestions.
 *
 * Maps to ipywidgets ComboboxModel.
 */

import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { WidgetComponentProps } from "../widget-registry";
import {
  useWidgetModelValue,
  useWidgetStoreRequired,
} from "../widget-store-context";

export function ComboboxWidget({ modelId, className }: WidgetComponentProps) {
  const { sendUpdate, sendCustom } = useWidgetStoreRequired();

  // Subscribe to individual state keys
  const value = useWidgetModelValue<string>(modelId, "value") ?? "";
  const options = useWidgetModelValue<string[]>(modelId, "options") ?? [];
  const placeholder =
    useWidgetModelValue<string>(modelId, "placeholder") ?? "Select or type...";
  const description = useWidgetModelValue<string>(modelId, "description");
  const disabled = useWidgetModelValue<boolean>(modelId, "disabled") ?? false;
  const ensureOption =
    useWidgetModelValue<boolean>(modelId, "ensure_option") ?? false;
  const continuousUpdate =
    useWidgetModelValue<boolean>(modelId, "continuous_update") ?? true;

  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState(value);

  // Sync input value when value changes from kernel
  useEffect(() => {
    setInputValue(value);
  }, [value]);

  const handleSelect = useCallback(
    (selectedValue: string) => {
      setInputValue(selectedValue);
      sendUpdate(modelId, { value: selectedValue });
      setOpen(false);
    },
    [modelId, sendUpdate],
  );

  const handleInputChange = useCallback(
    (newValue: string) => {
      setInputValue(newValue);
      if (continuousUpdate) {
        // Only update if not enforcing option or value is in options
        if (!ensureOption || options.includes(newValue)) {
          sendUpdate(modelId, { value: newValue });
        }
      }
    },
    [modelId, continuousUpdate, ensureOption, options, sendUpdate],
  );

  const handleBlur = useCallback(() => {
    if (!continuousUpdate) {
      if (!ensureOption || options.includes(inputValue)) {
        sendUpdate(modelId, { value: inputValue });
      } else {
        // Reset to last valid value
        setInputValue(value);
      }
    }
    sendCustom(modelId, { event: "submit" });
  }, [
    modelId,
    continuousUpdate,
    ensureOption,
    options,
    inputValue,
    value,
    sendUpdate,
    sendCustom,
  ]);

  // Filter options based on input
  const filteredOptions = options.filter((option) =>
    option.toLowerCase().includes(inputValue.toLowerCase()),
  );

  return (
    <div
      className={cn("flex items-center gap-3", className)}
      data-widget-id={modelId}
      data-widget-type="Combobox"
    >
      {description && <Label className="shrink-0 text-sm">{description}</Label>}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className="w-48 justify-between font-normal"
          >
            <span className="truncate">{inputValue || placeholder}</span>
            <ChevronsUpDownIcon className="ml-2 size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-48 p-0" align="start">
          <Command>
            <CommandInput
              placeholder={placeholder}
              value={inputValue}
              onValueChange={handleInputChange}
              onBlur={handleBlur}
            />
            <CommandList>
              <CommandEmpty>
                {ensureOption ? "No matching option" : "Type to add new value"}
              </CommandEmpty>
              <CommandGroup>
                {filteredOptions.map((option) => (
                  <CommandItem
                    key={option}
                    value={option}
                    onSelect={handleSelect}
                  >
                    <CheckIcon
                      className={cn(
                        "mr-2 size-4",
                        value === option ? "opacity-100" : "opacity-0",
                      )}
                    />
                    {option}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export default ComboboxWidget;
