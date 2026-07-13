import { parseNateArticle } from "../../../lib/nate-entertainment.js";
import { createThumbnailHooks, generateHomeThumbnail } from "../../../lib/nate-thumbnail.js";

const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const fail = (message, status = 400) => json({ success: false, error: { message } }, status);
const validId = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;

const fetchArticleHtml = async (url) => {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, { signal: controller.signal, headers: {
        "User-Agent": "Mozilla/5.0 (compatible; BlogNewsCollector/2.0)", Accept: "text/html,application/xhtml+xml",
      } });
      if (!response.ok) throw new Error(`HTTP_${response.status}`);
      return new TextDecoder("euc-kr").decode(await response.arrayBuffer());
    } catch (error) { lastError = error; } finally { clearTimeout(timer); }
  }
  throw lastError || new Error("ARTICLE_FETCH_FAILED");
};

const hooksInput = (value) => {
  const hooks = value && typeof value === "object" ? value : null;
  if (!hooks || !["categoryLabel", "mainHook", "secondaryHook", "bottomHook"].every((key) => typeof hooks[key] === "string")) return null;
  return Object.fromEntries(Object.entries(hooks).map(([key, text]) => [key, text.trim().slice(0, 40)]));
};

const regenerateThumbnail = async (env, article, suppliedHooks) => {
  if (!env.OPENAI_API_KEY || !env.OPENAI_MODEL || !env.IMAGES_BUCKET) throw new Error("THUMBNAIL_CONFIG_MISSING");
  const scraped = { title: article.title, body: article.extracted_content || article.content,
    representativeImageUrl: article.representative_image_url };
  const hooks = suppliedHooks || await createThumbnailHooks(env, scraped);
  const generated = await generateHomeThumbnail(env, scraped, hooks);
  const key = `private/generated/nate/${article.id}/${crypto.randomUUID()}.jpg`;
  await env.IMAGES_BUCKET.put(key, generated.bytes, { httpMetadata: { contentType: "image/jpeg" } });
  const generatedUrl = `/api/articles/${article.id}/thumbnail`;
  const image = await env.DB.prepare(`SELECT id FROM article_images WHERE article_id=? AND image_url=? LIMIT 1`)
    .bind(article.id, generatedUrl).first();
  if (image) await env.DB.prepare(`UPDATE article_images SET size_bytes=?,width=1024,height=1024,processed_r2_key=?,
    processing_status='processed',approved_for_use=0,rights_status='pending',sort_order=0 WHERE id=?`)
    .bind(generated.bytes.byteLength, key, image.id).run();
  else await env.DB.prepare(`INSERT INTO article_images (article_id,image_url,source,article_url,candidate_type,
    content_type,width,height,size_bytes,rights_status,rights_confirmed,approved_for_use,sort_order,crop_percent,
    processing_status,processed_r2_key) VALUES (?,?, 'AI 홈판',?,'og','image/jpeg',1024,1024,?,'pending',1,0,0,.15,'processed',?)`)
    .bind(article.id, generatedUrl, article.url, generated.bytes.byteLength, key).run();
  await env.DB.prepare(`UPDATE articles SET generated_thumbnail_url=?,thumbnail_r2_key=?,thumbnail_hooks_json=?,
    thumbnail_status='completed',thumbnail_approved=0,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .bind(generatedUrl, key, JSON.stringify(hooks), article.id).run();
  return hooks;
};

export async function onRequestPost({ request, env, params }) {
  const id = validId(params.id); if (!id) return fail("올바른 기사 id가 아닙니다.");
  let input; try { input = await request.json(); } catch { return fail("올바른 JSON 요청이 아닙니다."); }
  let article = await env.DB.prepare("SELECT * FROM articles WHERE id=? AND source_type='nate_entertainment_ranking'").bind(id).first();
  if (!article) return fail("네이트 연예 랭킹 기사를 찾을 수 없습니다.", 404);
  try {
    if (input.action === "rescrape") {
      const html = await fetchArticleHtml(article.url);
      const scraped = parseNateArticle(html, { rank: article.nate_rank, title: article.title, articleUrl: article.url,
        nateArticleId: article.nate_article_id, publisher: article.source, rankingDate: article.ranking_date });
      await env.DB.prepare(`UPDATE articles SET title=?,content=?,summary=?,extracted_content=?,extraction_status='extracted',
        extracted_at=CURRENT_TIMESTAMP,canonical_url=?,original_publisher_url=?,published_at=?,representative_image_url=?,
        image_url=?,reporter=?,scrape_status='completed',updated_at=CURRENT_TIMESTAMP WHERE id=?`)
        .bind(scraped.title, scraped.body, scraped.body.slice(0, 5000), scraped.body, scraped.canonicalUrl || null,
          scraped.originalPublisherUrl || null, scraped.publishedAt || null, scraped.representativeImageUrl,
          scraped.representativeImageUrl, scraped.reporter || null, id).run();
    } else if (input.action === "change_representative_image") {
      let url; try { url = new URL(String(input.url || "")); } catch { return fail("올바른 이미지 URL이 아닙니다."); }
      if (url.protocol !== "https:") return fail("대표 이미지는 HTTPS URL이어야 합니다.");
      await env.DB.prepare("UPDATE articles SET representative_image_url=?,thumbnail_status='pending',thumbnail_approved=0,updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .bind(url.href, id).run();
    } else if (["regenerate_thumbnail", "update_hooks"].includes(input.action)) {
      const supplied = input.action === "update_hooks" ? hooksInput(input.hooks) : null;
      if (input.action === "update_hooks" && !supplied) return fail("후킹 문구 형식이 올바르지 않습니다.");
      await env.DB.prepare("UPDATE articles SET thumbnail_status='generating',thumbnail_approved=0 WHERE id=?").bind(id).run();
      article = await env.DB.prepare("SELECT * FROM articles WHERE id=?").bind(id).first();
      await regenerateThumbnail(env, article, supplied);
      await env.DB.prepare(`UPDATE drafts SET approval_status='draft',approved_at=NULL,approved_draft_version=NULL,
        status='review',updated_at=CURRENT_TIMESTAMP WHERE article_group_id IN (
          SELECT group_id FROM article_group_items WHERE article_id=?
        )`).bind(id).run();
    } else return fail("지원하지 않는 파이프라인 동작입니다.");
    article = await env.DB.prepare("SELECT * FROM articles WHERE id=?").bind(id).first();
    return json({ success: true, data: { article } });
  } catch (error) {
    console.error("Nate manual pipeline action failed", id, input.action, error.message);
    if (["regenerate_thumbnail", "update_hooks"].includes(input.action)) {
      await env.DB.prepare("UPDATE articles SET thumbnail_status='failed',thumbnail_approved=0,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(id).run();
    }
    return fail("요청한 기사 파이프라인 작업에 실패했습니다.", 502);
  }
}

export function onRequest(context) {
  return context.request.method === "POST" ? onRequestPost(context) : fail("POST 요청만 허용됩니다.", 405);
}
