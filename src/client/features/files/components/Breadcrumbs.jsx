import { ChevronRight, Home } from "lucide-react";

export function Breadcrumbs({ stack, onNavigate, label = "" }) {
  return (
    <div className="breadcrumb-row">
      {label ? <span className="muted">{label}</span> : null}
      <button className="breadcrumb-button" onClick={() => onNavigate(-1)}>
        <Home size={15} /> 홈
      </button>
      {stack.map((folder, index) => (
        <span className="breadcrumb-segment" key={folder.id}>
          <ChevronRight size={14} color="var(--dd-muted)" />
          <button className="breadcrumb-button" onClick={() => onNavigate(index)}>{folder.name}</button>
        </span>
      ))}
    </div>
  );
}
