import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

const PUBLIC_SITEMAP_PATHS = [
  "/",
  "/access",
  "/agents",
  "/contact",
  "/daily-journal",
  "/faq",
  "/hors-doeuvre",
  "/legal",
  "/menu",
  "/on-line-store",
  "/on-line-store/apron",
  "/picture",
  "/privacy",
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_SITEMAP_PATHS.map((pathname) => ({
    url: pathname === "/" ? SITE_URL : new URL(pathname, SITE_URL).toString(),
  }));
}
