import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  outputFileTracingRoot: __dirname,
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
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
    ],
  }
};

export default nextConfig;
