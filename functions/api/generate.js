const json = (data, status = 200) =>
  Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });

const cleanText = (value, maxLength) =>
  typeof value === "string" ? value.trim().slice(0, maxLength) : "";

export async function onRequestPost({ request, env }) {
  if (!env.OPENAI_API_KEY) {
    return json({ error: "서버에 OPENAI_API_KEY가 설정되지 않았습니다." }, 500);
  }

  let input;
  try {
    input = await request.json();
  } catch {
    return json({ error: "올바른 JSON 요청이 아닙니다." }, 400);
  }

  const keyword = cleanText(input.keyword, 120);
  const category = cleanText(input.category, 40);
  const tone = cleanText(input.tone, 60);
  const extraPrompt = cleanText(input.prompt, 1000);
  const articleCount = Math.min(10, Math.max(2, Number(input.articleCount) || 5));

  if (!keyword) {
    return json({ error: "수집 키워드를 입력해 주세요." }, 400);
  }

  const apiResponse = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL || "gpt-5.4-mini",
      tools: [{ type: "web_search" }],
      instructions: [
        "당신은 한국어 블로그 전문 편집자입니다.",
        "웹 검색으로 최신의 신뢰할 수 있는 자료를 확인한 뒤 사실 중심으로 작성하세요.",
        "확인되지 않은 수치나 주장을 만들지 말고, 광고성 과장 표현을 피하세요.",
        "검색 결과의 문장을 그대로 길게 복사하지 말고 완전히 새 문장으로 작성하세요.",
        "본문은 읽기 쉬운 소제목과 문단으로 구성하되 마크다운 코드 블록은 사용하지 마세요.",
      ].join(" "),
      input: [
        `주제: ${keyword}`,
        `카테고리: ${category || "일반"}`,
        `문체: ${tone || "정보형"}`,
        `참고할 자료 수: 약 ${articleCount}개`,
        `추가 지침: ${extraPrompt || "도입부, 핵심 내용, 결론 순서로 작성"}`,
        "네이버 블로그에 바로 붙여넣을 수 있는 한국어 글을 작성하세요.",
      ].join("\n"),
      text: {
        format: {
          type: "json_schema",
          name: "blog_post",
          strict: true,
          schema: {
            type: "object",
            properties: {
              title: { type: "string" },
              content: { type: "string" },
              tags: {
                type: "array",
                items: { type: "string" },
                minItems: 5,
                maxItems: 10,
              },
            },
            required: ["title", "content", "tags"],
            additionalProperties: false,
          },
        },
      },
    }),
  });

  const result = await apiResponse.json();

  if (!apiResponse.ok) {
    console.error("OpenAI API error", apiResponse.status, result?.error?.code);
    const message = apiResponse.status === 429
      ? "OpenAI API 사용량 한도를 확인해 주세요."
      : "OpenAI에서 글을 생성하지 못했습니다.";
    return json({ error: message }, apiResponse.status);
  }

  try {
    const outputText = result.output_text || result.output
      ?.flatMap((item) => item.content || [])
      .find((item) => item.type === "output_text")
      ?.text;
    const post = JSON.parse(outputText);
    return json({
      title: post.title,
      content: post.content,
      tags: post.tags.map((tag) => tag.replace(/^#/, "")),
    });
  } catch (error) {
    console.error("OpenAI response parse error", error);
    return json({ error: "생성 결과를 처리하지 못했습니다. 다시 시도해 주세요." }, 502);
  }
}

export function onRequest(context) {
  if (context.request.method !== "POST") {
    return json({ error: "POST 요청만 허용됩니다." }, 405);
  }
  return onRequestPost(context);
}
