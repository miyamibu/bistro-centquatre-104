import type { Metadata } from "next";
import type { ReactNode } from "react";
import { createPageMetadata } from "@/lib/seo";

export const metadata: Metadata = createPageMetadata("/menu");

export default function MenuLayout({ children }: { children: ReactNode }) {
  return children;
}
