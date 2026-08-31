"use client";

import type { Route } from "next";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Pause, Play } from "lucide-react";
import { Tangerine } from "next/font/google";
import {
  appetizerSections,
  APPETIZER_SURCHARGE_NOTE,
} from "@/lib/appetizer-data";
import { getMenuTabIdForKey, type CourseTabId } from "@/lib/menu-tabs";
import { getReservationCoursesForServicePeriod } from "@/lib/reservation-config";

const tangerine = Tangerine({
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
});

const TOP_GAP_PX = 110;
const MOBILE_TOP_GAP_REDUCTION_PX = 45;
const MOBILE_TOP_GAP_EXTRA_PX = 30; // adds roughly 0.3cm compared with the current mobile spacing
const SLIDESHOW_INTERVAL_MS = 4000;
const DESKTOP_SLIDE_HEIGHT_PX = 576; // matches the intended Petite La desktop slide size
const DESKTOP_SLIDE_WIDTH_PX = 768; // keep the desktop slide width fixed to the Petite La layout
const PANEL_RADIUS_PX = 35.2; // equals rounded-[2.2rem]
const menuHeadingSize = { base: 32, md: 60 };

type CourseMenuItem = {
  headingHtml: string;
  note?: string;
  altHtml?: string;
  detailLink?: {
    href: Route;
    mobileOnly?: boolean;
  };
};

type CourseTab = {
  id: CourseTabId;
  tabLabel: string;
  heading: string;
  title: string;
  items: readonly CourseMenuItem[];
  photos: readonly string[];
};

const courseTabs: readonly CourseTab[] = [
  {
    id: "petite",
    tabLabel: "プティラ",
    heading: "Petite La",
    title: "Petite La course",
    items: [
      {
        headingHtml:
          '<span class="menu-tab-main">一口前菜</span>',
      },
      {
        headingHtml:
          '<span class="menu-tab-main">前菜<span class="menu-tab-pill menu-tab-sub">月替わり</span></span>',
        altHtml: "お好みに合わせて、別の前菜もお選びいただけます",
        detailLink: { href: "/hors-doeuvre?from=petite" },
      },
      {
        headingHtml: '魚料理<span class="menu-tab-or">または</span>肉料理',
        note: "丁寧な仕込みでご用意しております",
      },
      {
        headingHtml: "コーヒー",
        note: "小菓子もつきます",
      },
    ],
    photos: ["/photos/pu.jpg", "/photos/jo.jpg", "/photos/qu.jpg", "/photos/am.jpg"],
  },
  {
    id: "joie",
    tabLabel: "ジョワ",
    heading: "Joie",
    title: "Joie course",
    items: [
      {
        headingHtml:
          '<span class="menu-tab-main">一口前菜</span>',
      },
      {
        headingHtml:
          '<span class="menu-tab-main">冷製前菜<span class="menu-tab-pill menu-tab-sub">月替わり</span></span>',
        altHtml: "お好みに合わせて、別の前菜もお選びいただけます",
        detailLink: { href: "/hors-doeuvre?from=joie", mobileOnly: true },
      },
      {
        headingHtml:
          '<span class="menu-tab-main">温製前菜<span class="menu-tab-pill menu-tab-sub">月替わり</span></span>',
        note: "お好みに合わせて、別の前菜もお選びいただけます",
        detailLink: { href: "/hors-doeuvre?from=joie", mobileOnly: true },
      },
      {
        headingHtml: '魚料理<span class="menu-tab-or">または</span>肉料理',
        note: "丁寧な仕込みでご用意しております",
      },
      {
        headingHtml: "締めの１品",
        note: "裏メニューもご用意しております",
      },
      {
        headingHtml: "コーヒー",
        note: "小菓子もつきます",
      },
    ],
    photos: ["/photos/jo.jpg", "/photos/pu.jpg", "/photos/qu.jpg", "/photos/am.jpg", "/photos/po.png"],
  },
  {
    id: "cent-quatre",
    tabLabel: "サンキャトル",
    heading: "Cent Quatre",
    title: "Cent Quatre course",
    items: [
      {
        headingHtml:
          '<span class="menu-tab-main">一口前菜</span>',
      },
      {
        headingHtml:
          '<span class="menu-tab-main">冷製前菜<span class="menu-tab-pill menu-tab-sub">月替わり</span></span>',
        altHtml: "お好みに合わせて、別の前菜もお選びいただけます",
        detailLink: { href: "/hors-doeuvre?from=cent-quatre", mobileOnly: true },
      },
      {
        headingHtml:
          '<span class="menu-tab-main">温製前菜<span class="menu-tab-pill menu-tab-sub">月替わり</span></span>',
        note: "お好みに合わせて、別の前菜もお選びいただけます",
        detailLink: { href: "/hors-doeuvre?from=cent-quatre", mobileOnly: true },
      },
      {
        headingHtml: "魚料理",
        note: "丁寧な仕込みでご用意しております",
      },
      {
        headingHtml: "肉料理",
        note: "丁寧な仕込みでご用意しております",
      },
      {
        headingHtml: "締めの１品",
        note: "裏メニューもご用意しております",
      },
      {
        headingHtml: "コーヒー",
        note: "小菓子もつきます",
      },
    ],
    photos: [
      "/photos/qu.jpg",
      "/photos/jo.jpg",
      "/photos/pu.jpg",
      "/photos/am.jpg",
      "/photos/extract_1~2.png",
      "/photos/extract_2~2.png",
    ],
  },
];

