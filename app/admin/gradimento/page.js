"use client";

import { useEffect, useState } from "react";
import GemmaInternalAuth from "../../../components/GemmaInternalAuth";
import GemmaInternalNav from "../../../components/GemmaInternalNav";

function Body({ user, logout }) {
  const [data,setData]=useState(null);

  useEffect(()=>{
    void fetch("/api/gemma/admin/performance",{cache:"no-store"})
      .then(async r=>{const p=await r.json();if(!r.ok)throw new Error(p.error||"Errore");setData(p.performance);})
      .catch(()=>setData({general:{average:null,totalRatings:0,distribution:{}},operators:[]}));
  },[]);

  return (
    <main className="internalPage">
      <GemmaInternalNav role="ADMIN" user={user} onLogout={logout}/>
      <section className="internalContent">
        <div className="internalTitleRow"><div><p className="internalEyebrow">Qualità percepita</p><h1>Gradimento servizio</h1><p>Valutazioni dei ticket risolti, aggregate e per operatore.</p></div></div>
        <section className="statGrid">
          <article className="statCard"><span>Media generale</span><strong>{data?.general?.average == null ? "—" : data.general.average+" / 5"}</strong></article>
          <article className="statCard"><span>Valutazioni</span><strong>{data?.general?.totalRatings ?? 0}</strong></article>
        </section>
        <section className="adminPanel">
          <div className="panelTitle">Per operatore</div>
          <div className="adminTable performanceTable">
            <div className="adminTableHead"><span>Operatore</span><span>Media</span><span>Valutazioni</span></div>
            {(data?.operators||[]).map(item=>(
              <div className="adminTableRow" key={item.name}><span>{item.name}</span><span>{item.average == null ? "—" : item.average+" / 5"}</span><span>{item.totalRatings}</span></div>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}

export default function SatisfactionPage(){
  return <GemmaInternalAuth requiredRole="ADMIN">{({user,logout})=><Body user={user} logout={logout}/>}</GemmaInternalAuth>;
}
