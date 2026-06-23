import { getStore } from "@netlify/blobs";
import { createHash } from "node:crypto";

// API de synchronisation de Flow.
// Modèle : un "espace" = un code secret. On range l'état JSON sous sha256(code).
// La table/le store n'est jamais listé : sans le code, rien n'est accessible.
export default async (req) => {
  if (req.method !== "POST")
    return new Response("Method Not Allowed", { status: 405 });

  let body;
  try { body = await req.json(); }
  catch { return Response.json({ error: "bad json" }, { status: 400 }); }

  const { action, code, data } = body || {};
  if (!code || typeof code !== "string" || code.length < 8)
    return Response.json({ error: "invalid code" }, { status: 400 });

  const key = createHash("sha256").update(code).digest("hex");
  // cohérence forte : un push est immédiatement visible par les autres appareils
  const store = getStore({ name: "flow", consistency: "strong" });

  if (action === "pull") {
    const row = await store.get(key, { type: "json" });
    return Response.json(row || null); // { data, updated_at } | null
  }

  if (action === "push") {
    const updated_at = new Date().toISOString();
    await store.setJSON(key, { data, updated_at });
    return Response.json({ updated_at });
  }

  return Response.json({ error: "unknown action" }, { status: 400 });
};

export const config = { path: "/api/sync" };
