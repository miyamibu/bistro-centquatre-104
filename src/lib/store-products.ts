export type StoreProduct = {
  id: string;
  name: string;
  count: string;
  price: string;
  image: string;
  fit?: "contain" | "cover";
  href?: string;
  agentHandoffPath?: string;
};

export const storeProducts: StoreProduct[] = [
  {
    id: "apron",
    name: "オリジナルエプロン",
    count: "",
    price: "¥10,000",
    image: "/photos/online%20store/エプロン.jpg",
    fit: "contain",
    href: "/on-line-store/apron",
    agentHandoffPath: "/on-line-store/apron",
  },
  {
    id: "shokupan",
    name: "食パンセット",
    count: "3個",
    price: "¥2,376",
    image:
      "https://images.unsplash.com/photo-1549931319-a545dcf3bc73?auto=format&fit=crop&w=1200&q=80",
  },
  {
    id: "popular",
    name: "人気パンセット",
    count: "10個",
    price: "¥3,024",
    image:
      "https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=1200&q=80",
  },
];
