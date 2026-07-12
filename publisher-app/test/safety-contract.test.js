import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("기존 Publisher lease 경로를 유지한다",async()=>assert.match(await readFile(new URL("../src/index.js",import.meta.url),"utf8"),/\/api\/publisher\/lease/));
test("로그인 만료 결과를 서버가 login_required로 재처리 가능하게 유지한다",async()=>assert.match(await readFile(new URL("../../functions/api/publisher/result.js",import.meta.url),"utf8"),/login_required/));
test("네이버 실패 경로는 lease를 해제하고 queued로 되돌린다",async()=>{const src=await readFile(new URL("../src/index.js",import.meta.url),"utf8");assert.match(src,/catch \(error\)[\s\S]*result: "released"/);});
test("에디터 필드 탐지 전에 기존 작성글 팝업을 처리한다",async()=>{const src=await readFile(new URL("../src/index.js",import.meta.url),"utf8");const popup=src.indexOf("dismissExistingDraftPopup(page)");const title=src.indexOf("firstVisible(page, editorSelectors.title)");assert.ok(popup>=0&&popup<title);});
test("기존 작성글 팝업 문구와 취소 버튼을 제한한다",async()=>{const src=await readFile(new URL("../src/naver-selectors.js",import.meta.url),"utf8");assert.match(src,/작성 중인 글이 있습니다\|이어서 작성하시겠습니까/);assert.match(src,/getByRole\("button", \{ name: cancelButtonName \}\)/);assert.match(src,/state: "hidden", timeout: 10000/);});
