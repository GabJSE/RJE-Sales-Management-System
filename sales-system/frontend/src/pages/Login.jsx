import { useState } from "react";
import { useAuth } from "../context/AuthContext.jsx";

function Login() {
  const { login } = useAuth();
  const [form, setForm] = useState({ username: "", password: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    if (!form.username || !form.password) return setError("Username and password are required.");
    try { setIsSaving(true); setError(""); await login(form); } catch (requestError) { setError(requestError.message); } finally { setIsSaving(false); }
  };
  return <main className="login-page"><form className="login-card" onSubmit={submit}><div className="brand login-brand"><span className="brand-mark">R</span><div><strong>RJE Motorparts</strong><small>Sales Management System</small></div></div><p className="eyebrow">Welcome back</p><h1>Sign in</h1>{error && <div className="notice error">{error}</div>}<label>Username<input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} autoComplete="username" required /></label><label>Password<div className="password-field"><input type={showPassword ? "text" : "password"} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} autoComplete="current-password" required /><button type="button" onClick={() => setShowPassword(!showPassword)}>{showPassword ? "Hide" : "Show"}</button></div></label><button className="primary-button" type="submit" disabled={isSaving}>{isSaving ? "Signing in..." : "Sign in"}</button></form></main>;
}
export default Login;
