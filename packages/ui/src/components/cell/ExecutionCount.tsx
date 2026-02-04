import { cn } from "@runtimed/ui/lib/utils";

interface ExecutionCountProps {
  count: number | null;
  isExecuting?: boolean;
  className?: string;
}

export function ExecutionCount({
  count,
  isExecuting,
  className,
}: ExecutionCountProps) {
  const display = isExecuting ? "*" : (count ?? " ");
  return (
    <span
      data-slot="execution-count"
      className={cn("font-mono text-sm text-muted-foreground", className)}
    >
      [{display}]:
    </span>
  );
}
