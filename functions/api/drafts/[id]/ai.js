import { VALIDATOR_PROMPT, WRITER_PROMPT, factsForGroup, response, schemas } from "../../groups/[id]/generate.js";
import { renderDraft, validateWriterOutput } from "../../../lib/draft-validation.js";
const out=(body,status=200)=>Response.json(body,{status,headers:{"Cache-Control":"no-store"}});
const fail=(message,status=400)=>out({success:false,error:{message}},status);
const parse=(value,fallback=[])=>{try{return JSON.parse(value||"[]");}catch{return fallback;}};
export async function onRequestPost({request,env,params}) {
  const id=Number(params.id);if(!Number.isSafeInteger(id)||id<1)return fail("올바른 초안 id가 아닙니다.");
  let body;try{body=await request.json();}catch{return fail("올바른 JSON 요청이 아닙니다.");}
  if(!["regenerate_title","regenerate_body","revalidate"].includes(body?.action))return fail("지원하지 않는 AI 동작입니다.");
  if(!env.OPENAI_API_KEY||!env.OPENAI_MODEL)return fail("OpenAI 설정을 확인해 주세요.",503);
  const draft=await env.DB.prepare("SELECT * FROM drafts WHERE id=?").bind(id).first();if(!draft)return fail("초안을 찾을 수 없습니다.",404);
  const articles=(await env.DB.prepare(`SELECT a.id,a.title,a.source,COALESCE(a.extracted_content,a.summary,a.content) content FROM article_group_items gi JOIN articles a ON a.id=gi.article_id WHERE gi.group_id=? AND COALESCE(a.is_advertisement,0)=0 ORDER BY COALESCE(a.published_at,a.created_at) DESC LIMIT 3`).bind(draft.article_group_id).all()).results||[];
  if(!articles.length)return fail("검수 근거 기사를 찾을 수 없습니다.",422);
  const {facts,cacheHit}=await factsForGroup(env,draft.article_group_id,articles,"draft_action_facts");
  let current={title:draft.title,bodyBlocks:parse(draft.body_blocks_json),tags:parse(draft.tags_json,draft.tags)};
  if(body.action==="regenerate_title") {
    const schema={type:"object",properties:{title:{type:"string"}},required:["title"],additionalProperties:false};
    const value=await response(env,"draft_title_only","기사와 Fact만 근거로 과장 없는 제목 하나를 작성하라.",{articles,facts,currentTitle:current.title},schema);
    current.title=String(value.title||"").trim().slice(0,500);
  } else if(body.action==="regenerate_body") {
    const value=await response(env,"draft_body_only",`${WRITER_PROMPT} 기존 제목은 유지하고 본문과 태그만 다시 작성하라.`,{articles,facts,title:current.title},schemas.writer);
    current={title:current.title,bodyBlocks:value.bodyBlocks,tags:value.tags};
  }
  let local=validateWriterOutput(current);
  let ai=await response(env,"draft_revalidator",VALIDATOR_PROMPT,{articles,facts,draft:current,localIssues:local.issues},schemas.validator);
  let issues=[...local.issues,...(ai.valid?[]:ai.issues)];
  if(body.action==="regenerate_body"&&issues.length){
    const value=await response(env,"draft_body_revision",`${WRITER_PROMPT}\n다음 검수 문제만 바로잡아 본문과 태그를 한 번 수정하라. 기존 제목은 유지하라.`,{articles,facts,title:current.title,previousDraft:current,issues},schemas.writer);
    current={title:current.title,bodyBlocks:value.bodyBlocks,tags:value.tags};
    local=validateWriterOutput(current);
    ai=await response(env,"draft_revalidator_retry",VALIDATOR_PROMPT,{articles,facts,draft:current,localIssues:local.issues},schemas.validator);
    issues=[...local.issues,...(ai.valid?[]:ai.issues)];
  }
  const validationStatus=issues.length?"review_required":"passed";
  const status=issues.length?"review":draft.status;
  const rendered=renderDraft(local.bodyBlocks,local.tags);
  const saved=await env.DB.prepare(`UPDATE drafts SET title=?,content=?,tags=?,body_blocks_json=?,tags_json=?,rendered_content=?,generation_model=?,generation_status=?,validation_status=?,validation_issues_json=?,status=?,approval_status='draft',approved_at=NULL,approved_draft_version=NULL,draft_version=draft_version+1,updated_at=CURRENT_TIMESTAMP WHERE id=? RETURNING *`).bind(current.title,rendered,JSON.stringify(local.tags),JSON.stringify(local.bodyBlocks),JSON.stringify(local.tags),rendered,env.OPENAI_MODEL,body.action,validationStatus,JSON.stringify(issues),status,id).first();
  await env.DB.prepare("UPDATE automation_settings SET enabled=0,next_run_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE approved_draft_id=?").bind(id).run();
  return out({success:true,data:{draft:{...saved,bodyBlocks:local.bodyBlocks,tags:local.tags,validationIssues:issues},optimization:{factCacheHit:cacheHit}}});
}
export function onRequest(c){return c.request.method==="POST"?onRequestPost(c):fail("POST 요청만 허용됩니다.",405);}
