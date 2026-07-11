const json = (data, status = 200, headers = {}) => Response.json(data, {
  status,
  headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers },
});

const success = (data, status = 200) => json({ success: true, data }, status);
const failure = (message, status, code, headers) =>
  json({ success: false, error: { code, message } }, status, headers);

const validId = (value) => {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

const clean = (value, maxLength) =>
  typeof value === "string" ? value.trim().slice(0, maxLength) : "";

const INSTRUCTIONS = `너는 여러 연예뉴스 기사를 교차 비교해 네이버 연예·방송 블로그 초안을 작성하는 편집자다.

반드시 지킬 원칙:
- 입력으로 제공된 기사 제목, 출처, 요약, RSS content에 있는 사실만 사용한다.
- 기사 문장을 길게 그대로 복사하지 않고 새 문장으로 재구성한다.
- 여러 기사에 공통으로 등장하는 사실과 일부 기사만 전하는 추가 정보를 명확히 구분한다.
- 기사끼리 세부 내용이 다르면 어느 하나를 사실로 단정하지 말고 보도 내용에 차이가 있다고 표현한다.
- 확인되지 않은 추측, 배경 지식, 인물 평가, 새로운 수치나 사실을 추가하지 않는다.
- 제목은 과장 없이 의외성과 궁금증이 생기도록 쓴다.
- 본문은 자연스러운 도입, 내용에 맞는 소제목 정확히 3개, 마무리 순서로 작성한다.
- 소제목은 각기 독립된 줄에 표시하고, 전체 본문은 공백 포함 약 900~1100자로 쓴다.
- 자연스럽고 읽기 쉬운 네이버 연예·방송 블로그 문체를 사용한다.
- tags는 관련 태그 정확히 10개이며 # 문자를 넣지 않는다.`;

const selectArticles = (articles) => {
  const selected = [];
  const usedSources = new Set();
  for (const article of articles) {
    const source = clean(article.source, 300) || "출처 없음";
    if (!usedSources.has(source)) {
      selected.push(article);
      usedSources.add(source);
      if (selected.length === 5) return selected;
    }
  }
  for (const article of articles) {
    if (!selected.includes(article)) selected.push(article);
    if (selected.length === 5) break;
  }
  return selected;
};

const extractOutputText = (result) => result?.output_text || result?.output
  ?.flatMap((item) => item.content || [])
  .find((item) => item.type === "output_text")?.text;

const classifyOpenAIError = (response, result) => {
  const code = result?.error?.code || "";
  if (response.status === 429 || ["insufficient_quota", "rate_limit_exceeded"].includes(code)) {
    return { code: "OPENAI_USAGE_ERROR", message: "OpenAI API 사용량 또는 요청 한도를 확인해 주세요." };
  }
  if (["model_not_found", "invalid_model"].includes(code) || (response.status === 404 && code)) {
    return { code: "OPENAI_MODEL_ERROR", message: "설정된 OpenAI 모델을 사용할 수 없습니다. OPENAI_MODEL 값을 확인해 주세요." };
  }
  return { code: "OPENAI_API_ERROR", message: "OpenAI에서 초안을 생성하지 못했습니다. 잠시 후 다시 시도해 주세요." };
};

export async function generateGroupDraft(env, rawGroupId, options = {}) {
  const groupId = validId(rawGroupId);
  if (!groupId) return failure("올바른 그룹 id가 아닙니다.", 400, "INVALID_GROUP_ID");
  if (!env.OPENAI_API_KEY) return failure("초안 생성 서비스 설정을 확인해 주세요.", 500, "OPENAI_CONFIG_ERROR");
  if (!env.OPENAI_MODEL) return failure("초안 생성 모델 설정을 확인해 주세요.", 500, "OPENAI_MODEL_ERROR");

  let group;
  let articles;
  try {
    group = await env.DB.prepare(
      "SELECT id, representative_title FROM article_groups WHERE id = ? LIMIT 1",
    ).bind(groupId).first();
    if (!group) return failure("이슈 그룹을 찾을 수 없습니다.", 404, "GROUP_NOT_FOUND");

    const preventDuplicate = options.preventDuplicate !== false;
    if (preventDuplicate) {
      const existing = await env.DB.prepare(
        "SELECT id FROM drafts WHERE article_group_id = ? LIMIT 1",
      ).bind(groupId).first();
      if (existing) return failure("이미 초안이 생성된 이슈 그룹입니다.", 409, "DRAFT_EXISTS");
    }

    const query = await env.DB.prepare(`SELECT a.id, a.title, a.url, a.source, a.summary, a.content,
      a.extracted_content, a.extraction_status, a.published_at
      FROM article_group_items i
      JOIN articles a ON a.id = i.article_id
      WHERE i.group_id = ?
      ORDER BY COALESCE(a.published_at, a.created_at) DESC, a.id DESC`).bind(groupId).all();
    articles = query.results || [];
  } catch (error) {
    console.error("Group draft source query error", error);
    return failure("초안 생성에 필요한 기사를 불러오지 못했습니다.", 500, "DATABASE_ERROR");
  }

  if (articles.length < 2) {
    return failure("서로 비교할 기사가 2개 이상인 그룹만 초안을 생성할 수 있습니다.", 422, "NOT_ENOUGH_ARTICLES");
  }

  const selected = selectArticles(articles);
  for (const article of selected) {
    if (article.extracted_content) continue;
    try {
      const extracted = await extractAndStore(env, article);
      article.extracted_content = extracted.text;
      article.extraction_status = extracted.status;
    } catch (error) {
      console.error("Article extraction storage failed", article.id, error);
    }
  }
  const input = selected.map((article, index) => ({
    article: index + 1,
    title: clean(article.title, 500),
    source: clean(article.source, 300) || "출처 없음",
    summary: clean(article.summary, 5000),
    key_content: clean(article.extracted_content || article.summary || article.content, 12000),
    extraction_status: article.extraction_status || "rss_fallback",
  }));

  let apiResponse;
  let result;
  try {
    apiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: env.OPENAI_MODEL,
        instructions: INSTRUCTIONS,
        input: [{ role: "user", content: [{ type: "input_text", text: JSON.stringify({
          issue_title: clean(group.representative_title, 500),
          articles: input,
        }) }] }],
        text: {
          format: {
            type: "json_schema",
            name: "group_blog_draft",
            strict: true,
            schema: {
              type: "object",
              properties: {
                title: { type: "string" },
                content: { type: "string" },
                tags: { type: "array", items: { type: "string" }, minItems: 10, maxItems: 10 },
              },
              required: ["title", "content", "tags"],
              additionalProperties: false,
            },
          },
        },
        max_output_tokens: 2500,
        store: false,
      }),
    });
    result = await apiResponse.json();
  } catch (error) {
    console.error("OpenAI request error", error);
    return failure("OpenAI 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.", 502, "OPENAI_API_ERROR");
  }

  if (!apiResponse.ok) {
    console.error("OpenAI API error", apiResponse.status, result?.error?.code);
    const publicError = classifyOpenAIError(apiResponse, result);
    return failure(publicError.message, apiResponse.status >= 500 ? 502 : apiResponse.status, publicError.code);
  }

  let draft;
  try {
    const parsed = JSON.parse(extractOutputText(result));
    const title = clean(parsed.title, 500);
    const content = clean(parsed.content, 20000);
    const tags = Array.isArray(parsed.tags)
      ? parsed.tags.map((tag) => clean(tag, 100).replace(/^#+/, "")).filter(Boolean)
      : [];
    if (!title || !content || tags.length !== 10) throw new Error("Invalid structured output");

    const status = ["draft", "review", "queued"].includes(options.status) ? options.status : "draft";
    if (preventDuplicate) {
      const existing = await env.DB.prepare(
        "SELECT id FROM drafts WHERE article_group_id = ? LIMIT 1",
      ).bind(groupId).first();
      if (existing) return failure("이미 초안이 생성된 이슈 그룹입니다.", 409, "DRAFT_EXISTS");
    }
    const insertSql = preventDuplicate
      ? `INSERT INTO drafts (article_group_id, title, content, tags, status)
        SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS
          (SELECT 1 FROM drafts WHERE article_group_id = ?)
        RETURNING id, article_group_id, title, content, tags, status, created_at, updated_at`
      : `INSERT INTO drafts (article_group_id, title, content, tags, status)
        VALUES (?, ?, ?, ?, ?)
        RETURNING id, article_group_id, title, content, tags, status, created_at, updated_at`;
    const statement = env.DB.prepare(insertSql);
    draft = preventDuplicate
      ? await statement.bind(groupId, title, content, JSON.stringify(tags), status, groupId).first()
      : await statement.bind(groupId, title, content, JSON.stringify(tags), status).first();
    if (!draft && preventDuplicate) {
      return failure("이미 초안이 생성된 이슈 그룹입니다.", 409, "DRAFT_EXISTS");
    }
    draft.tags = tags;
  } catch (error) {
    console.error("Draft output or save error", error);
    return failure("생성 결과를 저장하지 못했습니다. 다시 시도해 주세요.", 502, "DRAFT_PROCESSING_ERROR");
  }

  return success({ draft, article_count: selected.length }, 201);
}

export async function onRequestPost({ env, params }) {
  return generateGroupDraft(env, params.id);
}

export function onRequest(context) {
  if (context.request.method !== "POST") {
    return failure("POST 요청만 허용됩니다.", 405, "METHOD_NOT_ALLOWED", { Allow: "POST" });
  }
  return onRequestPost(context);
}
import { extractAndStore } from "../../../lib/article-content.js";
