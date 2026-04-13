import React, { useState } from "react";

export default function AuthScreen({ onLogin, error, t, language, setLanguage }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [localError, setLocalError] = useState("");

  const errText = localError || error || "";

  async function submit(e) {
    e.preventDefault();
    setLocalError("");

    if (!email || !password) {
      setLocalError(`${t("email")} + ${t("password")} ${language === "ru" ? "обязательны" : "are required"}`);
      return;
    }

    try {
      await onLogin?.(email, password);
    } catch (err) {
      setLocalError(err?.message || t("authError"));
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 16, background: "radial-gradient(1200px 700px at 30% 30%, #0f172a, #020617)", color: "#e5e7eb", fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial" }}>
      <form onSubmit={submit} style={{ width: "min(420px, 100%)", background: "rgba(2,6,23,0.65)", border: "1px solid rgba(148,163,184,0.15)", borderRadius: 16, padding: 22, boxShadow: "0 20px 60px rgba(0,0,0,0.35)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{t("appName")}</div>
          <select value={language} onChange={(e) => setLanguage(e.target.value)} style={{ width: 110 }}>
            <option value="ru">{t("russian")}</option>
            <option value="en">{t("english")}</option>
          </select>
        </div>

        <div style={{ marginTop: 14 }}>
          <label style={{ fontSize: 12, opacity: 0.8 }}>{t("email")}</label>
          <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} />
        </div>

        <div style={{ marginTop: 12 }}>
          <label style={{ fontSize: 12, opacity: 0.8 }}>{t("password")}</label>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} style={inputStyle} />
        </div>

        {errText ? <div style={{ marginTop: 10, color: "#fca5a5", fontSize: 13 }}>{errText}</div> : <div style={{ marginTop: 10, height: 18 }} />}

        <button type="submit" style={buttonStyle}>{t("signIn")}</button>
      </form>
    </div>
  );
}

const inputStyle = {
  width: "100%",
  marginTop: 6,
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(148,163,184,0.18)",
  background: "rgba(15,23,42,0.55)",
  color: "#e5e7eb",
  outline: "none",
};

const buttonStyle = {
  width: "100%",
  marginTop: 10,
  padding: "12px 14px",
  borderRadius: 12,
  border: "1px solid rgba(148,163,184,0.22)",
  background: "rgba(59,130,246,0.25)",
  color: "#e5e7eb",
  cursor: "pointer",
  fontWeight: 600,
};
