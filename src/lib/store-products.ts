export type StoreProduct = {
  id: string;
  name: string;
  count: string;
  priceYen: number;
  price: string;
  isPublished: boolean;
  image: string;
  fit?: "contain" | "cover";
  href?: string;
  agentHandoffPath?: string;
};

export function formatStoreProductPrice(priceYen: number): string {
  return `¥${priceYen.toLocaleString("ja-JP")}`;
}

function createStoreProduct(
  product: Omit<StoreProduct, "price">
): StoreProduct {
  return {
    ...product,
    price: formatStoreProductPrice(product.priceYen),
  };
}

export const storeProducts: StoreProduct[] = [
  createStoreProduct({
    id: "apron",
    name: "オリジナルエプロン",
    count: "",
    priceYen: 10000,
    isPublished: true,
    image: "/photos/online%20store/エプロン.jpg",
    fit: "contain",
    href: "/on-line-store/apron",
    agentHandoffPath: "/on-line-store/apron",
  }),
  createStoreProduct({
    id: "shokupan",
    name: "食パンセット",
    count: "3個",
    priceYen: 2376,
    isPublished: false,
    image:
      "https://images.unsplash.com/photo-1549931319-a545dcf3bc73?auto=format&fit=crop&w=1200&q=80",
  }),
  createStoreProduct({
    id: "popular",
    name: "人気パンセット",
    count: "10個",
    priceYen: 3024,
    isPublished: false,
    image:
      "https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=1200&q=80",
  }),
];

export function getStoreProduct(id: string): StoreProduct | null {
  return storeProducts.find((product) => product.id === id) ?? null;
}

export function getPublishedStoreProduct(id: string): StoreProduct | null {
  const product = getStoreProduct(id);
  return product?.isPublished ? product : null;
}
