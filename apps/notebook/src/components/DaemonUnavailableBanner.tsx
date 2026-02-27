import { AlertTriangle, X } from "lucide-react";

interface DaemonUnavailableBannerProps {
  message: string;
  guidance: string;
  onDismiss: () => void;
}

export function DaemonUnavailableBanner({
  message,
  guidance,
  onDismiss,
}: DaemonUnavailableBannerProps) {
  return (
    <div className="flex items-center justify-between gap-3 bg-red-600/90 px-3 py-2 text-sm text-white">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 flex-shrink-0" />
        <span className="font-medium">{message}</span>
        <span className="text-red-200">—</span>
        <span className="text-red-100">{guidance}</span>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="rounded p-1 hover:bg-red-500/50 transition-colors"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
