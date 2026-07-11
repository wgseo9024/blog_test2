import { publisherAuthorized } from "../../../lib/auth.js";
const reply=(body,status=200)=>Response.json(body,{status,headers:{"Cache-Control":"no-store"}});
const fail=(message,status=400)=>reply({success:false,error:{message}},status);
const validId=(v)=>Number.isSafeInteger(Number(v))&&Number(v)>0?Number(v):null;
export async function onRequestPost({request,env,params}) {
  if(!publisherAuthorized(request,env))return fail("이미지 처리 결과 기록 권한이 없습니다.",env.PUBLISHER_TOKEN?401:503);
  if(!env.IMAGES_BUCKET)return fail("IMAGES_BUCKET 바인딩이 설정되지 않았습니다.",503);
  const id=validId(params.id); if(!id)return fail("올바른 이미지 id가 아닙니다.");
  const image=await env.DB.prepare(`SELECT ai.*,gi.group_id FROM article_images ai JOIN article_group_items gi ON gi.article_id=ai.article_id WHERE ai.id=? AND ai.approved_for_use=1 AND ai.rights_status='approved' LIMIT 1`).bind(id).first();
  if(!image)return fail("승인된 이미지만 처리 결과를 저장할 수 있습니다.",422);
  let form;try{form=await request.formData();}catch{return fail("multipart/form-data 요청이 필요합니다.");}
  const original=form.get("original"),processed=form.get("processed"),metadata=JSON.parse(String(form.get("metadata")||"{}"));
  if(!(original instanceof File)||!(processed instanceof File))return fail("원본과 처리 이미지 파일이 필요합니다.");
  const ext={"image/jpeg":"jpg","image/png":"png","image/webp":"webp"}[original.type]; if(!ext)return fail("JPG, PNG, WebP 원본만 허용됩니다.",415);
  const originalKey=`private/original/${image.group_id}/${id}.${ext}`,processedKey=`private/processed/${image.group_id}/${id}.jpg`;
  await Promise.all([env.IMAGES_BUCKET.put(originalKey,original.stream(),{httpMetadata:{contentType:original.type}}),env.IMAGES_BUCKET.put(processedKey,processed.stream(),{httpMetadata:{contentType:"image/jpeg"}})]);
  await env.DB.prepare(`UPDATE article_images SET content_type=?,width=?,height=?,size_bytes=?,sha256=?,perceptual_hash=?,crop_percent=?,crop_pixels=?,processing_status='processed',processing_error=NULL,original_r2_key=?,processed_r2_key=? WHERE id=?`).bind(original.type,Number(metadata.width)||null,Number(metadata.height)||null,original.size,String(metadata.sha256||"").slice(0,64)||null,String(metadata.perceptualHash||"").slice(0,64)||null,Number(metadata.cropPercent)||null,Number(metadata.cropPixels)||null,originalKey,processedKey,id).run();
  return reply({success:true,data:{image_id:id,processing_status:"processed",original_r2_key:originalKey,processed_r2_key:processedKey}});
}
export async function onRequestGet({request,env,params}) { if(!publisherAuthorized(request,env))return fail("이미지 조회 권한이 없습니다.",401);const id=validId(params.id);const row=await env.DB.prepare("SELECT processed_r2_key FROM article_images WHERE id=? AND approved_for_use=1").bind(id).first();if(!row?.processed_r2_key)return fail("처리 이미지를 찾을 수 없습니다.",404);const object=await env.IMAGES_BUCKET.get(row.processed_r2_key);if(!object)return fail("R2 객체를 찾을 수 없습니다.",404);return new Response(object.body,{headers:{"Content-Type":object.httpMetadata?.contentType||"image/jpeg","Cache-Control":"private, max-age=60"}}); }
export async function onRequestPut({request,env,params}){if(!publisherAuthorized(request,env))return fail("이미지 검사 기록 권한이 없습니다.",401);const id=validId(params.id);let body;try{body=await request.json();}catch{return fail("올바른 JSON 요청이 아닙니다.");}await env.DB.prepare(`UPDATE article_images SET content_type=COALESCE(?,content_type),width=COALESCE(?,width),height=COALESCE(?,height),size_bytes=COALESCE(?,size_bytes),sha256=COALESCE(?,sha256),perceptual_hash=COALESCE(?,perceptual_hash),duplicate_of=?,exclude_reason=?,processing_status=?,processing_error=? WHERE id=?`).bind(body.content_type||null,Number(body.width)||null,Number(body.height)||null,Number(body.size_bytes)||null,body.sha256||null,body.perceptual_hash||null,Number(body.duplicate_of)||null,body.exclude_reason||null,body.processing_status||"failed",body.processing_error||null,id).run();return reply({success:true,data:{image_id:id}});}
export function onRequest(c){if(c.request.method==="POST")return onRequestPost(c);if(c.request.method==="GET")return onRequestGet(c);if(c.request.method==="PUT")return onRequestPut(c);return fail("GET, POST, PUT 요청만 허용됩니다.",405);}
