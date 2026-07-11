const TIMEOUT_MS = 8000;
const MAX_HTML_BYTES = 1_000_000;
const MAX_EXTRACTED_LENGTH = 12000;
const USER_AGENT = "BlogNewsResearchBot/1.0 (article summary extraction; contact site owner)";

const SITE_CONTAINERS = [
  { host: "sports.khan.co.kr", patterns: [/class=["'][^"']*(?:art_body|article-body)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i] },
  { host: "mydaily.co.kr", patterns: [/class=["'][^"']*(?:article_content|view_con)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i] },
  { host: "newsis.com", patterns: [/class=["'][^"']*(?:viewer|articleBody)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i] },
  { host: "mbn.co.kr", patterns: [/class=["'][^"']*(?:detail|article)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i] },
];

const decode = (value) => String(value || "")
  .replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<")
  .replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));

const clean = (html) => decode(String(html || "")
  .replace(/<(script|style|noscript|svg|iframe|form|nav|aside|footer|header)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
  .replace(/<(div|section)\b[^>]*(?:class|id)=["'][^"']*(?:advert|ad-|recommend|related|ranking|promotion|copyright|reporter|share)[^"']*["'][^>]*>[\s\S]*?<\/\1>/gi, " ")
  .replace(/<br\s*\/?>|<\/p>|<\/li>|<\/h\d>/gi, "\n")
  .replace(/<[^>]+>/g, " "))
  .replace(/[ \t]+/g, " ").replace(/\n\s*/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

const commonBody = (html) => {
  const article = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1];
  if (article) return article;
  const paragraphs = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((match) => match[1]);
  return paragraphs.join("\n");
};

export const extractArticle = async (article) => {
  const fallback = clean(article.summary || article.content).slice(0, MAX_EXTRACTED_LENGTH);
  if (!/^https?:\/\//i.test(article.url || "")) return { text: fallback, status: "fallback", ogImage: null };
  const target = new URL(article.url);
  const host = target.hostname.toLowerCase();
  if (host === "localhost" || host === "0.0.0.0" || host === "::1"
    || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)
    || /^169\.254\./.test(host) || /^172\.(?:1[6-9]|2\d|3[01])\./.test(host)) {
    return { text: fallback, status: "fallback", ogImage: null };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(article.url, { signal: controller.signal,
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" } });
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    if (!String(response.headers.get("content-type") || "").toLowerCase().includes("text/html")) {
      throw new Error("UNSUPPORTED_CONTENT_TYPE");
    }
    const html = (await response.text()).slice(0, MAX_HTML_BYTES);
    const siteHost = target.hostname.replace(/^www\./, "");
    const site = SITE_CONTAINERS.find((item) => siteHost.endsWith(item.host));
    const selected = site?.patterns.map((pattern) => html.match(pattern)?.[1]).find(Boolean) || commonBody(html);
    const text = clean(selected).slice(0, MAX_EXTRACTED_LENGTH);
    const rawOgImage = html.match(/<meta\b[^>]*(?:property|name)=["']og:image["'][^>]*content=["']([^"']+)["']/i)?.[1]
      || html.match(/<meta\b[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']og:image["']/i)?.[1] || null;
    const ogImage = rawOgImage ? new URL(rawOgImage, target).href : null;
    return { text: text.length >= 80 ? text : fallback, status: text.length >= 80 ? "extracted" : "fallback", ogImage };
  } catch (error) {
    console.error("Article extraction failed", article.id, String(error?.message || error));
    return { text: fallback, status: "fallback", ogImage: null };
  } finally { clearTimeout(timer); }
};

export const extractAndStore = async (env, article) => {
  const result = await extractArticle(article);
  await env.DB.prepare(`UPDATE articles SET extracted_content = ?, extraction_status = ?,
    extracted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .bind(result.text || null, result.status, article.id).run();
  if (result.ogImage && /^https?:\/\//i.test(result.ogImage)) {
    await env.DB.prepare(`INSERT OR IGNORE INTO article_images
      (article_id, image_url, source, article_url, candidate_type) VALUES (?, ?, ?, ?, 'og')`)
      .bind(article.id, result.ogImage.slice(0, 3000), article.source || null, article.url).run();
  }
  return result;
};
