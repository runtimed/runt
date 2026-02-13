import { useCallback, useEffect, useState } from "react";
import { Save, Play, Square, Plus, Package, Settings, Sun, Moon, Monitor, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { ThemeMode } from "@/hooks/useTheme";
import type { KernelspecInfo } from "../types";
import type { EnvProgressState } from "../hooks/useEnvProgress";

interface NotebookToolbarProps {
  kernelStatus: string;
  dirty: boolean;
  hasDependencies: boolean;
  theme: ThemeMode;
  envProgress: EnvProgressState | null;
  onThemeChange: (theme: ThemeMode) => void;
  onSave: () => void;
  onStartKernel: (name: string) => void;
  onInterruptKernel: () => void;
  onRestartKernel: () => void;
  onAddCell: (type: "code" | "markdown") => void;
  onToggleDependencies: () => void;
  listKernelspecs: () => Promise<KernelspecInfo[]>;
}

const themeOptions: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

export function NotebookToolbar({
  kernelStatus,
  dirty,
  hasDependencies,
  theme,
  envProgress,
  onThemeChange,
  onSave,
  onStartKernel,
  onInterruptKernel,
  onRestartKernel,
  onAddCell,
  onToggleDependencies,
  listKernelspecs,
}: NotebookToolbarProps) {
  const [kernelspecs, setKernelspecs] = useState<KernelspecInfo[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    listKernelspecs().then(setKernelspecs);
  }, [listKernelspecs]);

  const handleStartKernel = useCallback(() => {
    // Default to python3 or first available
    const python = kernelspecs.find(
      (k) => k.name === "python3" || k.name === "python"
    );
    const spec = python ?? kernelspecs[0];
    if (spec) {
      onStartKernel(spec.name);
    }
  }, [kernelspecs, onStartKernel]);

  const isKernelRunning =
    kernelStatus === "idle" ||
    kernelStatus === "busy" ||
    kernelStatus === "starting";

  return (
    <Collapsible open={settingsOpen} onOpenChange={setSettingsOpen}>
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/60">
        <div className="flex h-10 items-center gap-2 px-3">
          {/* Save */}
          <button
            type="button"
            onClick={onSave}
            className={cn(
              "flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors hover:bg-muted",
              dirty ? "text-foreground" : "text-muted-foreground"
            )}
            title="Save (Cmd+S)"
          >
            <Save className="h-3.5 w-3.5" />
            {dirty && <span className="text-[10px]">&bull;</span>}
          </button>

          <div className="h-4 w-px bg-border" />

          {/* Add cells */}
          <button
            type="button"
            onClick={() => onAddCell("code")}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="Add code cell"
          >
            <Plus className="h-3 w-3" />
            Code
          </button>
          <button
            type="button"
            onClick={() => onAddCell("markdown")}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="Add markdown cell"
          >
            <Plus className="h-3 w-3" />
            Markdown
          </button>

          <div className="h-4 w-px bg-border" />

          {/* Dependencies */}
          <button
            type="button"
            onClick={onToggleDependencies}
            className={cn(
              "flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors hover:bg-muted",
              hasDependencies ? "text-foreground" : "text-muted-foreground"
            )}
            title="Manage dependencies"
          >
            <Package className="h-3.5 w-3.5" />
            Deps
          </button>

          <div className="flex-1" />

          {/* Kernel controls */}
          {!isKernelRunning ? (
            <button
              type="button"
              onClick={handleStartKernel}
              disabled={kernelspecs.length === 0}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
              title="Start kernel"
            >
              <Play className="h-3 w-3" fill="currentColor" />
              Start Kernel
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onInterruptKernel}
                className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                title="Interrupt kernel"
              >
                <Square className="h-3 w-3" />
                Interrupt
              </button>
              <button
                type="button"
                onClick={onRestartKernel}
                className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                title="Restart kernel"
              >
                <RotateCcw className="h-3 w-3" />
                Restart
              </button>
            </>
          )}

          {/* Kernel status */}
          <div className="flex items-center gap-1.5">
            <div
              className={cn(
                "h-2 w-2 rounded-full",
                kernelStatus === "idle" && "bg-green-500",
                kernelStatus === "busy" && "bg-amber-500",
                kernelStatus === "starting" && "bg-blue-500 animate-pulse",
                kernelStatus === "not started" && "bg-gray-400 dark:bg-gray-500",
                kernelStatus === "error" && "bg-red-500"
              )}
            />
            <span className="text-xs text-muted-foreground">
              {envProgress ? envProgress.statusText : (
                <span className="capitalize">{kernelStatus}</span>
              )}
            </span>
          </div>

          <div className="h-4 w-px bg-border" />

          {/* Settings gear */}
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                settingsOpen && "bg-muted text-foreground"
              )}
              aria-label="Settings"
            >
              <Settings className="h-4 w-4" />
            </button>
          </CollapsibleTrigger>
        </div>

        {/* Collapsible settings panel */}
        <CollapsibleContent>
          <div className="border-t bg-background px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="text-xs font-medium text-muted-foreground">
                Theme
              </span>
              <div className="flex items-center gap-1 rounded-md border bg-muted/50 p-0.5">
                {themeOptions.map((option) => {
                  const Icon = option.icon;
                  const isActive = theme === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => onThemeChange(option.value)}
                      className={cn(
                        "flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs transition-colors",
                        isActive
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </CollapsibleContent>
      </header>
    </Collapsible>
  );
}
