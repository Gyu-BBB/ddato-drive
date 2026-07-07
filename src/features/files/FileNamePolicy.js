import { normalizeCrossPlatformFileName, repairLatin1Utf8Name } from "../../core/fileNames.js";

export class FileNamePolicy {
  sanitize(value, fallback = "untitled") {
    return normalizeCrossPlatformFileName(value, fallback);
  }

  sanitizeUploadName(value, fallback = "upload") {
    return this.sanitize(repairLatin1Utf8Name(value), fallback);
  }

  copyName(value) {
    const name = this.sanitize(value, "copy");
    const extensionIndex = name.lastIndexOf(".");
    const hasExtension = extensionIndex > 0;
    const base = hasExtension ? name.slice(0, extensionIndex) : name;
    const extension = hasExtension ? name.slice(extensionIndex) : "";
    return `${base} 복사본${extension}`;
  }

  nextAvailable(repository, ownerId, parentId, preferredName, exceptId = "") {
    if (!repository.nameExists(ownerId, parentId, preferredName, exceptId)) return preferredName;

    const extensionIndex = preferredName.lastIndexOf(".");
    const hasExtension = extensionIndex > 0;
    const base = hasExtension ? preferredName.slice(0, extensionIndex) : preferredName;
    const extension = hasExtension ? preferredName.slice(extensionIndex) : "";

    for (let index = 1; index <= 9999; index += 1) {
      const candidate = `${base} (${index})${extension}`;
      if (!repository.nameExists(ownerId, parentId, candidate, exceptId)) return candidate;
    }

    const error = new Error("Could not find an available file name.");
    error.statusCode = 409;
    throw error;
  }
}

export const fileNamePolicy = new FileNamePolicy();
