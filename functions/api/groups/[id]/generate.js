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
  writer: { type: "object", properties: { title: { type: "string" }, bodyBlocks: { type: "array", items: { type: "string" }, minItems: 7, maxItems: 7 }, tags: { type: "array", items: { type: "string" }, minItems: 10, maxItems: 10 } }, required: ["title", "bodyBlocks", "tags"], additionalProperties: false },
  validator: { type: "object", properties: { valid: { type: "boolean" }, issues: { type: "array", items: { type: "object", properties: { sentence: { type: "string" }, reason: { type: "string" } }, required: ["sentence", "reason"], additionalProperties: false } } }, required: ["valid", "issues"], additionalProperties: false },
};

export async function response(env, name, instructions, payload, schema) {
  const res = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: env.OPENAI_MODEL, instructions, input: JSON.stringify(payload), text: { format: { type: "json_schema", name, strict: true, schema } }, max_output_tokens: 3000, store: false }) });
  const body = await res.json();
  if (!res.ok) throw Object.assign(new Error("OPENAI_API_ERROR"), { status: res.status, detail: body?.error?.code });
  return JSON.parse(outputText(body));
}

export const FACT_PROMPT = "기사 1~3개만 근거로 공통 사실, 단일 출처 사실, 충돌, 제외할 추측을 분리하고 모든 항목에 sourceArticleIds를 붙여라.";
export const WRITER_PROMPT = `너는 네이버 블로그용 연예뉴스 글을 작성하는 작가다. 제공된 연예뉴스 기사 제목과 기사 내용만 바탕으로 블로그에 바로 올릴 수 있는 글을 작성한다.

제목은 원 기사의 핵심 이슈를 유지하되 문장을 다르게 바꾼다. 과하게 자극적이지 않게 쓰면서 특정 장면, 한마디, 행동 하나를 중심에 두고 궁금증과 의외성을 담는다. “최민수 한마디에 촬영장이 멈췄다, 막내 스태프가 잊지 못한 이유” 같은 느낌을 참고하고, “분위기가 달라졌다”, “시선이 쏠렸다”, “놀란 이유”, “잊지 못한 이유”, “흔든 이유” 같은 표현은 기사 내용에 맞을 때만 자연스럽게 활용한다. 허위 사실처럼 보이거나 과도한 어그로는 피한다.

본문은 기사와 Fact에서 확인된 내용 안에서만 작성하며 없는 내용을 임의로 추가하지 않는다. 원문을 그대로 베끼지 않고 자연스럽게 재구성하고, 딱딱한 기사 요약이 아닌 읽기 쉬운 연예뉴스 전문 블로그 톤으로 쓴다. 정확히 7개의 완결된 한 문장 bodyBlocks를 출력하고, 각 문장은 공백 포함 90자 이상, 7문장 합계는 공백 포함 반드시 600~800자로 맞춘다. 출력 전에 각 문장과 전체 글자 수를 직접 확인한다. 별도 소제목은 넣지 않고 모바일에서 읽기 쉬운 길이로 쓴다.

논란성 내용은 단정하지 않는다. 기사에 근거가 있을 때 “~라고 전했습니다”, “~로 알려졌습니다”, “~라는 반응이 나왔습니다”처럼 조심스럽게 표현한다. 출연자나 연예인을 비난하지 않으며 “인성 논란”, “충격”, “소름” 같은 과한 표현은 꼭 필요한 경우가 아니면 쓰지 않는다. “글쓴이” 대신 문맥에 따라 “A씨는”, “해당 네티즌은”, “당시 스태프는”, “일화를 전한 네티즌은”으로 표현한다.

단순 정보 전달보다 왜 해당 장면이 화제가 됐는지가 드러나게 쓴다. 방송·예능 기사는 기사에 나온 패널 반응, 출연자 한마디, 관계 변화, 의외의 장면을 중심으로 정리한다. title에는 마크다운 기호 없이 제목만 넣고, tags에는 중복 없는 관련 태그를 정확히 10개 넣되 # 기호는 넣지 않는다.`;
export const VALIDATOR_PROMPT = "기사와 Fact에 없는 인물·사건·반응, 과장하거나 자극적인 제목, 비난·단정, 원문 과도 복제 여부를 검사하라. 소제목은 금지이므로 소제목이 있으면 오류이고, 소제목이 없는 것은 정상이다. 정확히 7 blocks, 각 block 90자 이상, 중복 없는 10 tags, 본문 공백 포함 600~800자를 엄격히 검사하라. 문장별 글자 수와 전체 글자 수 조건을 반드시 지켜야 한다.";
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
