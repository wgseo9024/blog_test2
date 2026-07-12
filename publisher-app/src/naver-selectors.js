export const editorSelectors = {
  title: [
    { kind:"role", role:"textbox", name:/제목/ },
    { kind:"placeholder", value:/제목/ },
    { kind:"css", value:'[contenteditable="true"][data-placeholder*="제목"]' },
    { kind:"css", value:'.se-title-text [contenteditable="true"]' },
  ],
  body: [
    { kind:"role", role:"textbox", name:/본문|내용/ },
    { kind:"placeholder", value:/본문|내용/ },
    { kind:"css", value:'[contenteditable="true"][data-placeholder*="본문"]' },
    { kind:"css", value:'.se-component-content [contenteditable="true"]' },
  ],
  temporarySave: [{kind:"role",role:"button",name:/임시저장/},{kind:"text",value:/임시저장/}],
  image: [{kind:"role",role:"button",name:/사진|이미지/},{kind:"text",value:/사진|이미지/}],
  category: [{kind:"role",role:"button",name:/카테고리/},{kind:"text",value:/카테고리/}],
};

const existingDraftPrompt = /작성 중인 글이 있습니다|이어서 작성하시겠습니까/;
const cancelButtonName = /^\s*취소\s*$/;

export async function firstVisible(page, candidates) {
  for (const item of candidates) {
    const locator = item.kind === "role" ? page.getByRole(item.role,{name:item.name}).first() : item.kind === "placeholder" ? page.getByPlaceholder(item.value).first() : item.kind === "text" ? page.getByText(item.value).first() : page.locator(item.value).first();
    if (await locator.isVisible().catch(()=>false)) return {locator,selector:`${item.kind}:${item.value || item.name}`};
  }
  return null;
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
