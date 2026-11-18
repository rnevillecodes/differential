import { useApp, type SidebarTab } from "../store";
import { FileList } from "./FileList";
import { FileTree } from "./FileTree";
import { ChangesIcon, FilesIcon } from "./icons";

const TABS: { id: SidebarTab; label: string; Icon: typeof ChangesIcon }[] = [
  { id: "changes", label: "Changes", Icon: ChangesIcon },
  { id: "files", label: "Files", Icon: FilesIcon },
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
            <t.Icon />
            <span>{t.label}</span>
          </button>
        ))}
      </div>
      <div className="sidebar-panel" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "changes" ? <FileList /> : <FileTree />}
      </div>
    </aside>
  );
}
