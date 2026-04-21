"use client";
import Link from "next/link";
import { type ReactNode, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Tangerine } from "next/font/google";
import { CONTACT_PHONE_DISPLAY, CONTACT_TEL_LINK } from "@/lib/contact";
const tangerine = Tangerine({
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
});
type MenuKind = "lunch" | "dinner";
type MenuSlide = {
  title: string;
  subtitle: string;
  description: string;
  anchor: string;
};
type MenuGroup = {
  label: string;
  slides: MenuSlide[];
};

const MOBILE_ONLY_BREAK_TOKEN = "[[mobile-break]]";
const DESKTOP_ONLY_BREAK_TOKEN = "[[desktop-break]]";

const menuCardText = {
  subtitleWrap: "flex flex-wrap items-baseline justify-center gap-x-3 gap-y-1 md:flex-nowrap",
  subtitleJa:
    "text-[18px] md:text-[20px] uppercase tracking-[0.30em] text-[#b68c5a]",
  subtitleEn:
    "text-[18px] md:text-[40px] text-[#b68c5a] leading-none",
  title:
    "text-[15px] md:text-[20px] font-semibold text-[#2f1b0f] leading-[1.15] tracking-[0.06em]",
  meta:
    "text-[10px] md:text-[20px] text-[#2f1b0f]/80 tracking-[0.12em]",
  desc:
    "text-[12px] md:text-[20px] text-[#4a3121] leading-[1.75]",
};

function splitJaEnSubtitle(s: string) {
  const m = s.match(/[A-Za-z]/);
  if (!m || m.index == null) return { ja: s.trim(), en: "" };
  return { ja: s.slice(0, m.index).trim(), en: s.slice(m.index).trim() };
}

function splitCourseTitle(raw: string) {
  // 全角/半角スペース両対応で分割
  const parts = raw.split(/[ 　]+/).filter(Boolean);

  const main = parts[0] ?? raw; // キャッチ
  let count = "";
  let price = "";

  if (parts.length >= 3) {
    price = parts[parts.length - 1]; // 末尾を価格扱い
    count = parts.slice(1, parts.length - 1).join(" "); // 真ん中を品数扱い
  } else if (parts.length === 2) {
    count = parts[1];
  }

  return { main, count, price };
}

function renderMultilineText(text: string) {
  return text.split("\n").map((line, index) => {
    const segments = line
      .replaceAll(DESKTOP_ONLY_BREAK_TOKEN, `\n${DESKTOP_ONLY_BREAK_TOKEN}\n`)
      .replaceAll(MOBILE_ONLY_BREAK_TOKEN, `\n${MOBILE_ONLY_BREAK_TOKEN}\n`)
      .split("\n")
      .filter((segment) => segment.length > 0);

    return (
      <span key={`${line}-${index}`}>
        {index > 0 ? <br /> : null}
        {segments.map((segment, segmentIndex) => {
          if (segment === MOBILE_ONLY_BREAK_TOKEN) {
            return <br key={`${segment}-${segmentIndex}`} className="md:hidden" />;
          }

          if (segment === DESKTOP_ONLY_BREAK_TOKEN) {
            return <br key={`${segment}-${segmentIndex}`} className="hidden md:block" />;
          }

          return <span key={`${segment}-${segmentIndex}`}>{segment}</span>;
        })}
      </span>
    );
  });
}

function splitIntoAlternatingColumns<T>(items: T[], pattern: number[]) {
  const columns: T[][] = [];
  let start = 0;
  let patternIndex = 0;

  while (start < items.length) {
    const size = pattern[patternIndex % pattern.length] ?? 1;
    columns.push(items.slice(start, start + size));
    start += size;
    patternIndex += 1;
  }

  return columns;
}

const MENU = {
  lunch: {
    label: "ランチ",
    slides: [
      {
        title: "北京じゃないよ 3品 3,800円",
        subtitle: " プティラ Petite La course",
        description: `Amuse-bouches（2種）/ Hors-d’œuvre または Entrée / ${MOBILE_ONLY_BREAK_TOKEN}Poisson または ßViande / ${DESKTOP_ONLY_BREAK_TOKEN}Café`,
        anchor: "petite",
      },
    ],
  },

  dinner: {
    label: "ディナー",
    slides: [
      {
        title: "実食！ ５品 5,000円",
        subtitle: "ジョワ Joie course",
        description: `Amuse-bouches (3種) / Hors-d’œuvre / Entrée / ${MOBILE_ONLY_BREAK_TOKEN}Poisson または Viande / ${DESKTOP_ONLY_BREAK_TOKEN}Riz / Café`,
        anchor: "joie",
      },
      {
        title: "戸田市 ６品 8,000円",
        subtitle: "サンキャトル Cent Quatre course",
        description: `Amuse-bouches (3種) / Hors-d’œuvre / Entrée / Poisson / ${MOBILE_ONLY_BREAK_TOKEN}Viande / ${DESKTOP_ONLY_BREAK_TOKEN}Riz / Café`,
        anchor: "cent-quatre",
      },
    ],
  },
} satisfies Record<MenuKind, MenuGroup>;

