import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("기존 Publisher lease 경로를 유지한다",async()=>assert.match(await readFile(new URL("../src/index.js",import.meta.url),"utf8"),/\/api\/publisher\/lease/));
test("로그인 만료 결과를 서버가 login_required로 재처리 가능하게 유지한다",async()=>assert.match(await readFile(new URL("../../functions/api/publisher/result.js",import.meta.url),"utf8"),/login_required/));
test("네이버 실패 경로는 published를 기록하지 않는다",async()=>{const src=await readFile(new URL("../src/index.js",import.meta.url),"utf8");assert.match(src,/catch \(error\)[\s\S]*result: "failed"/);});
