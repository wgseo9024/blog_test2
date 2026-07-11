import test from "node:test";
import assert from "node:assert/strict";
import { scoreAdvertisement } from "../functions/lib/advertisement.js";
import { normalizeTags, validateWriterOutput, validateWithOneRevision } from "../functions/lib/draft-validation.js";
import { validateGeneratedPost } from "../functions/api/generate.js";
import { collectSource } from "../functions/api/news/collect.js";

const blocks = Array.from({length:7},(_,i)=>`${i+1}번째 문장은 기사에서 확인된 사실을 중심으로 독자가 맥락을 이해하도록 구체적으로 설명하고 확인되지 않은 반응이나 추측을 배제하며 보도의 핵심을 신중하게 정리합니다.`);
while(blocks.join("").length<600) blocks[6]+=" 확인된 범위만 전합니다.";
if(blocks.join("").length>800) throw new Error("fixture length");
const validDraft={bodyBlocks:blocks,tags:Array.from({length:10},(_,i)=>`태그${i+1}`)};

test("광고 점수와 사유를 누적해 저장 가능한 결과를 만든다",()=>{const result=scoreAdvertisement({title:"유료 광고 단독 특가",content:"브랜드 제공 제품을 지금 구매하기 할인 판매합니다. https://a.test/1 https://a.test/2 https://a.test/3"});assert.equal(result.isAdvertisement,true);assert.ok(result.score>=60);assert.ok(result.reasons.length>=2);});
test("단어 하나만으로 광고 판정하지 않는다",()=>assert.equal(scoreAdvertisement({title:"광고 촬영 소식"}).isAdvertisement,false));
test("bodyBlocks 7개와 600~800자, tags 10개를 검증한다",()=>assert.equal(validateWriterOutput(validDraft).valid,true));
test("본문 길이 오류를 검출한다",()=>assert.ok(validateWriterOutput({...validDraft,bodyBlocks:Array(7).fill("짧은 문장입니다.")}).issues.some(x=>x.code==="BODY_LENGTH")));
test("90자 미만 문장을 검출한다",()=>{const invalid={...validDraft,bodyBlocks:["짧은 문장입니다.",...validDraft.bodyBlocks.slice(1)]};assert.ok(validateWriterOutput(invalid).issues.some(x=>x.code==="BODY_BLOCK_MIN_LENGTH"));});
test("중복 태그 제거 후 개수 오류를 검출한다",()=>{assert.deepEqual(normalizeTags(["a","a","b"]),["a","b"]);assert.ok(validateWriterOutput({...validDraft,tags:Array(10).fill("중복")}).issues.some(x=>x.code==="TAG_COUNT"));});
test("태그 #을 금지한다",()=>assert.ok(validateWriterOutput({...validDraft,tags:["#금지",...validDraft.tags.slice(1)]}).issues.some(x=>x.code==="TAG_HASH")));
test("Validator 실패 후 정확히 한 번 재작성한다",async()=>{let calls=0,revisions=0;const out=await validateWithOneRevision({},async()=>({valid:++calls===2,issues:["x"]}),async()=>{revisions++;return {fixed:true}});assert.equal(revisions,1);assert.equal(out.reviewRequired,false);});
test("두 번째 실패는 review_required로 표시한다",async()=>{const out=await validateWithOneRevision({},async()=>({valid:false,issues:["x"]}),async()=>({}));assert.equal(out.reviewRequired,true);});
test("수동 생성 본문도 7문장·각 90자 이상·600~800자와 태그 10개를 강제한다",()=>{const tags=Array.from({length:10},(_,i)=>`태그${i}`);const valid=Array(7).fill(`${"가".repeat(89)}.`).join(" ");assert.equal(validateGeneratedPost({content:valid,tags}).valid,true);assert.equal(validateGeneratedPost({content:Array(7).fill(`${"가".repeat(88)}.`).join(" "),tags}).valid,false);assert.equal(validateGeneratedPost({content:Array(6).fill(`${"가".repeat(99)}.`).join(" "),tags}).valid,false);});
test("RSS 기사를 파싱한 뒤 광고 판정하고 저장한다",async()=>{const originalFetch=globalThis.fetch;globalThis.fetch=async()=>new Response(`<?xml version="1.0"?><rss><channel><item><title>새 연예 기사</title><link>https://example.com/article/1</link><description>기사 요약입니다.</description></item></channel></rss>`);const env={DB:{prepare(sql){return{bind(){return{first:async()=>sql.startsWith("SELECT")?null:{id:1},run:async()=>({success:true})}}}}}};try{const result=await collectSource(env,{name:"테스트 언론사",url:"https://example.com/rss"});assert.equal(result.fetched,1);assert.equal(result.inserted,1);assert.equal(result.failed,0);}finally{globalThis.fetch=originalFetch;}});
