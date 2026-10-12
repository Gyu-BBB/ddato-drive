export const INTERNAL_MOVE_TYPE = "application/x-ddato-drive-file-ids";

export function hasInternalMove(dataTransfer) {
  return Array.from(dataTransfer?.types || []).includes(INTERNAL_MOVE_TYPE);
}

export function readInternalMoveIds(dataTransfer, fallbackIds = []) {
  try {
    const ids = JSON.parse(dataTransfer?.getData(INTERNAL_MOVE_TYPE) || "null");
    return normalizeIds(Array.isArray(ids) ? ids : fallbackIds);
  } catch {
    return normalizeIds(fallbackIds);
  }
}

function normalizeIds(ids) {
  return [...new Set(ids.filter(id => typeof id === "string" && id.length > 0))];
}

export function compactMoveSelection(items) {
  const unique = [...new Map(items.filter(Boolean).map(item => [item.id, item])).values()];
  const ids = new Set(unique.map(item => item.id));
  return unique.filter(item => !(item.path || []).some(entry => entry.id !== item.id && ids.has(entry.id)));
}

export function dragSelection(file, selectedFiles) {
  return compactMoveSelection(selectedFiles.some(item => item.id === file.id) ? selectedFiles : [file]);
}

export function canDropSelection(items, target) {
  if (!items.length || (target && target.type !== "folder")) return false;
  const targetId = target?.id || null;
  const ancestors = new Set((target?.path || []).map(entry => entry.id));
  if (items.some(item => item.id === targetId || (item.type === "folder" && ancestors.has(item.id)))) return false;
  return items.some(item => (item.parentId || null) !== targetId);
}

export function createMoveDragImage(dataTransfer, items) {
  const image = document.createElement("div");
  image.className = "file-move-drag-image";
  image.textContent = items.length > 1 ? `${items.length}개 항목` : items[0].name;
  image.setAttribute("aria-hidden", "true");
  document.body.append(image);
  dataTransfer.setDragImage(image, 16, 16);
  return () => image.remove();
}
