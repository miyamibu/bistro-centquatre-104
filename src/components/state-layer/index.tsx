import "@/components/state-layer/state-layer.css";

export interface LkStateLayerProps {
  bgColor?: LkColor | "currentColor";
  forcedState?: "hover" | "active" | "focus"; // Used when you need a static state controlled by something higher, like a select field that keeps actively-selected options grayed out
}

export default function StateLayer({ bgColor = "currentColor", forcedState }: LkStateLayerProps) {
  const stateLayerStyle =
    bgColor === "currentColor"
      ? { backgroundColor: "currentColor" }
      : { backgroundColor: `var(--lk-${bgColor})` };

  return (
    <>
      <div
        data-lk-component="state-layer"
        style={stateLayerStyle}
        {...(forcedState && { "data-lk-forced-state": forcedState })}
      ></div>
    </>
  );
}
