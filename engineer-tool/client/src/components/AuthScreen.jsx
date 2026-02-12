import React, { useState } from "react";

export default function AuthScreen({ onLogin, onRegister, error }) {
  const [mode, setMode] = useState("login"); // login | register
  const [firstName, setFirstName] = useState("Andrei");
  const [lastName, setLastName] = useState("Anishchenko");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [localError, setLocalError] = useState("");

  const isRegister = mode === "register";
  const errText = localError || error || "";

  async function submit(e) {
    e.preventDefault();
    setLocalError("");

    if (!email || !password) {
      setLocalError("Email и пароль обязательны");
      return;
    }

    try {
      if (isRegister) {
        if (!firstName || !lastName) {
          setLocalError("Имя и фамилия обязательны");
          return;
        }
        await onRegister?.({
          email,
          password,
          first_name: firstName,
          last_name: lastName,
        });
      } else {
        await onLogin?.(email, password);
      }
    } catch (err) {
      setLocalError(err?.message || "Ошибка");
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "radial-gradient(1200px 700px at 30% 30%, #0f172a, #020617)",
        color: "#e5e7eb",
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial",
      }}
    >
      <form
        onSubmit={submit}
        style={{
          width: 420,
          background: "rgba(2,6,23,0.65)",
          border: "1px solid rgba(148,163,184,0.15)",
          borderRadius: 16,
          padding: 22,
          boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>Engineer Tool</div>

          <button
            type="button"
            onClick={() => setMode(isRegister ? "login" : "register")}
            style={{
              borderRadius: 12,
              border: "1px solid rgba(148,163,184,0.25)",
              background: "rgba(15,23,42,0.6)",
              color: "#e5e7eb",
              padding: "8px 14px",
              cursor: "pointer",
            }}
          >
            {isRegister ? "Логин" : "Регистрация"}
          </button>
        </div>

        {isRegister && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 14 }}>
            <div>
              <label style={{ fontSize: 12, opacity: 0.8 }}>Имя</label>
              <input
                id="first_name"
                name="first_name"
                autoComplete="given-name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, opacity: 0.8 }}>Фамилия</label>
              <input
                id="last_name"
                name="last_name"
                autoComplete="family-name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                style={inputStyle}
              />
            </div>
          </div>
        )}

        <div style={{ marginTop: 14 }}>
          <label style={{ fontSize: 12, opacity: 0.8 }}>Email</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={inputStyle}
          />
        </div>

        <div style={{ marginTop: 12 }}>
          <label style={{ fontSize: 12, opacity: 0.8 }}>Пароль</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete={isRegister ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={inputStyle}
          />
        </div>

        {errText ? (
          <div style={{ marginTop: 10, color: "#fca5a5", fontSize: 13 }}>{errText}</div>
        ) : (
          <div style={{ marginTop: 10, height: 18 }} />
        )}

        <button type="submit" style={buttonStyle}>
          {isRegister ? "Зарегистрироваться и войти" : "Войти"}
        </button>

        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.8 }}>
          Демо-аккаунт: <b>demo@engineer.local</b> / <b>demo1234</b>
        </div>
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

