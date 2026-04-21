import { NextRequest, NextResponse } from "next/server";
import puppeteer from "puppeteer";
import * as path from "path";
import * as fs from "fs";
import { isAuthorized } from "@/lib/basic-auth";
import { apiError, enforceWriteRequestSecurity } from "@/lib/api-security";
import { getRequestId, logError, logWarn } from "@/lib/logger";
import { pdfToImageSchema, zodFields } from "@/lib/validation";

export const dynamic = "force-dynamic";

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 10;
const MAX_CONCURRENT_CONVERSIONS = 2;
const ipRequestLog = new Map<string, number[]>();
let activeConversions = 0;

function getClientIp(request: NextRequest) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }

  const realIp = request.headers.get("x-real-ip");
  return realIp || "unknown";
}

function isPathInsideBase(baseDir: string, targetPath: string) {
  const relative = path.relative(baseDir, targetPath);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function hasSymlinkInPath(baseDir: string, targetPath: string) {
  const relative = path.relative(baseDir, targetPath);
  const parts = relative.split(path.sep).filter(Boolean);
  let current = baseDir;

  for (const part of parts) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      return true;
    }
  }

  return false;
}

function applyRateLimit(request: NextRequest) {
  const now = Date.now();
  const key = getClientIp(request);
  const timestamps = ipRequestLog.get(key) ?? [];
  const recent = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);

  if (recent.length >= RATE_LIMIT_MAX_REQUESTS) {
    const oldest = recent[0] ?? now;
    const retryAfterSec = Math.max(1, Math.ceil((RATE_LIMIT_WINDOW_MS - (now - oldest)) / 1000));
    ipRequestLog.set(key, recent);
    return { limited: true, retryAfterSec };
  }

  recent.push(now);
  ipRequestLog.set(key, recent);

  if (ipRequestLog.size > 5000) {
    for (const [ip, logs] of ipRequestLog.entries()) {
      const validLogs = logs.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
      if (validLogs.length === 0) {
        ipRequestLog.delete(ip);
      } else {
        ipRequestLog.set(ip, validLogs);
      }
    }
  }

  return { limited: false, retryAfterSec: 0 };
}

function tryAcquireConversionSlot() {
  if (activeConversions >= MAX_CONCURRENT_CONVERSIONS) {
    return false;
  }
  activeConversions += 1;
  return true;
}