const DRINK_MENU = {
  title: "",
  subtitle: "ドリンク Alcohol",
  description:
    "グラスワイン、ボトル、カクテル、ノンアルコールまで\n幅広くご用意しています。",
};

const dishPhotos = [
  { src: "/photos/料理/１.jpg", alt: "料理 01" },
  { src: "/photos/料理/２.jpg", alt: "料理 02" },
  { src: "/photos/料理/３.jpg", alt: "料理 03" },
  { src: "/photos/料理/４.jpg", alt: "料理 04" },
  { src: "/photos/料理/５.jpg", alt: "料理 05" },
  { src: "/photos/料理/６.jpg", alt: "料理 06" },
  { src: "/photos/料理/１.jpg", alt: "料理 07" },
  { src: "/photos/料理/１.jpg", alt: "料理 08" },
  { src: "/photos/料理/１.jpg", alt: "料理 09" },
  { src: "/photos/料理/１.jpg", alt: "料理 10" },];
const dishPhotoCardWidthPx = 360; // 2列時と3列時の中間サイズ
const dishPhotoGapPx = 24; // gap-6 と同じ間隔
const mobileDishPhotoCardWidthPx = 112;
const mobileDishPhotoGapPx = 8;

function ScrollReveal({
  children,
  className = "",
  delayMs = 0,
  distancePx = 34,
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

function GoldDivider({
  fullBleed = false,
  shiftY = 0,
  thickness = 40,
  blendTopOnPhoto = false,
  centerOpacity,
  colorRgb = "200,153,77",
  className = "",}: {
  fullBleed?: boolean;
  shiftY?: number;
  thickness?: number;
  blendTopOnPhoto?: boolean;
  centerOpacity?: number;
  colorRgb?: string;
  className?: string;}) { return (
    (() => {
      const safeThickness = Math.max(8, thickness);
      const fadePx = Math.max(6, Math.round(safeThickness * 0.35));
      const bandHeight = safeThickness + fadePx * 2;
      const bandHalf = Math.round(safeThickness / 2);
      const topFadeOpacity = blendTopOnPhoto ? 0.24 : 0.42;
      const centerFadeOpacity =
        centerOpacity ?? (blendTopOnPhoto ? 0.88 : 0.96);
      const bottomFadeOpacity = blendTopOnPhoto ? 0.24 : 0.42;
      const topFadeStep = blendTopOnPhoto ? Math.max(4, Math.round(fadePx * 0.65)) : fadePx;

      return (
    <div
      className={(fullBleed
          ? "relative left-1/2 right-1/2 -ml-[50vw] -mr-[50vw] w-screen"
          : "mx-auto max-w-5xl") +" px-0 overflow-visible " + 
      className}>
  <div
  style={{
    transform: `translateY(${shiftY}px)`,
    height: `${Math.max(56, bandHeight + 12)}px`,
  }}
  className="relative overflow-visible">
  <div
    className="absolute inset-x-0 top-1/2 -translate-y-1/2"
    style={{
      height: `${bandHeight}px`,
      background:
        `linear-gradient(to bottom,
          rgba(${colorRgb},0) 0px,
          rgba(${colorRgb},${topFadeOpacity}) ${topFadeStep}px,
          rgba(${colorRgb},${centerFadeOpacity}) ${fadePx + bandHalf}px,
          rgba(${colorRgb},${bottomFadeOpacity}) ${fadePx + safeThickness}px,
          rgba(${colorRgb},0) ${bandHeight}px
        )`,
    }}
  />
</div>
    </div>
      );
    })()
  );}

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

export default function HomePage() {
  const isMobile = useIsMobileLayout();
  const desktopHomeLayout = {
    readMoreBtnPos: {
      x: 0,
      y: 550,
    },
    heroPhoto: {
      offsetXPx: 0,
      offsetYPx: -5,
      focalXPercent: 50,
      focalYPercent: 15,
    },
    po: {
      w: 200,
      h: 360,
      x: 103,
      y: 248,
      pos: "50% 50%",
    },
    storyGraphic: {
      w: 350,
      h: 300,
      x: -285,
      y: -120,
    },
    storySpacing: {
      top: 150,
    },
    storyPos: {
      group: { x: -285, y: -90 },
      label: { x: 0, y: 0 },
      title: { x: 0, y: 0 },
      body: { x: 0, y: 0 },
    },
    infoPos: {
      group: { x: 0, y: 100 },
      heading: { x: 0, y: 0 },
      body: { x: 0, y: 0 },
      subheading: { x: 0, y: 0 },
      subbody: { x: 0, y: 0 },
    },
    contactPos: {
      group: { x: 0, y: 300 },
      map: { x: 0, y: 300 },
    },
    contactSpacing: {
      extraBottom: 76,
    },
    dishesSpacing: {
      top: 120,
    },
  } as const;
  const mobileHomeLayout = {
    readMoreBtnPos: {
      x: 0,
      y: 0,
    },
    heroPhoto: {
      offsetXPx: 0,
      offsetYPx: -3,
      focalXPercent: 50,
      focalYPercent: 35,
    },
    po: {
      w: 68,
      h: 112,
      x: 0,
      y: 0,
      pos: "50% 50%",
    },
    storyGraphic: {
      w: 220,
      h: 188,
      x: 0,
      y: -56,
    },
    storySpacing: {
      top: 16,
    },
    storyPos: {
      group: { x: 0, y: 0 },
      label: { x: 0, y: 0 },
      title: { x: 0, y: 0 },
      body: { x: 0, y: 0 },
    },
    infoPos: {
      group: { x: 0, y: 24 },
      heading: { x: 0, y: 0 },
      body: { x: 0, y: 0 },
      subheading: { x: 0, y: 0 },
      subbody: { x: 0, y: 0 },
    },
    contactPos: {
      group: { x: 0, y: 18 },
      map: { x: 0, y: 18 },
    },
    contactSpacing: {
      extraBottom: 124,
    },
    dishesSpacing: {
      top: 52,
    },
  } as const;
  const homeLayout = isMobile ? mobileHomeLayout : desktopHomeLayout;
  const readMoreBtnPos = homeLayout.readMoreBtnPos;
  const heroPhoto = homeLayout.heroPhoto;
  const po = homeLayout.po;
  const storyGraphic = homeLayout.storyGraphic;
  const storySpacing = homeLayout.storySpacing;
  const storyPos = homeLayout.storyPos;
  const infoPos = homeLayout.infoPos;
  const contactPos = homeLayout.contactPos;
  const contactSpacing = homeLayout.contactSpacing;
  const dishesSpacing = homeLayout.dishesSpacing;
  const dishPhotoRows = splitIntoAlternatingColumns(dishPhotos, [2, 3]);
  const heroGoldBandLiftPx = 4; // 約0.1cmぶん上に移動
  const goldDividerPos = {
    thicknessBase: 44, // 帯の基準太さ(px)
    thicknessAll: 0,   // 全帯の太さを一括微調整(+/-)
    heroBottomThickness: isMobile ? 0 : 6, // ヒーロー直下の帯の太さ微調整
    heroBottomCenterOpacity: 1, // ヒーロー直下の帯の中心濃度(0-1)
    heroBottomColorRgb: "184,136,56", // ヒーロー直下の帯色（濃いゴールド）
    readMoreThickness: 0,   // READ MORE下の帯の太さ微調整
    dishesThickness: 0,     // DISHES下の帯の太さ微調整
    contactTopThickness: 0, // CONTACT上の帯の太さ微調整
    showDivider2: false, // 2本目（READ MORE-DISHES間）を一時表示するか
    showDivider3: false, // 3本目（DISHES-MENU間）を一時表示するか
    showDivider4: false, // 4本目（CONTACT上）を一時表示するか
    divider1Y: (isMobile ? -42 : -80) - heroGoldBandLiftPx,      // 1本目: ヒーロー直下の帯（下に+ / 上に-）
    divider2Y: 130,      // 2本目: READ MORE と DISHES の間の帯
    divider3Y: 120,      // 3本目: DISHES と MENU の間の帯
    divider4Y: 180,      // 4本目: CONTACT 上の帯
  };
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);
  const [menuKind, setMenuKind] = useState<MenuKind>("dinner");
  const activeMenu = MENU[menuKind];

useEffect(() => {
  if (!lightbox) return;

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") setLightbox(null);
  };

  document.addEventListener("keydown", onKeyDown);

  // 背景スクロール止める
  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";

  return () => {
    document.removeEventListener("keydown", onKeyDown);
    document.body.style.overflow = prevOverflow;
  };
}, [lightbox]);
  const chefText = {
  label: "text-[12px] md:text-[27px]",
  title: "text-[23px] md:text-[40px] whitespace-nowrap",
  body: "text-[18px] md:text-[24px] leading-relaxed md:leading-relaxed",
};
const sectionBackgroundTone = {
  white: "#ffffff",
  accent: "#F3E5AB",
};
const sectionBlendPx = 220;
const dishesBoundaryLiftPx = 114; // 約3cmぶん上に移動
const dishesBlendPx = Math.max(0, sectionBlendPx - dishesBoundaryLiftPx);
const contactBoundaryLiftPx = 76; // 約2cmぶん上に移動
const contactBlendPx = Math.max(0, sectionBlendPx - contactBoundaryLiftPx);
const sectionBackgroundGradient = {
  dishes: `linear-gradient(to bottom, ${sectionBackgroundTone.white} 0px, ${sectionBackgroundTone.accent} ${dishesBlendPx}px, ${sectionBackgroundTone.accent} 100%)`,
  menu: `linear-gradient(to bottom, ${sectionBackgroundTone.accent} 0px, ${sectionBackgroundTone.white} ${sectionBlendPx}px, ${sectionBackgroundTone.white} 100%)`,
  contact: `linear-gradient(to bottom, ${sectionBackgroundTone.white} 0px, ${sectionBackgroundTone.accent} ${contactBlendPx}px, ${sectionBackgroundTone.accent} 100%)`,
};
const contactOffsetCompensation = Math.max(0, contactPos.group.y, contactPos.map.y);
const storeLabel = {
  href: "/on-line-store",
  text: "ONLINE STORE",
};
const storeLabelPos = { x: 13, y: 0 }; // 右側ラベルの微調整(px)
const storeLabelSize = { py: 18, px: 12, font: 11, tracking: 0.24 }; // 右ラベル微調整
const reserveLabel = {
  href: "/booking",
  text: "RESERVE",
};
const reserveLabelPos = { x:-12, y: 0 }; // 左側ラベルの微調整(px)
const reserveLabelSize = { py:39, px: 12, font: 11, tracking: 0.24 }; // 左ラベル微調整
const readMoreButtonClassName = `
  z-20
  pointer-events-auto
  cursor-pointer
  inline-flex h-10 items-center whitespace-nowrap
  rounded-[2px]
  border border-[#c7a357]
  bg-gradient-to-b from-[#e6d0a2] to-[#d2ab66]
  px-5 md:px-7
  text-[11px] md:text-[12px] font-medium tracking-[0.18em] text-[#2f1b0f]
  shadow-[0_1px_0_rgba(0,0,0,0.06)]
  transition
  hover:brightness-[1.03]
  active:brightness-[0.98]
  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c7a357]/40
`;
const readMoreButtonStyle = {
  writingMode: "horizontal-tb" as const,
  fontFamily:
    '"Noto Serif JP","Yu Mincho","游明朝","Hiragino Mincho ProN","Hiragino Mincho Pro",serif',
};
return (
  <>
  <div className="relative z-10 space-y-0 pb-0 md:pb-0">
     <a
       href={reserveLabel.href}
       aria-label="予約する"
       className="fixed inset-x-4 z-40 flex h-12 items-center justify-center rounded-full bg-[#b32626] text-[13px] font-semibold tracking-[0.28em] text-white shadow-lg transition hover:brightness-[1.05] active:brightness-[0.98] md:hidden"
       style={{ bottom: "calc(env(safe-area-inset-bottom) + 1rem)" }}
     >
       予約する
     </a>
     <a
       href={reserveLabel.href}
       aria-label="予約"
       className="fixed left-3 top-1/2 z-40 hidden rounded-r-md bg-[#b32626] text-white shadow-lg transition hover:brightness-[1.05] active:brightness-[0.98] md:block"
       style={{
         writingMode: "vertical-rl",
         textOrientation: "mixed",
         padding: `${reserveLabelSize.py}px ${reserveLabelSize.px}px`,
         fontSize: `${reserveLabelSize.font}px`,
         letterSpacing: `${reserveLabelSize.tracking}em`,
         transform: `translate(${reserveLabelPos.x}px, ${reserveLabelPos.y}px) translateY(-50%)`,
       }}
     >
       {reserveLabel.text}
     </a>
     <a
       href={storeLabel.href}
       aria-label="オンラインストア"
       className="fixed right-3 top-1/2 z-40 hidden rounded-l-md bg-[#1f4f8f] text-white shadow-lg transition hover:brightness-[1.05] active:brightness-[0.98] md:block"
       style={{
         writingMode: "vertical-rl",
         textOrientation: "mixed",
         padding: `${storeLabelSize.py}px ${storeLabelSize.px}px`,
         fontSize: `${storeLabelSize.font}px`,
         letterSpacing: `${storeLabelSize.tracking}em`,
         transform: `translate(${storeLabelPos.x}px, ${storeLabelPos.y}px) translateY(-50%)`,
       }}
     >
       {storeLabel.text}
     </a>
      {lightbox && (
  <div
    className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 p-4 cursor-default"
    role="dialog"
    aria-modal="true"
    onMouseDown={(e) => {
      if (e.target === e.currentTarget) setLightbox(null);
    }}
  >
    <div className="relative w-full max-w-5xl">
      {/* 写真の上だけフォークナイフ */}
      <div className="relative aspect-[16/10] w-full overflow-hidden rounded-2xl bg-black shadow-2xl cursor-utensils">
        <Image
          src={lightbox.src}
          alt={lightbox.alt}
          fill
          className="object-contain"
          sizes="100vw"
          priority
        />
      </div>
    </div>
  </div>
)}

	      <ScrollReveal>
	<section className="relative left-1/2 right-1/2 -ml-[50vw] -mr-[50vw] w-screen overflow-hidden h-[56.25vw] min-h-[180px] rounded-none md:h-auto md:min-h-[950px]">
  <div
    className="absolute inset-0"
    style={{
      transform: `translate(${heroPhoto.offsetXPx}px, ${heroPhoto.offsetYPx}px)`,
    }}
  >
    <Image
      src="/photos/am.jpg"
      alt=""
      fill
      priority
      className="object-cover"
      style={{
        objectPosition: `${heroPhoto.focalXPercent}% ${heroPhoto.focalYPercent}%`,
      }}
    />
    <div className="absolute inset-0 bg-gradient-to-br from-[#f5e7ce]/10 via-transparent to-white/5" />
  </div>

  <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[5] hidden h-[40px] bg-white md:block" />

  <div className="absolute inset-0 z-10 pointer-events-none">
    <div className="hero-left-fade absolute left-3 top-[58px] md:bottom-[8.5rem] md:left-[8.9rem] md:top-auto">
      <Image
        src="/photos/mo.png"
        alt="Cent Quatre"
        width={520}
        height={360}
        className="h-auto w-[132px] opacity-100 drop-shadow-lg sm:w-[220px] md:w-[420px]"
        priority
      />
    </div>
  </div>
	</section>
	<GoldDivider
  fullBleed
  blendTopOnPhoto
  centerOpacity={goldDividerPos.heroBottomCenterOpacity}
  colorRgb={goldDividerPos.heroBottomColorRgb}
  thickness={
    goldDividerPos.thicknessBase +
    goldDividerPos.thicknessAll +
    goldDividerPos.heroBottomThickness
  }
  shiftY={goldDividerPos.divider1Y}
  className="relative z-[15] mb-6"
/>
	      </ScrollReveal>

	      <ScrollReveal delayMs={80}>
	<section
  className="mt-0 space-y-8 px-4 text-center md:space-y-6 md:px-0"
  style={{ paddingTop: `${storySpacing.top}px` }}
>
  <div className="mx-auto hidden w-full max-w-5xl justify-center md:flex">
    <Link
      href="/menu"
      style={{
        ...readMoreButtonStyle,
        transform: `translate(${readMoreBtnPos.x}px, ${readMoreBtnPos.y}px)`,
      }}
      className={readMoreButtonClassName}
    >
      <span className="leading-none">READ MORE</span>
    </Link>
  </div>

  <div className="grid items-center gap-10 border-0 bg-transparent shadow-none ring-0 md:grid-cols-2 md:gap-6 md:items-center">
    {/* 左カラム：po画像 + ボタン */}
    <div className="order-2 relative hidden overflow-visible md:order-1 md:block">
      {/* 画像だけ po で動かす */}
      <div className="mx-auto w-fit" style={{ transform: `translate(${po.x}px, ${po.y}px)` }}>
        <div
          className="relative overflow-hidden rounded-2xl border-0 bg-transparent shadow-none ring-0"
          style={{ width: `${po.w}px`, height: `${po.h}px` }}
        >
          <Image
            src="/photos/po.png"
            alt=""
            fill
            className="object-contain"
            style={{ objectPosition: po.pos }}
            sizes="(max-width: 768px) 116px, 200px"
          />
        </div>
      </div>

    </div>

    {/* 右カラム：2.png + Story（ここに “元の内容” を入れる） */}
    <div className="order-1 flex flex-col items-center space-y-5 text-center md:order-2 md:space-y-3">
      <div
        className="relative mx-auto"
        style={{
          width: `${storyGraphic.w}px`,
          height: `${storyGraphic.h}px`,
          transform: `translate(${storyGraphic.x}px, ${storyGraphic.y}px)`,
        }}
      >
        <Image
          src="/photos/2.png"
          alt="Bistro Cent Quatre"
          fill
          className="object-contain"
          priority
          sizes="(max-width: 768px) 220px, 350px"
        />
      </div>

      <div
        className="text-center md:max-w-none"
        style={{ transform: `translate(${storyPos.group.x}px, ${storyPos.group.y}px)` }}
      >
        <p
          className={`${chefText.label} uppercase tracking-[0.25em] text-[#b68c5a]`}
          style={{ transform: `translate(${storyPos.label.x}px, ${storyPos.label.y}px)` }}
        >
          STORY
        </p>

        <h3
          className={`${chefText.title} font-semibold text-[#2f1b0f]`}
          style={{ transform: `translate(${storyPos.title.x}px, ${storyPos.title.y}px)` }}
        >
          川越をフレンチの街へ
        </h3>

        <p
          className={`${chefText.body} whitespace-pre-line text-center text-[#4a3121] md:whitespace-pre`}
          style={{ transform: `translate(${storyPos.body.x}px, ${storyPos.body.y}px)` }}
        >
          {"川越は芋ばっかり😩\n街全体が芋になってしまう前にフレンチの街にしよう！"}
        </p>
      </div>

      <div className="relative mx-auto h-[112px] w-full max-w-[280px] md:hidden">
        <div
          className="absolute top-1/2"
          style={{ left: "calc(50% - 132px)", transform: `translate(${po.x}px, -50%)` }}
        >
          <div
            className="relative overflow-hidden rounded-2xl border-0 bg-transparent shadow-none ring-0"
            style={{ width: `${po.w}px`, height: `${po.h}px` }}
          >
            <Image
              src="/photos/po.png"
              alt=""
              fill
              className="object-contain"
              style={{ objectPosition: po.pos }}
              sizes="68px"
            />
          </div>
        </div>
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <Link
            href="/menu"
            style={readMoreButtonStyle}
            className={readMoreButtonClassName}
          >
            <span className="leading-none">READ MORE</span>
          </Link>
        </div>
      </div>
    </div>
  </div>
	</section>
	      </ScrollReveal>

	      <div className="relative left-1/2 right-1/2 -ml-[50vw] -mr-[50vw] w-screen">
	      <div
	        style={{
	          background: sectionBackgroundGradient.dishes,
	        }}
	      >
	      <ScrollReveal delayMs={100}>
		<GoldDivider
  fullBleed
  thickness={
    goldDividerPos.thicknessBase +
    goldDividerPos.thicknessAll +
    goldDividerPos.readMoreThickness
  }
  shiftY={goldDividerPos.divider2Y}
		  className={`mb-6 ${goldDividerPos.showDivider2 ? "" : "hidden"}`}
		/>
	      </ScrollReveal>

	      <ScrollReveal delayMs={120}>
		{/* 料理セクション：READ MORE と メニューの間 */}
		<section
  className="mt-0 pb-[30px] pt-16 text-center md:pt-[110px]"
  style={{ marginTop: `${dishesSpacing.top}px` }}
>
  <div className="mx-auto max-w-[1240px] px-2 md:px-4">
    <div className="space-y-1">
      <p className="text-xs uppercase tracking-[0.3em] text-[#b68c5a]">DISHES</p>
      <h2 className="text-3xl font-semibold text-[#2f1b0f]">料理</h2>
    </div>

    <div className="mt-10 space-y-6">
      {(() => {
        let revealIndex = 0;
        return dishPhotoRows.map((row, rowIndex) => (
          <div
            key={`dish-row-${rowIndex}`}
            className="mx-auto flex w-full flex-wrap justify-center gap-2 md:grid md:gap-6"
            style={
              isMobile
                ? { gap: `${mobileDishPhotoGapPx}px` }
                : {
                    maxWidth: `calc(${row.length} * ${dishPhotoCardWidthPx}px + ${(row.length - 1) * dishPhotoGapPx}px)`,
                    gridTemplateColumns: `repeat(${row.length}, minmax(0, 1fr))`,
                  }
            }
          >
            {row.map((p, itemIndex) => {
              const delayMs = revealIndex * 140;
              revealIndex += 1;
              return (
                <ScrollReveal
                  key={`${p.src}-${rowIndex}-${itemIndex}`}
                  delayMs={delayMs}
                  distancePx={20}
                  durationMs={980}
                >
                  <button
                    type="button"
                    onClick={() => setLightbox(p)}
                    aria-label={`${p.alt} を拡大`}
                    className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-[#cfa96d]/40 bg-white shadow-md cursor-utensils focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c7a357]/40 md:w-full"
                    style={isMobile ? { width: `${mobileDishPhotoCardWidthPx}px` } : undefined}
                  >
                    <Image
                      src={p.src}
                      alt={p.alt}
                      fill
                      className="object-cover"
                      sizes={
                        isMobile
                          ? `${mobileDishPhotoCardWidthPx}px`
                          : `${dishPhotoCardWidthPx}px`
                      }
                    />
                  </button>
                </ScrollReveal>
              );
            })}
          </div>
        ));
      })()}
    </div>
  </div>
		</section>
		      </ScrollReveal>

	      <ScrollReveal delayMs={140}>
		<GoldDivider
	  fullBleed
	  thickness={
	    goldDividerPos.thicknessBase +
	    goldDividerPos.thicknessAll +
	    goldDividerPos.dishesThickness
	  }
	  shiftY={goldDividerPos.divider3Y}
		  className={`mb-6 ${goldDividerPos.showDivider3 ? "" : "hidden"}`}
		/>
		      </ScrollReveal>
	      </div>

	      <div
	        style={{
	          background: sectionBackgroundGradient.menu,
	        }}
	      >
	      <ScrollReveal delayMs={160} durationMs={1200} distancePx={28}>
	      <section className="mt-0 space-y-6 pt-16 text-center menu-no-select md:pt-[145px]">
        <div className="mt-8 space-y-1">
          <p className="text-xs uppercase tracking-[0.3em] text-[#b68c5a]">Menu Showcase</p>
          <h2 className="text-3xl font-semibold text-[#2f1b0f]">メニュー</h2>
        </div>
        <div className="mt-6 flex justify-center gap-2">
  {(["lunch", "dinner"] as const).map((k) => {
    const active = menuKind === k;
    return (
      <button
        key={k}
        type="button"
        onClick={() => setMenuKind(k)}
        aria-pressed={active}
        className={[
          "h-10 rounded-[2px] px-6 text-sm tracking-[0.18em] transition select-none",
          active
            ? "bg-[#2f1b0f] text-white shadow"
            : "bg-[#f5e7ce] text-[#2f1b0f] border border-[#cfa96d]/40 hover:brightness-[0.98]",
        ].join(" ")}
      >
        {MENU[k].label}
      </button>
    );
  })}
</div>
        <div className="relative mx-auto flex max-w-5xl flex-col items-center justify-center gap-10">
  {activeMenu.slides.map((item, index) => {
  const { main, count, price } = splitCourseTitle(item.title);

  // ★ここが「map の中で使う」場所
  const { ja, en } = splitJaEnSubtitle(item.subtitle);

  const href = item.anchor ? { pathname: "/menu", hash: item.anchor } : "/menu";

  return (
    <ScrollReveal
      key={item.title}
      delayMs={index * 140}
      distancePx={16}
      durationMs={920}
    >
      <div
        className={["inline-block text-center", 'font-["Noto_Serif_JP","Yu_Mincho","Hiragino_Mincho_ProN",serif]'].join(" ")}
      >
        <Link
          href={href}
          className="inline-block select-none rounded-[2px] px-2 py-1 cursor-pointer"
          draggable={false}
        >
          <div className="space-y-2">

            <p className={menuCardText.subtitleWrap}>
              <span className={menuCardText.subtitleJa}>{ja}</span>
              {en && (
                <span
                  className={`menu-sub-en ${menuCardText.subtitleEn} ${tangerine.className}`}
                >
                  {en}
                </span>
              )}
            </p>

            <div className="flex flex-wrap items-baseline justify-center gap-x-4 gap-y-1 md:flex-nowrap">
              <span className={menuCardText.title}>{main}</span>
              {count && <span className={menuCardText.meta}>{count}</span>}
              {price && <span className={menuCardText.meta}>{price}</span>}
              {price && <span className={menuCardText.meta}>税別</span>}
            </div>

            <p className={menuCardText.desc}>{renderMultilineText(item.description)}</p>
          </div>
        </Link>
      </div>
    </ScrollReveal>
  );
})}

  {(() => {
    const { main, count, price } = splitCourseTitle(DRINK_MENU.title);
    const { ja, en } = splitJaEnSubtitle(DRINK_MENU.subtitle);
    const drinkHref = "/menu";

    return (
      <ScrollReveal
        key={`drink-${menuKind}`}
        delayMs={activeMenu.slides.length * 140}
        distancePx={16}
        durationMs={920}
      >
        <Link
          href={drinkHref}
          className={[
            "inline-block px-2 py-1 text-center cursor-pointer select-none",
            'font-["Noto_Serif_JP","Yu_Mincho","Hiragino_Mincho_ProN",serif]',
          ].join(" ")}
          draggable={false}
        >
          <div className="space-y-2">
            <p className={menuCardText.subtitleWrap}>
              <span className={menuCardText.subtitleJa}>{ja}</span>
              {en && (
                <span className={`menu-sub-en ${menuCardText.subtitleEn} ${tangerine.className}`}>
                  {en}
                </span>
              )}
            </p>

            {(main || count || price) && (
              <div className="flex flex-wrap items-baseline justify-center gap-x-4 gap-y-1 md:flex-nowrap">
                {main && <span className={menuCardText.title}>{main}</span>}
                {count && <span className={menuCardText.meta}>{count}</span>}
                {price && <span className={menuCardText.meta}>{price}</span>}
                {price && <span className={menuCardText.meta}>税別</span>}
              </div>
            )}

            <p className={menuCardText.desc}>{renderMultilineText(DRINK_MENU.description)}</p>
          </div>
        </Link>
      </ScrollReveal>
    );
  })()}
</div>
        <div className="mx-auto mt-10 max-w-3xl text-center text-[#2f1b0f]">
          <div
            style={{
              transform: `translate(${infoPos.group.x}px, ${infoPos.group.y}px)`,
            }}
          >
            <p
              className="text-[14px] md:text-lg font-semibold tracking-[0.18em]"
              style={{ transform: `translate(${infoPos.heading.x}px, ${infoPos.heading.y}px)` }}
            >
              ご案内
            </p>
          <p
            className="mt-3 text-[13px] md:text-lg leading-relaxed text-[#4a3121]"
            style={{ transform: `translate(${infoPos.body.x}px, ${infoPos.body.y}px)` }}
          >
            アレルギー等のお食事制限がございましたら、お気軽にお申し付けください。
            また、予告なくメニュー内容に変更が生じる場合がございますので、
            <span className="whitespace-nowrap">ご了承ください。</span>
          </p>
          <p
            className="mt-6 text-[14px] md:text-lg font-semibold tracking-[0.12em]"
            style={{ transform: `translate(${infoPos.subheading.x}px, ${infoPos.subheading.y}px)` }}
          >
            アレルギー・食事制限について
          </p>
          <p
            className="mt-2 text-[13px] md:text-lg leading-relaxed text-[#4a3121]"
            style={{ transform: `translate(${infoPos.subbody.x}px, ${infoPos.subbody.y}px)` }}
          >
            事前にお申し付けください。可能な限りご対応させていただきます。
          </p>
          </div>
        </div>
		      </section>
		      </ScrollReveal>
	      </div>

	      <div
	        style={{
	          background: sectionBackgroundGradient.contact,
	        }}
	      >
	      <GoldDivider
	        fullBleed
	        thickness={
	          goldDividerPos.thicknessBase +
	          goldDividerPos.thicknessAll +
	          goldDividerPos.contactTopThickness
	        }
	        shiftY={goldDividerPos.divider4Y}
	        className={`mb-6 ${goldDividerPos.showDivider4 ? "" : "hidden"}`}
	      />

	      <ScrollReveal delayMs={180}>
	      <section
	        className="mt-36 pb-24 md:mt-20"
	        style={{
	          paddingBottom: `${
	            contactSpacing.extraBottom + contactOffsetCompensation
	          }px`,
	        }}
	      >
        <div className="mx-auto grid w-full max-w-[900px] items-start gap-6 md:max-w-[1180px] md:grid-cols-[550px_550px] md:justify-center md:gap-16">
          <div
            className="order-1 md:flex md:h-[340px] md:items-center md:justify-end"
            style={{
              transform: `translate(${contactPos.group.x}px, ${contactPos.group.y}px)`,
            }}
          >
          <div className="px-0 text-[#2f1b0f] md:w-full md:max-w-[420px] md:px-0">
            <div className="flex flex-col items-start gap-5 md:h-[190px] md:justify-between md:gap-0">
              <h2 className="ml-[19px] text-[24px] font-semibold md:ml-0 md:text-3xl">アクセス / お問い合わせ</h2>
              <div className="space-y-1 pl-[38px] text-[14px] font-normal text-black md:pl-0 md:text-lg">
                <p>〒350-0824</p>
                <p className="whitespace-nowrap">埼玉県川越市石原町１丁目４７−７</p>
              </div>
              <div className="flex w-full flex-nowrap items-center gap-2 pl-[38px] text-[14px] font-normal text-black md:pl-0 md:text-lg">
                <span>連絡先：</span>
                <a className="whitespace-nowrap underline text-black" href={CONTACT_TEL_LINK}>
                  {CONTACT_PHONE_DISPLAY}
                </a>
                <Link
                  href="/contact"
                  className="inline-flex h-9 items-center justify-center rounded-full border border-[#c7a357] bg-white px-4 text-[11px] font-medium tracking-[0.14em] text-[#2f1b0f] shadow-[0_1px_0_rgba(0,0,0,0.06)] transition hover:bg-[#f8f2e6] active:brightness-[0.98] md:h-10 md:px-6 md:text-[12px] md:tracking-[0.18em]"
                >
                  お問い合わせ
                </Link>
              </div>
            </div>
          </div>
          </div>
          <div
            className="order-2 mx-auto w-full max-w-[280px] overflow-hidden rounded-2xl border border-[#cfa96d]/40 shadow-sm md:w-[550px] md:max-w-[550px]"
            style={{ transform: `translate(${contactPos.map.x}px, ${contactPos.map.y}px)` }}
          >
            <iframe
              title="Bistro Cent Quatre map"
              className="h-56 w-full md:h-[380px]"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              src="https://www.google.com/maps?q=%E3%80%92350-0824%20%E5%9F%BC%E7%8E%89%E7%9C%8C%E5%B7%9D%E8%B6%8A%E5%B8%82%E7%9F%B3%E5%8E%9F%E7%94%BA%EF%BC%91%E4%B8%81%E7%9B%AE%EF%BC%94%EF%BC%97%E2%88%92%EF%BC%97&output=embed"
            />
          </div>
	        </div>
	      </section>
	      </ScrollReveal>
	      </div>
	      </div>
  </div>
  </>
);
}
