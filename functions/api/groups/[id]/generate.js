import { extractAndStore } from "../../../lib/article-content.js";
import { renderDraft, validateWriterOutput } from "../../../lib/draft-validation.js";

const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const ok = (data, status = 200) => json({ success: true, data }, status);
const fail = (message, status, code) => json({ success: false, error: { code, message } }, status);
const idOf = (v) => Number.isSafeInteger(Number(v)) && Number(v) > 0 ? Number(v) : null;
const clean = (v, n = 20000) => typeof v === "string" ? v.trim().slice(0, n) : "";
const outputText = (r) => r?.output_text || r?.output?.flatMap((x) => x.content || []).find((x) => x.type === "output_text")?.text;

const schemas = {
  fact: { type: "object", properties: {
    commonFacts: { type: "array", items: { $ref: "#/$defs/fact" } }, singleSourceFacts: { type: "array", items: { $ref: "#/$defs/fact" } },
    conflicts: { type: "array", items: { $ref: "#/$defs/fact" } }, excludedClaims: { type: "array", items: { $ref: "#/$defs/fact" } },
  }, required: ["commonFacts", "singleSourceFacts", "conflicts", "excludedClaims"], additionalProperties: false,
  $defs: { fact: { type: "object", properties: { text: { type: "string" }, sourceArticleIds: { type: "array", items: { type: "integer" } } }, required: ["text", "sourceArticleIds"], additionalProperties: false } } },
  writer: { type: "object", properties: { title: { type: "string" }, bodyBlocks: { type: "array", items: { type: "string" }, minItems: 6, maxItems: 6 }, tags: { type: "array", items: { type: "string" }, minItems: 10, maxItems: 10 } }, required: ["title", "bodyBlocks", "tags"], additionalProperties: false },
  validator: { type: "object", properties: { valid: { type: "boolean" }, issues: { type: "array", items: { type: "object", properties: { sentence: { type: "string" }, reason: { type: "string" } }, required: ["sentence", "reason"], additionalProperties: false } } }, required: ["valid", "issues"], additionalProperties: false },
};

export async function response(env, name, instructions, payload, schema) {
  const res = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: env.OPENAI_MODEL, instructions, input: JSON.stringify(payload), text: { format: { type: "json_schema", name, strict: true, schema } }, max_output_tokens: 3000, store: false }) });
  const body = await res.json();
  if (!res.ok) throw Object.assign(new Error("OPENAI_API_ERROR"), { status: res.status, detail: body?.error?.code });
  return JSON.parse(outputText(body));
}

export const FACT_PROMPT = "기사 1~3개만 근거로 공통 사실, 단일 출처 사실, 충돌, 제외할 추측을 분리하고 모든 항목에 sourceArticleIds를 붙여라.";
export const WRITER_PROMPT = "Fact와 기사에서 확인된 사실만 사용한다. title, 정확히 6개의 완결된 한 문장 bodyBlocks, 정확히 10개의 중복 없는 # 없는 tags를 출력한다. 6문장 합계는 공백 포함 700~800자다. 소제목, 없는 반응·과거 정보, 장문 복제, 논란 단정을 금지한다.";
export const VALIDATOR_PROMPT = "기사와 Fact에 없는 인물·사건·반응, 반대 설명, 과장 제목, 비난·단정, 원문 과도 복제, 6 blocks, 10 tags, 본문 700~800자를 엄격히 검사하라.";
export { schemas };

