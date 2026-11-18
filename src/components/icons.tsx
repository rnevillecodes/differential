import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

/** A diff: plus over minus inside a page. */
export function ChangesIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 1.75h5.5L12.5 4.75v9.5H4z" />
      <path d="M8.25 5.5v3.5M6.5 7.25h3.5M6.5 11.25h3.5" />
    </Icon>
  );
}

/** A folder. */
export function FilesIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M1.75 4.25v8.5h12.5v-7H8L6.5 3.25H1.75z" />
    </Icon>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Icon width={12} height={12} {...props}>
      <path d="M4 6l4 4 4-4" />
    </Icon>
  );
}

/** An open folder. */
export function FolderOpenIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M1.75 12.75V3.25H6.5L8 4.75h5.25v2.5" />
      <path d="M1.75 12.75l2-5.5h10.5l-2 5.5z" />
    </Icon>
  );
}

/** Stacked chevrons pointing inward: collapse all. */
export function CollapseAllIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 2.5l3 3 3-3M5 13.5l3-3 3 3" />
    </Icon>
  );
}
