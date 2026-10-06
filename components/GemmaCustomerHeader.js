"use client";

import Link from "next/link";

export default function GemmaCustomerHeader() {
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
              <span>Area cliente Gemma</span>
            </div>
            <p>Consulta i tuoi ticket e dialoga con l&apos;assistenza.</p>
          </div>
        </div>

        <div className="gemmaCustomerHeaderActions">
          <Link href="/">Torna a Gemma</Link>
          <Link href="/backoffice">Backoffice</Link>
          <Link href="/admin">Admin</Link>
        </div>
      </div>
    </header>
  );
}
