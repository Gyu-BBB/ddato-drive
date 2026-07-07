export function IconButton({ icon: Icon, label, className = "", ...props }) {
  return (
    <button className={`icon-button ${className}`.trim()} type="button" title={label} aria-label={label} {...props}>
      <Icon size={18} />
    </button>
  );
}
