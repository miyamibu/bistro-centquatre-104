"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TopNav } from "@/components/top-nav";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isOrdersDashboard = pathname === "/dashboard/orders";
  const isMenuRoute = pathname === "/menu" || pathname.startsWith("/menu/");
  const isAdminRoute = pathname === "/admin" || pathname.startsWith("/admin/");
  const hideTopNav = isOrdersDashboard || isAdminRoute;
  const isBookingRoute = pathname === "/booking" || pathname.startsWith("/booking/");
  const showMobileHeaderGoldBand = pathname === "/";
  // Public-facing pages manage their own top spacing and should sit under the fixed header.
  const isPublicWebRoute =
    pathname === "/" ||
    isBookingRoute ||
    pathname === "/menu" ||
    pathname.startsWith("/menu/") ||
    pathname === "/hors-doeuvre" ||
    pathname.startsWith("/hors-doeuvre/") ||
    pathname === "/picture" ||
    pathname.startsWith("/picture/") ||
    pathname === "/daily-journal" ||
    pathname.startsWith("/daily-journal/") ||
    pathname === "/contact" ||
    pathname.startsWith("/contact/") ||
    pathname === "/faq" ||
    pathname.startsWith("/faq/") ||
    pathname === "/privacy" ||
    pathname.startsWith("/privacy/") ||
    pathname === "/legal" ||
    pathname.startsWith("/legal/") ||
    pathname === "/access" ||
    pathname.startsWith("/access/") ||
    pathname === "/reservation/manage" ||
    pathname.startsWith("/reservation/manage/") ||
    pathname === "/on-line-store" ||
    pathname.startsWith("/on-line-store/");

  const shellWidthClass = isMenuRoute
    ? "max-w-[1680px]"
    : isAdminRoute
      ? "max-w-6xl md:max-w-7xl"
      : "max-w-6xl";
  const headerWidthClass = isMenuRoute
    ? "max-w-[1680px]"
    : isAdminRoute
      ? "max-w-6xl md:max-w-7xl"
      : "max-w-6xl";
  const mainClassName = isOrdersDashboard
    ? "flex-1 pt-10"
    : hideTopNav
      ? "flex-1"
      : isBookingRoute
        ? "pt-[var(--header-h)] md:pt-0"
        : isPublicWebRoute
          ? "flex-1 pt-[var(--header-h)] md:pt-0"
          : "flex-1 pt-[var(--header-h)]";
  const mainBottomPaddingClass = pathname === "/"
    ? "pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-0"
    : "";
  return (
    <div
      className={`relative mx-auto flex min-h-screen ${shellWidthClass} flex-col bg-white px-4 py-0 [--header-h:58px] md:[--header-h:92px]`}
    >
      {hideTopNav ? null : (
        <>
        {showMobileHeaderGoldBand ? (
          <div className="pointer-events-none absolute inset-x-0 top-0 z-[110] overflow-visible md:hidden">
            <div
              className="absolute inset-x-0 h-[132px]"
              style={{
                background:
                  "linear-gradient(to bottom, rgba(184,136,56,0.82) 0px, rgba(184,136,56,0.66) 15px, rgba(184,136,56,0.44) 34px, rgba(184,136,56,0.3) 58px, rgba(184,136,56,0.22) 82px, rgba(184,136,56,0.16) 101px, rgba(184,136,56,0.1) 117px, rgba(184,136,56,0) 132px)",
              }}
            />
          </div>
        ) : null}
        <header className="pointer-events-none fixed inset-x-0 top-0 z-[120] h-[var(--header-h)]">
          <div
            className={`relative mx-auto flex h-full ${headerWidthClass} items-start px-4 pt-[2px] md:items-center md:pt-0`}
          >
            <TopNav />
          </div>
        </header>
        </>
      )}

      <main className={`${mainClassName} ${mainBottomPaddingClass}`}>
        {children}
      </main>
      {!hideTopNav && isPublicWebRoute ? (
        <footer className="border-t border-[#eadfce] py-6 text-sm text-[#6b5644]">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <p>bistro centquatre 104</p>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              <Link href="/privacy" className="inline-flex min-h-11 items-center underline underline-offset-2">
                プライバシーポリシー
              </Link>
              <Link href="/legal" className="inline-flex min-h-11 items-center underline underline-offset-2">
                特定商取引法に基づく表記
              </Link>
              <Link href="/faq" className="inline-flex min-h-11 items-center underline underline-offset-2">
                ご予約・キャンセル案内
              </Link>
            </div>
          </div>
        </footer>
      ) : null}
    </div>
  );
}
