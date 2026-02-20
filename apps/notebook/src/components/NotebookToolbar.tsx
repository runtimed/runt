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

/** Notebook runtime type */
export type Runtime = "python" | "deno";

/** Deno logo icon (from tabler icons) */
function DenoIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0" />
      <path d="M13.47 20.882l-1.47 -5.882c-2.649 -.088 -5 -1.624 -5 -3.5c0 -1.933 2.239 -3.5 5 -3.5s4 1 5 3c.024 .048 .69 2.215 2 6.5" />
      <path d="M12 11h.01" />
    </svg>
  );
}

/** Python logo icon (from tabler icons) */
function PythonIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M12 9h-7a2 2 0 0 0 -2 2v4a2 2 0 0 0 2 2h3" />
      <path d="M12 15h7a2 2 0 0 0 2 -2v-4a2 2 0 0 0 -2 -2h-3" />
      <path d="M8 9v-4a2 2 0 0 1 2 -2h4a2 2 0 0 1 2 2v5a2 2 0 0 1 -2 2h-4a2 2 0 0 0 -2 2v5a2 2 0 0 0 2 2h4a2 2 0 0 0 2 -2v-4" />
      <path d="M11 6l0 .01" />
      <path d="M13 18l0 .01" />
    </svg>
  );
}

/** Format an env source string for display in the toolbar. */
function formatEnvSource(source: string | null): string | null {
  if (!source) return null;
  switch (source) {
    case "uv:inline": return "uv";
    case "uv:pyproject": return "pyproject.toml";
    case "uv:prewarmed": return "uv";
    case "uv:fresh": return "uv";
    case "conda:inline": return "conda";
    case "conda:pixi": return "pixi.toml";
    case "conda:env_yml": return "environment.yml";
    case "conda:prewarmed": return "conda";
    case "conda:fresh": return "conda";
    default: return source.split(":")[0] ?? source;
  }
}

interface NotebookToolbarProps {
  kernelStatus: string;
  envSource: string | null;
  dirty: boolean;
  hasDependencies: boolean;
  theme: ThemeMode;
  envProgress: EnvProgressState | null;
  runtime?: Runtime;
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
  envSource,
  dirty,
  hasDependencies,
  theme,
  envProgress,
  runtime = "python",
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

          {/* Runtime badge */}
          <div
            className={cn(
              "flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium",
              runtime === "deno"
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : "bg-blue-500/10 text-blue-600 dark:text-blue-400"
            )}
            title={runtime === "deno" ? "Deno/TypeScript notebook" : "Python notebook"}
          >
            {runtime === "deno" ? (
              <>
                <DenoIcon className="h-3 w-3" />
                <span>Deno</span>
              </>
            ) : (
              <>
                <PythonIcon className="h-3 w-3" />
                <span>Python</span>
              </>
            )}
          </div>

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
              {envProgress?.isActive ? envProgress.statusText : (
                <>
                  <span className="capitalize">{kernelStatus}</span>
                  {envSource && (kernelStatus === "idle" || kernelStatus === "busy") && (
                    <span className="text-muted-foreground/70"> · {formatEnvSource(envSource)}</span>
                  )}
                </>
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
