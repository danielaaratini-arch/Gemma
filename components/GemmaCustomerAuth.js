"use client";

import { useEffect, useState } from "react";

export default function GemmaCustomerAuth({ children }) {
  const [state, setState] = useState({
    loading: true,
    user: null,
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
        user: data?.user?.role === "CUSTOMER" ? data.user : null,
      });
      return data?.user || null;
    } catch {
      setState({ loading: false, user: null });
      return null;
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      const register = mode === "REGISTER";
      const response = await fetch(
        register
          ? "/api/gemma/auth/register"
          : "/api/gemma/auth/login",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...form,
            mode: "CUSTOMER",
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

  if (!state.user) {
    return (
      <main className="customerAuthPage">
        <section className="customerAuthCard">
          <div className="brand">
            TAAP <span>Gemma</span>
          </div>

          <p className="internalAuthEyebrow">Area cliente</p>
          <h1>
            {mode === "REGISTER"
              ? "Crea il tuo accesso"
              : "Accedi alle tue segnalazioni"}
          </h1>
          <p>
            Accedendo ritrovi ticket, messaggi e allegati anche da un altro
            dispositivo.
          </p>

          <div className="customerAuthTabs">
            <button
              type="button"
              className={mode === "LOGIN" ? "active" : ""}
              onClick={() => {
                setMode("LOGIN");
                setError("");
              }}
            >
              Accedi
            </button>
            <button
              type="button"
              className={mode === "REGISTER" ? "active" : ""}
              onClick={() => {
                setMode("REGISTER");
                setError("");
              }}
            >
              Registrati
            </button>
          </div>

          <form className="internalAuthForm" onSubmit={submit}>
            {mode === "REGISTER" ? (
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
                : mode === "REGISTER"
                  ? "Crea account"
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
