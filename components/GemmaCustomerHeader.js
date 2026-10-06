"use client";

import Link from "next/link";

export default function GemmaCustomerHeader({ user, onLogout }) {
  return (
    <header className="gemmaCustomerHeader">
      <div className="gemmaCustomerHeaderCard">
        <div className="gemmaCustomerHeaderMain">
          <Link href="/cliente" className="gemmaCustomerBrand">
            <span>TAAP</span>
            <small>Powered by Smeraldo</small>
          </Link>

          <div className="gemmaCustomerTitle">
            <div>
              <h1>Cliente</h1>
              <span>{user?.name || "Area cliente Gemma"}</span>
            </div>
            <p>Consulta i tuoi ticket e dialoga con l&apos;assistenza.</p>
          </div>
        </div>

        <div className="gemmaCustomerHeaderActions">
          <Link href="/">Torna a Gemma</Link>
          <button type="button" onClick={onLogout}>
            Esci
          </button>
        </div>
      </div>
    </header>
  );
}
