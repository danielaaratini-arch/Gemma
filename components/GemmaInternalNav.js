"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const adminItems = [
  ["/admin", "Dashboard"],
  ["/backoffice", "Backoffice"],
  ["/admin/users", "Accessi"],
  ["/admin/faults", "Alert fault"],
  ["/admin/memory", "Memory"],
  ["/admin/ai-router", "AI Router"],
  ["/admin/gradimento", "Gradimento"],
  ["/admin/knowledge", "Knowledge"],
  ["/conversations", "Conversazioni"],
  ["/reports", "Report"],
];

const operatorItems = [
  ["/backoffice", "Ticket"],
  ["/backoffice/performance", "Performance"],
  ["/conversations", "Conversazioni"],
  ["/reports", "Report"],
];

export default function GemmaInternalNav({ role, user, onLogout }) {
  const pathname = usePathname();
  const items = role === "ADMIN" ? adminItems : operatorItems;

  return (
    <header className="internalHeader">
      <div className="internalHeaderBrand">
        <Link href="/" className="gemmaLogo">
          <span className="gemmaLogoMain">TAAP</span>
          <span className="gemmaLogoSub">Gemma · Powered by Smeraldo</span>
        </Link>
        <div className="internalHeaderIdentity">
          <strong>{role === "ADMIN" ? "Amministrazione" : "Backoffice"}</strong>
          <span>{user?.name || user?.email || "Utente"}</span>
        </div>
      </div>

      <nav className="internalNav">
        {items.map(([href, label]) => (
          <Link
            key={href}
            href={href}
            className={
              pathname === href
                ? "internalNavLink active"
                : "internalNavLink"
            }
          >
            {label}
          </Link>
        ))}
      </nav>

      <button className="internalLogout" type="button" onClick={onLogout}>
        Esci
      </button>
    </header>
  );
}
