import { ApiError } from "./apiError.js";
import { formatBytes } from "../lib/formatBytes.js";

export async function apiRequest(path, options = {}) {
  const headers = new Headers(options.headers || {});
  let body = options.body;

  if (body && !(body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(body);
  }

  const response = await fetch(path, {
    method: options.method || "GET",
    headers,
    body,
    credentials: "include",
    signal: options.signal
  });

  if (options.responseType === "blob") {
    if (!response.ok) await throwApiError(response);
    return response.blob();
  }

  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  if (!response.ok || json?.ok === false) {
    const details = json?.details || null;
    throw new ApiError(formatApiErrorMessage(json?.error || response.statusText, details), response.status, details);
  }
  return json;
}

async function throwApiError(response) {
  const text = await response.text();
  try {
    const json = JSON.parse(text);
    throw new ApiError(formatApiErrorMessage(json.error || response.statusText, json.details || null), response.status, json.details || null);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(response.statusText, response.status);
  }
}

export function formatApiErrorMessage(message, details) {
  if (details?.code === "password_required") {
    return "암호가 필요합니다.";
  }

  if (details?.code === "password_invalid") {
    return "암호가 올바르지 않습니다.";
  }

  if (details?.code === "password_required_input") {
    return "암호를 입력하세요.";
  }

  if (details?.code === "user_quota_exceeded") {
    const remaining = formatBytes(details.remainingBytes || 0);
    const quota = formatBytes(details.quotaBytes || 0);
    const used = formatBytes(details.usageBytes || 0);
    const pending = Number(details.pendingBytes || 0);
    const upload = Number(details.fileBytes || 0);
    const uploadText = upload > 0 ? ` 업로드하려는 파일은 ${formatBytes(upload)}입니다.` : "";
    const pendingText = pending > 0 ? ` 진행 중인 업로드 ${formatBytes(pending)}도 사용량에 포함됩니다.` : "";
    return `저장 공간이 부족합니다. 남은 용량은 ${remaining}이고 전체 용량은 ${quota}입니다.${uploadText} 현재 사용량은 ${used}입니다.${pendingText}`;
  }

  if (details?.code === "project_quota_exceeded") {
    const available = formatBytes(details.availableBytes || 0);
    const quota = formatBytes(details.quotaBytes || 0);
    const upload = Number(details.fileBytes || details.requestBytes || 0);
    const uploadText = upload > 0 ? ` 업로드하려는 파일은 ${formatBytes(upload)}입니다.` : "";
    return `프로젝트 저장 공간이 부족합니다. 현재 남은 프로젝트 용량은 ${available}이고 전체 프로젝트 용량은 ${quota}입니다.${uploadText}`;
  }

  if (details?.code === "upload_file_too_large") {
    const max = Number(details.maxBytes || 0);
    return max > 0
      ? `파일이 너무 큽니다. 최대 업로드 가능 크기는 ${formatBytes(max)}입니다.`
      : "파일이 너무 큽니다.";
  }

  return message || "요청을 처리하지 못했습니다.";
}
