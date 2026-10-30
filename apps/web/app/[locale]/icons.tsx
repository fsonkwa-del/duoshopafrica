import type { ReactNode } from "react";

// Icônes au trait (SVG en ligne, décoratives : le texte ou aria-label porte le sens).
function Icon({ children, size = 24 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const CartIcon = () => (
  <Icon>
    <path d="M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h9.2a1 1 0 0 0 1-.8L20 8H6.2" />
    <circle cx="9.5" cy="19.5" r="1.3" />
    <circle cx="17" cy="19.5" r="1.3" />
  </Icon>
);
export const BellIcon = () => (
  <Icon>
    <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15Z" />
    <path d="M10 20a2 2 0 0 0 4 0" />
  </Icon>
);
export const OrdersIcon = () => (
  <Icon>
    <rect x="5" y="4" width="14" height="17" rx="2" />
    <path d="M9 4.5h6M9 10h6M9 14h6M9 18h3" />
  </Icon>
);
export const UserIcon = () => (
  <Icon>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </Icon>
);
export const GlobeIcon = ({ size }: { size?: number }) => (
  <Icon size={size ?? 22}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18" />
  </Icon>
);
export const MenuIcon = () => (
  <Icon size={18}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Icon>
);
export const ChevronIcon = () => (
  <Icon size={18}>
    <path d="m9 6 6 6-6 6" />
  </Icon>
);
export const ArrowUpIcon = () => (
  <Icon>
    <path d="M5 4h14M12 20V9M7 13l5-5 5 5" />
  </Icon>
);
export const SearchIcon = () => (
  <Icon size={20}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4 4" />
  </Icon>
);
export const ShieldIcon = () => (
  <Icon>
    <path d="M12 3 5 6v5c0 4.5 3 8.4 7 10 4-1.6 7-5.5 7-10V6Z" />
    <path d="m9 12 2 2 4-4" />
  </Icon>
);
export const StoreIcon = () => (
  <Icon>
    <path d="M4 10v10h16V10M3 6l2-3h14l2 3v2a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0Z" />
    <path d="M10 20v-5h4v5" />
  </Icon>
);
export const TagIcon = () => (
  <Icon>
    <path d="M3 12V4h8l9 9-8 8Z" />
    <circle cx="7.5" cy="7.5" r="1.2" />
  </Icon>
);
export const PinIcon = () => (
  <Icon size={18}>
    <path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12Z" />
    <circle cx="12" cy="9" r="2.5" />
  </Icon>
);

// Pictogrammes des rubriques (taxonomie de départ) ; étiquette par défaut sinon.
const categoryPaths: Record<string, ReactNode> = {
  mode: <path d="M8 3 4 6l2 4 2-1v12h8V9l2 1 2-4-4-3a4 4 0 0 1-8 0Z" />,
  alimentation: (
    <>
      <path d="M4 10h16l-2 10H6Z" />
      <path d="m8 10 3-6M16 10l-3-6" />
    </>
  ),
  beaute: (
    <>
      <path d="M9 3h6v4H9Z" />
      <rect x="7" y="7" width="10" height="14" rx="2" />
    </>
  ),
  maison: (
    <>
      <path d="m3 11 9-7 9 7" />
      <path d="M5 10v10h14V10" />
    </>
  ),
  artisanat: (
    <>
      <path d="M8 3h8l-1 4c3 2 4 5 3 9a6 6 0 0 1-12 0c-1-4 0-7 3-9Z" />
    </>
  ),
  electronique: (
    <>
      <rect x="7" y="2.5" width="10" height="19" rx="2" />
      <path d="M11 18.5h2" />
    </>
  ),
};
export function CategoryIcon({ slug }: { slug: string }) {
  const path = categoryPaths[slug];
  return path ? <Icon>{path}</Icon> : <TagIcon />;
}
