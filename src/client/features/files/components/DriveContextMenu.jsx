import { useEffect, useRef } from "react";

export function DriveContextMenu({ menu, onClose }) {
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menu) return undefined;

    const close = () => onClose?.();
    const handlePointerDown = (event) => {
      if (!menuRef.current?.contains(event.target)) close();
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") close();
    };

    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [menu, onClose]);

  if (!menu) return null;

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{ left: menu.x, top: menu.y }}
      role="menu"
      onContextMenu={(event) => event.preventDefault()}
    >
      {menu.items.map((item) => {
        if (item.separator) return <div key={item.id} className="context-menu-separator" />;
        if (item.palette) {
          return (
            <div key={item.id} className="context-menu-palette" role="group" aria-label={item.label}>
              <span>{item.label}</span>
              <div className="context-menu-swatches">
                {item.palette.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={option.active ? "context-color-button active" : "context-color-button"}
                    aria-label={`${option.label}로 변경`}
                    title={option.label}
                    onClick={() => item.onSelect(option.id)}
                  >
                    <span style={{ backgroundColor: option.body }} />
                  </button>
                ))}
              </div>
            </div>
          );
        }
        const Icon = item.icon;
        return (
          <button key={item.id} type="button" role="menuitem" onClick={item.onClick} disabled={item.disabled}>
            {Icon ? <Icon size={16} /> : null}
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