export async function generateGroupDraft(env, rawId, options = {}) {
  const groupId = idOf(rawId);
  if (!groupId) return fail("올바른 그룹 id가 아닙니다.", 400, "INVALID_GROUP_ID");
  if (!env.OPENAI_API_KEY || !env.OPENAI_MODEL) return fail("OpenAI 설정을 확인해 주세요.", 500, "OPENAI_CONFIG_ERROR");
  const group = await env.DB.prepare("SELECT id, representative_title FROM article_groups WHERE id=?").bind(groupId).first();
  if (!group) return fail("이슈 그룹을 찾을 수 없습니다.", 404, "GROUP_NOT_FOUND");
  if (options.preventDuplicate !== false && await env.DB.prepare("SELECT id FROM drafts WHERE article_group_id=?").bind(groupId).first()) return fail("이미 초안이 생성된 이슈 그룹입니다.", 409, "DRAFT_EXISTS");
  const rows = (await env.DB.prepare(`SELECT a.* FROM article_group_items i JOIN articles a ON a.id=i.article_id WHERE i.group_id=? AND COALESCE(a.is_advertisement,0)=0 ORDER BY COALESCE(a.published_at,a.created_at) DESC LIMIT 3`).bind(groupId).all()).results || [];
  if (!rows.length) return fail("광고가 아닌 기사가 없어 생성할 수 없습니다.", 422, "NO_ELIGIBLE_ARTICLES");
  for (const article of rows) if (!article.extracted_content) { const x = await extractAndStore(env, article); article.extracted_content = x.text; }
  const articles = rows.map((a) => ({ id: a.id, title: clean(a.title, 500), source: clean(a.source, 200), content: clean(a.extracted_content || a.summary || a.content, 12000) }));
  try {
    const facts = await response(env, "article_facts", FACT_PROMPT, { articles }, schemas.fact);
    let draft = await response(env, "blog_writer", WRITER_PROMPT, { articles, facts }, schemas.writer);
    let local = validateWriterOutput(draft);
    let ai = await response(env, "blog_validator", VALIDATOR_PROMPT, { articles, facts, draft, localIssues: local.issues }, schemas.validator);
    let issues = [...local.issues, ...(ai.valid ? [] : ai.issues)];
    let revised = false;
    if (issues.length) {
      revised = true;
      draft = await response(env, "blog_writer_revision", `${WRITER_PROMPT}\n다음 문제를 한 번만 수정하라.`, { articles, facts, previousDraft: draft, issues }, schemas.writer);
      local = validateWriterOutput(draft);
      ai = await response(env, "blog_validator_retry", VALIDATOR_PROMPT, { articles, facts, draft, localIssues: local.issues }, schemas.validator);
      issues = [...local.issues, ...(ai.valid ? [] : ai.issues)];
    }
    const validationStatus = issues.length ? "review_required" : "passed";
    const status = issues.length ? "review" : (["draft", "review", "queued"].includes(options.status) ? options.status : "draft");
    const rendered = renderDraft(local.bodyBlocks, local.tags);
    const saved = await env.DB.prepare(`INSERT INTO drafts (article_group_id,title,content,tags,status,body_blocks_json,tags_json,rendered_content,source_article_ids_json,generation_model,generation_status,validation_status,validation_issues_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING *`).bind(groupId, clean(draft.title,500), rendered, JSON.stringify(local.tags), status, JSON.stringify(local.bodyBlocks), JSON.stringify(local.tags), rendered, JSON.stringify(rows.map((a)=>a.id)), env.OPENAI_MODEL, revised ? "revised_once" : "generated", validationStatus, JSON.stringify(issues)).first();
    return ok({ draft: { ...saved, tags: local.tags, bodyBlocks: local.bodyBlocks, validationIssues: issues }, article_count: rows.length }, 201);
  } catch (error) {
    console.error("Three-stage generation failed", error);
    return fail("초안 생성 또는 검증에 실패했습니다.", 502, error.message === "OPENAI_API_ERROR" ? "OPENAI_API_ERROR" : "DRAFT_PROCESSING_ERROR");
  }
}

export async function onRequestPost({ env, params }) { return generateGroupDraft(env, params.id); }
export function onRequest(context) { return context.request.method === "POST" ? onRequestPost(context) : fail("POST 요청만 허용됩니다.", 405, "METHOD_NOT_ALLOWED"); }
