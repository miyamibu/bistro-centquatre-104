type DiagonalTwoToneBackgroundProps = {
  creamColor?: string;
  wineColor?: string;
  clipPathPolygon?: string;
  showRightBanner?: boolean;
  bannerWidth?: number;
  bannerHeight?: number;
  bannerTop?: number;
};

export function DiagonalTwoToneBackground({
  creamColor = "#f4efe6",
  wineColor = "#6b0f1a",
  clipPathPolygon = "polygon(0 68%, 100% 52%, 100% 100%, 0 100%)",
  showRightBanner = false,
  bannerWidth = 44,
  bannerHeight = 280,
  bannerTop = 96,
}: DiagonalTwoToneBackgroundProps) {
  return (
    <div className="pointer-events-none absolute inset-0 z-0">
      <div className="absolute inset-0" style={{ background: creamColor }} />
      <div
        className="absolute inset-0"
        style={{
          background: wineColor,
          clipPath: clipPathPolygon,
        }}
      />
      {showRightBanner && (
        <div
          className="absolute right-0"
          style={{
            top: `${bannerTop}px`,
            width: `${bannerWidth}px`,
            height: `${bannerHeight}px`,
            background: wineColor,
          }}
        />
      )}
    </div>
  );
}
