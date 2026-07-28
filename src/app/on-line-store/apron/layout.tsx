import type { Metadata } from "next";
import type { ReactNode } from "react";
import { createPageMetadata } from "@/lib/seo";

export const metadata: Metadata = createPageMetadata("/on-line-store/apron");

export default function ApronLayout({ children }: { children: ReactNode }) {
  return children;
}
