import { Icons, cn } from "@wealthfolio/ui";
import type { IconName } from "@wealthfolio/ui";
import type { ReactNode } from "react";

interface PageShellProps {
  iconName?: IconName;
  heading: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * Consistent page frame used by both Dashboard and Settings. Renders a Wealthfolio-style
 * header (Phosphor icon + heading + subtitle + action slot) over the page content. Kept
 * deliberately light — doesn't use `@wealthfolio/ui`'s `Page`/`PageHeader` because those
 * assume the host app shell's scroll context and rendered oddly inside the addon outlet.
 */
export function PageShell({ iconName, heading, description, actions, children, className }: PageShellProps) {
  const Icon = iconName ? Icons[iconName] : null;
  return (
    <div className={cn("space-y-6 p-6 max-w-3xl mx-auto", className)}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          {Icon && (
            <div className="rounded-xl bg-muted p-2 text-foreground/80">
              <Icon size={22} weight="duotone" />
            </div>
          )}
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{heading}</h1>
            {description && <p className="text-muted-foreground mt-1 text-sm">{description}</p>}
          </div>
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}
