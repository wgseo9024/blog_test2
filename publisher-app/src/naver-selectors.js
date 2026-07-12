export const editorSelectors = {
  title: [
    { kind: "css", value: '[contenteditable="true"][data-placeholder*="제목"]' },
    { kind: "css", value: '[contenteditable="true"][aria-label*="제목"]' },
    { kind: "css", value: ".se-title-text" },
    { kind: "css", value: ".se-title-text p" },
    { kind: "css", value: ".se-documentTitle" },
    { kind: "css", value: ".se-documentTitle p" },
    { kind: "css", value: ".se-title input" },
    { kind: "css", value: 'textarea[placeholder*="제목"]' },
    { kind: "css", value: 'input[placeholder*="제목"]' },
  ],
  body: [
    { kind: "css", value: '.se-main-container [contenteditable="true"]' },
    { kind: "css", value: '.se-component-content [contenteditable="true"]' },
    { kind: "css", value: ".se-text-paragraph" },
    { kind: "css", value: '.se-text-paragraph [contenteditable="true"]' },
    { kind: "css", value: '.se-content [contenteditable="true"]' },
    { kind: "css", value: '[contenteditable="true"][data-placeholder*="내용"]' },
    { kind: "css", value: '[contenteditable="true"][aria-label*="본문"]' },
    { kind: "css", value: '[contenteditable="true"][aria-label*="내용"]' },
    { kind: "css", value: "div.ProseMirror" },
    { kind: "css", value: 'body[contenteditable="true"]' },
  ],
  temporarySave: [{kind:"role",role:"button",name:/임시저장/},{kind:"text",value:/임시저장/}],
  image: [{kind:"css",value:'button[data-name="image"]'},{kind:"css",value:'button[class*="image"]'},{kind:"role",role:"button",name:/사진|이미지/},{kind:"text",value:/사진|이미지/}],
  category: [{kind:"css",value:'button[class*="category"]'},{kind:"css",value:'[class*="category"] button'},{kind:"role",role:"button",name:/카테고리/},{kind:"text",value:/카테고리/}],
};

const existingDraftPrompt = /작성 중인 글이 있습니다|이어서 작성하시겠습니까/;
const cancelButtonName = /^\s*취소\s*$/;

function candidateLocator(scope, item) {
  return item.kind === "role" ? scope.getByRole(item.role, { name: item.name })
    : item.kind === "placeholder" ? scope.getByPlaceholder(item.value)
    : item.kind === "text" ? scope.getByText(item.value)
    : scope.locator(item.value);
}

export async function firstVisible(scope, candidates) {
  for (const item of candidates) {
    const locator = candidateLocator(scope, item).first();
    if (await locator.isVisible().catch(()=>false)) return {locator,selector:`${item.kind}:${item.value || item.name}`};
  }
  return null;
}

export async function waitForMainFrame(page, timeout = 15000) {
  const deadline = Date.now() + timeout;
  await page.locator("iframe#mainFrame").waitFor({ state: "attached", timeout }).catch(() => {});
  while (Date.now() < deadline) {
    let frame = page.frame({ name: "mainFrame" });
    if (!frame) {
      const handle = await page.locator("iframe#mainFrame").elementHandle().catch(() => null);
      frame = await handle?.contentFrame().catch(() => null);
    }
    if (frame && /PostWriteForm|PostWrite/i.test(frame.url())) {
      const loaded = await frame.locator("html").count().then((count) => count > 0).catch(() => false);
      if (loaded) return { frame, found: true, urlConfirmed: true };
    }
    await page.waitForTimeout(250);
  }
  const frame = page.frame({ name: "mainFrame" }) || null;
  return { frame, found: Boolean(frame), urlConfirmed: Boolean(frame && /PostWriteForm|PostWrite/i.test(frame.url())) };
}

async function usableCandidates(scope, candidates, type) {
  const matches = [];
  let count = 0;
  for (const item of candidates) {
    const group = candidateLocator(scope, item);
    const total = await group.count().catch(() => 0);
    count += total;
    for (let index = 0; index < total; index++) {
      const locator = group.nth(index);
      const visible = await locator.isVisible().catch(() => false);
      const box = visible ? await locator.boundingBox().catch(() => null) : null;
      const disabled = await locator.isDisabled().catch(() => false);
      const minimumWidth = type === "body" ? 200 : 50;
      if (visible && box && box.width > minimumWidth && box.height > 10 && !disabled) {
        matches.push({ locator, selector: `css:${item.value}`, box });
      }
    }
  }
  return { count, matches };
}

export async function findEditorFields(scope) {
  const titleCandidates = await usableCandidates(scope, editorSelectors.title, "title");
  const bodyCandidates = await usableCandidates(scope, editorSelectors.body, "body");
  for (const title of titleCandidates.matches) {
    const body = bodyCandidates.matches.find((candidate) =>
      candidate.box.y >= title.box.y + Math.min(title.box.height, 10) && candidate.box.width > 200);
    if (body) return { title, body, titleCount: titleCandidates.count, bodyCount: bodyCandidates.count };
  }
  return {
    title: titleCandidates.matches[0] || null,
    body: null,
    titleCount: titleCandidates.count,
    bodyCount: bodyCandidates.count,
  };
}

export async function findEditorAcrossFrames(page, mainFrame, onFrame = async () => {}) {
  const ordered = mainFrame ? [mainFrame, ...page.frames().filter((frame) => frame !== mainFrame)] : page.frames();
  let mainResult = null;
  for (const frame of ordered) {
    await onFrame({ name: frame.name(), url: frame.url() });
    const result = await findEditorFields(frame);
    if (frame === mainFrame) mainResult = result;
    if (result.title && result.body) return { ...result, frame, mainResult: mainResult || result };
  }
  return { ...(mainResult || { title: null, body: null, titleCount: 0, bodyCount: 0 }), frame: null, mainResult };
}

export async function dismissExistingDraftPopup(page) {
  const prompt = page.getByText(existingDraftPrompt).filter({ visible: true }).first();
  if (!await prompt.isVisible().catch(() => false)) return true;

  const dialog = prompt.locator('xpath=ancestor-or-self::*[@role="dialog" or contains(@class,"dialog") or contains(@class,"modal") or contains(@class,"popup")][1]');
  const scope = await dialog.isVisible().catch(() => false) ? dialog : page;
  const cancelCandidates = [
    scope.getByRole("button", { name: cancelButtonName }).filter({ visible: true }).first(),
    scope.getByText(cancelButtonName, { exact: true }).filter({ visible: true }).first(),
  ];
  let visibleCancel = null;
  for (const locator of cancelCandidates) {
    if (await locator.isVisible().catch(() => false)) { visibleCancel = locator; break; }
  }
  if (!visibleCancel) return false;

  await visibleCancel.click({ timeout: 10000 }).catch(() => {});
  return await prompt.waitFor({ state: "hidden", timeout: 10000 }).then(() => true).catch(() => false);
}
