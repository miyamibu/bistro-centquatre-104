import dynamicIconImports from "lucide-react/dynamicIconImports";
import dynamic from "next/dynamic";
import { useMemo } from "react";
import "@/components/icon/icon.css";

export type IconName = keyof typeof dynamicIconImports;

export interface LkIconProps extends React.HTMLAttributes<HTMLElement> {
  name?: IconName;
  fontClass?: Exclude<LkFontClass, `${string}-bold` | `${string}-mono`>;
  color?: LkColor | "currentColor";
  display?: "block" | "inline-block" | "inline";
  strokeWidth?: number;
  opticShift?: boolean; //if true, pulls icon slightly upward
}

export default function Icon({
  name = "roller-coaster",
  fontClass,
  color = "onsurface",
  strokeWidth = 2,
  opticShift = false,
  ...restProps
}: LkIconProps) {
  const IconComponent = useMemo(
    () => dynamic(dynamicIconImports[name] ?? dynamicIconImports.circle),
    [name]
  );

  return (
    <div data-lk-component="icon" data-lk-icon-offset={opticShift} {...restProps} data-lk-icon-font-class={fontClass} >
      <IconComponent
        width="1em"
        height="1em"
        color={color === "currentColor" ? "currentColor" : `var(--lk-${color})`}
        strokeWidth={strokeWidth}
      />
    </div>
  );
}
