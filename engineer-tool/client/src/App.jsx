import React, { useEffect, useState } from "react";
import AuthScreen from "./components/AuthScreen.jsx";
import Workspace from "./Workspace.jsx";
import { AuthAPI, UsersAPI, getToken, setToken, clearToken } from "./api.js";

export default function App() {
  const [token, setTok] = useState(getToken());
  const [me, setMe] = useState(null);
  const [bootError, setBootError] = useState("");
  const [authError, setAuthError] = useState("");
  const [loading, setLoading] = useState(false);

  async function loadMe() {
    setBootError("");
    try {
      const data = await UsersAPI.me();
      setMe(data);
    } catch (e) {
      clearToken();
      setMe(null);
      setTok("");
      setBootError(e?.message || "Auth error");
    }
  }

  useEffect(() => {
    const t = getToken();
    setTok(t || "");
    if (t) loadMe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onLogin(email, password) {
    setAuthError("");
    setLoading(true);
    try {
      const res = await AuthAPI.login(email, password);
      const tok = res?.token;
      if (!tok) throw new Error("No token in response");
      setToken(tok);
      setTok(tok);
      await loadMe();
    } catch (e) {
      setAuthError(e?.message || "Login error");
      clearToken();
      setTok("");
      setMe(null);
    } finally {
      setLoading(false);
    }
  }

  async function onRegister(payload) {
    // payload: { email,password,first_name,last_name }
    setAuthError("");
    setLoading(true);
    try {
      const res = await AuthAPI.register(payload);

      // если register возвращает token — используем
      if (res?.token) {
        setToken(res.token);
        setTok(res.token);
        await loadMe();
        return;
      }

      // если register токен не вернул — логинимся после регистрации
      await onLogin(payload.email, payload.password);
    } catch (e) {
      setAuthError(e?.message || "Register error");
    } finally {
      setLoading(false);
    }
  }

  function logout() {
    clearToken();
    setTok("");
    setMe(null);
  }

  if (!token) {
    return (
      <AuthScreen
        onLogin={onLogin}
        onRegister={onRegister}
        error={loading ? "Loading..." : authError}
      />
    );
  }

  return (
    <div style={{ minHeight: "100vh" }}>
      {bootError ? (
        <div style={{ padding: 12, color: "#ff6b6b" }}>{bootError}</div>
      ) : null}
      <Workspace me={me} onLogout={logout} />
    </div>
  );
}
