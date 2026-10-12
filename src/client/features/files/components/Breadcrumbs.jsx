import { ChevronRight, Home } from "lucide-react";

export function Breadcrumbs({ stack, onNavigate, label = "", compact = false }) {
  if (!stack.length && !label) return null;

  return (
    <nav className={compact ? "breadcrumb-row compact" : "breadcrumb-row"} aria-label="현재 경로">
      <div className="breadcrumb-trail" aria-label="현재 경로">
        {label ? <span className="breadcrumb-owner">{label}</span> : null}
        <button className="breadcrumb-button" onClick={() => onNavigate(-1)}>
          <Home size={13} /> 홈
        </button>
        {stack.map((folder, index) => (
          <span className="breadcrumb-segment" key={folder.id}>
            <ChevronRight size={12} aria-hidden="true" />
            <button className="breadcrumb-button" onClick={() => onNavigate(index)}>{folder.name}</button>
          </span>
        ))}
      </div>
    </nav>
  );
}
