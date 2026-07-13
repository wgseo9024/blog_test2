import { scoreAdvertisement } from "../../lib/advertisement.js";
import { generateGroupDraft } from "../groups/[id]/generate.js";
import {
  buildNateEntertainmentRankingUrl, getKoreaDateString, normalizeNateArticleUrl,
  parseNateArticle, parseNateEntertainmentRanking, sha256Hex, validRankingDate,
} from "../../lib/nate-entertainment.js";
import { NATE_SOURCE_TYPE } from "../../lib/nate-selectors.js";
import { createThumbnailHooks, generateHomeThumbnail } from "../../lib/nate-thumbnail.js";

const SOURCES = [
  { id: "sports-khan", name: "스포츠경향 연예", url: "https://sports.khan.co.kr/rss/entertainment" },
  { id: "mydaily", name: "마이데일리 스타", url: "https://mydaily.co.kr/star_rss.xml" },
  { id: "newsis", name: "뉴시스 연예", url: "https://www.newsis.com/RSS/entertain.xml" },
  { id: "mbn", name: "MBN 연예", url: "https://www.mbn.co.kr/rss/enter/" },
];

// Legacy RSS utilities remain available for unrelated/manual compatibility tests, but the
// entertainment collection endpoint never selects or calls these sources anymore.
export const DISABLED_LEGACY_RSS_SOURCES = Object.freeze(SOURCES.map((source) => ({ ...source, enabled: false })));

const FEED_LIMIT = 5;
const REQUEST_TIMEOUT_MS = 10000;
const USER_AGENT = "Mozilla/5.0 (compatible; BlogNewsCollector/1.0; +https://wgseo9024.github.io/blog_test2/)";

const json = (data, status = 200, headers = {}) => Response.json(data, {
  status,
  headers: {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  },
});

const failure = (message, status, headers) =>
  json({ success: false, error: { message } }, status, headers);

const decodeEntities = (value) => {
  const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return String(value || "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === "#") {
      const hexadecimal = entity[1]?.toLowerCase() === "x";
      const codePoint = Number.parseInt(entity.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
      try {
        return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
      } catch {
        return match;
      }
    }
    return named[entity.toLowerCase()] ?? match;
  });
};

