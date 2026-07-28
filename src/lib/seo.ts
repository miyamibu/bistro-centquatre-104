import type { Metadata } from "next";

export const SITE_URL = "https://bistro-centquatre-104.vercel.app";
export const SITE_TITLE = "ビストロ　サンキャトル　１０４";
export const SITE_DESCRIPTION =
  "川越のフレンチレストラン bistro centquatre 104 の予約・店舗情報・オンラインストア";
export const SITE_NAME = "bistro centquatre 104";
export const NO_INDEX_METADATA: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
  alternates: null,
  openGraph: null,
  twitter: null,
};

function normalizePathname(pathname: string): string {
  const path = pathname.split(/[?#]/, 1)[0]?.trim() ?? "";
  if (!path || path === "/") return "/";
  return `/${path.replace(/^\/+|\/+$/g, "")}`;
}

export function createPageMetadata(
  pathname: string,
  title = SITE_TITLE,
  description = SITE_DESCRIPTION,
): Metadata {
  const normalizedPathname = normalizePathname(pathname);
  const url =
    normalizedPathname === "/"
      ? SITE_URL
      : new URL(normalizedPathname, SITE_URL).toString();

  return {
    title,
    description,
    alternates: {
      canonical: url,
    },
    openGraph: {
      type: "website",
      locale: "ja_JP",
      url,
      title,
      description,
      siteName: SITE_NAME,
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
  };
}
