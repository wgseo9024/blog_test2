import {
  NATE_RANK_END, NATE_RANK_LIMIT, NATE_RANK_START,
} from "./nate-selectors.js";

const NATE_ORIGIN = "https://news.nate.com";
const TRACKING_PARAMS = new Set([
  "mid", "sect", "list", "cate", "utm_source", "utm_medium", "utm_campaign",
  "utm_term", "utm_content", "fbclid", "gclid", "ref", "source",
]);

export const getKoreaDateString = (date = new Date()) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
}).format(date).replaceAll("-", "");

export const validRankingDate = (value) => /^\d{8}$/.test(String(value || ""));

export const buildNateEntertainmentRankingUrl = (date = new Date()) => {
  const key = date instanceof Date ? getKoreaDateString(date) : String(date);
  if (!validRankingDate(key)) throw new Error("INVALID_RANKING_DATE");
  return `${NATE_ORIGIN}/rank/interest?sc=ent&p=day&date=${key}`;
};

export const decodeHtmlEntities = (value) => String(value || "")
  .replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<")
  .replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));

export const stripMarkup = (value) => decodeHtmlEntities(String(value || "")
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

const attribute = (tag, name) => decodeHtmlEntities(tag.match(
  new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"),
)?.[2] || "");

const absoluteUrl = (raw, base = NATE_ORIGIN) => {
  if (!String(raw || "").trim()) return "";
  try { return new URL(raw, base).href; } catch { return ""; }
};

export const normalizeNateArticleUrl = (rawUrl) => {
  const url = new URL(rawUrl, NATE_ORIGIN);
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(key.toLowerCase()) || key.toLowerCase().startsWith("utm_")) {
      url.searchParams.delete(key);
    }
  }
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  return url.toString();
};

export const extractNateArticleId = (rawUrl) => {
  try { return new URL(rawUrl, NATE_ORIGIN).pathname.match(/\/view\/(\d{8}n\d+)/i)?.[1] || undefined; }
  catch { return undefined; }
};

