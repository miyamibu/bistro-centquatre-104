"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Instagram, Menu, ShoppingCart, X } from "lucide-react";
import { Playfair_Display } from "next/font/google";
import { shouldShowStoreCartIcon } from "@/lib/store-payment-state";
const links = [
  { href: "/", label: "ホーム" },
  { href: "/booking", label: "予約" },
  { href: "/menu", label: "メニュー" },
  { href: "/picture", label: "写真" },
  { href: "/daily-journal", label: "日々の出来事" },
  { href: "/access", label: "アクセス" },
  { href: "/faq", label: "FAQ" },
  { href: "/contact", label: "お問い合わせ" },
  { href: "/on-line-store", label: "オンラインストア" },
] as const;
const logoFont = Playfair_Display({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
});
export function TopNav() {
  const logoPos = { x: 0 }; // ロゴの左右微調整(px)
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const showCartIcon = shouldShowStoreCartIcon(pathname);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const closeMenu = useCallback(() => {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!open) return;

    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => closeRef.current?.focus());

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu();
        return;
      }

      if (event.key !== "Tab") return;

      const dialog = dialogRef.current;
      if (!dialog) return;

      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousBodyOverflow;
    };
  }, [closeMenu, open]);

  return (
    <div className="pointer-events-auto relative z-[130] mx-auto w-[calc(100%-0.75rem)] max-w-[23rem] md:w-full md:max-w-none">
      <div className="relative flex items-center justify-between rounded-full bg-white/80 px-4 py-2 shadow-sm backdrop-blur">
        <a
          href="https://www.instagram.com/bistrocentquatre104?igsh=MXQydXRuMnI5YWllMA=="
          target="_blank"
          rel="noreferrer"
          aria-label="Instagramへ"
          className="z-20 flex h-11 w-11 items-center justify-center text-[#6b3b20] transition hover:text-[#8a4c29]"
        >
          <Instagram size={35} />
        </a>

        <Link
          href="/"
          aria-label="ホームへ戻る"
          className={`absolute inset-0 z-10 flex items-center justify-center text-center ${logoFont.className} cursor-pointer select-none ${showCartIcon ? "pr-12 md:pr-0" : ""}`}
          style={{ marginLeft: `${logoPos.x}px` }}
          onClick={() => setOpen(false)} // もしメニューが開いてたら閉じる
        >
          <div className="flex flex-col items-center leading-tight md:translate-y-[2px]">
            <p className="text-[10px] uppercase tracking-[0.14em] text-[#b68c5a]">Bistro １０４</p>
            <p className="text-lg font-semibold text-[#2f1b0f]">Cent Quatre</p>
          </div>
        </Link>

        <div className="relative z-20 flex items-center gap-1.5 md:gap-3">
          {showCartIcon && (
            <Link
              href="/on-line-store/cart"
              aria-label="カート"
              className="flex h-11 w-11 items-center justify-center text-[#6b3b20] transition hover:text-[#8a4c29]"
            >
              <ShoppingCart size={35} strokeWidth={1.9} />
            </Link>
          )}
          <button
            type="button"
            ref={triggerRef}
            aria-label={open ? "メニューを閉じる" : "メニューを開く"}
            aria-expanded={open}
            aria-controls="site-navigation-dialog"
            className="flex h-11 w-11 items-center justify-center text-[#6b3b20] transition hover:text-[#8a4c29]"
            onClick={() => (open ? closeMenu() : setOpen(true))}
          >
            <Menu size={35} />
          </button>
        </div>
      </div>

      {open && (
        <div className="fixed inset-0 z-[220] bg-black/40 backdrop-blur-sm" onClick={closeMenu}>
          <div
            id="site-navigation-dialog"
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="サイトメニュー"
            className="absolute left-1/2 top-8 z-[221] max-h-[calc(100vh-4rem)] w-[90%] max-w-sm -translate-x-1/2 overflow-y-auto overscroll-contain rounded-2xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-end">
              <button ref={closeRef} type="button" aria-label="閉じる" onClick={closeMenu} className="inline-flex h-11 w-11 items-center justify-center rounded-full text-[#6b3b20] hover:bg-[#f4e8d8] hover:text-[#8a4c29] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b68c5a]/50">
                <X size={20} />
              </button>
            </div>
            <div className="mt-4 space-y-3">
              {links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="flex min-h-11 items-center rounded-lg border border-[#b68c5a]/30 px-3 py-2 text-[#2f1b0f] hover:bg-[#f4e8d8]"
                  onClick={closeMenu}
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
