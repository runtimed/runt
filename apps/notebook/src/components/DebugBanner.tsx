import { GitBranch } from "lucide-react";

interface DebugBannerProps {
  branch: string;
  commit: string;
  description?: string | null;
}

export function DebugBanner({ branch, commit, description }: DebugBannerProps) {
  return (
    <div className="flex items-center justify-center gap-2 bg-violet-600/90 px-3 py-1 text-xs text-white">
      <GitBranch className="h-3 w-3" />
      <span className="font-medium">{branch}</span>
      <span className="text-violet-200">@</span>
      <span className="font-mono text-violet-200">{commit}</span>
      {description && (
        <>
          <span className="text-violet-300">|</span>
          <span className="text-violet-100">{description}</span>
        </>
      )}
      <span className="ml-2 rounded bg-violet-500/50 px-1.5 py-0.5 text-[10px] font-medium uppercase">
        Dev
      </span>
    </div>
  );
}
