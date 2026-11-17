import { useApp, type SidebarTab } from "../store";
import { FileList } from "./FileList";
import { FileTree } from "./FileTree";

const TABS: { id: SidebarTab; label: string }[] = [
  { id: "changes", label: "Changes" },
  { id: "files", label: "Files" },
];

export function Sidebar() {
  const tab = useApp((s) => s.sidebarTab);
  const setTab = useApp((s) => s.setSidebarTab);
  return (
    <aside className="sidebar">
      <div className="sidebar-tabs" role="tablist" aria-label="Sidebar">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="sidebar-panel" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "changes" ? <FileList /> : <FileTree />}
      </div>
    </aside>
  );
}
