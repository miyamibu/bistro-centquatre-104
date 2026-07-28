import type { Metadata } from "next";
import type { ReactNode } from "react";
import { createPageMetadata } from "@/lib/seo";

export const metadata: Metadata = createPageMetadata("/hors-doeuvre");

export default function HorsDoeuvreLayout({ children }: { children: ReactNode }) {
  return children;
}
