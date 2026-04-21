"use client";

import { Suspense, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Noto_Serif_JP, Tangerine } from "next/font/google";
import { addToCart } from "@/lib/store-cart";

const headingFont = Tangerine({
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
});

const bodySerif = Noto_Serif_JP({
  subsets: ["latin"],
  weight: ["400", "600"],
});

const pageSpacing = { top: 132, bottom: 140 };
const menuHeadingSize = { base: 32, md: 60 };
const pdfEmbedParams = "#page=1&zoom=page-fit&toolbar=0&navpanes=0&scrollbar=0";
const rightPanelOffsetY = 24;
const quantityButtonTuning = {
  minus: { x: 0, y: 0, size: 32, lineWidth: 20, lineThickness: 2 },
  plus: { x: 0, y:-8, size: 32, fontSize: 45 },
};
const productInfoTextSize = {
  name: 28,
  price: 30,
  sizeLabel: 22,
  sizeValue: 22,
};

const productImages = [
  {
    src: "/photos/online%20store/エプロン.jpg",
    alt: "オリジナルエプロン写真 1枚目",
    fit: "contain",
  },
  {
    src: "/photos/online%20store/20260219_225237_temp.jpg",
    alt: "オリジナルエプロン写真 2枚目",
    fit: "contain",
  },
] as const;

function clampQuantity(value: number) {
  return Math.min(10, Math.max(1, value));
}

function parseRequestedQuantity(value: string | null) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return 1;
  return clampQuantity(parsed);
}

function ApronPurchaseFallback() {
  return (
    <section
      className="relative left-1/2 right-1/2 -ml-[50vw] -mr-[50vw] flex min-h-[60vh] w-screen items-center justify-center bg-gradient-to-b from-[#f7ebd3] via-[#f1ddb5] to-[#e8c98f] px-4"
      style={{ paddingTop: `${pageSpacing.top}px`, paddingBottom: `${pageSpacing.bottom}px` }}
    >
      <p className={`${bodySerif.className} text-sm text-[#4a3121]`}>読み込み中...</p>
    </section>
  );
}

function ApronPurchaseContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isAgentMode = searchParams.get("mode") === "agent";
  const requestedQuantity = searchParams.get("qty");
  const [zoomImage, setZoomImage] = useState<string | null>(null);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [quantity, setQuantity] = useState(1);

  useEffect(() => {
    setQuantity(parseRequestedQuantity(requestedQuantity));
  }, [requestedQuantity]);

  const prevImage = () => {
    setCurrentImageIndex((prev) => (prev === 0 ? productImages.length - 1 : prev - 1));
  };

  const nextImage = () => {
    setCurrentImageIndex((prev) => (prev + 1) % productImages.length);
  };

  const decreaseQuantity = () => {
    setQuantity((prev) => clampQuantity(prev - 1));
  };

  const increaseQuantity = () => {
    setQuantity((prev) => clampQuantity(prev + 1));
  };

  const currentImage = productImages[currentImageIndex];
  const isCurrentPdf = currentImage.src.toLowerCase().endsWith(".pdf");
  const isZoomPdf = zoomImage?.toLowerCase().endsWith(".pdf");

  const handleAddToCart = () => {
    addToCart(
      {
        id: "apron",
        name: "オリジナルエプロン",
        price: 10000,
        image: productImages[0].src,
      },
      quantity,
    );
    router.push(isAgentMode ? "/on-line-store/cart?mode=agent" : "/on-line-store/cart");
  };

  return (
    <section
      className="relative left-1/2 right-1/2 -ml-[50vw] -mr-[50vw] w-screen bg-gradient-to-b from-[#f7ebd3] via-[#f1ddb5] to-[#e8c98f] px-4"
      style={{ paddingTop: `${pageSpacing.top}px`, paddingBottom: `${pageSpacing.bottom}px` }}
    >
      <div className="mx-auto max-w-[76rem] space-y-8">
        <header className="text-center">
          <h1
            className={`menu-heading-title font-semibold text-[#2f1b0f] ${headingFont.className}`}
            style={
              {
                "--menu-heading-size": `${menuHeadingSize.base}px`,
                "--menu-heading-size-md": `${menuHeadingSize.md}px`,
              } as Record<string, string>
            }
          >
            Purchase
          </h1>
        </header>

        {isAgentMode ? (
          <div className={`${bodySerif.className} mx-auto max-w-3xl rounded-3xl border border-[#cfa96d]/40 bg-white/90 px-6 py-5 text-[#4a3121] shadow-[0_16px_48px_rgba(47,27,15,0.08)]`}>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#8a6233]">
              Warm Handoff
            </p>
            <p className="mt-3 text-sm leading-7">
              AIが商品選定と数量の下準備を行いました。数量を確認し、次の画面でお客様ご自身が
              ご注文内容の確認と最終送信を行ってください。
            </p>
          </div>
        ) : null}

        <div className="grid items-start gap-8 lg:grid-cols-[1.15fr_1fr] lg:gap-3">
          <div className="relative mx-auto w-full max-w-[27rem] overflow-hidden rounded-sm bg-white lg:translate-x-[0.2cm]">
            <button
              type="button"
              onClick={() => setZoomImage(currentImage.src)}
              className="relative block w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[#6b4a2f]/30"
            >
              <div className="relative aspect-[3/4]">
                {isCurrentPdf ? (
                  <div className="h-full w-full overflow-hidden p-4">
                    <iframe
                      src={`${currentImage.src}${pdfEmbedParams}`}
                      title={currentImage.alt}
                      className="h-full w-[calc(100%+24px)] -ml-[12px] bg-white pointer-events-none"
                    />
                  </div>
                ) : (
                  <Image
                    src={currentImage.src}
                    alt={currentImage.alt}
                    fill
                    className={currentImage.fit === "contain" ? "object-contain p-4" : "object-cover"}
                    sizes="(max-width: 1280px) 100vw, 65vw"
                  />
                )}
              </div>
            </button>
            <button
              type="button"
              onClick={prevImage}
              aria-label="前の画像"
              className="absolute left-4 top-1/2 z-10 -translate-y-1/2 p-2 text-[#1f1f1f] transition hover:opacity-70 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2f1b0f]/30"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="h-7 w-7"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M15 4L7 12L15 20" />
              </svg>
            </button>
            <button
              type="button"
              onClick={nextImage}
              aria-label="次の画像"
              className="absolute right-4 top-1/2 z-10 -translate-y-1/2 p-2 text-[#1f1f1f] transition hover:opacity-70 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2f1b0f]/30"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="h-7 w-7"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9 4L17 12L9 20" />
              </svg>
            </button>
          </div>

          <aside
            className={`${bodySerif.className} flex min-h-[34rem] w-full max-w-[24rem] flex-col p-5 lg:ml-[0.2cm] lg:justify-self-start`}
            style={{
              marginTop: `${rightPanelOffsetY}px`,
            }}
          >
            <div className="space-y-0">
              <div className="text-left">
                <p
                  className="font-semibold text-[#2f1b0f]"
                  style={{ fontSize: `${productInfoTextSize.name}px` }}
                >
                  オリジナルエプロン
                </p>
                <p
                  className="mt-[2cm] font-semibold text-[#4a3121]"
                  style={{ fontSize: `${productInfoTextSize.price}px` }}
                >
                  ¥10,000
                </p>
                <div className="mt-[2cm] mb-[2cm] flex w-full max-w-[18rem] items-center justify-start gap-6">
                  <p
                    className="font-semibold text-[#2f1b0f]"
                    style={{ fontSize: `${productInfoTextSize.sizeLabel}px` }}
                  >
                    サイズ
                  </p>
                  <p className="text-[#4a3121]" style={{ fontSize: `${productInfoTextSize.sizeValue}px` }}>
                    フリーサイズ
                  </p>
                </div>
              </div>

              <form className="mt-0">
                <div className="mx-auto flex w-full max-w-[22rem] items-center gap-5">
                  <div className="flex h-12 flex-1 items-center justify-between rounded-full border border-[#2f1b0f] bg-[#f6f1e7] px-4">
                    <button
                      type="button"
                      aria-label="数量を減らす"
                      onClick={decreaseQuantity}
                      disabled={quantity <= 1}
                      className="leading-none text-[#2f1b0f] transition hover:brightness-90 disabled:cursor-not-allowed disabled:opacity-100"
                      style={{
                        width: `${quantityButtonTuning.minus.size}px`,
                        height: `${quantityButtonTuning.minus.size}px`,
                        transform: `translate(${quantityButtonTuning.minus.x}px, ${quantityButtonTuning.minus.y}px)`,
                      }}
                    >
                      <span
                        aria-hidden="true"
                        className="mx-auto block rounded-full bg-current"
                        style={{
                          width: `${quantityButtonTuning.minus.lineWidth}px`,
                          height: `${quantityButtonTuning.minus.lineThickness}px`,
                        }}
                      />
                    </button>

                    <span className="min-w-[2ch] text-center text-2xl leading-none text-[#2f1b0f]">
                      {quantity}
                    </span>

                    <button
                      type="button"
                      aria-label="数量を増やす"
                      onClick={increaseQuantity}
                      disabled={quantity >= 10}
                      className="leading-none text-[#2f1b0f] transition hover:brightness-90 disabled:cursor-not-allowed disabled:opacity-100"
                      style={{
                        width: `${quantityButtonTuning.plus.size}px`,
                        height: `${quantityButtonTuning.plus.size}px`,
                        fontSize: `${quantityButtonTuning.plus.fontSize}px`,
                        transform: `translate(${quantityButtonTuning.plus.x}px, ${quantityButtonTuning.plus.y}px)`,
                      }}
                    >
                      +
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={handleAddToCart}
                    className="inline-flex h-12 flex-1 items-center justify-center rounded-full border border-[#2f1b0f] bg-[#f6f1e7] px-6 text-base font-semibold text-[#2f1b0f] transition hover:brightness-[0.99] active:brightness-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2f1b0f]/30"
                  >
                    カートに入れる
                  </button>
                </div>
                <p className="mt-5 text-base whitespace-nowrap text-[#4a3121]">
                  お届けまで2〜3週間ほどお時間をいただきます。
                </p>
              </form>
            </div>
          </aside>
        </div>

        <div className="text-center">
          <Link href="/on-line-store" className={`${bodySerif.className} text-lg underline text-[#4a3121]`}>
            商品一覧へ戻る
          </Link>
        </div>
      </div>

      {zoomImage ? (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4"
          onClick={() => setZoomImage(null)}
        >
          <div className="relative h-[85vh] w-[95vw] max-w-5xl bg-white">
            {isZoomPdf ? (
              <iframe
                src={`${zoomImage}${pdfEmbedParams}`}
                title="オリジナルエプロン拡大PDF"
                className="h-full w-[calc(100%+24px)] -ml-[12px] bg-white pointer-events-none"
              />
            ) : (
              <Image
                src={zoomImage}
                alt="オリジナルエプロン拡大画像"
                fill
                className="object-contain"
                sizes="95vw"
              />
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}

export default function ApronPurchasePage() {
  return (
    <Suspense fallback={<ApronPurchaseFallback />}>
      <ApronPurchaseContent />
    </Suspense>
  );
}
