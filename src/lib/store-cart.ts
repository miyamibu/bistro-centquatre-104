"use client";

export interface StoreCartItem {
  id: string;
  name: string;
  price: number;
  image: string;
  quantity: number;
}

const STORAGE_KEY = "bistro_store_cart";

/**
 * Format amount to Japanese Yen string (e.g., "¥10,000")
 */
export function formatYen(amount: number): string {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * Get all cart items from localStorage
 */
export function getCartItems(): StoreCartItem[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    console.error("Failed to parse cart from localStorage");
    return [];
  }
}

/**
 * Save cart items to localStorage
 */
function saveCart(items: StoreCartItem[]): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    const serialized = JSON.stringify(items);
    localStorage.setItem(STORAGE_KEY, serialized);
    return localStorage.getItem(STORAGE_KEY) === serialized;
  } catch {
    console.error("Failed to save cart to localStorage");
    return false;
  }
}

export function restoreCartItems(items: StoreCartItem[]): boolean {
  return saveCart(items);
}

export type StoredCartReadResult =
  | { ok: true; items: StoreCartItem[] }
  | { ok: false };

export function readStoredCartItemsForRestore(): StoredCartReadResult {
  if (typeof window === "undefined") return { ok: false };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ok: true, items: [] };
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return { ok: false };

    const items: StoreCartItem[] = [];
    for (const item of parsed) {
      if (
        !item ||
        typeof item !== "object" ||
        typeof item.id !== "string" ||
        typeof item.name !== "string" ||
        typeof item.price !== "number" ||
        !Number.isFinite(item.price) ||
        typeof item.image !== "string" ||
        typeof item.quantity !== "number" ||
        !Number.isInteger(item.quantity)
      ) {
        return { ok: false };
      }
      items.push(item as StoreCartItem);
    }
    return { ok: true, items };
  } catch {
    return { ok: false };
  }
}

/**
 * Add item to cart or increase quantity if already exists
 */
export function addToCart(
  product: Omit<StoreCartItem, "quantity">,
  quantity: number = 1
): void {
  const items = getCartItems();
  const existing = items.find((item) => item.id === product.id);

  if (existing) {
    existing.quantity += quantity;
  } else {
    items.push({
      ...product,
      quantity,
    });
  }

  saveCart(items);
}

/**
 * Remove item from cart by ID
 */
export function removeFromCart(itemId: string): void {
  const items = getCartItems();
  const filtered = items.filter((item) => item.id !== itemId);
  saveCart(filtered);
}

/**
 * Clear all items from cart
 */
export function clearCart(): boolean {
  return saveCart([]);
}

/**
 * Get total cart value
 */
export function getCartTotal(): number {
  return getCartItems().reduce((sum, item) => sum + item.price * item.quantity, 0);
}

/**
 * Get total item count
 */
export function getCartItemCount(): number {
  return getCartItems().reduce((sum, item) => sum + item.quantity, 0);
}
