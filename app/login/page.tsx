"use client";

import { useState } from "react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });

    if (res.ok) {
      window.location.href = "/";
    } else {
      setError("Wrong password.");
      setLoading(false);
    }
  };

  return (
    <main className="shell" style={{ justifyContent: "center" }}>
      <div>
        <h1>Alarm</h1>
        <p className="sub">Enter the password to continue.</p>
      </div>
      <form className="card" onSubmit={submit} style={{ gap: 14 }}>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoFocus
          autoComplete="current-password"
        />
        {error && <p className="error">{error}</p>}
        <button className="primary" type="submit" disabled={loading}>
          {loading ? "..." : "Unlock"}
        </button>
      </form>
    </main>
  );
}
