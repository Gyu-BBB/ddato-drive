import { ChevronRight, Home } from "lucide-react";

export function Breadcrumbs({ stack, onNavigate, label = "", compact = false,
  canDrop = false, dropTargetId = "", onDragOverFolder, onDragLeaveFolder, onDropOnFolder }) {
  if (!stack.length && !label && !canDrop) return null;

  function dropProps(folder) {
    return {
      className: `breadcrumb-button${canDrop && dropTargetId === (folder?.id || "home") ? " move-drop-target" : ""}`,
      onDragOver: canDrop ? event => onDragOverFolder?.(event, folder) : undefined,
      onDragLeave: canDrop ? event => onDragLeaveFolder?.(event, folder) : undefined,
      onDrop: canDrop ? event => onDropOnFolder?.(event, folder) : undefined
    };
  }

  return (
    <nav className={compact ? "breadcrumb-row compact" : "breadcrumb-row"} aria-label="현재 경로">
      <div className="breadcrumb-trail" aria-label="현재 경로">
        {label ? <span className="breadcrumb-owner">{label}</span> : null}
        <button {...dropProps(null)} onClick={() => onNavigate(-1)}>
          <Home size={13} /> 홈
        </button>
        {stack.map((folder, index) => (
          <span className="breadcrumb-segment" key={folder.id}>
            <ChevronRight size={12} aria-hidden="true" />
            <button {...dropProps({ ...folder, type: "folder", path: stack.slice(0, index + 1) })} onClick={() => onNavigate(index)}>{folder.name}</button>
          </span>
        ))}
      </div>
    </nav>
  );
}
