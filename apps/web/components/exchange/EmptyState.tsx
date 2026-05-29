import Link from "next/link";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: {
    label: string;
    href?: string;
    onClick?: () => void;
  };
  className?: string;
}

export function EmptyState({ title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-6 py-12 text-center",
        className,
      )}
    >
      <h3 className="text-base font-semibold text-text">{title}</h3>
      {description ? (
        <p className="text-sm text-text-dim max-w-md">{description}</p>
      ) : null}
      {action ? (
        action.href ? (
          <Link
            href={action.href}
            className="inline-flex items-center justify-center h-9 px-4 text-sm font-semibold rounded-md bg-accent text-accent-fg hover:bg-accent-hover transition-colors mt-2"
          >
            {action.label}
          </Link>
        ) : (
          <button
            type="button"
            onClick={action.onClick}
            className="inline-flex items-center justify-center h-9 px-4 text-sm font-semibold rounded-md bg-accent text-accent-fg hover:bg-accent-hover transition-colors mt-2"
          >
            {action.label}
          </button>
        )
      ) : null}
    </div>
  );
}
