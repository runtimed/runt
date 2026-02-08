import { Sun, Moon, Monitor } from "lucide-react";
import type { ThemeMode } from "@/hooks/use-theme";
import { cn } from "@runtimed/ui/lib/utils";

interface SettingsPanelProps {
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
}

const themeOptions: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

export function SettingsPanel({ theme, onThemeChange }: SettingsPanelProps) {
  return (
    <div className="border-t bg-background px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="text-xs font-medium text-muted-foreground">Theme</span>
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
                    : "text-muted-foreground hover:text-foreground",
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
  );
}
