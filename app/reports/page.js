"use client";

import { useEffect, useState } from "react";
import GemmaInternalAuth from "../../components/GemmaInternalAuth";
import GemmaInternalNav from "../../components/GemmaInternalNav";

function ReportsBody({ user, logout }) {
  const [data,setData]=useState(null);
  const [error,setError]=useState("");

  async function load(){
    try{
      const response=await fetch("/api/gemma/reports",{cache:"no-store"});
      const payload=await response.json();
      if(!response.ok) throw new Error(payload?.error||"Report non disponibile.");
      setData(payload);
    }catch(caught){setError(caught instanceof Error?caught.message:"Report non disponibile.");}
  }

  useEffect(()=>{void load();},[]);

  return (
    <main className="internalPage">
      <GemmaInternalNav role={user.role} user={user} onLogout={logout}/>
      <section className="internalContent">
        <div className="internalTitleRow">
          <div><p className="internalEyebrow">Reporting operativo</p><h1>Report</h1><p>Distribuzione reale dei ticket Gemma per stato, reparto, priorità e ultimi 30 giorni.</p></div>
          <button className="internalRefresh" onClick={()=>void load()}>Aggiorna</button>
        </div>
        {error?<div className="internalError">{error}</div>:null}

        <div className="adminColumns">
          <section className="adminPanel"><div className="panelTitle">Per stato</div><div className="metricList">{(data?.status||[]).map(item=><div className="metricRow" key={item.status}><span>{item.status}</span><strong>{item.count}</strong></div>)}</div></section>
          <section className="adminPanel"><div className="panelTitle">Per reparto</div><div className="metricList">{(data?.department||[]).map(item=><div className="metricRow" key={item.department}><span>{item.department}</span><strong>{item.count}</strong></div>)}</div></section>
        </div>

        <div className="adminColumns recentPanel">
          <section className="adminPanel"><div className="panelTitle">Per priorità</div><div className="metricList">{(data?.priority||[]).map(item=><div className="metricRow" key={item.priority}><span>{item.priority}</span><strong>{item.count}</strong></div>)}</div></section>
          <section className="adminPanel"><div className="panelTitle">Ticket aperti negli ultimi 30 giorni</div><div className="metricList reportDaily">{(data?.daily||[]).map(item=><div className="metricRow" key={String(item.day)}><span>{new Date(item.day).toLocaleDateString("it-IT")}</span><strong>{item.count}</strong></div>)}</div></section>
        </div>
      </section>
    </main>
  );
}

export default function ReportsPage(){
  return <GemmaInternalAuth requiredRole="STAFF">{({user,logout})=><ReportsBody user={user} logout={logout}/>}</GemmaInternalAuth>;
}
