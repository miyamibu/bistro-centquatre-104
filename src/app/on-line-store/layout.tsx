import type { Metadata } from "next";
import type { ReactNode } from "react";
import { createPageMetadata } from "@/lib/seo";

export const metadata: Metadata = createPageMetadata("/on-line-store");

export default function OnlineStoreLayout({ children }: { children: ReactNode }) {
  return children;
}
