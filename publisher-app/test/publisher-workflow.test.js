import test from "node:test";
import assert from "node:assert/strict";
import {
  findImageControl, insertImageTextSequence, PublisherStageError, selectCategoryIfPresent,
  expectedSequenceLog, uploadSingleImage, validateDraftAssets,
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

for (const imageCount of [1, 2, 3, 4, 5]) test(`이미지 ${imageCount}장 입력 순서를 동적으로 생성한다`, async () => {
  const events = [];
  const bodyLocator = { click: async () => {}, press: async () => {}, pressSequentially: async (text) => events.push(text) };
  const frame = { locator: () => ({ count: async () => Math.min(imageCount, 4) }) };
  await insertImageTextSequence({ page: {}, frame, bodyLocator,
    files: Array.from({ length: imageCount }, (_, index) => `image${index}`), bodyBlocks: Array.from({ length: 7 }, (_, index) => `block${index}`),
    upload: async (_page, _frame, file) => { events.push(file); return events.length; },
  });
  assert.equal(`예상 입력 순서: ${events.join(" → ")}`, expectedSequenceLog(imageCount, 7));
});

test("카테고리 UI가 없어도 기존 선택을 유지한다", async () => {
  const messages = [];
  const invisible = { first: () => ({ isVisible: async () => false }) };
  const scope = { locator: () => invisible, getByRole: () => invisible, getByText: () => invisible };
  const selected = await selectCategoryIfPresent({ page: scope, frame: scope, categoryName: "연예", log: async (message) => messages.push(message) });
  assert.equal(selected, false);
  assert.deepEqual(messages, ["카테고리 선택 생략: 기존 선택 유지"]);
});
