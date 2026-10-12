export async function collectDroppedUploadEntries(dataTransfer) {
  const items = Array.from(dataTransfer?.items || []);
  const entries = items
    .filter((item) => item.kind === "file")
    .map((item) => (typeof item.webkitGetAsEntry === "function" ? item.webkitGetAsEntry() : null))
    .filter(Boolean);

  if (entries.length) {
    return mergeCollected(await Promise.all(entries.map((entry) => collectEntry(entry, []))));
  }

  return collectSelectedUploadEntries(dataTransfer?.files);
}

export function collectSelectedUploadEntries(fileList) {
  const files = Array.from(fileList || []);
  return {
    directories: [],
    files: files.map((file) => ({
      file,
      pathSegments: normalizePathSegments(file.webkitRelativePath || file.name, file.name)
    }))
  };
}

export async function uploadCollectedEntries({ entries, rootParentId, ownerId, createFolder, uploadFile, onQueueAdd, onQueueUpdate }) {
  const directories = collectDirectoryPaths(entries);
  const folderIds = new Map([["", rootParentId || null]]);

  for (const pathSegments of directories) {
    const key = pathKey(pathSegments);
    const itemId = `folder-${key}-${Date.now()}`;
    const parentSegments = pathSegments.slice(0, -1);
    const parentId = folderIds.get(pathKey(parentSegments)) || null;
    const name = pathSegments.at(-1);

    onQueueAdd({
      id: itemId,
      name: pathSegments.join("/"),
      status: "uploading",
      detail: "폴더 생성 중"
    });

    try {
      const result = await createFolder({ name, parentId, ownerId });
      folderIds.set(key, result.file.id);
      onQueueUpdate(itemId, { status: "done", detail: "폴더 생성됨" });
    } catch (error) {
      onQueueUpdate(itemId, { status: "failed", error: error.message || "폴더를 만들지 못했습니다." });
      throw error;
    }
  }

  for (const entry of entries.files) {
    const pathSegments = normalizePathSegments(entry.pathSegments, entry.file.name);
    const fileName = pathSegments.at(-1) || entry.file.name;
    const parentSegments = pathSegments.slice(0, -1);
    const parentId = folderIds.get(pathKey(parentSegments)) || rootParentId || null;
    await uploadFile({ file: entry.file, parentId, ownerId, name: fileName, displayName: pathSegments.join("/") });
  }
}

export function hasDroppedFiles(dataTransfer) {
  return Array.from(dataTransfer?.types || []).includes("Files");
}

function collectDirectoryPaths(entries) {
  const keys = new Set();
  const directories = [];

  for (const pathSegments of entries.directories) {
    addDirectoryPath(pathSegments);
  }

  for (const entry of entries.files) {
    const pathSegments = normalizePathSegments(entry.pathSegments, entry.file.name);
    for (let depth = 1; depth < pathSegments.length; depth += 1) {
      addDirectoryPath(pathSegments.slice(0, depth));
    }
  }

  return directories.sort((a, b) => a.length - b.length || a.join("/").localeCompare(b.join("/")));

  function addDirectoryPath(pathSegments) {
    const normalized = normalizePathSegments(pathSegments, "");
    if (!normalized.length) return;
    const key = pathKey(normalized);
    if (keys.has(key)) return;
    keys.add(key);
    directories.push(normalized);
  }
}

async function collectEntry(entry, basePath) {
  if (entry.isFile) {
    const file = await fileFromEntry(entry);
    return {
      directories: [],
      files: [{
        file,
        pathSegments: [...basePath, file.name]
      }]
    };
  }

  if (!entry.isDirectory) return { directories: [], files: [] };

  const directoryPath = [...basePath, entry.name];
  const children = await readDirectoryEntries(entry);
  const collected = await Promise.all(children.map((child) => collectEntry(child, directoryPath)));
  const merged = mergeCollected(collected);
  return {
    directories: [directoryPath, ...merged.directories],
    files: merged.files
  };
}

function fileFromEntry(entry) {
  return new Promise((resolve, reject) => {
    entry.file(resolve, reject);
  });
}

function readDirectoryEntries(entry) {
  const reader = entry.createReader();
  const entries = [];

  return new Promise((resolve, reject) => {
    const readBatch = () => {
      reader.readEntries((batch) => {
        if (!batch.length) {
          resolve(entries);
          return;
        }
        entries.push(...batch);
        readBatch();
      }, reject);
    };
    readBatch();
  });
}

function mergeCollected(collections) {
  return collections.reduce((result, collection) => ({
    directories: [...result.directories, ...collection.directories],
    files: [...result.files, ...collection.files]
  }), { directories: [], files: [] });
}

function normalizePathSegments(value, fallbackName) {
  const segments = Array.isArray(value) ? value : String(value || fallbackName || "").split("/");
  return segments
    .map((segment) => String(segment || "").normalize("NFC").trim())
    .filter((segment) => segment && segment !== "." && segment !== "..");
}

function pathKey(pathSegments) {
  return normalizePathSegments(pathSegments, "").join("\u0000");
}
