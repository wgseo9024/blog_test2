import test from "node:test";
import assert from "node:assert/strict";
import {
  ensureTextBlockAfterLastImage, findImageControl, insertImageTextSequence, PublisherStageError, selectCategoryIfPresent,
  expectedSequenceLog, textBlockCount, uploadSingleImage, validateDraftAssets, verifyDomSequence, verifyInsertedSentences,
} from "../src/publisher-workflow.js";

const draft = (imageCount = 4, blockCount = 7) => ({
  images: Array.from({ length: imageCount }, (_, id) => ({ id: id + 1 })),
  body_blocks: Array.from({ length: blockCount }, (_, id) => `문장 ${id + 1}`),
});

test("mainFrame의 이미지 file input을 탐지한다", async () => {
  const input = { count: async () => 1 };
  const frame = { locator: (selector) => { assert.equal(selector, 'input[type="file"]'); return { first: () => input }; } };
  const result = await findImageControl(frame);
  assert.equal(result.input, input);
  assert.equal(result.button, null);
});

test("file input이 없으면 file chooser로 업로드한다", async () => {
  let clicked = false; let selected = false; let blocks = 0;
  const fileInput = { count: async () => 0 };
  const button = { isVisible: async () => true, click: async () => { clicked = true; blocks = 1; } };
  const empty = { first: () => ({ isVisible: async () => false }) };
  const frame = {
    locator: (selector) => selector === 'input[type="file"]' ? { first: () => fileInput }
      : selector.includes("se-component") ? { count: async () => blocks } : empty,
    getByRole: () => ({ first: () => button }), getByText: () => empty,
    waitForFunction: async () => {},
  };
  const page = { waitForEvent: async () => ({ setFiles: async () => { selected = true; } }) };
  const count = await uploadSingleImage(page, frame, "safe-test.jpg");
  assert.equal(clicked, true); assert.equal(selected, true); assert.equal(count, 1);
});

test("승인 이미지 0장이면 image_pending으로 중단한다", () => {
  assert.throws(() => validateDraftAssets(draft(0, 7)), (error) => error instanceof PublisherStageError && error.result === "image_pending" && error.message === "승인된 처리 이미지가 없습니다.");
});

for (const imageCount of [1, 2, 3, 4]) test(`승인 이미지 ${imageCount}장이면 진행한다`, () => {
  assert.equal(validateDraftAssets(draft(imageCount, 7)).images.length, imageCount);
});

test("승인 이미지 5장이면 정렬된 앞의 4장만 사용한다", () => {
  assert.deepEqual(validateDraftAssets(draft(5, 7)).images.map(({ id }) => id), [1, 2, 3, 4]);
});

test("body_blocks 7개 미만이면 queued 복구 대상으로 중단한다", () => {
  assert.throws(() => validateDraftAssets(draft(4, 6)), (error) => error instanceof PublisherStageError && error.result === "retry");
});

class FakeLocator {
  constructor(frame, type, index, { reflect = true } = {}) { this.frame = frame; this.type = type; this.index = index; this.reflect = reflect; }
  async isVisible() { return true; }
  async boundingBox() { return this.type === "image" ? { x: 20, y: 100, width: 500, height: 200 } : { x: 20, y: 330 + this.index * 40, width: 500, height: 30 }; }
  async isDisabled() { return false; }
  async getAttribute(name) { if (name === "contenteditable" && this.type === "text") return "true"; if (name === "class") return this.type === "text" ? "se-text-paragraph" : "se-component se-image"; return null; }
  async click() {}
  async focus() {}
  async pressSequentially(text) { if (this.reflect) this.frame.texts[this.index] = (this.frame.texts[this.index] || "") + text; }
  async press(key) { if (this.type === "text" && key === "Enter") this.frame.addText(); if (this.type === "image" && (key === "Delete" || key === "Backspace")) this.frame.images--; }
  async innerText() { return this.frame.texts[this.index] || ""; }
  async textContent() { return this.innerText(); }
}

class FakeGroup {
  constructor(items) { this.items = items; }
  async count() { return this.items().length; }
  nth(index) { return this.items()[index]; }
  first() { return this.nth(0); }
}

class FakeFrame {
  constructor({ reflect = true } = {}) { this.images = 0; this.texts = []; this.reflect = reflect; }
  addText() { this.texts.push(""); return new FakeLocator(this, "text", this.texts.length - 1, { reflect: this.reflect }); }
  locator(selector) {
    if (selector === 'input[type="file"]') return new FakeGroup(() => []);
    if (selector.includes("se-component.se-image") && !selector.includes("se-text-paragraph")) return new FakeGroup(() => Array.from({ length: this.images }, (_, i) => new FakeLocator(this, "image", i)));
    return new FakeGroup(() => this.texts.map((_text, i) => new FakeLocator(this, "text", i, { reflect: this.reflect })));
  }
  page() { return { mouse: { click: async () => {} }, keyboard: { insertText: async () => {} } }; }
}

