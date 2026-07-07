import { execFile } from "node:child_process";
import fs from "node:fs";
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

    const workDir = fs.mkdtempSync(path.join(config.tempDir, "document-pdf-preview-"));
    const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "ddato-office-profile-"));
    const inputPath = path.join(workDir, path.basename(absolutePath));

    try {
      fs.copyFileSync(absolutePath, inputPath);
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

      fs.mkdirSync(path.dirname(cachedPath), { recursive: true });
      fs.copyFileSync(convertedPath, cachedPath);
      return cachedPath;
    } catch {
      return null;
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
      fs.rmSync(profileDir, { recursive: true, force: true });
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

function findOfficeBinary() {
  const candidates = [
    process.env.DDATO_DRIVE_OFFICE_BINARY,
    findInPath("soffice"),
    findInPath("libreoffice"),
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
    "/opt/homebrew/bin/soffice",
    "/usr/local/bin/soffice"
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate)) || "";
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
