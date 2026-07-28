import type { Metadata } from "next";
import type { ReactNode } from "react";
import { NO_INDEX_METADATA } from "@/lib/seo";

export const metadata: Metadata = NO_INDEX_METADATA;

export default function LineLinkLayout({ children }: { children: ReactNode }) {
  return children;
}
