import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { Noto_Serif_JP, Tangerine } from "next/font/google";
import { storeProducts } from "@/lib/store-products";

const headingFont = Tangerine({
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
});

const bodySerif = Noto_Serif_JP({
  subsets: ["latin"],
  weight: ["400", "600"],
});

const storeSpacing = { top: 132, bottom: 140 };
const menuHeadingSize = { base: 32, md: 60 };

export default function StorePage() {
  return (
    <section
      className="relative -mt-[var(--header-h)] w-screen bg-gradient-to-b from-[#fff9e4] via-[#F3E5AB] to-[#dcc06f] px-4 md:mt-0"
      style={{
        marginLeft: "calc(50% - 50vw)",
        marginRight: "calc(50% - 50vw)",
        paddingTop: `${storeSpacing.top}px`,
        paddingBottom: `${storeSpacing.bottom}px`,
      }}
    >
      <div className="mx-auto max-w-[76rem]">
        <header className="-mt-[30px] text-center md:mt-0">
          <h1
            className={`menu-heading-title font-semibold text-[#2f1b0f] ${headingFont.className}`}
            style={
              {
                "--menu-heading-size": `${menuHeadingSize.base}px`,
                "--menu-heading-size-md": `${menuHeadingSize.md}px`,
              } as Record<string, string>
            }
          >
            Item list
          </h1>
        </header>

        <div className="mt-6 grid gap-y-12 md:mx-auto md:max-w-[56rem] md:grid-cols-2 md:gap-x-6">
          {storeProducts.map((product, index) => {
            const isComingSoon = !product.href;
            const card = (
              <article
                className="text-center store-fade-up"
                style={{
                  animationDelay: `${index * 0.1}s`,
                }}
              >
                <div className="relative mx-auto aspect-[16/11] w-full max-w-[24rem] overflow-hidden rounded-sm bg-white">
                  {isComingSoon && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/35">
                      <span className="text-2xl font-semibold tracking-[0.14em] text-white">
                        準備中
                      </span>
                    </div>
                  )}
                  <Image
                    src={product.image}
                    alt={product.name}
                    fill
                    className={product.fit === "contain" ? "object-contain" : "object-cover"}
                    sizes="(max-width: 768px) 100vw, 33vw"
                  />
                </div>
                <div className={`${bodySerif.className} mt-4 space-y-2`}>
                  <p className="text-base font-semibold text-[#2f1b0f]">
                    {isComingSoon ? (
                      "準備中"
                    ) : (
                      <>
                        {product.name}
                        <span className="ml-2 text-sm font-medium text-[#6b4a2f]">
                          {product.count}
                        </span>
                      </>
                    )}
                  </p>
                  {!isComingSoon && (
                    <p className="text-sm tracking-[0.14em] text-[#4a3121]">
                      {product.price}
                    </p>
                  )}
                </div>
              </article>
            );

            if (product.href) {
              return (
                <Link
                  key={product.id}
                  href={product.href as Route}
                  className="block rounded-sm transition hover:opacity-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#6b4a2f]/30"
                  aria-label={`${product.name}の購入ページへ`}
                >
                  {card}
                </Link>
              );
            }

            return <div key={product.id}>{card}</div>;
          })}
        </div>
      </div>
    </section>
  );
}
