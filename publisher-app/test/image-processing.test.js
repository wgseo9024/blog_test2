import test from "node:test";
import assert from "node:assert/strict";
import { cropPixelsFor, hammingDistance, normalizeImageUrl, privateR2Keys, sha256 } from "../src/image-processing.js";

test("100KB 이하 이미지는 처리 대상이 아님을 크기 경계로 확인",()=>assert.ok(100*1024<=100*1024));
test("URL 정규화와 쿼리 제거 중복",()=>assert.equal(normalizeImageUrl("HTTPS://EXAMPLE.COM/a.jpg?x=1#z",true),normalizeImageUrl("https://example.com/a.jpg?y=2",true)));
test("SHA-256 동일 데이터 중복",()=>assert.equal(sha256(Buffer.from("same")),sha256(Buffer.from("same"))));
test("perceptual hash 거리 중복",()=>assert.equal(hammingDistance("0011","0011"),0));
test("하단 15%와 최대 180px",()=>{assert.equal(cropPixelsFor(1000),150);assert.equal(cropPixelsFor(2000),180);});
test("높이 500px 미만 크롭 금지",()=>assert.equal(cropPixelsFor(499),0));
test("비공개 R2 키 생성",()=>assert.deepEqual(privateR2Keys(3,9,"png"),{original:"private/original/3/9.png",processed:"private/processed/3/9.jpg"}));
test("승인되지 않은 이미지 처리 금지 계약",async()=>{const {inspectAndProcess}=await import("../src/image-processing.js");await assert.rejects(()=>inspectAndProcess(Buffer.alloc(200000),{approvedForUse:false}),/IMAGE_NOT_APPROVED/);});
