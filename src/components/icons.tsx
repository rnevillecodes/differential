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

/**
 * The differential mark: the app icon's overlapping old (red, −) and new (green, +)
 * squares, without the icon's light tile so it sits on either theme.
 * Source: src-tauri/icons/app-icon.svg.
 */
export function LogoMark({ size = 18, title, ...props }: IconProps & { size?: number; title?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="176 176 672 672"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
      {...props}
    >
      <rect x="176" y="176" width="464" height="464" rx="96" fill="#E5484D" />
      <rect x="384" y="384" width="464" height="464" rx="96" fill="#2FBF7A" />
      <path d="M480 384 H640 V544 A96 96 0 0 1 544 640 H384 V480 A96 96 0 0 1 480 384 Z" fill="#18181B" />
      <rect x="216" y="258" width="128" height="48" rx="24" fill="#FFFFFF" />
      <rect x="680" y="718" width="128" height="48" rx="24" fill="#FFFFFF" />
      <rect x="720" y="678" width="48" height="128" rx="24" fill="#FFFFFF" />
    </svg>
  );
}

/** A window with a left panel: show or hide the sidebar. */
export function SidebarIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5" />
      <path d="M6 2.75v10.5" />
    </Icon>
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

export function CheckIcon(props: IconProps) {
  return (
    <Icon width={12} height={12} {...props}>
      <path d="M3 8.5l3.5 3.5L13 4.5" />
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
