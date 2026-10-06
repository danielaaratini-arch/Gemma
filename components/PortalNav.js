"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  ["/", "Gemma"],
  ["/cliente", "Area cliente"],
  ["/backoffice", "Backoffice"],
  ["/admin", "Admin"],
];

export default function PortalNav() {
  const pathname = usePathname();

  return (
    <nav className="portalNav" aria-label="Aree Gemma">
      {items.map(([href, label]) => (
        <Link
          key={href}
          href={href}
          className={
            "portalNavLink " +
            (pathname === href ? "portalNavLinkActive" : "")
          }
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
