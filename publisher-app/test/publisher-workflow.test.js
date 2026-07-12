import test from "node:test";
import assert from "node:assert/strict";
import {
  findImageControl, insertImageTextSequence, PublisherStageError, selectCategoryIfPresent,
  uploadSingleImage, validateDraftAssets,
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

test("이미지 4장 미만이면 image_pending으로 중단한다", () => {
  assert.throws(() => validateDraftAssets(draft(3, 7)), (error) => error instanceof PublisherStageError && error.result === "image_pending");
});

test("body_blocks 7개 미만이면 queued 복구 대상으로 중단한다", () => {
  assert.throws(() => validateDraftAssets(draft(4, 6)), (error) => error instanceof PublisherStageError && error.result === "retry");
});

test("이미지1-문장1부터 이미지4-문장4 후 문장7까지 순서대로 입력한다", async () => {
  const events = [];
  const bodyLocator = {
    click: async () => {}, press: async () => {},
    pressSequentially: async (text) => events.push(text),
  };
  const frame = { locator: () => ({ count: async () => 4 }) };
  await insertImageTextSequence({ page: {}, frame, bodyLocator,
    files: ["i1", "i2", "i3", "i4"], bodyBlocks: draft().body_blocks,
    upload: async (_page, _frame, file) => { events.push(file); return Number(file.at(-1)); },
  });
  assert.deepEqual(events, ["i1", "문장 1", "i2", "문장 2", "i3", "문장 3", "i4", "문장 4", "문장 5", "문장 6", "문장 7"]);
});

test("카테고리 UI가 없어도 기존 선택을 유지한다", async () => {
  const messages = [];
  const invisible = { first: () => ({ isVisible: async () => false }) };
  const scope = { locator: () => invisible, getByRole: () => invisible, getByText: () => invisible };
  const selected = await selectCategoryIfPresent({ page: scope, frame: scope, categoryName: "연예", log: async (message) => messages.push(message) });
  assert.equal(selected, false);
  assert.deepEqual(messages, ["카테고리 선택 생략: 기존 선택 유지"]);
});