function getBookingHref(courseId: CourseTabId): Route {
  const servicePeriod = courseId === "petite" ? "LUNCH" : "DINNER";
  const courseLabel =
    courseId === "petite"
      ? "プティラ"
      : courseId === "joie"
        ? "ジョワ"
        : "サンキャトル";
  const course = getReservationCoursesForServicePeriod(servicePeriod).find((option) =>
    option.label.startsWith(courseLabel)
  )?.value;
  const params = new URLSearchParams({
    servicePeriod,
    course: course ?? "",
  });

  return `/booking?${params.toString()}` as Route;
}

function useIsMobileLayout(breakpointPx = 767) {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia(`(max-width: ${breakpointPx}px)`);
    const onChange = () => setIsMobile(mediaQuery.matches);

    onChange();

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", onChange);
      return () => mediaQuery.removeEventListener("change", onChange);
    }

    mediaQuery.addListener(onChange);
    return () => mediaQuery.removeListener(onChange);
  }, [breakpointPx]);

  return isMobile;
}

export default function MenuPage() {
  const isMobileLayout = useIsMobileLayout();
  const [activeTab, setActiveTab] = useState<CourseTabId>("petite");
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const [isSlideshowPaused, setIsSlideshowPaused] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [motionPreferenceReady, setMotionPreferenceReady] = useState(false);
  const [panelHeightPx, setPanelHeightPx] = useState(0);
  const [panelWidthPx, setPanelWidthPx] = useState(0);
  const panelRef = useRef<HTMLElement | null>(null);
  const tabButtonRefs = useRef<Partial<Record<CourseTabId, HTMLButtonElement | null>>>({});

  const topGapPx = isMobileLayout
    ? Math.max(0, TOP_GAP_PX - MOBILE_TOP_GAP_REDUCTION_PX + MOBILE_TOP_GAP_EXTRA_PX)
    : TOP_GAP_PX;
  const courseAnchorScrollMarginPx = topGapPx + 24;
  const activeCourse = courseTabs.find((course) => course.id === activeTab) ?? courseTabs[0];
  const bookingHref = useMemo(() => getBookingHref(activeCourse.id), [activeCourse.id]);
  const hasDesktopSlide = activeCourse.id === "petite";
  const hasAppetizerPanel = activeCourse.id === "joie" || activeCourse.id === "cent-quatre";
  const effectiveSlideHeightPx = panelHeightPx || DESKTOP_SLIDE_HEIGHT_PX;
  const effectiveSlideWidthPx = panelWidthPx || DESKTOP_SLIDE_WIDTH_PX;
  const desktopSlideHeight = `${effectiveSlideHeightPx}px`;
  const desktopSlideWidth = `${effectiveSlideWidthPx}px`;
  const slideBottomAlignOffsetPx = Math.max(24, panelHeightPx - effectiveSlideHeightPx);
  const desktopSlideTop = `calc(var(--header-h) + min(${slideBottomAlignOffsetPx}px, max(1.5rem, 100vh - var(--header-h) - ${desktopSlideHeight} - 1.5rem)))`;

  function focusTab(tabId: CourseTabId) {
    setActiveTab(tabId);
    tabButtonRefs.current[tabId]?.focus();
  }

  function handleTabKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, tabId: CourseTabId) {
    const nextTabId = getMenuTabIdForKey(tabId, event.key);
    if (!nextTabId) return;

    event.preventDefault();
    focusTab(nextTabId);
  }

  useEffect(() => {
    if (isMobileLayout) return;

    const element = panelRef.current;
    if (!element) return;

    const updateHeight = () => {
      const rect = element.getBoundingClientRect();
      setPanelHeightPx(rect.height);
      setPanelWidthPx(rect.width);
    };

    updateHeight();

    const resizeObserver = new ResizeObserver(() => updateHeight());
    resizeObserver.observe(element);
    window.addEventListener("resize", updateHeight);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateHeight);
    };
  }, [activeTab, isMobileLayout]);

  useEffect(() => {
    let firstFrameId = 0;
    let secondFrameId = 0;

    const syncHash = () => {
      const nextHash = window.location.hash ? decodeURIComponent(window.location.hash.slice(1)) : "";
      const matchingCourse = courseTabs.find((course) => course.id === nextHash);

      if (!matchingCourse) return;

      setActiveTab(matchingCourse.id);

      firstFrameId = window.requestAnimationFrame(() => {
        secondFrameId = window.requestAnimationFrame(() => {
          document.getElementById(matchingCourse.id)?.scrollIntoView({ block: "start" });
        });
      });
    };

    syncHash();
    window.addEventListener("hashchange", syncHash);

    return () => {
      window.cancelAnimationFrame(firstFrameId);
      window.cancelAnimationFrame(secondFrameId);
      window.removeEventListener("hashchange", syncHash);
    };
  }, []);

  useEffect(() => {
    setActiveSlideIndex(0);
  }, [activeTab]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncPreference = () => {
      setPrefersReducedMotion(mediaQuery.matches);
      setMotionPreferenceReady(true);
    };

    syncPreference();

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", syncPreference);
      return () => mediaQuery.removeEventListener("change", syncPreference);
    }

    mediaQuery.addListener(syncPreference);
    return () => mediaQuery.removeListener(syncPreference);
  }, []);

  useEffect(() => {
    if (
      isMobileLayout ||
      !motionPreferenceReady ||
      prefersReducedMotion ||
      isSlideshowPaused ||
      activeCourse.photos.length < 2
    ) {
      return;
    }

    const timerId = window.setInterval(() => {
      setActiveSlideIndex((prev) => (prev + 1) % activeCourse.photos.length);
    }, SLIDESHOW_INTERVAL_MS);

    return () => {
      window.clearInterval(timerId);
    };
  }, [
    activeCourse.id,
    activeCourse.photos.length,
    isMobileLayout,
    isSlideshowPaused,
    motionPreferenceReady,
    prefersReducedMotion,
  ]);

  return (
    <div
      className="relative min-h-screen"
      style={
        {
          marginTop: isMobileLayout ? "calc(var(--header-h) * -1)" : "0px",
          "--menu-top-gap": `${topGapPx}px`,
        } as CSSProperties
      }
    >
      <div className="sticky bottom-4 z-40 mx-auto flex w-full max-w-[22rem] justify-center px-4 md:hidden">
        <Link
          href={bookingHref}
          className="inline-flex h-12 w-full items-center justify-center rounded-full bg-[#b32626] px-6 text-sm font-semibold tracking-[0.22em] text-white shadow-lg transition hover:brightness-[1.05] active:brightness-[0.98]"
        >
          予約する
        </Link>
      </div>
      <div className="pointer-events-none absolute inset-y-0 left-1/2 w-screen -translate-x-1/2 bg-[radial-gradient(circle_at_top,rgba(180,130,74,0.42),transparent_28%),linear-gradient(180deg,#6a4b2f_0%,#503624_18%,#422d20_44%,#2d2119_100%)]" />

      <div className="relative z-10 px-4 pb-16" style={{ paddingTop: `${topGapPx}px` }}>
        <header className="mb-5 space-y-4 pt-8 text-center md:mb-7 md:pt-14">
          <p className="text-[0.72rem] font-medium uppercase tracking-[0.48em] text-[#d7b06c] md:text-[0.82rem]">
            Course Selection
          </p>
          <h1
            className={`menu-heading-title font-semibold text-[#f5eee6] ${tangerine.className}`}
            style={
              {
                "--menu-heading-size": `${menuHeadingSize.base}px`,
                "--menu-heading-size-md": `${menuHeadingSize.md}px`,
              } as Record<string, string>
            }
          >
            Menu
          </h1>
          <div className="flex flex-col items-center justify-center gap-3 pt-2 md:flex-row">
            <Link
              href={bookingHref}
              className="inline-flex h-11 items-center justify-center rounded-full bg-[#b32626] px-7 text-sm font-semibold tracking-[0.2em] text-white shadow-lg transition hover:brightness-[1.05] active:brightness-[0.98]"
            >
              コースを見て予約する
            </Link>
            <Link
              href="/access"
              className="inline-flex h-11 items-center justify-center rounded-full border border-[#c7a357]/60 bg-white/10 px-7 text-sm font-medium tracking-[0.16em] text-[#f8f2e6] transition hover:bg-white/15"
            >
              営業時間・アクセス
            </Link>
          </div>
        </header>

        <section className="mx-auto max-w-[132rem] px-4 pb-6 pt-3 md:px-16 md:pb-14 md:pt-8">
          <div className="h-0 overflow-hidden">
            {courseTabs.map((course) => (
              <div
                key={course.id}
                id={course.id}
                className="block h-0"
                style={{ scrollMarginTop: `${courseAnchorScrollMarginPx}px` }}
              />
            ))}
          </div>

          <div
            role="tablist"
            aria-label="メニューコース"
            aria-orientation="horizontal"
            className="md:flex md:flex-nowrap md:justify-center md:gap-3"
          >
            <div className="flex justify-center gap-3 md:contents">
              {courseTabs
                .filter((course) => course.id === "petite")
                .map((course) => {
                  const isActive = course.id === activeTab;

                  return (
                    <button
                      key={course.id}
                      id={`${course.id}-tab`}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      aria-controls={`${course.id}-panel`}
                      tabIndex={isActive ? 0 : -1}
                      ref={(element) => {
                        tabButtonRefs.current[course.id] = element;
                      }}
                      onKeyDown={(event) => handleTabKeyDown(event, course.id)}
                      onClick={() => setActiveTab(course.id)}
                      className={`inline-flex w-auto justify-center whitespace-nowrap rounded-full border-0 px-4 py-3 text-sm tracking-[0.08em] transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#f0eadf]/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#4a3122] md:min-w-[10.5rem] md:px-8 md:py-3 md:text-[1.02rem] ${
                        isActive
                          ? "bg-[#f0eadf] text-[#3a271b] shadow-[0_10px_20px_rgba(0,0,0,0.16)]"
                          : "bg-transparent text-[#f5eee6] hover:bg-white/5"
                      }`}
                    >
                      {course.tabLabel}
                    </button>
                  );
                })}
            </div>

            <div className="mx-auto mt-3 grid w-full max-w-[18.5rem] grid-cols-2 gap-3 md:mt-0 md:flex md:w-auto md:max-w-none md:contents">
              {courseTabs
                .filter((course) => course.id !== "petite")
                .map((course) => {
                  const isActive = course.id === activeTab;

                  return (
                    <button
                      key={course.id}
                      id={`${course.id}-tab`}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      aria-controls={`${course.id}-panel`}
                      tabIndex={isActive ? 0 : -1}
                      ref={(element) => {
                        tabButtonRefs.current[course.id] = element;
                      }}
                      onKeyDown={(event) => handleTabKeyDown(event, course.id)}
                      onClick={() => setActiveTab(course.id)}
                      className={`inline-flex w-full justify-center whitespace-nowrap rounded-full border-0 px-4 py-3 text-sm tracking-[0.08em] transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#f0eadf]/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#4a3122] md:w-auto md:min-w-[10.5rem] md:px-8 md:py-3 md:text-[1.02rem] ${
                        isActive
                          ? "bg-[#f0eadf] text-[#3a271b] shadow-[0_10px_20px_rgba(0,0,0,0.16)]"
                          : "bg-transparent text-[#f5eee6] hover:bg-white/5"
                      }`}
                    >
                      {course.tabLabel}
                    </button>
                  );
                })}
            </div>
          </div>

          <div className="mt-9 grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:items-start md:gap-12">
            <article
              ref={panelRef}
              id={`${activeCourse.id}-panel`}
              role="tabpanel"
              aria-labelledby={`${activeCourse.id}-tab`}
              className="rounded-[2.2rem] border-0 bg-transparent px-7 py-8 text-[#f5f0e8] shadow-none md:px-14 md:pt-14 md:pb-[0.6rem]"
            >
              <div className="mx-auto w-full max-w-[48rem] md:translate-x-[2cm]">
                <header className="mb-7 text-center md:mb-9">
                  <h2
                    className={`whitespace-nowrap font-["Cormorant_Garamond","Noto_Serif_JP","Yu_Mincho","Hiragino_Mincho_ProN",serif] text-[2rem] font-light tracking-[0.12em] text-[#f6efe6] md:text-[3.25rem] md:tracking-[0.18em] ${
                      activeCourse.id === "joie" ? "md:translate-x-[0.2cm]" : ""
                    }`}
                  >
                    {activeCourse.heading}
                  </h2>
                  <div className="mt-6 flex items-center justify-center gap-4 text-[#cca35d]">
                    <span className="h-px w-16 bg-gradient-to-r from-transparent to-current" />
                    <span className="h-[7px] w-[7px] rotate-45 bg-current" />
                    <span className="h-px w-16 bg-gradient-to-l from-transparent to-current" />
                  </div>
                </header>

                <ul className="space-y-0">
                  {activeCourse.items.map((item, index) => {
                    const isCenteredSingleLine = !item.note && !item.altHtml;
                    const isCoffeeLine = item.headingHtml === "コーヒー";
                    const keepMainCenteredOnMobile =
                      item.headingHtml.includes("menu-tab-main") &&
                      item.headingHtml.includes("menu-tab-sub");
                    const mobileAppetizerHeadingClass = item.detailLink
                      ? activeCourse.id === "petite"
                        ? "menu-tab-heading--petite-appetizer"
                        : "menu-tab-heading--grand-appetizer"
                      : "";

                    return (
                      <li
                        key={`${activeCourse.id}-${index}`}
                        className="relative py-6 after:absolute after:bottom-0 after:left-1/2 after:h-px after:w-[calc(100%-1.2cm)] after:-translate-x-1/2 after:bg-[rgba(138,104,60,0.34)] after:content-[''] last:pb-0 last:after:hidden md:py-[1.625rem] md:after:w-[calc(100%-4cm)] md:last:pb-0"
                      >
                        <div
                          className={`menu-tab-heading relative text-center text-[1.48rem] font-medium leading-[1.55] tracking-[0.12em] text-[#f5f0e8] md:text-[1.78rem] ${
                            isCenteredSingleLine ? "flex items-center justify-center" : ""
                          } ${mobileAppetizerHeadingClass} ${
                            keepMainCenteredOnMobile ? "menu-tab-heading--mobile-main-center" : ""
                          } ${isCoffeeLine ? "-translate-y-[0.1cm]" : ""}`}
                          dangerouslySetInnerHTML={{ __html: item.headingHtml }}
                        />
                        {item.note ? (
                          <p className="mt-2 text-center text-[0.88rem] leading-7 tracking-[0.08em] text-[#b6a48f] md:text-[0.94rem]">
                            {item.note}
                          </p>
                        ) : null}
                        {item.altHtml ? (
                          <div
                            className="menu-tab-alt mt-1 pt-4 text-center text-[0.82rem] leading-8 tracking-[0.08em] text-[#b6a48f] md:text-[0.88rem]"
                            dangerouslySetInnerHTML={{ __html: item.altHtml }}
                          />
                        ) : null}
                        {item.detailLink ? (
                          <div
                            className={`mt-2 text-center text-[0.82rem] leading-8 tracking-[0.08em] md:text-[0.88rem] ${
                              item.detailLink.mobileOnly ? "md:hidden" : ""
                            }`}
                          >
                            <Link href={item.detailLink.href} className="menu-tab-linklike inline-flex min-h-11 items-center px-3">
                              別の前菜を見る
                            </Link>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </article>

            {hasDesktopSlide ? (
              <aside
                className="relative hidden self-start overflow-hidden bg-[#1b1410]/28 shadow-[0_24px_80px_rgba(0,0,0,0.16)] md:sticky md:block"
                style={{
                  height: desktopSlideHeight,
                  width: desktopSlideWidth,
                  top: desktopSlideTop,
                  borderRadius: `${PANEL_RADIUS_PX}px`,
                }}
              >
                {activeCourse.photos.map((src, index) => {
                  const isActive = index === activeSlideIndex;

                  return (
                    <div
                      key={`${activeCourse.id}-${src}`}
                      aria-hidden={!isActive}
                      className={`absolute inset-0 transition-opacity duration-700 motion-reduce:transition-none ${
                        isActive ? "opacity-100" : "opacity-0"
                      }`}
                    >
                      <Image
                        src={src}
                        alt={`${activeCourse.title} ${index + 1}`}
                        fill
                        className="object-cover"
                        priority={index === 0}
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-black/15" />
                    </div>
                  );
                })}

                <div className="absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-3">
                  <div className="flex items-center gap-2" role="group" aria-label="スライド選択">
                    {activeCourse.photos.map((_, index) => (
                      <button
                        key={`${activeCourse.id}-dot-${index}`}
                        type="button"
                        onClick={() => setActiveSlideIndex(index)}
                        aria-label={`${index + 1}枚目の写真を表示`}
                        aria-current={index === activeSlideIndex ? "true" : undefined}
                        className="inline-flex h-11 min-w-11 items-center justify-center rounded-full transition hover:bg-black/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
                      >
                        <span
                          aria-hidden="true"
                          className={`h-1.5 rounded-full transition-all duration-300 motion-reduce:transition-none ${
                            index === activeSlideIndex ? "w-6 bg-white" : "w-1.5 bg-white/70"
                          }`}
                        />
                      </button>
                    ))}
                  </div>
                  {!prefersReducedMotion ? (
                    <button
                      type="button"
                      onClick={() => setIsSlideshowPaused((paused) => !paused)}
                      aria-label={isSlideshowPaused ? "スライドショーを再開" : "スライドショーを一時停止"}
                      aria-pressed={isSlideshowPaused}
                      className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-black/55 px-1.5 text-[10px] font-semibold text-white transition hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
                    >
                      {isSlideshowPaused ? (
                        <Play aria-hidden="true" className="h-3 w-3 fill-current" />
                      ) : (
                        <Pause aria-hidden="true" className="h-3 w-3 fill-current" />
                      )}
                    </button>
                  ) : null}
                </div>
              </aside>
            ) : null}

            {hasAppetizerPanel ? (
              <aside
                className="hidden self-start md:sticky md:block"
                style={{
                  top: desktopSlideTop,
                  width: desktopSlideWidth,
                  marginLeft: "-1.5cm",
                }}
              >
                <div
                  className="overflow-hidden px-10 py-10"
                  style={{
                    borderRadius: `${PANEL_RADIUS_PX}px`,
                    background: "transparent",
                    border: "none",
                    boxShadow: "none",
                    backdropFilter: "none",
                  }}
                >
                  <div className="mb-8 text-center">
                    <p className="text-[0.72rem] uppercase tracking-[0.4em] text-[#cca35d]">
                      Grand Menu
                    </p>
                    <p className="mt-1 text-[1.15rem] font-semibold tracking-[0.14em] text-[#f5f0e8]">
                      前菜をお選びください
                    </p>
                    <div className="mt-4 flex items-center justify-center gap-3 text-[#cca35d]">
                      <span className="h-px w-12 bg-gradient-to-r from-transparent to-current" />
                      <span className="h-[5px] w-[5px] rotate-45 bg-current" />
                      <span className="h-px w-12 bg-gradient-to-l from-transparent to-current" />
                    </div>
                  </div>

                  <div className="space-y-8">
                    {appetizerSections.map((section, sectionIndex) => (
                      <div key={section.label}>
                        <p className="mb-3 text-center text-[0.75rem] uppercase tracking-[0.32em] text-[#cca35d]">
                          {section.frenchLabel}
                        </p>
                        <p className="mb-4 text-center text-[0.95rem] font-semibold tracking-[0.12em] text-[#f5f0e8]">
                          {section.label}
                        </p>
                        <div className="mx-auto mb-5 h-px w-10 bg-[rgba(200,153,77,0.35)]" />

                        <ul className="space-y-4">
                          {section.dishes.map((dish) => (
                            <li
                              key={dish.name}
                              className="flex flex-wrap items-baseline justify-center gap-x-2 gap-y-0.5 text-center"
                            >
                              <span className="text-[0.92rem] leading-[1.6] tracking-[0.06em] text-[#f0ebe2]">
                                {dish.name}
                              </span>
                              {dish.surcharge != null ? (
                                <span className="whitespace-nowrap text-[0.78rem] tracking-[0.1em] text-[#cca35d]">
                                  +{dish.surcharge.toLocaleString()}円
                                </span>
                              ) : null}
                            </li>
                          ))}
                        </ul>

                        {sectionIndex < appetizerSections.length - 1 ? (
                          <div className="mx-auto mt-8 h-px w-[calc(100%-4cm)] bg-[rgba(138,104,60,0.28)]" />
                        ) : null}
                      </div>
                    ))}
                  </div>

                  <p className="mt-8 text-center text-[0.72rem] leading-[1.8] tracking-[0.08em] text-[#9a8878]">
                    {APPETIZER_SURCHARGE_NOTE}
                  </p>
                </div>
              </aside>
            ) : null}
          </div>

          {courseTabs
            .filter((course) => course.id !== activeCourse.id)
            .map((course) => (
              <div
                key={`${course.id}-tabpanel-placeholder`}
                id={`${course.id}-panel`}
                role="tabpanel"
                aria-labelledby={`${course.id}-tab`}
                hidden
              />
            ))}
        </section>

        <section className="mx-auto mt-6 max-w-5xl rounded-[2rem] border border-[#c7a357]/25 bg-[rgba(255,248,235,0.08)] px-6 py-7 text-[#f7efe3] shadow-[0_18px_40px_rgba(14,7,4,0.18)] md:px-10">
          <div className="grid gap-5 md:grid-cols-[minmax(0,1fr),auto] md:items-center">
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-[0.32em] text-[#d7b06c]">Reservation</p>
              <h2 className="text-2xl font-semibold md:text-3xl">コースが決まったら、そのまま予約へ進めます</h2>
              <p className="text-sm leading-7 text-[#f3e6d0] md:text-base">
                日付・人数・来店時間を確認しながら、スマホでもスムーズに予約できます。営業時間やアクセス確認が必要な場合も、ここから続けて見られます。
              </p>
            </div>
            <div className="flex flex-col gap-3 md:items-end">
              <Link
                href={bookingHref}
                className="inline-flex h-12 items-center justify-center rounded-full bg-[#b32626] px-8 text-sm font-semibold tracking-[0.2em] text-white shadow-lg transition hover:brightness-[1.05] active:brightness-[0.98]"
              >
                予約フォームへ
              </Link>
              <Link
                href="/access"
                className="inline-flex h-11 items-center justify-center rounded-full border border-[#c7a357]/60 bg-transparent px-8 text-sm font-medium tracking-[0.16em] text-[#fff8eb] transition hover:bg-white/8"
              >
                店舗情報を見る
              </Link>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
