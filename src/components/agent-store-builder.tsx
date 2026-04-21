"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { storeProducts } from "@/lib/store-products";

export function AgentStoreBuilder() {
  const defaultProductId =
    storeProducts.find((product) => product.agentHandoffPath)?.id ?? storeProducts[0]?.id ?? "";
  const [productId, setProductId] = useState(defaultProductId);
  const [quantity, setQuantity] = useState("1");
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");

  const selectedProduct =
    storeProducts.find((product) => product.id === productId) ?? storeProducts[0] ?? null;
  const handoffUrl = selectedProduct?.agentHandoffPath
    ? `${selectedProduct.agentHandoffPath}?mode=agent&qty=${quantity}`
    : "";

  async function handleCopy() {
    if (!handoffUrl) return;

    try {
      await navigator.clipboard.writeText(handoffUrl);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }

    window.setTimeout(() => {
      setCopyStatus("idle");
    }, 1800);
  }

  return (
    <div className="mt-5 rounded-2xl border border-[#cfa96d]/40 bg-[#fff7e6] p-4 text-sm text-[#4a3121]">
      <p className="font-semibold text-[#2f1b0f]">Store handoff builder</p>
      <p className="mt-2 leading-6">
        This keeps the store flow in warm handoff mode. Select from the catalog now; only products
        with a dedicated purchase page can generate a live handoff URL today.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="agent-store-product">Product</Label>
          <select
            id="agent-store-product"
            value={productId}
            onChange={(event) => setProductId(event.target.value)}
            className="h-10 rounded-md border border-[#b9965a] bg-white px-3 text-sm text-[#2f1b0f] focus:outline-none focus:ring-2 focus:ring-[#8a6233]/25"
          >
            {storeProducts.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="agent-store-quantity">Quantity</Label>
          <select
            id="agent-store-quantity"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            className="h-10 rounded-md border border-[#b9965a] bg-white px-3 text-sm text-[#2f1b0f] focus:outline-none focus:ring-2 focus:ring-[#8a6233]/25"
          >
            {Array.from({ length: 10 }, (_, index) => `${index + 1}`).map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-4 grid gap-2">
        <Label htmlFor="agent-store-handoff-url">Generated handoff URL</Label>
        <Input
          id="agent-store-handoff-url"
          readOnly
          value={handoffUrl || "No handoff route configured for this product yet"}
          className="border-[#b9965a] bg-white text-xs"
        />
      </div>

      {selectedProduct && !selectedProduct.agentHandoffPath ? (
        <p className="mt-3 text-xs leading-6 text-[#7a5528]">
          `{selectedProduct.name}` は商品一覧にはありますが、個別の購入ページが未実装のため、
          まだ handoff URL を生成できません。
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <a
          href={handoffUrl || "#"}
          aria-disabled={!handoffUrl}
          className={[
            "inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-semibold transition",
            handoffUrl
              ? "bg-[#2f1b0f] text-white hover:brightness-110"
              : "cursor-not-allowed bg-[#b8a894] text-white/85",
          ].join(" ")}
          onClick={(event) => {
            if (!handoffUrl) event.preventDefault();
          }}
        >
          Open Handoff
        </a>
        <button
          type="button"
          onClick={handleCopy}
          disabled={!handoffUrl}
          className={[
            "inline-flex items-center justify-center rounded-full border px-4 py-2 text-sm font-semibold transition",
            handoffUrl
              ? "border-[#2f1b0f] text-[#2f1b0f] hover:bg-white/70"
              : "cursor-not-allowed border-[#b8a894] text-[#8c7c68]",
          ].join(" ")}
        >
          Copy URL
        </button>
        {copyStatus === "copied" ? <span className="text-xs text-[#7b5a2d]">Copied</span> : null}
        {copyStatus === "failed" ? (
          <span className="text-xs text-[#9f2b2b]">Copy failed</span>
        ) : null}
      </div>
    </div>
  );
}
