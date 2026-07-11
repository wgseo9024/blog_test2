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

const INSTRUCTIONS = `너는 네이버 블로그용 연예뉴스 글을 작성하는 작가다. 사용자가 연예뉴스 기사 제목과 기사 내용을 보내면, 해당 내용만 바탕으로 블로그에 바로 올릴 수 있는 글을 작성한다.

제목 지침:
- 원 기사 제목과 핵심 이슈는 유지하되 문장은 다르게 바꾼다.
- 과하게 자극적이지 않게 쓰고, 특정 장면·한마디·행동 하나를 중심에 둔다.
- 궁금증과 의외성을 자연스럽게 담는다.
- "분위기가 달라졌다", "시선이 쏠렸다", "놀란 이유", "잊지 못한 이유", "흔든 이유" 같은 표현은 내용에 맞을 때만 활용한다.
- 허위 사실처럼 보이거나 과도한 어그로는 피한다.

본문 지침:
- 제공된 기사 내용 안에서만 작성하고 기사에 없는 내용을 추가하지 않는다.
- 원문을 그대로 베끼지 않고 자연스럽게 재구성한다.
- 본문만 공백 포함 약 700~800자로 쓰고, 모바일에서 읽기 쉽게 3~5개 문단으로 나눈다.
- 별도 소제목은 넣지 않는다.
- 단순 요약보다 왜 해당 장면이나 소식이 화제가 됐는지가 드러나게 쓴다.

표현 지침:
- 논란성 내용이나 확인되지 않은 사실은 단정하지 않는다.
- 필요하면 "~라고 전했습니다", "~로 알려졌습니다", "~라는 반응이 나왔습니다"처럼 조심스럽게 쓴다.
- 출연자나 연예인을 비난하지 않고, 불필요한 "인성 논란", "충격", "소름" 같은 표현은 쓰지 않는다.
- "글쓴이"라는 표현 대신 문맥에 맞게 "A씨는", "해당 네티즌은", "당시 스태프는" 등을 쓴다.
- 자연스럽고 가벼운 연예뉴스 전문 블로그 톤을 유지한다.

출력 지침:
- title에는 마크다운 기호 없이 제목만 쓴다.
- content에는 제목과 태그를 제외한 본문만 쓴다.
- tags에는 관련 태그를 정확히 10개 작성하며 # 기호는 넣지 않는다.`;

const extractOutputText = (result) =>
  result.output_text || result.output
    ?.flatMap((item) => item.content || [])
    .find((item) => item.type === "output_text")
    ?.text;

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

  const articleTitle = cleanText(input.articleTitle, 300);
  const articleContent = cleanText(input.articleContent, 30000);

  if (!articleTitle || !articleContent) {
    return json({ error: "기사 제목과 기사 내용을 모두 입력해 주세요." }, 400);
  }

  const apiResponse = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL || "gpt-5.6-sol",
      instructions: INSTRUCTIONS,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `기사 제목:\n${articleTitle}\n\n기사 내용:\n${articleContent}`,
            },
          ],
        },
      ],
      text: {
        verbosity: "medium",
        format: {
          type: "json_schema",
          name: "entertainment_blog_post",
          strict: true,
          schema: {
            type: "object",
            properties: {
              title: { type: "string" },
              content: { type: "string" },
              tags: {
                type: "array",
                items: { type: "string" },
                minItems: 10,
                maxItems: 10,
              },
            },
            required: ["title", "content", "tags"],
            additionalProperties: false,
          },
        },
      },
      reasoning: {
        effort: "medium",
        summary: "auto",
      },
      max_output_tokens: 2000,
      store: false,
    }),
  });

  const result = await apiResponse.json();

  if (!apiResponse.ok) {
    console.error("OpenAI API error", apiResponse.status, result?.error?.code);
    const message = apiResponse.status === 429
      ? "OpenAI API 사용량 한도를 확인해 주세요."
      : result?.error?.code === "model_not_found"
        ? "설정된 OpenAI 모델을 사용할 수 없습니다. OPENAI_MODEL 값을 확인해 주세요."
        : "OpenAI에서 글을 생성하지 못했습니다.";
    return json({ error: message }, apiResponse.status);
  }

  try {
    const post = JSON.parse(extractOutputText(result));
    return json({
      title: post.title.trim(),
      content: post.content.trim(),
      tags: post.tags.map((tag) => tag.trim().replace(/^#/, "")),
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
