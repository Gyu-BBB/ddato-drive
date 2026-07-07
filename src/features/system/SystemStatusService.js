import fs from "node:fs";
import { config } from "../../core/config.js";
import { getProjectStorageUsage } from "../../core/storageUsage.js";

export class SystemStatusService {
  getStatus(storageSummary, settings = {}) {
    const storage = {
      ...storageSummary,
      ...getProjectStorageUsage()
    };
    const projectUsedBytes = storage.usedBytes;
    const projectTotalBytes = config.projectDiskQuotaBytes;

    return {
      storage,
      project: {
        totalBytes: projectTotalBytes,
        usedBytes: projectUsedBytes,
        freeBytes: Math.max(0, projectTotalBytes - projectUsedBytes),
        usedPercent: projectTotalBytes ? Math.round((projectUsedBytes / projectTotalBytes) * 1000) / 10 : 0
      },
      disk: statDisk(config.dataDir),
      settings
    };
  }
}

function statDisk(targetPath) {
  try {
    const stat = fs.statfsSync(targetPath);
    const totalBytes = Number(stat.blocks) * Number(stat.bsize);
    const freeBytes = Number(stat.bavail) * Number(stat.bsize);
    return {
      totalBytes,
      freeBytes,
      usedBytes: Math.max(0, totalBytes - freeBytes),
      usedPercent: totalBytes ? Math.round(((totalBytes - freeBytes) / totalBytes) * 1000) / 10 : 0
    };
  } catch {
    return { totalBytes: 0, freeBytes: 0, usedBytes: 0, usedPercent: 0 };
  }
}

export const systemStatusService = new SystemStatusService();
