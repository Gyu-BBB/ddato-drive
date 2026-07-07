import { Inbox } from "lucide-react";

export function EmptyState({ title, body, action = null }) {
  return (
    <div className="empty-state">
      <Inbox size={34} />
      <strong>{title}</strong>
      {body ? <span>{body}</span> : null}
      {action}
    </div>
  );
}
