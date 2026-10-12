import { execFile } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { config } from "../../core/config.js";

const execFileAsync = promisify(execFile);

const CONVERTIBLE_EXTENSIONS = new Set([
  ".doc",
  ".docx",
  ".docm",
  ".dot",
  ".dotx",
  ".dotm",
  ".xls",
  ".xlsx",
  ".xlsm",
  ".xlt",
  ".xltx",
  ".xltm",
  ".ppt",
  ".pptx",
  ".pptm",
  ".pps",
  ".ppsx",
  ".ppsm",
  ".pot",
  ".potx",
  ".potm",
  ".odt",
  ".ott",
  ".ods",
  ".ots",
  ".odp",
  ".otp",
  ".rtf"
]);

export class DocumentPdfPreviewService {
  cachedPdfPath(file) {
    const cachedPath = this.cachePath(file);
    return fs.existsSync(cachedPath) ? cachedPath : "";
  }

  canConvert(file) {
    return this.canTryConvert(file) && Boolean(findOfficeBinary());
  }

  async convertToPdf(file, absolutePath) {
    if (!this.canTryConvert(file)) return null;

    const officeBinary = findOfficeBinary();
    if (!officeBinary) return null;

    const cachedPath = this.cachePath(file);
    if (fs.existsSync(cachedPath)) return cachedPath;

    const workDir = await fsp.mkdtemp(path.join(config.tempDir, "document-pdf-preview-"));
    let profileDir;
    const inputPath = path.join(workDir, path.basename(absolutePath));

    try {
      profileDir = await fsp.mkdtemp(path.join(os.tmpdir(), "ddato-office-profile-"));
      await fsp.copyFile(absolutePath, inputPath);
      await execFileAsync(officeBinary, [
        "--headless",
        "--nologo",
        "--nofirststartwizard",
        "--nodefault",
        "--nolockcheck",
        `-env:UserInstallation=file://${profileDir}`,
        "--convert-to",
        "pdf",
        "--outdir",
        workDir,
        inputPath
      ], {
        env: {
          ...process.env,
          SAL_USE_VCLPLUGIN: "svp"
        },
        stdio: "ignore",
        timeout: 60_000
      });

      const convertedPath = path.join(workDir, `${path.basename(inputPath, path.extname(inputPath))}.pdf`);
      if (!fs.existsSync(convertedPath)) return null;

      await fsp.mkdir(path.dirname(cachedPath), { recursive: true });
      await fsp.rename(convertedPath, cachedPath);
      return cachedPath;
    } catch {
      return null;
    } finally {
      await fsp.rm(workDir, { recursive: true, force: true });
      if (profileDir) await fsp.rm(profileDir, { recursive: true, force: true });
    }
  }

  canTryConvert(file) {
    const extension = path.extname(String(file.original_name || "")).toLowerCase();
    return CONVERTIBLE_EXTENSIONS.has(extension);
  }

  cachePath(file) {
    const version = [
      file.id,
      file.updated_at || 0,
      file.size_bytes || 0
    ].join("-");
    return path.join(config.previewCacheDir, "pdf", `${version}.pdf`);
  }
}

let officeBinaryCache = null;
let officeBinaryCheckedAt = 0;

function findOfficeBinary() {
  if (officeBinaryCache !== null && Date.now() - officeBinaryCheckedAt < 60000) return officeBinaryCache;
  const candidates = [
    process.env.DDATO_DRIVE_OFFICE_BINARY,
    findInPath("soffice"),
    findInPath("libreoffice"),
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
    "/opt/homebrew/bin/soffice",
    "/usr/local/bin/soffice"
  ].filter(Boolean);

  officeBinaryCache = candidates.find((candidate) => fs.existsSync(candidate)) || "";
  officeBinaryCheckedAt = Date.now();
  return officeBinaryCache;
}

function findInPath(binaryName) {
  for (const directory of String(process.env.PATH || "").split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, binaryName);
    if (fs.existsSync(candidate)) return candidate;
  }
  return "";
}

export const documentPdfPreviewService = new DocumentPdfPreviewService();