test("본문 7개를 먼저 입력한 뒤 첫 문장 앞에 이미지 1장을 삽입한다", async () => {
  const frame = new FakeFrame(); frame.addText();
  const events = [];
  const blocks = Array.from({ length: 7 }, (_, index) => `문장 ${index + 1} 테스트 본문`);
  const result = await insertImageTextSequence({ page: frame.page(), frame, bodyLocator: frame.locator("text").first(), files: ["image0"], bodyBlocks: blocks,
    upload: async () => { events.push("image0"); frame.images++; frame.addText(); return 1; }, log: async (message) => events.push(message), textBlockTimeout: 50 });
  assert.equal(result.sentenceCount, 7);
  assert.equal(result.strategy, "text-first");
  assert.deepEqual(frame.texts.filter(Boolean), blocks);
  assert.equal(await verifyInsertedSentences(frame, frame.locator("text").first(), blocks), 7);
  assert.match(events.join("\n"), /선택한 입력 전략: text-first/);
});

test("이미지 아래 텍스트 블록 생성 실패는 queued 복구용 오류를 낸다", async () => {
  const frame = new FakeFrame(); frame.addText(); frame.images = 1;
  await assert.rejects(() => ensureTextBlockAfterLastImage(frame, { beforeTextCount: 1, timeout: 5 }),
    (error) => error instanceof PublisherStageError && error.result === "retry" && /이미지 후 텍스트 블록 생성 실패/.test(error.message));
});

test("문장 입력 후 DOM 반영 실패 시 즉시 중단한다", async () => {
  const frame = new FakeFrame({ reflect: false }); frame.addText();
  await assert.rejects(() => insertImageTextSequence({ page: frame.page(), frame, bodyLocator: frame.locator("text").first(), files: ["image0"],
    bodyBlocks: Array.from({ length: 7 }, (_, i) => `문장 ${i + 1}`), upload: async () => { frame.images++; frame.addText(); return 1; }, textBlockTimeout: 20 }),
  /문장 1 입력 반영 실패/);
});

test("이미지 먼저 넣은 뒤 텍스트 블록 생성 실패 시 text-first로 전환한다", async () => {
  const frame = new FakeFrame(); frame.addText(); let attempts = 0;
  const logs = [];
  const result = await insertImageTextSequence({ page: frame.page(), frame, bodyLocator: frame.locator("text").first(), files: ["image0"], strategy: "image-first",
    bodyBlocks: Array.from({ length: 7 }, (_, i) => `전환 문장 ${i + 1}`), log: async (line) => logs.push(line), textBlockTimeout: 20,
    upload: async () => { attempts++; frame.images++; return 1; } });
  assert.equal(result.strategy, "text-first");
  assert.equal(attempts, 2);
  assert.match(logs.join("\n"), /삽입 이미지 원상복구: 성공/);
  assert.match(logs.join("\n"), /text-first 전략으로 전환/);
});

test("캡션 contenteditable은 본문 블록 수에서 제외한다", async () => {
  const caption = {
    isVisible: async () => true, boundingBox: async () => ({ x: 0, y: 0, width: 300, height: 30 }), isDisabled: async () => false,
    getAttribute: async (name) => name === "contenteditable" ? "true" : name === "class" ? "se-image-caption" : null,
    evaluate: async () => true, textContent: async () => "이미지 설명",
  };
  const frame = { locator: () => new FakeGroup(() => [caption]) };
  assert.equal(await textBlockCount(frame), 0);
});

test("이미지 1개 최종 DOM 순서를 image0 다음 block0~block6으로 검증한다", async () => {
  const blocks = Array.from({ length: 7 }, (_, i) => `순서 문장 ${i + 1}`);
  const items = [{ image: true, text: "" }, ...blocks.map((text) => ({ image: false, text }))].map((item) => ({
    isVisible: async () => true, evaluate: async () => item.image, textContent: async () => item.text,
  }));
  const frame = { locator: () => new FakeGroup(() => items) };
  const result = await verifyDomSequence(frame, blocks, 1);
  assert.equal(result.valid, true);
  assert.deepEqual(result.found, ["image0", "block0", "block1", "block2", "block3", "block4", "block5", "block6"]);
});

for (const imageCount of [1, 2, 3, 4, 5]) test(`이미지 ${imageCount}장 예상 순서를 동적으로 생성한다`, () => {
  const used = Math.min(imageCount, 4); const expected = [];
  for (let index = 0; index < used; index++) expected.push(`image${index}`, `block${index}`);
  for (let index = used; index < 7; index++) expected.push(`block${index}`);
  assert.equal(expectedSequenceLog(imageCount, 7), `예상 입력 순서: ${expected.join(" → ")}`);
});

test("카테고리 UI가 없어도 기존 선택을 유지한다", async () => {
  const messages = [];
  const invisible = { first: () => ({ isVisible: async () => false }) };
  const scope = { locator: () => invisible, getByRole: () => invisible, getByText: () => invisible };
  const selected = await selectCategoryIfPresent({ page: scope, frame: scope, categoryName: "연예", log: async (message) => messages.push(message) });
  assert.equal(selected, false);
  assert.deepEqual(messages, ["카테고리 선택 생략: 기존 선택 유지"]);
});
