"use client";

import Link from "next/link";
import type { Route } from "next";
import { Noto_Serif_JP } from "next/font/google";
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  appetizerSections,
  APPETIZER_INTRO,
  APPETIZER_SURCHARGE_NOTE,
} from "@/lib/appetizer-data";

const bodySerif = Noto_Serif_JP({
  subsets: ["latin"],
  weight: ["400", "600"],
  display: "swap",
});

const validReturnTabs = new Set(["petite", "joie", "cent-quatre"]);

function ScrollReveal({
  children,
  className = "",
  delayMs = 0,
  distancePx = 20,
  durationMs = 780,
}: {
  children: ReactNode;
  className?: string;
  delayMs?: number;
  distancePx?: number;
  durationMs?: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.14, rootMargin: "0px 0px -8% 0px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: visible ? 1 : 0,
        transform: `translateY(${visible ? 0 : distancePx}px)`,
        transitionProperty: "opacity, transform",
        transitionDuration: `${durationMs}ms`,
        transitionTimingFunction: "cubic-bezier(0.22, 0.61, 0.36, 1)",
        transitionDelay: `${delayMs}ms`,
        willChange: "opacity, transform",
      }}
    >
      {children}
    </div>
  );
}

export default function HorsDoeuvrePage() {
  const [backHref, setBackHref] = useState<Route>("/menu");

  useEffect(() => {
    const from = new URLSearchParams(window.location.search).get("from");
    if (from && validReturnTabs.has(from)) {
      setBackHref(`/menu#${from}` as Route);
    }
  }, []);

  return (
    <div
      className={`relative -mt-[var(--header-h)] min-h-screen w-screen overflow-hidden md:mt-0 ${bodySerif.className}`}
      style={{
        marginLeft: "calc(50% - 50vw)",
        marginRight: "calc(50% - 50vw)",
      }}
    >
      <div className="pointer-events-none absolute inset-y-0 left-1/2 w-screen -translate-x-1/2 bg-[radial-gradient(circle_at_top,rgba(180,130,74,0.42),transparent_28%),linear-gradient(180deg,#6a4b2f_0%,#503624_18%,#422d20_44%,#2d2119_100%)]" />

      <div className="relative z-10 px-4 pb-24 pt-[calc(var(--header-h)+2rem)] md:px-8 md:pb-28 md:pt-[calc(var(--header-h)+4rem)]">
        <div className="mx-auto max-w-4xl">
          <ScrollReveal distancePx={10} durationMs={600}>
            <div className="mb-8">
              <Link
                href={backHref}
                className="text-[0.72rem] tracking-[0.14em] text-[#cca35d] opacity-80 transition hover:opacity-100"
              >
                ← コースメニューへ戻る
              </Link>
            </div>
          </ScrollReveal>

          <ScrollReveal distancePx={20} durationMs={900} delayMs={60}>
            <header className="mb-10 text-center md:mb-14">
              <p className="text-[0.65rem] uppercase tracking-[0.48em] text-[#cca35d] md:text-[0.72rem]">
                Grand Menu
              </p>
              <h1 className="mt-1 text-[2rem] font-semibold tracking-[0.1em] text-[#f5f0e8] md:text-[2.8rem]">
                前菜
              </h1>

              <div className="my-4 flex items-center justify-center gap-3 text-[#cca35d]">
                <span className="h-px w-12 bg-gradient-to-r from-transparent to-current" />
                <span className="inline-block h-[6px] w-[6px] rotate-45 bg-current" />
                <span className="h-px w-12 bg-gradient-to-l from-transparent to-current" />
              </div>

              <p className="mx-auto max-w-xl text-[0.75rem] leading-[1.9] tracking-[0.06em] text-[#b6a48f] md:text-[0.82rem]">
                {APPETIZER_INTRO}
              </p>
              <p className="mt-2 text-[0.68rem] tracking-[0.1em] text-[#cca35d]">
                {APPETIZER_SURCHARGE_NOTE}
              </p>
            </header>
          </ScrollReveal>

          <div className="mx-auto max-w-lg rounded-[2rem] px-5 py-8 md:max-w-2xl md:px-10 md:py-10">
            {appetizerSections.map((section, sectionIndex) => (
              <section key={section.label} className={sectionIndex === 0 ? "" : "mt-12"}>
                <ScrollReveal delayMs={sectionIndex * 120} distancePx={12} durationMs={780}>
                  <div className="mb-5 text-center">
                    <p className="text-[0.75rem] uppercase tracking-[0.32em] text-[#cca35d]">
                      {section.frenchLabel}
                    </p>
                    <p className="mt-1 text-[1.05rem] font-semibold tracking-[0.12em] text-[#f5f0e8] md:text-[1.2rem]">
                      {section.label}
                    </p>
                    <div
                      className="mx-auto mt-3 h-px w-8"
                      style={{ background: "rgba(200,153,77,0.4)" }}
                    />
                  </div>
                </ScrollReveal>

                <ul className="m-0 list-none p-0">
                  {section.dishes.map((dish, dishIndex) => (
                    <ScrollReveal
                      key={dish.name}
                      delayMs={sectionIndex * 120 + 80 + dishIndex * 80}
                      distancePx={10}
                      durationMs={820}
                    >
                      <li
                        className="px-1"
                        style={{
                          padding: "0.85rem 0.25rem",
                        }}
                      >
                        <div className="md:hidden">
                          <div className="text-center text-[0.72rem] leading-[1.5] tracking-[0.05em] text-[#f0ebe2]">
                            {dish.name}
                          </div>
                          {dish.surcharge != null ? (
                            <div className="mt-1 text-right text-[0.68rem] tracking-[0.1em] text-[#cca35d]">
                              +{dish.surcharge.toLocaleString()}円
                            </div>
                          ) : null}
                        </div>

                        <div className="relative hidden items-center md:flex">
                          <div className="flex-1 text-center text-[0.9rem] leading-[1.5] tracking-[0.05em] text-[#f0ebe2]">
                            {dish.name}
                          </div>
                          {dish.surcharge != null ? (
                            <span
                              className="absolute text-[0.75rem] tracking-[0.1em] text-[#cca35d]"
                              style={{ right: "2cm", whiteSpace: "nowrap" }}
                            >
                              +{dish.surcharge.toLocaleString()}円
                            </span>
                          ) : null}
                        </div>
                        {dishIndex < section.dishes.length - 1 ? (
                          <div
                            aria-hidden="true"
                            className="mx-auto mt-[0.85rem] h-px"
                            style={{
                              width: "calc(100% - 2cm)",
                              background: "rgba(138,104,60,0.28)",
                            }}
                          />
                        ) : null}
                      </li>
                    </ScrollReveal>
                  ))}
                </ul>
              </section>
            ))}

            <p className="mt-10 text-center text-[0.72rem] leading-[1.8] tracking-[0.08em] text-[#9a8878]">
              {APPETIZER_SURCHARGE_NOTE}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
