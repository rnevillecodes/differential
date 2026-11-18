import type { ReactNode } from "react";

/** A centred empty or status message filling a sidebar panel. */
export function SidebarEmpty({
  icon,
  title,
  children,
  action,
  tone,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: { label: string; onClick: () => void };
  tone?: "error";
}) {
  return (
    <div className={`sidebar-empty${tone ? ` ${tone}` : ""}`} role={tone === "error" ? "alert" : "status"}>
      {icon && <div className="sidebar-empty-icon">{icon}</div>}
      <p className="sidebar-empty-title">{title}</p>
      {children && <p className="sidebar-empty-text">{children}</p>}
      {action && (
        <button type="button" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}
