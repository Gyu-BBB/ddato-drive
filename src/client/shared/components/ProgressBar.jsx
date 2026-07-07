export function ProgressBar({ value = 0, label }) {
  const width = `${Math.max(0, Math.min(100, value))}%`;
  return (
    <div className="quota-block" aria-label={label}>
      {label ? <span className="muted">{label}</span> : null}
      <div className="quota-track">
        <div className="quota-fill" style={{ width }} />
      </div>
    </div>
  );
}
