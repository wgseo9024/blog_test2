import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { chromium } from "playwright";
import { findEditorAcrossFrames, waitForMainFrame } from "../src/naver-selectors.js";

test("mainFrame iframe 내부의 제목과 본문 contenteditable을 탐지한다", async (t) => {
  const editorHtml = `<!doctype html><html><head><style>
    html, body { width: 900px; height: 700px; margin: 0; }
    [contenteditable] { display:block; width:700px; }
    [data-placeholder*=\"제목\"] { height:40px; }
    .se-main-container { margin-top:30px; }
    .se-main-container [contenteditable] { height:300px; }
  </style></head><body>
  <div contenteditable="true" data-placeholder="제목을 입력하세요"></div>
  <div class="se-main-container"><div contenteditable="true" aria-label="본문"></div></div>
  </body></html>`;
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(request.url.startsWith("/PostWriteForm") ? editorHtml
      : '<iframe id="mainFrame" name="mainFrame" style="width:900px;height:700px" src="/PostWriteForm.naver"></iframe>');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  const address = server.address();
  await page.goto(`http://127.0.0.1:${address.port}/`);

  const main = await waitForMainFrame(page);
  assert.equal(main.found, true);
  assert.equal(main.urlConfirmed, true);
  await main.frame.locator('[data-placeholder*="제목"]').waitFor({ state: "visible" });
  const result = await findEditorAcrossFrames(page, main.frame);
  assert.ok(result.title, `제목 후보=${result.titleCount}, 본문 후보=${result.bodyCount}`);
  assert.ok(result.body, `제목 후보=${result.titleCount}, 본문 후보=${result.bodyCount}`);
  assert.equal(result.frame, main.frame);
});
