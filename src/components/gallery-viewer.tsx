"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";

type GalleryItem = {
  id: string;
  url: string;
  caption: string;
};

type GallerySection = {
  key: string;
  label: string;
  items: GalleryItem[];
};

export function GalleryViewer({ sections }: { sections: GallerySection[] }) {
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const flatPhotos = useMemo(
    () =>
      sections.flatMap((section) =>
        section.items.map((photo) => ({
          ...photo,
          sectionLabel: section.label,
        }))
      ),
    [sections]
  );
  const selectedPhotoIndex = useMemo(() => {
    if (!selectedPhotoId) return -1;
    return flatPhotos.findIndex((photo) => photo.id === selectedPhotoId);
  }, [flatPhotos, selectedPhotoId]);
  const selectedPhoto = selectedPhotoIndex >= 0 ? flatPhotos[selectedPhotoIndex] : null;

  const closeModal = () => setSelectedPhotoId(null);

  function moveSelection(offset: number) {
    if (!selectedPhoto || flatPhotos.length < 2) return;

    const nextIndex = (selectedPhotoIndex + offset + flatPhotos.length) % flatPhotos.length;
    setSelectedPhotoId(flatPhotos[nextIndex].id);
  }

  useEffect(() => {
    if (!selectedPhotoId) return;
    if (selectedPhotoIndex >= 0) return;
    setSelectedPhotoId(null);
  }, [selectedPhotoId, selectedPhotoIndex]);

  useEffect(() => {
    if (!selectedPhoto) return;

    const bodyOverflow = document.body.style.overflow;
    const htmlOverflow = document.documentElement.style.overflow;
    const previousActiveElement =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setSelectedPhotoId(null);
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        if (flatPhotos.length < 2 || selectedPhotoIndex < 0) return;
        const nextIndex = (selectedPhotoIndex + 1) % flatPhotos.length;
        setSelectedPhotoId(flatPhotos[nextIndex].id);
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        if (flatPhotos.length < 2 || selectedPhotoIndex < 0) return;
        const nextIndex = (selectedPhotoIndex - 1 + flatPhotos.length) % flatPhotos.length;
        setSelectedPhotoId(flatPhotos[nextIndex].id);
        return;
      }

      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
        )
      );
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = bodyOverflow;
      document.documentElement.style.overflow = htmlOverflow;
      document.removeEventListener("keydown", onKeyDown);
      previousActiveElement?.focus();
    };
  }, [selectedPhoto, selectedPhotoIndex, flatPhotos]);

  return (
    <>
      {sections.map((section) => (
        <section key={section.key} className="space-y-3">
          <h2 className="text-xl font-semibold text-[#2f1b0f]">{section.label}</h2>
          {section.items.length === 0 ? (
            <p className="text-sm text-gray-600">写真準備中です。</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4">
              {section.items.map((photo) => (
                <button
                  key={photo.id}
                  type="button"
                  onClick={() => setSelectedPhotoId(photo.id)}
                  className="w-full space-y-2 text-left"
                  aria-label={`写真を拡大表示: ${photo.caption}`}
                  data-gallery-photo-button
                >
                  <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl">
                    <Image
                      src={photo.url}
                      alt={photo.caption}
                      fill
                      className="object-cover transition-transform duration-300 hover:scale-[1.02]"
                    />
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      ))}

      {selectedPhoto ? (
        <div
          className="fixed inset-0 z-[240] bg-black/75 px-3 py-4 md:px-8 md:py-6"
          role="dialog"
          ref={dialogRef}
          aria-modal="true"
          aria-label={`写真拡大: ${selectedPhoto.caption}`}
          onClick={closeModal}
          data-gallery-modal
        >
          <div className="flex h-full items-center justify-center">
            <div
              className="relative w-full max-w-6xl space-y-3"
              onClick={(event) => event.stopPropagation()}
              data-gallery-modal-content
            >
              <button
                type="button"
                ref={closeButtonRef}
                onClick={closeModal}
                className="absolute right-0 top-0 z-20 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-xl leading-none text-[#2f1b0f] shadow-md transition hover:bg-white"
                aria-label="閉じる"
              >
                ×
              </button>

              <div
                className="relative mx-auto w-full overflow-hidden rounded-2xl bg-black shadow-2xl"
                style={{ maxWidth: "min(92vw, calc(82vh * 4 / 3))", aspectRatio: "4 / 3" }}
              >
                <Image
                  src={selectedPhoto.url}
                  alt={selectedPhoto.caption}
                  fill
                  className="object-contain"
                  sizes="92vw"
                  priority
                />

                {flatPhotos.length > 1 ? (
                  <>
                    <button
                      type="button"
                      onClick={() => moveSelection(-1)}
                      className="absolute left-2 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-lg text-white transition hover:bg-black/70"
                      aria-label="前の写真"
                    >
                      ‹
                    </button>
                    <button
                      type="button"
                      onClick={() => moveSelection(1)}
                      className="absolute right-2 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-lg text-white transition hover:bg-black/70"
                      aria-label="次の写真"
                    >
                      ›
                    </button>
                  </>
                ) : null}
              </div>
              <p className="text-center text-sm text-white/90">
                {selectedPhoto.caption}
                <span className="ml-2 text-white/70">({selectedPhoto.sectionLabel})</span>
              </p>
              {flatPhotos.length > 1 ? (
                <p className="text-center text-xs tracking-[0.08em] text-white/65">
                  {selectedPhotoIndex + 1} / {flatPhotos.length}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
