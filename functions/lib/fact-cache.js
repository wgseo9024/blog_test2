const hex = (buffer) => [...new Uint8Array(buffer)].map((value) => value.toString(16).padStart(2, "0")).join("");

export async function articleSignature(articles) {
  const stable = articles.map(({ id, title, source, content }) => ({ id, title, source, content }));
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(stable))));
}

export async function readFactCache(env, groupId, articles) {
  const signature = await articleSignature(articles);
  const row = await env.DB.prepare("SELECT content_signature,facts_json FROM group_fact_cache WHERE group_id=?")
    .bind(groupId).first();
  if (row?.content_signature !== signature) return { signature, facts: null, cacheHit: false };
  try { return { signature, facts: JSON.parse(row.facts_json), cacheHit: true }; }
  catch { return { signature, facts: null, cacheHit: false }; }
}

export async function writeFactCache(env, groupId, signature, facts, model) {
  await env.DB.prepare(`INSERT INTO group_fact_cache (group_id,content_signature,facts_json,model)
    VALUES (?,?,?,?) ON CONFLICT(group_id) DO UPDATE SET content_signature=excluded.content_signature,
    facts_json=excluded.facts_json,model=excluded.model,updated_at=CURRENT_TIMESTAMP`)
    .bind(groupId, signature, JSON.stringify(facts), model || null).run();
}

