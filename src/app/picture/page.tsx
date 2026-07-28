import type { Metadata } from "next";
import { Socket } from "node:net";
import { Tangerine } from "next/font/google";
import { prisma } from "@/lib/prisma";
import { GalleryViewer } from "@/components/gallery-viewer";
import { createPageMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";
export const metadata: Metadata = createPageMetadata("/picture");

const PHOTO_CATEGORIES = [
  { key: "food", label: "料理" },
  { key: "drink", label: "飲み物" },
  { key: "interior", label: "内装" },
  { key: "exterior", label: "外装" },
] as const;

type PhotoCategoryKey = (typeof PHOTO_CATEGORIES)[number]["key"];

type GalleryPhoto = {
  id: string;
  url: string;
  caption: string;
  category: PhotoCategoryKey;
  sortOrder: number;
};

const CURATED_FOOD_PHOTOS: GalleryPhoto[] = [
  { id: "curated-food-1", url: "/photos/料理/料理１.JPG", caption: "料理１", category: "food", sortOrder: 1 },
  { id: "curated-food-2", url: "/photos/料理/料理２.JPG", caption: "料理２", category: "food", sortOrder: 2 },
  { id: "curated-food-3", url: "/photos/料理/料理３.JPG", caption: "料理３", category: "food", sortOrder: 3 },
  { id: "curated-food-4", url: "/photos/料理/料理４.JPG", caption: "料理４", category: "food", sortOrder: 4 },
];

const CURATED_INTERIOR_PHOTOS: GalleryPhoto[] = [
  { id: "curated-interior-1", url: "/photos/内装/内装1.JPG", caption: "内装1", category: "interior", sortOrder: 1 },
  { id: "curated-interior-2", url: "/photos/内装/内装2.JPG", caption: "内装2", category: "interior", sortOrder: 2 },
  { id: "curated-interior-3", url: "/photos/内装/内装２.JPG", caption: "内装２", category: "interior", sortOrder: 3 },
  { id: "curated-interior-4", url: "/photos/内装/内装３.JPG", caption: "内装３", category: "interior", sortOrder: 4 },
];

const CURATED_EXTERIOR_PHOTOS: GalleryPhoto[] = [
  { id: "curated-exterior-1", url: "/photos/外装/外観1.JPG", caption: "外観1", category: "exterior", sortOrder: 1 },
  { id: "curated-exterior-4", url: "/photos/外装/外観4.JPG", caption: "外観4", category: "exterior", sortOrder: 4 },
  { id: "curated-exterior-5", url: "/photos/外装/外観5.JPG", caption: "外観5", category: "exterior", sortOrder: 5 },
  { id: "curated-exterior-6", url: "/photos/外装/外観6.JPG", caption: "外観6", category: "exterior", sortOrder: 6 },
];

const FALLBACK_PHOTOS: GalleryPhoto[] = [
];

const CATEGORY_ALIASES: Record<PhotoCategoryKey, string[]> = {
  food: ["food", "料理", "dish", "meal", "course", "dessert"],
  drink: ["drink", "drinks", "飲み物", "ドリンク", "wine", "cocktail", "beverage"],
  interior: ["interior", "内装", "店内", "厨房", "キッチン", "counter", "bar"],
  exterior: ["exterior", "外装", "外観", "入口", "玄関", "facade", "outside"],
};

const headingFont = Tangerine({
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
});

const menuHeadingSize = { base: 32, md: 60 };

function safeDecodeUrl(url: string) {
  try {
    return decodeURIComponent(url);
  } catch {
    return url;
  }
}

function normalizePhotoCategory(value: string | null | undefined, caption: string, url: string): PhotoCategoryKey {
  const normalized = `${value ?? ""} ${caption} ${safeDecodeUrl(url)}`.toLowerCase();

  if (CATEGORY_ALIASES.exterior.some((keyword) => normalized.includes(keyword.toLowerCase()))) {
    return "exterior";
  }

  if (CATEGORY_ALIASES.interior.some((keyword) => normalized.includes(keyword.toLowerCase()))) {
    return "interior";
  }

  if (CATEGORY_ALIASES.drink.some((keyword) => normalized.includes(keyword.toLowerCase()))) {
    return "drink";
  }

  if (CATEGORY_ALIASES.food.some((keyword) => normalized.includes(keyword.toLowerCase()))) {
    return "food";
  }

  if (value === "exterior") {
    return "exterior";
  }

  if (value === "interior" || value === "kitchen") {
    return "interior";
  }

  if (value === "drink") {
    return "drink";
  }

  return "food";
}

function sortGalleryPhotos(a: GalleryPhoto, b: GalleryPhoto) {
  if (a.sortOrder !== b.sortOrder) {
    return a.sortOrder - b.sortOrder;
  }

  return a.caption.localeCompare(b.caption, "ja");
}

async function canReachDatabase(databaseUrl: string | undefined) {
  if (!databaseUrl || !/^(postgres|postgresql):\/\//.test(databaseUrl)) {
    return false;
  }

  try {
    const { hostname, port } = new URL(databaseUrl);
    const socket = new Socket();

    return await new Promise((resolve) => {
      const finish = (result: boolean) => {
        socket.removeAllListeners();
        socket.destroy();
        resolve(result);
      };

      socket.setTimeout(400);
      socket.once("connect", () => finish(true));
      socket.once("timeout", () => finish(false));
      socket.once("error", () => finish(false));
      socket.connect(Number(port || "5432"), hostname);
    });
  } catch {
    return false;
  }
}

export default async function PhotosPage() {
  const photosTopPaddingMobile = "56px";
  const photosTopPaddingDesktop = "124px";
  const canQueryDatabase = await canReachDatabase(process.env.DATABASE_URL);
  const dbPhotos = canQueryDatabase
    ? await prisma.photo
        .findMany({
          where: { isPublished: true },
          orderBy: { sortOrder: "asc" },
        })
        .catch((error) => {
          console.error("Failed to load photos", error);
          return [];
        })
    : [];

  const normalizedDbPhotos: GalleryPhoto[] = dbPhotos.map((photo) => ({
    id: photo.id,
    url: photo.url,
    caption: photo.caption,
    category: normalizePhotoCategory(photo.category, photo.caption, photo.url),
    sortOrder: photo.sortOrder,
  }));

  const existingUrls = new Set(normalizedDbPhotos.map((photo) => photo.url));
  const galleryPhotos = [
    ...normalizedDbPhotos,
    ...FALLBACK_PHOTOS.filter((photo) => !existingUrls.has(photo.url)),
  ];
  const gallerySections = PHOTO_CATEGORIES.map((category) => ({
    key: category.key,
    label: category.label,
    items:
      category.key === "food"
        ? CURATED_FOOD_PHOTOS.map((photo) => ({
            id: photo.id,
            url: photo.url,
            caption: photo.caption,
          }))
        : category.key === "interior"
          ? CURATED_INTERIOR_PHOTOS.map((photo) => ({
              id: photo.id,
              url: photo.url,
              caption: photo.caption,
            }))
          : category.key === "exterior"
            ? CURATED_EXTERIOR_PHOTOS.map((photo) => ({
                id: photo.id,
                url: photo.url,
                caption: photo.caption,
              }))
        : galleryPhotos
            .filter((photo) => photo.category === category.key)
            .sort(sortGalleryPhotos)
            .map((photo) => ({
              id: photo.id,
              url: photo.url,
              caption: photo.caption,
            })),
  }));

  return (
    <div
      className="space-y-8 pt-[var(--photos-top-padding-mobile)] md:pt-[var(--photos-top-padding-desktop)]"
      style={{
        "--photos-top-padding-mobile": photosTopPaddingMobile,
        "--photos-top-padding-desktop": photosTopPaddingDesktop,
      } as Record<string, string>}
    >
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
          GALLERY
        </h1>
      </header>
      <GalleryViewer sections={gallerySections} />
    </div>
  );
}