export const sha256Hex = async (value) => [...new Uint8Array(await crypto.subtle.digest(
  "SHA-256", new TextEncoder().encode(String(value || "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim()),
))].map((byte) => byte.toString(16).padStart(2, "0")).join("");

const rankingChunks = (html) => String(html || "").split(/(?=<dl\b[^>]*class=["'][^"']*\bmduRank\s+rank\d+\b)/i);

export const parseNateEntertainmentRanking = (html, rankingDate, collectedAt = new Date().toISOString()) => {
  const byRank = new Map();
  for (const chunk of rankingChunks(html)) {
    const rank = Number(chunk.match(/<dl\b[^>]*class=["'][^"']*\bmduRank\s+rank(\d+)\b/i)?.[1]);
    if (rank < NATE_RANK_START || rank > NATE_RANK_END || byRank.has(rank)) continue;
    const scope = chunk.slice(0, 6000);
    const linkTag = (scope.match(/<a\b[^>]*href=["'][^"']*\/view\/[^"']+["'][^>]*>/i) || [])[0] || "";
    const articleUrl = absoluteUrl(attribute(linkTag, "href"));
    const title = stripMarkup(scope.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i)?.[1] || "");
    if (!articleUrl || !title || !extractNateArticleId(articleUrl)) continue;
    const imgTag = (scope.match(/<img\b[^>]*>/i) || [])[0] || "";
    const thumbnailUrl = absoluteUrl(attribute(imgTag, "src"), articleUrl) || undefined;
    const publisherMatches = [...scope.matchAll(/<span\b[^>]*class=["'][^"']*\bmedium\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi)];
    const publisher = stripMarkup(publisherMatches[0]?.[1] || "").replace(/\d{4}-\d{2}-\d{2}.*/, "").trim() || undefined;
    byRank.set(rank, { rank, title, articleUrl, nateArticleId: extractNateArticleId(articleUrl),
      thumbnailUrl, publisher, rankingDate, collectedAt });
  }
  const items = [...byRank.values()].sort((a, b) => a.rank - b.rank).slice(0, NATE_RANK_LIMIT);
  if (items.length !== NATE_RANK_LIMIT || new Set(items.map((item) => item.nateArticleId)).size !== NATE_RANK_LIMIT
    || items.some((item, index) => item.rank !== index + 1)) {
    throw new Error("NATE_RANKING_STRUCTURE_CHANGED");
  }
  return items;
};

const metaContent = (html, key) => {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  const tag = tags.find((item) => new RegExp(`(?:property|name)=["']${key}["']`, "i").test(item));
  return tag ? attribute(tag, "content") : "";
};

const linkHref = (html, rel) => {
  const tags = html.match(/<link\b[^>]*>/gi) || [];
  const tag = tags.find((item) => new RegExp(`rel=["']${rel}["']`, "i").test(item));
  return tag ? attribute(tag, "href") : "";
};

const cleanArticleBody = (bodyHtml) => stripMarkup(String(bodyHtml || "")
  .replace(/<SCLINK\b[^>]*>[\s\S]*?<\/SCLINK>/gi, " ")
  .replace(/<(?:div|aside|section)\b[^>]*(?:id|class)=["'][^"']*(?:ad_|advert|recommend|related|ranking|copyright|reporter|subscribe|comment)[^"']*["'][^>]*>[\s\S]*?<\/\1>/gi, " ")
  .replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, " "))
  .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, "")
  .replace(/(?:무단\s*전재|재배포\s*금지|저작권자)[^.。\n]*/gi, "")
  .replace(/\s+/g, " ").trim();

const imageCandidates = (bodyHtml, base) => [...String(bodyHtml || "").matchAll(/<img\b[^>]*>/gi)]
  .map((match, index) => ({ url: absoluteUrl(attribute(match[0], "src"), base), index,
    width: Number(attribute(match[0], "width")) || 0, height: Number(attribute(match[0], "height")) || 0 }))
  .filter((item) => item.url && !/(?:logo|profile|banner|icon|share|pixel|tracking|recommend)/i.test(item.url)
    && !(item.width && item.width <= 300) && !(item.height && item.height <= 300));

export const parseNateArticle = (html, rankingItem) => {
  const bodyHtml = html.match(/<div\b[^>]*id=["']realArtcContents["'][^>]*>([\s\S]*?)(?=<\/div>\s*<\/div>\s*<SCLINK|<SCLINK|<script\b)/i)?.[1] || "";
  const title = stripMarkup(html.match(/<h1\b[^>]*class=["'][^"']*articleSubecjt[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i)?.[1]) || rankingItem.title;
  const publisher = stripMarkup(html.match(/<a\b[^>]*class=["'][^"']*medium[^"']*["'][^>]*>([\s\S]*?)<\/a>/i)?.[1]) || rankingItem.publisher;
  const publishedAt = stripMarkup(html.match(/<span\b[^>]*class=["'][^"']*firstDate[^"']*["'][^>]*>[\s\S]*?<em>([\s\S]*?)<\/em>/i)?.[1]) || undefined;
  const canonicalUrl = absoluteUrl(linkHref(html, "canonical"), rankingItem.articleUrl) || undefined;
  const contentImages = imageCandidates(bodyHtml, rankingItem.articleUrl).map((item) => item.url);
  const jsonLdImages = [...html.matchAll(/"image"\s*:\s*(?:"([^"]+)"|\[\s*"([^"]+)")/gi)].map((m) => m[1] || m[2]);
  const representativeImageUrl = [metaContent(html, "og:image"), metaContent(html, "twitter:image"),
    ...jsonLdImages, ...contentImages, rankingItem.thumbnailUrl].map((url) => absoluteUrl(url, rankingItem.articleUrl)).find(Boolean);
  const originalPublisherUrl = [...bodyHtml.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)]
    .map((match) => absoluteUrl(match[1], rankingItem.articleUrl)).find((url) => url && !new URL(url).hostname.endsWith("nate.com"));
  const body = cleanArticleBody(bodyHtml);
  if (body.length < 80) throw new Error("NATE_ARTICLE_BODY_MISSING");
  if (!representativeImageUrl) throw new Error("NATE_REPRESENTATIVE_IMAGE_MISSING");
  const reporter = body.match(/(?:\[?[^\]]*?=)?\s*([가-힣]{2,4})\s*기자/)?.[1];
  return { rank: rankingItem.rank, title, body, articleUrl: rankingItem.articleUrl,
    normalizedArticleUrl: normalizeNateArticleUrl(rankingItem.articleUrl), nateArticleId: rankingItem.nateArticleId,
    canonicalUrl, originalPublisherUrl, publisher, reporter, publishedAt, representativeImageUrl,
    contentImages, rankingDate: rankingItem.rankingDate };
};
