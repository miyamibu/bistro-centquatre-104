"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Instagram, Menu, ShoppingCart, X } from "lucide-react";
import { Playfair_Display } from "next/font/google";
const links = [
  { href: "/", label: "ホーム" },
  { href: "/booking", label: "予約" },
  { href: "/menu", label: "メニュー" },
  { href: "/picture", label: "写真" },
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
  const pathname = usePathname();
  const showCartIcon =
    pathname === "/on-line-store" ||
    (pathname.startsWith("/on-line-store/") && pathname !== "/on-line-store/cart");

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <div className="pointer-events-auto relative z-[130] mx-auto w-[calc(100%-0.75rem)] max-w-[23rem] md:w-full md:max-w-none">
      <div className="relative flex items-center justify-between rounded-full bg-white/80 px-4 py-2 shadow-sm backdrop-blur">
        <a
          href="https://www.instagram.com/bistrocentquatre104?igsh=MXQydXRuMnI5YWllMA=="
          target="_blank"
          rel="noreferrer"
          aria-label="Instagramへ"
          className="z-20 flex h-10 w-10 items-center justify-center text-[#6b3b20] transition hover:text-[#8a4c29]"
        >
          <Instagram size={35} />
        </a>

        <Link
          href="/"
          aria-label="ホームへ戻る"
          className={`absolute inset-0 z-10 flex items-center justify-center text-center ${logoFont.className} cursor-pointer select-none`}
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
              className="flex h-10 w-10 items-center justify-center text-[#6b3b20] transition hover:text-[#8a4c29]"
            >
              <ShoppingCart size={35} strokeWidth={1.9} />
            </Link>
          )}
          <button
            type="button"
            aria-label="メニューを開く"
            className="flex h-10 w-10 items-center justify-center text-[#6b3b20] transition hover:text-[#8a4c29]"
            onClick={() => setOpen((prev) => !prev)}
          >
            <Menu size={35} />
          </button>
        </div>
      </div>

      {open && (
        <div className="fixed inset-0 z-[220] bg-black/40 backdrop-blur-sm" onClick={() => setOpen(false)}>
          <div
            className="absolute left-1/2 top-8 z-[221] w-[90%] max-w-sm -translate-x-1/2 rounded-2xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-end">
              <button type="button" aria-label="閉じる" onClick={() => setOpen(false)} className="text-[#6b3b20] hover:text-[#8a4c29]">
                <X size={20} />
              </button>
            </div>
            <div className="mt-4 space-y-3">
              {links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="block rounded-lg border border-[#b68c5a]/30 px-3 py-2 text-[#2f1b0f] hover:bg-[#f4e8d8]"
                  onClick={() => setOpen(false)}
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
