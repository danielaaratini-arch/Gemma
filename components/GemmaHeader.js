"use client";

import Link from "next/link";

export default function GemmaHeader() {
  return (
    <header className="gemmaPublicHeader">
      <div className="gemmaPublicHeaderInner">
        <Link href="/" className="gemmaLogo">
          <span className="gemmaLogoMain">TAAP</span>
          <span className="gemmaLogoSub">Powered by Smeraldo</span>
        </Link>

        <nav className="gemmaPublicNav" aria-label="Navigazione principale">
          <Link href="/" className="gemmaPublicNavLink">
            Home
          </Link>
          <Link href="/cliente" className="gemmaCustomerLink">
            Area cliente
          </Link>
        </nav>
      </div>
    </header>
  );
}
