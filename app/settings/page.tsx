"use client";

import { useCallback, useEffect, useState } from "react";
import { categoryMeta } from "@/lib/categories";
import type { Category } from "@/lib/types";

const SUB_ID_KEY = "discipline.pushSubId";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export default function SettingsPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [newCategory, setNewCategory] = useState("");
  const [newSub, setNewSub] = useState("");
  const [pushOk, setPushOk] = useState(false);
  const [note, setNote] = useState("");
  const [testing, setTesting] = useState("");

  const load = useCallback(async () => {
    const c = await fetch("/api/categories").then((r) => (r.ok ? r.json() : []));
    setCategories(c);
    if (selected === null && c.length) setSelected(c[0].id);
  }, [selected]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .getRegistration()
      .then((reg) => reg?.pushManager.getSubscription())
      .then((sub) => setPushOk(Boolean(sub)))
      .catch(() => {});
  }, []);

  const enablePush = async () => {
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      setNote("This browser has no push support.");
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setNote("Notifications denied — enforced blocks cannot reach you.");
      return;
    }
    const vapid = await fetch("/api/vapid").then((r) => r.json());
    if (!vapid.enabled) {
      setNote("Server push is not configured.");
      return;
    }
    await navigator.serviceWorker.register("/sw.js").catch(() => {});
    const reg = await navigator.serviceWorker.ready;
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapid.publicKey),
      }));

    let id = "";
    try {
      id = localStorage.getItem(SUB_ID_KEY) || "";
    } catch {}

    const res = await fetch("/api/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: id || undefined, subscription: sub }),
    });
    if (res.ok) {
      const data = await res.json();
      try {
        localStorage.setItem(SUB_ID_KEY, data.id);
      } catch {}
      setPushOk(true);
      setNote("");
    }
  };

  const category = categories.find((c) => c.id === selected);

  return (
    <main className="shell">
      <header className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="sub">Personal app — no accounts, no sync service.</p>
        </div>
        <a className="icon-btn" href="/" aria-label="Back">
          ✕
        </a>
      </header>

      <section>
        <h2 className="sec-title">Notifications</h2>
        <div className="card">
          <span className="pill">
            <span className={`dot${pushOk ? "" : " warn"}`} />
            {pushOk
              ? "On — this is what makes enforced blocks work"
              : "Off — enforced blocks cannot reach you"}
          </span>
          <p className="note">
            Blocks are sent from the server, so they arrive with the app closed.
            They cannot fire while the machine running the server is off or
            offline.
          </p>
          {!pushOk && (
            <button className="ghost" onClick={enablePush}>
              Enable notifications
            </button>
          )}
          <button
            className="ghost"
            disabled={!pushOk || testing === "sending"}
            onClick={async () => {
              setTesting("sending");
              const res = await fetch("/api/test", { method: "POST" });
              setTesting(res.ok ? "Sent — check your phone." : "Test failed.");
              setTimeout(() => setTesting(""), 6000);
            }}
          >
            {testing === "sending" ? "Buzzing…" : "Test buzz now"}
          </button>
          {testing && testing !== "sending" && (
            <p className="note">{testing}</p>
          )}
          {note && <p className="note">{note}</p>}
        </div>
      </section>

      <section>
        <h2 className="sec-title">Categories</h2>
        <div className="chip-row">
          {categories.map((c) => {
            const meta = categoryMeta(c);
            const active = c.id === selected;
            return (
              <button
                key={c.id}
                className={`chip${active ? " active" : ""}`}
                style={
                  active ? { borderColor: meta.color, color: meta.color } : undefined
                }
                onClick={() => setSelected(c.id)}
              >
                <span>{meta.icon}</span> {meta.label}
              </button>
            );
          })}
        </div>

        <div className="card">
          <label className="field">
            New category
            <div className="inline-add">
              <input
                type="text"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                placeholder="Name"
              />
              <button
                className="ghost small"
                disabled={!newCategory.trim()}
                onClick={async () => {
                  await fetch("/api/categories", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ customName: newCategory.trim() }),
                  });
                  setNewCategory("");
                  load();
                }}
              >
                Add
              </button>
            </div>
          </label>

          {category && !category.defaultType && (
            <button
              className="ghost danger small"
              onClick={async () => {
                await fetch(`/api/categories?id=${category.id}`, {
                  method: "DELETE",
                });
                setSelected(null);
                load();
              }}
            >
              Delete “{categoryMeta(category).label}”
            </button>
          )}
        </div>

        {category && (
          <div className="card">
            <p className="row-title">
              Subcategories of {categoryMeta(category).label}
            </p>
            {category.subCategories.length === 0 && (
              <p className="note">None yet.</p>
            )}
            {category.subCategories.map((s) => (
              <div key={s.id} className="src-row">
                <span className="src-label">{s.name}</span>
                <button
                  className="ghost small"
                  onClick={async () => {
                    await fetch(`/api/subcategories?id=${s.id}`, {
                      method: "DELETE",
                    });
                    load();
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
            <div className="inline-add">
              <input
                type="text"
                value={newSub}
                onChange={(e) => setNewSub(e.target.value)}
                placeholder="New subcategory"
              />
              <button
                className="ghost small"
                disabled={!newSub.trim()}
                onClick={async () => {
                  await fetch("/api/subcategories", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      name: newSub.trim(),
                      mainCategoryId: category.id,
                    }),
                  });
                  setNewSub("");
                  load();
                }}
              >
                Add
              </button>
            </div>
          </div>
        )}
      </section>

      <section>
        <h2 className="sec-title">Data</h2>
        <div className="card">
          <p className="note">
            Everything lives in one SQLite file on the server. This exports it
            as JSON.
          </p>
          <a className="ghost as-btn" href="/api/backup">
            Download backup
          </a>
        </div>
      </section>

      <section>
        <h2 className="sec-title">Session</h2>
        <div className="card">
          <button
            className="ghost danger"
            onClick={async () => {
              await fetch("/api/auth", { method: "DELETE" });
              window.location.href = "/";
            }}
          >
            Log out
          </button>
        </div>
      </section>
    </main>
  );
}
