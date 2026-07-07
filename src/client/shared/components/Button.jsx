export function Button({ icon: Icon, children, className = "", iconOnly = false, variant = "default", ...props }) {
  const label = typeof children === "string" ? children : props["aria-label"] || props.title;
  const nextClassName = `button ${variant} ${iconOnly ? "icon-only" : ""} ${className}`.trim();

  return (
    <button
      className={nextClassName}
      type={props.type || "button"}
      title={iconOnly ? label : props.title}
      aria-label={iconOnly ? label : props["aria-label"]}
      {...props}
    >
      {Icon ? <Icon size={17} /> : null}
      <span>{children}</span>
    </button>
  );
}
