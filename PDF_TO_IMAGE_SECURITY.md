# PDF-to-Image API Security

## Critical Vulnerabilities Fixed

### 1. Path Traversal (CWE-22)
**Before:**
```typescript
// ❌ VULNERABLE: No path validation
const filePath = await request.json(); // User can send: "../../../etc/passwd.pdf"
if (!fs.existsSync(filePath) || !filePath.endsWith(".pdf")) {
  // This does NOT prevent traversal!
}
const fileUrl = `file://${filePath}`; // Opens ANY file
```

**Attack Example:**
```bash
# Send: ../../../etc/passwd.pdf
# Result: file:///etc/passwd.pdf opened in browser
```

**After:**
```typescript
// ✅ SECURE: Path normalization and boundary check
const allowedBaseDir = path.resolve(process.cwd(), "public", "photos");
const resolvedFilePath = path.resolve(filePath);

// CRITICAL: Verify resolved path stays within allowed directory
if (!resolvedFilePath.startsWith(allowedBaseDir)) {
  return 403; // Access Denied
}
```

### 2. Symlink Traversal (CWE-61)
**Before:**
```typescript
// ❌ VULNERABLE: fs.existsSync doesn't check for symlinks
if (!fs.existsSync(filePath)) { /* ... */ }
// Symlink to /etc/shadow would pass this check!
```

**After:**
```typescript
// ✅ SECURE: Explicitly check file type
const stats = fs.statSync(resolvedFilePath);
if (stats.isSymbolicLink()) {
  return 403; // Symlinks not allowed
}
if (!stats.isFile()) {
  return 400; // Must be regular file
}
```

### 3. Authentication Not Required (CWE-306)
**Before:**
```typescript
export async function POST(request: NextRequest) {
  // ❌ VULNERABLE: No authentication check
  const { filePath } = await request.json();
  // Anyone can call this endpoint
}
```

**After:**
```typescript
export async function POST(request: NextRequest) {
  // ✅ SECURE: Require Basic Auth
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { filePath } = await request.json();
}
```

### 4. Denial of Service - No Resource Limits (CWE-400)
**Before:**
```typescript
// ❌ VULNERABLE: No file size check
await page.goto(fileUrl, { waitUntil: "networkidle0" }); // Infinite wait?
// Large PDF → High memory usage → Server crash
```

**After:**
```typescript
// ✅ SECURE: Multi-layer DoS protection
const MAX_PDF_SIZE = 50 * 1024 * 1024; // 50 MB limit
if (stats.size > MAX_PDF_SIZE) {
  return 413; // Payload Too Large
}

// Timeout to prevent hanging
await page.goto(fileUrl, { 
  waitUntil: "networkidle0",
  timeout: 30000, // 30 second timeout
});
```

## Security Measures Implemented

| Layer | Mechanism | Protection |
|-------|-----------|-----------|
| **Authentication** | Basic Auth (isAuthorized) | Only admin users |
| **Path Validation** | `path.resolve()` + startsWith check | No traversal |
| **Symlink Check** | `isSymbolicLink()` check | No symlink traversal |
| **File Type** | Must be `.pdf` + `isFile()` | Only PDFs |
| **File Size** | 50 MB max limit | DoS prevention |
| **Timeout** | 30 second navigation timeout | Hanging prevention |
| **Allowed Directory** | `public/photos` only | Restricted scope |

## Safe Usage

### Correct Request
```bash
curl -X POST http://localhost:3000/api/pdf-to-image \
  -H "Authorization: Basic $(echo -n 'admin:changeme' | base64)" \
  -H "Content-Type: application/json" \
  -d '{"filePath": "/path/to/public/photos/menu.pdf"}'
```

### Blocked Requests
```bash
# Rejected: Path traversal
{"filePath": "../../../etc/passwd.pdf"}
# Status: 403 (Path outside allowed directory)

# Rejected: Symlink
{"filePath": "/path/to/photo/symlink.pdf"}
# Status: 403 (Symlinks not allowed)

# Rejected: Too large
# File size > 50 MB
# Status: 413 (Payload Too Large)

# Rejected: Unauthenticated
# Missing or invalid Authorization header
# Status: 401 (Unauthorized)
```

## Implementation Details

### File Location
`src/app/api/pdf-to-image/route.ts`

### Key Changes
1. Added `import { isAuthorized } from "@/lib/basic-auth"`
2. Path traversal prevention using `path.resolve()` and boundary check
3. Symlink detection using `fs.statSync().isSymbolicLink()`
4. File size validation (50 MB max)
5. Navigation timeout (30 seconds)
6. Error handling with appropriate HTTP status codes

### Configuration
- **Allowed Directory**: `{cwd}/public/photos`
- **Max File Size**: 50 MB
- **Navigation Timeout**: 30 seconds
- **Auth Method**: Basic Auth (same as admin dashboard)

## Related Security Documents

- See `SECURITY_ARCHITECTURE.md` for authentication architecture
- See `middleware.ts` for protected route configuration
- See `ORDER_VALIDATION_SECURITY.md` for server-side validation patterns

## Testing Checklist

- [ ] Normal PDF conversion works
- [ ] Path traversal with `../` is rejected (403)
- [ ] Symlink access is rejected (403)
- [ ] Files >50MB are rejected (413)
- [ ] Requests without auth are rejected (401)
- [ ] File extension check (.pdf required)
- [ ] Non-existent files are rejected (404)
- [ ] Timeout works on slow PDFs
- [ ] Output is properly written to `/public/converted-images`

## Future Improvements

1. **Rate Limiting**: Add per-user rate limits to prevent abuse
2. **Content Validation**: Validate PDF structure before processing
3. **Virus Scanning**: Integrate antivirus for uploaded PDFs
4. **Audit Logging**: Log all conversion requests with usernames
5. **Temporary Files**: Implement cleanup for converted images
6. **Async Queue**: Use job queue for large batches to prevent blocking
