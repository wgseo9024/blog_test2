import { scoreAdvertisement } from "../../lib/advertisement.js";

const SOURCES = [
  { id: "sports-khan", name: "스포츠경향 연예", url: "https://sports.khan.co.kr/rss/entertainment" },
  { id: "mydaily", name: "마이데일리 스타", url: "https://mydaily.co.kr/star_rss.xml" },
  { id: "newsis", name: "뉴시스 연예", url: "https://www.newsis.com/RSS/entertain.xml" },
  { id: "mbn", name: "MBN 연예", url: "https://www.mbn.co.kr/rss/enter/" },
];

const FEED_LIMIT = 5;
const REQUEST_TIMEOUT_MS = 10000;
const USER_AGENT = "BlogNewsCollector/1.0 (+Cloudflare Pages; RSS reader)";

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

const parseFeed = (xml, source) => {
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
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

const collectSource = async (env, source) => {
  const result = { name: source.name, fetched: 0, inserted: 0, duplicates: 0, failed: 0 };
  let articles;
  try {
    const xml = await fetchFeed(source);
    try {
      const ad = scoreAdvertisement(article);
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

export async function onRequestPost({ request, env }) {
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

export function onRequest(context) {
  if (context.request.method !== "POST") {
    return failure("POST 요청만 허용됩니다.", 405, { Allow: "POST" });
  }
  return onRequestPost(context);
}
