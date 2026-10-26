const collator = new Intl.Collator("ko", { numeric: true, sensitivity: "base" });

export function fileKind(file) {
  if (file.type === "folder") return "폴더";
  return file.mimeType || "파일";
}

export function fileExtension(file) {
  if (file.type === "folder") return "";
  const name = String(file.name || "");
  const dotIndex = name.lastIndexOf(".");
  return dotIndex > -1 && dotIndex < name.length - 1 ? name.slice(dotIndex + 1).toLowerCase() : "";
}

export function fileLocation(file) {
  if (!Array.isArray(file.path)) return "";
  const parentPath = file.type === "folder" ? file.path.slice(0, -1) : file.path;
  return parentPath.length ? parentPath.map((item) => item.name).join(" / ") : "홈";
}

export function filePath(file) {
  return fileLocation(file) || "홈";
}

export function sortFiles(files, field, direction) {
  const multiplier = direction === "desc" ? -1 : 1;
  return [...files].sort((left, right) => {
    const primary = compareSortValue(sortValue(left, field), sortValue(right, field)) * multiplier;
    if (primary) return primary;
    const name = collator.compare(String(left.name || ""), String(right.name || ""));
    if (name) return name;
    return collator.compare(String(left.id || ""), String(right.id || ""));
  });
}

function sortValue(file, field) {
  if (field === "size") return Number(file.sizeBytes || 0);
  if (field === "extension") return fileExtension(file);
  if (field === "createdAt") return Number(file.createdAt || 0);
  if (field === "updatedAt") return Number(file.updatedAt || 0);
  if (field === 'capturedAt') return Number(file.capturedAt || file.sourceModifiedAt || file.createdAt || 0);
  if (field === 'sourceModifiedAt') return Number(file.sourceModifiedAt || file.updatedAt || 0);
  if (field === "kind") return fileKind(file);
  if (field === "location") return fileLocation(file);
  return String(file.name || "");
}

function compareSortValue(left, right) {
  if (typeof left === "number" || typeof right === "number") {
    return Number(left || 0) - Number(right || 0);
  }
  return collator.compare(String(left || ""), String(right || ""));
}
