"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AdminLoginForm() {
  const [secret, setSecret] = useState("");
  const [error, setError] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(false);
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret })
    });
    if (res.ok) router.refresh();
    else setError(true);
  }

  return (
    <form onSubmit={submit} className="mt-4 flex max-w-sm items-center gap-2">
      <input
        type="password"
        value={secret}
        onChange={(e) => setSecret(e.target.value)}
        placeholder="ADMIN_SECRET"
        className="flex-1 rounded-card border border-borderStrong bg-bg px-3 py-2 text-sm text-text placeholder:text-textFaint focus-visible:border-signal-text"
      />
      <button type="submit" className="rounded-card bg-signal px-4 py-2 text-sm font-medium text-onAccent">
        Sign in
      </button>
      {error && <span className="text-sm text-signal-text">Incorrect.</span>}
    </form>
  );
}