const cleanMarkup = (value, maxLength) => decodeEntities(
  decodeEntities(String(value || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1"))
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " "),
).replace(/\s+/g, " ").trim().slice(0, maxLength);

const elementValue = (xml, names) => {
  for (const name of names) {
    const escaped = name.replace(":", "\\:");
    const match = xml.match(new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}\\s*>`, "i"));
    if (match) return match[1];
  }
  return "";
};

const attributeValue = (tag, name) => {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"));
  return match ? decodeEntities(match[2]).trim() : "";
};

const atomLink = (entry) => {
  const tags = entry.match(/<link\b[^>]*>/gi) || [];
  const preferred = tags.find((tag) => !attributeValue(tag, "rel") || attributeValue(tag, "rel") === "alternate");
  return attributeValue(preferred || tags[0] || "", "href");
};

const imageCandidate = (record) => {
  const tags = record.match(/<(?:media:content|media:thumbnail|enclosure)\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const url = attributeValue(tag, "url");
    const type = attributeValue(tag, "type");
    if (url && (!type || type.startsWith("image/"))) return url.slice(0, 3000);
  }
  return "";
};

const normalizeDate = (value) => {
  const cleaned = cleanMarkup(value, 200);
  if (!cleaned) return "";
  const date = new Date(cleaned);
  return Number.isNaN(date.getTime()) ? cleaned.slice(0, 100) : date.toISOString();
};

export const parseFeed = (xml, source) => {
  const body = String(xml || "").replace(/^\uFEFF/, "").trim();
  if (!body.startsWith("<") || !/<(?:rss|feed|rdf:RDF)\b/i.test(body)) {
    throw new Error("PARSE_ERROR");
  }

  const rssItems = [...body.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item\s*>/gi)].map((match) => ({
    xml: match[1],
    atom: false,
  }));
  const atomEntries = [...body.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry\s*>/gi)].map((match) => ({
    xml: match[1],
    atom: true,
  }));
  const records = (rssItems.length ? rssItems : atomEntries).slice(0, FEED_LIMIT);
  if (!records.length && /<(?:item|entry)\b/i.test(body)) throw new Error("PARSE_ERROR");

  return records.map(({ xml: record, atom }) => {
    const description = elementValue(record, ["description", "summary"]);
    const encoded = elementValue(record, ["content:encoded", "content"]);
    const url = atom
      ? atomLink(record) || cleanMarkup(elementValue(record, ["id"]), 3000)
      : cleanMarkup(elementValue(record, ["link", "guid"]), 3000);
    return {
      title: cleanMarkup(elementValue(record, ["title"]), 500),
      url,
      summary: cleanMarkup(description || encoded, 5000),
      content: cleanMarkup(encoded || description, 50000),
      published_at: normalizeDate(elementValue(record, ["pubDate", "published", "updated", "dc:date"])),
      source: source.name,
      image_url: imageCandidate(record),
    };
  });
};

const publicFeedError = (type, status) => {
  if (type === "timeout") return { type, message: "RSS 요청 시간이 초과되었습니다." };
  if (type === "http_403") return { type, status: 403, message: "RSS 서버가 요청을 거부했습니다." };
  if (type === "http_404") return { type, status: 404, message: "RSS 피드를 찾을 수 없습니다." };
  if (type === "http_error") return { type, status, message: "RSS 서버가 오류로 응답했습니다." };
  if (type === "xml_parse") return { type, message: "RSS XML을 해석하지 못했습니다." };
  return { type: "network", message: "RSS 서버에 연결하지 못했습니다." };
};

const logFeedError = (source, type, detail = "") => {
  console.error(`[RSS collect] source=${source.name} type=${type}`, detail);
};

const fetchFeed = async (source) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(source.url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" },
      signal: controller.signal,
    });
    if (!response.ok) {
      const type = response.status === 403 ? "http_403" : response.status === 404 ? "http_404" : "http_error";
      const error = new Error(type);
      error.feedType = type;
      error.status = response.status;
      throw error;
    }
    return await response.text();
  } catch (error) {
    if (error.name === "AbortError") {
      const timeout = new Error("timeout");
      timeout.feedType = "timeout";
      throw timeout;
    }
    throw Object.assign(error, { newArticleCreated: true });
  } finally {
    clearTimeout(timer);
  }
};

export const collectSource = async (env, source) => {
  const result = { name: source.name, fetched: 0, inserted: 0, duplicates: 0, failed: 0 };
  let articles;
  try {
    const xml = await fetchFeed(source);
    try {
      articles = parseFeed(xml, source);
    } catch {
      const type = "xml_parse";
      logFeedError(source, type);
      return { ...result, failed: 1, error: publicFeedError(type) };
    }
  } catch (error) {
    const type = error.feedType || "network";
    logFeedError(source, type, error.status || "");
    return { ...result, failed: 1, error: publicFeedError(type, error.status) };
  }

  result.fetched = articles.length;
  for (const article of articles) {
    if (!article.title || !article.url || !/^https?:\/\//i.test(article.url)) {
      result.failed += 1;
      continue;
    }
    try {
      const ad = scoreAdvertisement(article);
      const existing = await env.DB.prepare("SELECT id FROM articles WHERE url = ? LIMIT 1")
        .bind(article.url).first();
      if (existing) {
        result.duplicates += 1;
        continue;
      }
      const inserted = await env.DB.prepare(`INSERT INTO articles
        (title, url, source, summary, content, published_at, image_url,
         is_advertisement, advertisement_score, advertisement_reasons)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`)
        .bind(article.title, article.url, article.source, article.summary || null,
          article.content || null, article.published_at || null, article.image_url || null,
          ad.isAdvertisement ? 1 : 0, ad.score, JSON.stringify(ad.reasons))
        .first();
      if (inserted?.id && article.image_url && /^https?:\/\//i.test(article.image_url)) {
        await env.DB.prepare(`INSERT OR IGNORE INTO article_images
          (article_id, image_url, source, article_url, candidate_type) VALUES (?, ?, ?, ?, 'rss')`)
          .bind(inserted.id, article.image_url, article.source, article.url).run();
      }
      result.inserted += 1;
    } catch (error) {
      if (String(error?.message || "").toLowerCase().includes("unique")) {
        result.duplicates += 1;
      } else {
        result.failed += 1;
        logFeedError(source, "database");
      }
    }
  }
  return result;
};

const selectedSources = (values) => {
  if (values === undefined) return SOURCES;
  if (!Array.isArray(values)) return null;
  const requested = new Set(values.filter((value) => typeof value === "string").map((value) => value.trim()));
  return SOURCES.filter((source) => requested.has(source.id) || requested.has(source.name) || requested.has(source.url));
};

export async function legacyRssRequest({ request, env }) {
  let body = {};
  const rawBody = await request.text();
  if (rawBody.trim()) {
    try {
      body = JSON.parse(rawBody);
    } catch {
      return failure("올바른 JSON 요청이 아닙니다.", 400);
    }
  }
  const sources = selectedSources(body?.sources);
  if (!sources) return failure("sources는 배열이어야 합니다.", 400);
  if (!sources.length) return failure("수집할 RSS를 하나 이상 선택해 주세요.", 400);

  const sourceResults = await Promise.all(sources.map((source) => collectSource(env, source)));
  const totals = sourceResults.reduce((sum, item) => ({
    totalFetched: sum.totalFetched + item.fetched,
    inserted: sum.inserted + item.inserted,
    duplicates: sum.duplicates + item.duplicates,
    failed: sum.failed + item.failed,
  }), { totalFetched: 0, inserted: 0, duplicates: 0, failed: 0 });

  return json({ success: true, data: { ...totals, sources: sourceResults } });
}

const NATE_ERROR = Object.freeze({
  NATE_RANKING_STRUCTURE_CHANGED: "네이트 연예 랭킹 페이지의 구조가 변경되었거나 기사 선택자를 찾지 못했습니다.",
  NATE_ARTICLE_BODY_MISSING: "기사 본문 추출 실패",
  NATE_REPRESENTATIVE_IMAGE_MISSING: "대표 이미지 추출 실패",
});

const fetchHtml = async (url, label) => {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, { signal: controller.signal, headers: {
        "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml",
      } });
      if (response.status === 403 || response.status === 429) throw new Error("NATE_ACCESS_BLOCKED");
      if (response.status === 404) throw new Error("NATE_RANKING_NOT_FOUND");
      if (!response.ok) throw new Error(`${label}_HTTP_${response.status}`);
      const bytes = await response.arrayBuffer();
      return new TextDecoder("euc-kr").decode(bytes);
    } catch (error) {
      lastError = error;
      if (["NATE_ACCESS_BLOCKED", "NATE_RANKING_NOT_FOUND"].includes(error.message)) break;
    } finally { clearTimeout(timer); }
  }
  throw lastError || new Error(`${label}_FETCH_FAILED`);
};

const existingArticle = async (env, item, extra = {}) => {
  const normalized = normalizeNateArticleUrl(item.articleUrl);
  const hash = await sha256Hex(item.title);
  return env.DB.prepare(`SELECT * FROM articles WHERE
    (? IS NOT NULL AND nate_article_id = ?) OR normalized_article_url = ? OR
    (? IS NOT NULL AND canonical_url = ?) OR (? IS NOT NULL AND original_publisher_url = ?) OR title_hash = ?
    ORDER BY CASE WHEN nate_article_id = ? THEN 0 WHEN normalized_article_url = ? THEN 1
      WHEN canonical_url = ? THEN 2 WHEN original_publisher_url = ? THEN 3 ELSE 4 END LIMIT 1`)
    .bind(item.nateArticleId || null, item.nateArticleId || null, normalized,
      extra.canonicalUrl || null, extra.canonicalUrl || null,
      extra.originalPublisherUrl || null, extra.originalPublisherUrl || null, hash,
      item.nateArticleId || null, normalized, extra.canonicalUrl || null, extra.originalPublisherUrl || null).first();
};

const recordRank = async (env, article, item, checkedAt) => {
  const previous = Number(article.nate_rank) || null;
  const best = previous ? Math.min(Number(article.best_nate_rank) || previous, item.rank) : item.rank;
  await env.DB.prepare(`UPDATE articles SET previous_nate_rank=?,nate_rank=?,best_nate_rank=?,rank_change=?,
    source_type=COALESCE(source_type,?),nate_article_id=COALESCE(nate_article_id,?),
    normalized_article_url=COALESCE(normalized_article_url,?),ranking_first_seen_at=COALESCE(ranking_first_seen_at,?),
    ranking_date=?,ranking_last_seen_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .bind(previous, item.rank, best, previous ? previous - item.rank : null, NATE_SOURCE_TYPE,
      item.nateArticleId || null, normalizeNateArticleUrl(item.articleUrl), checkedAt,
      item.rankingDate, checkedAt, article.id).run();
  await env.DB.prepare(`INSERT INTO article_rank_history (id,article_id,rank,ranking_date,checked_at)
    VALUES (?,?,?,?,?)`).bind(crypto.randomUUID(), article.id, item.rank, item.rankingDate, checkedAt).run();
};

const insertImageCandidate = async (env, articleId, url, publisher, articleUrl, type = "og") => env.DB.prepare(
  `INSERT OR IGNORE INTO article_images (article_id,image_url,source,article_url,candidate_type)
   VALUES (?,?,?,?,?) RETURNING id`,
).bind(articleId, url, publisher || null, articleUrl, type).first();

const createDraftGroup = async (env, article, generatedImageId) => {
  const topicKey = `nate:${article.nateArticleId || article.id}`;
  const group = await env.DB.prepare(`INSERT INTO article_groups (topic_key,representative_title)
    VALUES (?,?) ON CONFLICT(topic_key) DO UPDATE SET representative_title=excluded.representative_title,
    updated_at=CURRENT_TIMESTAMP RETURNING id`).bind(topicKey, article.title).first();
  await env.DB.prepare(`INSERT OR IGNORE INTO article_group_items (group_id,article_id,similarity_score)
    VALUES (?,?,1)`).bind(group.id, article.id).run();
  const response = await generateGroupDraft(env, group.id, { status: "review", preventDuplicate: true });
  const payload = await response.json();
  if (!response.ok || !payload?.success) throw new Error("EXISTING_WRITER_PROMPT_FAILED");
  await env.DB.prepare(`UPDATE drafts SET selected_cover_image_id=?,image_mode='generate',status='review',
    approval_status='draft',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(generatedImageId, payload.data.draft.id).run();
  await env.DB.prepare("UPDATE articles SET draft_status='completed',status='review',updated_at=CURRENT_TIMESTAMP WHERE id=?")
    .bind(article.id).run();
};

const createNewArticle = async (env, item, checkedAt) => {
  const html = await fetchHtml(item.articleUrl, "NATE_ARTICLE");
  const scraped = parseNateArticle(html, item);
  const afterScrapeDuplicate = await existingArticle(env, item, scraped);
  if (afterScrapeDuplicate) {
    await recordRank(env, afterScrapeDuplicate, item, checkedAt);
    return { duplicate: true };
  }
  const titleHash = await sha256Hex(scraped.title);
  const inserted = await env.DB.prepare(`INSERT INTO articles
    (title,url,source,summary,content,published_at,image_url,status,extracted_content,extraction_status,extracted_at,
     source_type,nate_rank,best_nate_rank,nate_article_id,normalized_article_url,canonical_url,original_publisher_url,
     ranking_date,ranking_first_seen_at,ranking_last_seen_at,representative_image_url,title_hash,reporter,scrape_status,thumbnail_status,draft_status)
    VALUES (?,?,?,?,?,?,?,'processing',?,?,CURRENT_TIMESTAMP,?,?,?,?,?,?,?,?,?,?,?,?,?,'completed','generating','pending') RETURNING *`)
    .bind(scraped.title, scraped.articleUrl, scraped.publisher || "네이트 연예 랭킹뉴스", scraped.body.slice(0, 5000),
      scraped.body, scraped.publishedAt || null, scraped.representativeImageUrl, scraped.body, "extracted",
      NATE_SOURCE_TYPE, item.rank, item.rank, item.nateArticleId || null, scraped.normalizedArticleUrl,
      scraped.canonicalUrl || null, scraped.originalPublisherUrl || null, item.rankingDate, checkedAt, checkedAt,
      scraped.representativeImageUrl, titleHash, scraped.reporter || null).first();
  await env.DB.prepare(`INSERT INTO article_rank_history (id,article_id,rank,ranking_date,checked_at) VALUES (?,?,?,?,?)`)
    .bind(crypto.randomUUID(), inserted.id, item.rank, item.rankingDate, checkedAt).run();
  await insertImageCandidate(env, inserted.id, scraped.representativeImageUrl, scraped.publisher, scraped.articleUrl);
  for (const url of scraped.contentImages.slice(0, 12)) await insertImageCandidate(env, inserted.id, url, scraped.publisher, scraped.articleUrl);

  try {
    if (!env.OPENAI_API_KEY || !env.OPENAI_MODEL || !env.IMAGES_BUCKET) throw new Error("THUMBNAIL_CONFIG_MISSING");
    const hooks = await createThumbnailHooks(env, scraped);
    const generated = await generateHomeThumbnail(env, scraped, hooks);
    const key = `private/generated/nate/${inserted.id}/${crypto.randomUUID()}.jpg`;
    await env.IMAGES_BUCKET.put(key, generated.bytes, { httpMetadata: { contentType: "image/jpeg" } });
    const generatedUrl = `/api/articles/${inserted.id}/thumbnail`;
    const image = await insertImageCandidate(env, inserted.id, generatedUrl, "AI 홈판", scraped.articleUrl);
    await env.DB.prepare(`UPDATE article_images SET content_type='image/jpeg',width=1024,height=1024,size_bytes=?,
      rights_status='pending',rights_confirmed=1,approved_for_use=0,sort_order=0,crop_percent=.15,
      processing_status='processed',processed_r2_key=? WHERE id=?`).bind(generated.bytes.byteLength, key, image.id).run();
    await env.DB.prepare(`UPDATE articles SET generated_thumbnail_url=?,thumbnail_r2_key=?,thumbnail_hooks_json=?,
      thumbnail_status='completed',updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .bind(generatedUrl, key, JSON.stringify(hooks), inserted.id).run();
    await createDraftGroup(env, inserted, image.id);
  } catch (error) {
    console.error("Nate new article pipeline failed", inserted.id, error.message);
    await env.DB.prepare(`UPDATE articles SET thumbnail_status=CASE WHEN thumbnail_status='generating' THEN 'failed' ELSE thumbnail_status END,
      draft_status='failed',status='pipeline_failed',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(inserted.id).run();
    throw error;
  }
  return { article: inserted, duplicate: false };
};

export async function collectNateEntertainment(env, { rankingDate = getKoreaDateString(), now = new Date() } = {}) {
  if (!validRankingDate(rankingDate)) throw new Error("INVALID_RANKING_DATE");
  const rankingUrl = buildNateEntertainmentRankingUrl(rankingDate);
  const runId = crypto.randomUUID();
  const startedAt = now.toISOString();
  const lockOwner = `nate:${runId}`;
  await env.DB.prepare("DELETE FROM automation_locks WHERE lock_name='nate-entertainment-collection' AND expires_at<=?")
    .bind(startedAt).run();
  const lock = await env.DB.prepare(`INSERT OR IGNORE INTO automation_locks (lock_name,owner_id,acquired_at,expires_at)
    VALUES ('nate-entertainment-collection',?,?,?)`).bind(lockOwner, startedAt, new Date(now.getTime() + 20 * 60000).toISOString()).run();
  if (!lock.meta?.changes) return { skipped: true, reason: "RUN_IN_PROGRESS", rankingDate, rankingUrl,
    checkedCount: 0, newArticleCount: 0, duplicateCount: 0, failedCount: 0 };
  await env.DB.prepare(`INSERT INTO nate_collection_runs (id,ranking_date,ranking_url,started_at,status)
    VALUES (?,?,?,?,'running')`).bind(runId, rankingDate, rankingUrl, startedAt).run();
  const summary = { checkedCount: 0, newArticleCount: 0, duplicateCount: 0, failedCount: 0 };
  try {
    const html = await fetchHtml(rankingUrl, "NATE_RANKING");
    const items = parseNateEntertainmentRanking(html, rankingDate, startedAt);
    summary.checkedCount = items.length;
    for (const item of items) {
      try {
        const existing = await existingArticle(env, item);
        if (existing) { await recordRank(env, existing, item, startedAt); summary.duplicateCount += 1; continue; }
        const result = await createNewArticle(env, item, startedAt);
        if (result.duplicate) summary.duplicateCount += 1; else summary.newArticleCount += 1;
      } catch (error) {
        if (error.newArticleCreated) summary.newArticleCount += 1;
        summary.failedCount += 1;
        console.error(`Nate article failed rank=${item.rank}`, error.message);
      }
    }
    await env.DB.prepare(`UPDATE nate_collection_runs SET checked_count=?,new_article_count=?,duplicate_count=?,failed_count=?,
      completed_at=?,status='completed' WHERE id=?`).bind(summary.checkedCount, summary.newArticleCount,
      summary.duplicateCount, summary.failedCount, new Date().toISOString(), runId).run();
    return { ...summary, rankingDate, rankingUrl, skipped: false };
  } catch (error) {
    const message = NATE_ERROR[error.message] || error.message;
    await env.DB.prepare(`UPDATE nate_collection_runs SET checked_count=?,failed_count=?,completed_at=?,status='failed',error_message=? WHERE id=?`)
      .bind(summary.checkedCount, Math.max(1, summary.failedCount), new Date().toISOString(), message.slice(0, 1000), runId).run();
    throw Object.assign(error, { publicMessage: message });
  } finally {
    await env.DB.prepare("DELETE FROM automation_locks WHERE lock_name='nate-entertainment-collection' AND owner_id=?")
      .bind(lockOwner).run();
  }
}

export async function onRequestPost({ request, env }) {
  let body = {};
  try { const text = await request.text(); if (text.trim()) body = JSON.parse(text); }
  catch { return failure("올바른 JSON 요청이 아닙니다.", 400); }
  if (body.sources && (!Array.isArray(body.sources) || body.sources.some((source) => source !== NATE_SOURCE_TYPE))) {
    return failure("연예뉴스 수집 소스는 네이트 연예 랭킹뉴스만 사용할 수 있습니다.", 400);
  }
  const rankingDate = body.date || getKoreaDateString();
  if (!validRankingDate(rankingDate)) return failure("랭킹 날짜는 YYYYMMDD 형식이어야 합니다.", 400);
  try {
    const data = await collectNateEntertainment(env, { rankingDate });
    return json({ success: true, data: { ...data, totalFetched: data.checkedCount,
      inserted: data.newArticleCount, duplicates: data.duplicateCount, failed: data.failedCount,
      source: { id: NATE_SOURCE_TYPE, name: "네이트 연예 랭킹뉴스" } } }, data.skipped ? 202 : 200);
  } catch (error) {
    console.error("Nate collection failed", error.message);
    return failure(error.publicMessage || "네이트 연예 랭킹뉴스 수집에 실패했습니다.", 502);
  }
}

export function onRequest(context) {
  if (context.request.method !== "POST") {
    return failure("POST 요청만 허용됩니다.", 405, { Allow: "POST" });
  }
  return onRequestPost(context);
}
