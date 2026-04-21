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
function saveCart(items: StoreCartItem[]): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    console.error("Failed to save cart to localStorage");
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
export function clearCart(): void {
  saveCart([]);
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
