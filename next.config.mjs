import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProduction = process.env.NODE_ENV === "production";
const isCloudflareWorker = process.env.CLOUDFLARE_WORKER_RUNTIME === "true";

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data: blob: https://images.unsplash.com",
  "font-src 'self' data:",
  "connect-src 'self' https://api.line.me https://access.line.me https://liffsdk.line-scdn.net https://static.line-scdn.net https://*.supabase.co",
  "frame-src 'self' https://www.google.com https://liff.line.me https://access.line.me",
  `script-src 'self' 'unsafe-inline'${isProduction ? "" : " 'unsafe-eval'"} https://static.line-scdn.net`,
  "style-src 'self' 'unsafe-inline'",
  "worker-src 'self' blob:",
].join("; ");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: true,
  serverExternalPackages: ["@prisma/client", ".prisma/client"],
  webpack(config) {
    if (isCloudflareWorker) {
      config.resolve.alias.puppeteer = path.join(__dirname, "src/lib/cloudflare-puppeteer-disabled.ts");
    }
    return config;
  },
  outputFileTracingRoot: __dirname,
  outputFileTracingExcludes: {
    // This route is intentionally disabled in production before its dynamic
    // Puppeteer import. Its local-only filesystem conversion would otherwise
    // cause Next.js to trace every large asset under public/photos into the
    // Netlify SSR function in addition to the CDN copy.
    "/api/pdf-to-image": [
      "public/**",
      "node_modules/puppeteer/**",
      "node_modules/puppeteer-core/**",
      "node_modules/@puppeteer/**",
      "node_modules/chromium-bidi/**",
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
          {
            key: "Content-Security-Policy",
            value: contentSecurityPolicy,
          },
        ],
      },
    ];
  },
  async redirects() {
    return [
      { source: "/reserve", destination: "/booking", permanent: true },
      { source: "/photos", destination: "/picture", permanent: true },
      { source: "/info", destination: "/access", permanent: true },
      { source: "/store", destination: "/on-line-store", permanent: true },
      { source: "/store/apron", destination: "/on-line-store/apron", permanent: true },
      { source: "/store/cart", destination: "/on-line-store/cart", permanent: true },
      { source: "/store/order-complete", destination: "/on-line-store/order-complete", permanent: true },
    ];
  },
  images: {
    unoptimized: isCloudflareWorker,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
    ],
  }
};

export default nextConfig;
