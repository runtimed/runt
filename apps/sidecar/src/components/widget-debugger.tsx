"use client";

import { useState, useCallback } from "react";
import { useWidgetModels } from "@/components/widgets/widget-store-context";
import { JsonOutput } from "@/components/outputs/json-output";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { ChevronRightIcon, CopyIcon, CheckIcon, BugIcon } from "lucide-react";

interface CopyButtonProps {
  data: unknown;
  className?: string;
}

function CopyButton({ data, className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  }, [data]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={cn(
        "p-1 rounded hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors",
        className,
      )}
      title="Copy JSON"
    >
      {copied ? (
        <CheckIcon className="size-3.5 text-green-500" />
      ) : (
        <CopyIcon className="size-3.5" />
      )}
    </button>
  );
}

interface ModelCardProps {
  id: string;
  modelName: string;
  modelModule: string;
  state: Record<string, unknown>;
  buffers: ArrayBuffer[];
}

function ModelCard({
  id,
  modelName,
  modelModule,
  state,
  buffers,
}: ModelCardProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Highlight potentially interesting fields for debugging
  const hasLayout = "layout" in state;
  const hasStyle = "style" in state;
  const hasChildren = "children" in state;

  // Create a summary of key fields
  const layoutValue = state.layout;
  const styleValue = state.style;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="border rounded-md bg-card overflow-hidden">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 transition-colors"
          >
            <ChevronRightIcon
              className={cn(
                "size-4 shrink-0 text-muted-foreground transition-transform",
                isOpen && "rotate-90",
              )}
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm truncate">
                  {modelName}
                </span>
                <span className="text-xs text-muted-foreground font-mono truncate">
                  {id.slice(0, 8)}…
                </span>
              </div>
              <div className="text-xs text-muted-foreground truncate">
                {modelModule}
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {hasLayout && (
                <span
                  className={cn(
                    "text-xs px-1.5 py-0.5 rounded",
                    typeof layoutValue === "string" &&
                      layoutValue.startsWith("IPY_MODEL_")
                      ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  layout
                </span>
              )}
              {hasStyle && (
                <span
                  className={cn(
                    "text-xs px-1.5 py-0.5 rounded",
                    typeof styleValue === "string" &&
                      styleValue.startsWith("IPY_MODEL_")
                      ? "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  style
                </span>
              )}
              {hasChildren && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                  children
                </span>
              )}
              {buffers.length > 0 && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                  {buffers.length} buffer{buffers.length > 1 ? "s" : ""}
                </span>
              )}
            </div>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t px-3 py-2">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-muted-foreground">
                Full State ({Object.keys(state).length} keys)
              </span>
              <CopyButton data={{ id, modelName, modelModule, state }} />
            </div>
            <div className="max-h-80 overflow-auto">
              <JsonOutput data={state} collapsed={2} />
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

export function WidgetDebugger() {
  const models = useWidgetModels();

  const modelArray = Array.from(models.values());

  // Group by module for easier browsing
  const groupedModels = modelArray.reduce(
    (acc, model) => {
      const module = model.modelModule || "unknown";
      if (!acc[module]) acc[module] = [];
      acc[module].push(model);
      return acc;
    },
    {} as Record<string, typeof modelArray>,
  );

  const copyAllModels = useCallback(() => {
    const data = modelArray.map((m) => ({
      id: m.id,
      modelName: m.modelName,
      modelModule: m.modelModule,
      state: m.state,
    }));
    navigator.clipboard.writeText(JSON.stringify(data, null, 2));
  }, [modelArray]);

  return (
    <Sheet>
      <SheetTrigger asChild>
        <button
          type="button"
          className="fixed bottom-4 right-4 z-50 flex items-center gap-2 px-3 py-2 rounded-lg border bg-background/95 backdrop-blur shadow-lg hover:bg-muted/50 transition-colors"
        >
          <BugIcon className="size-4 text-muted-foreground" />
          <span className="font-medium text-sm">Widget Debugger</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
            {models.size}
          </span>
        </button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="w-full sm:max-w-lg overflow-hidden flex flex-col"
      >
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <BugIcon className="size-5" />
            Widget Debugger
          </SheetTitle>
          <SheetDescription>
            Inspect all widget models and their state
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-auto -mx-4 px-4">
          {models.size === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-sm">
              No widget models yet.
              <br />
              <span className="text-xs">
                Execute code with ipywidgets to see models here.
              </span>
            </div>
          ) : (
            <div className="space-y-4 pb-4">
              <div className="flex items-center justify-between sticky top-0 bg-background py-2 -mt-2">
                <span className="text-sm text-muted-foreground">
                  {models.size} model{models.size !== 1 ? "s" : ""} ·{" "}
                  {Object.keys(groupedModels).length} module
                  {Object.keys(groupedModels).length !== 1 ? "s" : ""}
                </span>
                <button
                  type="button"
                  onClick={copyAllModels}
                  className="text-xs px-2 py-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                >
                  <CopyIcon className="size-3" />
                  Copy All
                </button>
              </div>
              {Object.entries(groupedModels).map(([module, moduleModels]) => (
                <div key={module}>
                  <div className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
                    {module}
                  </div>
                  <div className="space-y-2">
                    {moduleModels.map((model) => (
                      <ModelCard
                        key={model.id}
                        id={model.id}
                        modelName={model.modelName}
                        modelModule={model.modelModule}
                        state={model.state}
                        buffers={model.buffers}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
