const HOOK_SCHEMA = {
  type: "object", properties: { categoryLabel: { type: "string" }, mainHook: { type: "string" },
    secondaryHook: { type: "string" }, bottomHook: { type: "string" } },
  required: ["categoryLabel", "mainHook", "secondaryHook", "bottomHook"], additionalProperties: false,
};

const outputText = (result) => result?.output_text || result?.output
  ?.flatMap((item) => item.content || []).find((item) => item.type === "output_text")?.text;

export const createThumbnailHooks = async (env, article) => {
  const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: {
    Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json",
  }, body: JSON.stringify({ model: env.OPENAI_MODEL, store: false,
    instructions: "기사 안의 사실만 사용해 한국어 홈판 문구를 짧게 만든다. 언론사명, 기자명, 면책·단서 문구, 기사에 없는 인물·수치·발언은 금지한다. 각 문구는 모바일에서 크게 보이도록 간결하게 쓴다.",
    input: JSON.stringify({ title: article.title, body: article.body }),
    text: { format: { type: "json_schema", name: "thumbnail_hooks", strict: true, schema: HOOK_SCHEMA } },
    reasoning: { effort: "low" }, max_output_tokens: 500 }) });
  const result = await response.json();
  if (!response.ok) throw new Error(`THUMBNAIL_HOOK_FAILED:${result?.error?.code || response.status}`);
  return JSON.parse(outputText(result));
};

export const generateHomeThumbnail = async (env, article, hooks) => {
  const prompt = `이 입력 이미지를 바탕으로 네이버 연예 홈판용 정사각형 이미지를 새롭게 재구성한다. 원본 하단 15%는 구도와 정보에서 완전히 제외한다. 인물 중심이면 인물을 오른쪽에 크게, 문구는 왼쪽에 배치한다. 노랑·빨강·흰색·검정의 강한 대비와 모바일용 큰 한글을 사용한다. 언론사명, 기자명, 사진 제공 문구, 워터마크, 작은 단서 문구, 면책 문구는 절대 넣지 않는다. 기사에 없는 인물·금액·발언·사건은 만들지 않는다. 표시 문구는 정확히 다음만 사용한다: ${hooks.categoryLabel} / ${hooks.mainHook} / ${hooks.secondaryHook} / ${hooks.bottomHook}`;
  const response = await fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: {
    Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json",
  }, body: JSON.stringify({ model: env.OPENAI_IMAGE_MODEL || "gpt-image-2", prompt,
    images: [{ image_url: article.representativeImageUrl }], size: "1024x1024", quality: "medium",
    output_format: "jpeg", output_compression: 88, moderation: "auto" }) });
  const result = await response.json();
  if (!response.ok || !result?.data?.[0]?.b64_json) {
    throw new Error(`THUMBNAIL_GENERATION_FAILED:${result?.error?.code || response.status}`);
  }
  return { bytes: Uint8Array.from(atob(result.data[0].b64_json), (char) => char.charCodeAt(0)), prompt };
};
