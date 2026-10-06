"use client";

import { useEffect, useState } from "react";

export default function GemmaInternalAuth({
  requiredRole = "STAFF",
  children,
}) {
  const [state, setState] = useState({
    loading: true,
    user: null,
    adminExists: true,
  });
  const [mode, setMode] = useState("LOGIN");
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function refresh() {
    setState((current) => ({ ...current, loading: true }));
    try {
      const response = await fetch("/api/gemma/auth/session", {
        cache: "no-store",
      });
      const data = await response.json();
      setState({
        loading: false,
        user: data?.user || null,
        adminExists: data?.adminExists !== false,
      });
      return data?.user || null;
    } catch {
      setState({ loading: false, user: null, adminExists: true });
      return null;
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const allowed =
    state.user &&
    (requiredRole === "ADMIN"
      ? state.user.role === "ADMIN"
      : ["ADMIN", "OPERATOR"].includes(state.user.role));

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      const setup = !state.adminExists && requiredRole === "ADMIN";
      const response = await fetch(
        setup
          ? "/api/gemma/auth/bootstrap-admin"
          : "/api/gemma/auth/login",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...form,
            mode: requiredRole === "ADMIN" ? "ADMIN" : "STAFF",
          }),
        },
      );
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "Accesso non riuscito.");
      }

      await refresh();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Accesso non riuscito.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await fetch("/api/gemma/auth/logout", { method: "POST" });
    await refresh();
  }

  if (state.loading) {
    return <div className="internalAuthLoading">Verifica accesso…</div>;
  }

  if (!allowed) {
    const setup = !state.adminExists && requiredRole === "ADMIN";

    return (
      <main className="internalAuthPage">
        <section className="internalAuthCard">
          <div className="brand">
            TAAP <span>Gemma</span>
          </div>
          <p className="internalAuthEyebrow">
            {requiredRole === "ADMIN" ? "Amministrazione" : "Backoffice"}
          </p>
          <h1>
            {setup
              ? "Configura il primo amministratore"
              : "Accedi all’area interna"}
          </h1>
          <p>
            {setup
              ? "Questo passaggio è disponibile solo finché non esiste un amministratore Gemma."
              : requiredRole === "ADMIN"
                ? "Accesso riservato agli amministratori."
                : "Accesso riservato ad amministratori e operatori backoffice."}
          </p>

          <form className="internalAuthForm" onSubmit={submit}>
            {setup ? (
              <label>
                Nome e cognome
                <input
                  value={form.name}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  required
                />
              </label>
            ) : null}

            <label>
              Email
              <input
                type="email"
                value={form.email}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    email: event.target.value,
                  }))
                }
                required
              />
            </label>

            <label>
              Password
              <input
                type="password"
                minLength={8}
                value={form.password}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    password: event.target.value,
                  }))
                }
                required
              />
            </label>

            {error ? <div className="internalAuthError">{error}</div> : null}

            <button type="submit" disabled={busy}>
              {busy
                ? "Attendi…"
                : setup
                  ? "Crea amministratore"
                  : "Accedi"}
            </button>
          </form>
        </section>
      </main>
    );
  }

  return children({
    user: state.user,
    logout,
    refreshAuth: refresh,
  });
}
