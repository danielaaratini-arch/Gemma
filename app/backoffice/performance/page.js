"use client";

import { useEffect, useState } from "react";
import GemmaInternalAuth from "../../../components/GemmaInternalAuth";
import GemmaInternalNav from "../../../components/GemmaInternalNav";

function Body({ user, logout }) {
  const [data,setData]=useState(null);

  useEffect(()=>{
    void fetch("/api/gemma/backoffice/performance",{cache:"no-store"})
      .then(async r=>{const p=await r.json();if(!r.ok)throw new Error(p.error||"Errore");setData(p.performance);})
      .catch(()=>setData({average:null,totalRatings:0,distribution:{}}));
  },[]);

  return (
    <main className="internalPage">
      <GemmaInternalNav role={user.role} user={user} onLogout={logout}/>
      <section className="internalContent">
        <div className="internalTitleRow"><div><p className="internalEyebrow">Backoffice</p><h1>Performance</h1><p>Gradimento personale basato sulle valutazioni dei ticket gestiti.</p></div></div>
        <section className="statGrid">
          <article className="statCard"><span>Media</span><strong>{data?.average == null ? "—" : data.average+" / 5"}</strong></article>
          <article className="statCard"><span>Valutazioni</span><strong>{data?.totalRatings ?? 0}</strong></article>
        </section>
        <section className="adminPanel">
          <div className="panelTitle">Distribuzione</div>
          <div className="ratingDistribution">
            {[5,4,3,2,1].map(score=>{
              const count=Number(data?.distribution?.[String(score)]||0);
              const total=Number(data?.totalRatings||0);
              return <div className="ratingRow" key={score}><span>{score} ★</span><div><i style={{width: total ? ((count/total)*100)+"%" : "0%"}} /></div><strong>{count}</strong></div>;
            })}
          </div>
        </section>
      </section>
    </main>
  );
}

export default function PerformancePage(){
  return <GemmaInternalAuth requiredRole="STAFF">{({user,logout})=><Body user={user} logout={logout}/>}</GemmaInternalAuth>;
}