function releaseConversionSlot() {
  activeConversions = Math.max(0, activeConversions - 1);
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  const route = "/api/pdf-to-image";
  let browser;
  let slotAcquired = false;
  try {
    const securityError = enforceWriteRequestSecurity(request, { requestId });
    if (securityError) return securityError;

    const rateLimit = applyRateLimit(request);
    if (rateLimit.limited) {
      return apiError(
        429,
        {
          error: "Too many requests",
          code: "RATE_LIMIT_EXCEEDED",
          details: `Rate limit exceeded (${RATE_LIMIT_MAX_REQUESTS} requests per minute)`,
          requestId,
        },
        {
          headers: { "Retry-After": String(rateLimit.retryAfterSec) },
        }
      );
    }

    if (!tryAcquireConversionSlot()) {
      return apiError(429, {
        error: "Too many concurrent conversions",
        code: "CONVERSION_QUEUE_FULL",
        details: `Only ${MAX_CONCURRENT_CONVERSIONS} concurrent conversions are allowed`,
        requestId,
      });
    }
    slotAcquired = true;

    // ⚠️ CRITICAL: Require authentication
    if (!isAuthorized(request)) {
      return apiError(401, {
        error: "Unauthorized - authentication required",
        code: "UNAUTHORIZED",
        requestId,
      });
    }

    const body = await request.json().catch(() => null);
    const parsed = pdfToImageSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(400, {
        error: "入力内容が不正です",
        code: "VALIDATION_ERROR",
        fields: zodFields(parsed.error),
        requestId,
      });
    }
    const { filePath } = parsed.data;

    // ⚠️ CRITICAL: Path Traversal Prevention
    const allowedBaseDir = path.resolve(process.cwd(), "public", "photos");
    const normalizedInputPath = path.normalize(filePath);
    const resolvedFilePath = path.isAbsolute(normalizedInputPath)
      ? path.resolve(normalizedInputPath)
      : path.resolve(allowedBaseDir, normalizedInputPath);

    if (!isPathInsideBase(allowedBaseDir, resolvedFilePath)) {
      logWarn("pdf_to_image.path_traversal_blocked", {
        requestId,
        route,
        errorCode: "INVALID_FILE_PATH",
        context: { filePath, resolvedFilePath },
      });
      return apiError(403, {
        error: "Invalid file path - access denied",
        code: "INVALID_FILE_PATH",
        requestId,
      });
    }

    // Verify file exists
    if (!fs.existsSync(resolvedFilePath)) {
      return apiError(404, {
        error: "File not found",
        code: "FILE_NOT_FOUND",
        requestId,
      });
    }

    // Detect symlink traversal using lstat (including parent path segments)
    if (hasSymlinkInPath(allowedBaseDir, resolvedFilePath)) {
      logWarn("pdf_to_image.symlink_blocked", {
        requestId,
        route,
        errorCode: "SYMLINK_NOT_ALLOWED",
        context: { resolvedFilePath },
      });
      return apiError(403, {
        error: "Symlinks are not allowed",
        code: "SYMLINK_NOT_ALLOWED",
        requestId,
      });
    }

    const realBaseDir = fs.realpathSync(allowedBaseDir);
    const realResolvedFilePath = fs.realpathSync(resolvedFilePath);
    if (!isPathInsideBase(realBaseDir, realResolvedFilePath)) {
      logWarn("pdf_to_image.realpath_blocked", {
        requestId,
        route,
        errorCode: "INVALID_REALPATH",
        context: { resolvedFilePath, realResolvedFilePath },
      });
      return apiError(403, {
        error: "Invalid file path - access denied",
        code: "INVALID_REALPATH",
        requestId,
      });
    }

    const stats = fs.statSync(resolvedFilePath);

    // Verify it's a regular file and a PDF
    if (!stats.isFile() || path.extname(resolvedFilePath).toLowerCase() !== ".pdf") {
      return apiError(400, {
        error: "Invalid file - must be a PDF file",
        code: "INVALID_FILE_TYPE",
        requestId,
      });
    }

    // ⚠️ CRITICAL: File size limit (prevent DoS - Puppeteer uses significant memory)
    const MAX_PDF_SIZE = 50 * 1024 * 1024; // 50 MB
    if (stats.size > MAX_PDF_SIZE) {
      return apiError(413, {
        error: "File too large",
        code: "FILE_TOO_LARGE",
        details: `Maximum file size is ${MAX_PDF_SIZE / (1024 * 1024)}MB`,
        requestId,
      });
    }

    // Create output directory
    const outputDir = path.join(process.cwd(), "public", "converted-images");
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Generate unique filename
    const baseFileName = path.basename(resolvedFilePath, ".pdf");
    const fileName = `${Date.now()}-${baseFileName}`;

    // Launch browser
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();

    // ⚠️ CRITICAL: Use validated/resolved path only
    // Ensure absolute path is used with file:// protocol
    const fileUrl = `file://${resolvedFilePath}`;
    
    // Set a timeout for the PDF loading to prevent DoS
    try {
      await page.goto(fileUrl, { 
        waitUntil: "networkidle0",
        timeout: 30000, // 30 second timeout
      });
    } catch (navigationError) {
      logError("pdf_to_image.load_failed", {
        requestId,
        route,
        errorCode: "PDF_LOAD_FAILED",
        context: {
          resolvedFilePath,
          message: navigationError instanceof Error ? navigationError.message : String(navigationError),
        },
      });
      return apiError(400, {
        error: "Failed to load PDF - may be corrupted or invalid",
        code: "PDF_LOAD_FAILED",
        requestId,
      });
    }

    // Set viewport
    await page.setViewport({ width: 1200, height: 1600 });

    // Take screenshot
    const imagePath = path.join(outputDir, `${fileName}.png`);
    await page.screenshot({
      path: imagePath,
      fullPage: true,
    });

    await browser.close();

    // Return the image path
    const webImagePath = `/converted-images/${fileName}.png`;

    return NextResponse.json(
      {
        success: true,
        imagePath: webImagePath,
        message: "PDF converted successfully",
        requestId,
      },
      { status: 200 }
    );
  } catch (error) {
    logError("pdf_to_image.unexpected", {
      requestId,
      route,
      errorCode: "PDF_CONVERT_FAILED",
      context: { message: error instanceof Error ? error.message : String(error) },
    });
    return apiError(500, {
      error: "Failed to convert PDF to image",
      code: "PDF_CONVERT_FAILED",
      requestId,
    });
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    if (slotAcquired) {
      releaseConversionSlot();
    }
  }
}
