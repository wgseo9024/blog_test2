const ARTICLE_LIMIT = 200;

const json = (data, status = 200, headers = {}) => Response.json(data, {
  status,
  headers: {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  },
});

const failure = (message, status, headers) =>
  json({ success: false, error: { message } }, status, headers);

const STOP_WORDS = new Set([
  "기자", "단독", "공식", "종합", "속보", "영상", "사진", "포토", "인터뷰", "뉴스",
  "연예", "스타", "오늘", "어제", "최근", "관련", "통해", "대한", "대해", "이번", "사실",
  "공개", "발표", "전해", "전했다", "밝혀", "밝혔다", "말해", "말했다", "알려져", "소식",
  "화제", "관심", "논란", "모습", "근황", "이유", "예정", "진행", "출연", "방송", "배우",
  "가수", "아이돌", "그룹", "멤버", "팬들", "누리꾼", "연예인", "사람", "그리고", "하지만",
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "from",
]);

const GENERIC_ANCHORS = new Set([
  ...STOP_WORDS,
  "결혼", "이혼", "열애", "복귀", "컴백", "고백", "눈물", "충격", "최초", "직접", "결국",
  "드라마", "영화", "예능", "프로그램", "작품", "시청률", "무대", "공연", "콘서트", "활동",
]);

const PARTICLES = [
  "으로부터", "에게서", "에서는", "으로는", "이라고", "이라는", "까지는", "부터는",
  "에게", "한테", "처럼", "보다", "으로", "에서", "에는", "에도", "이라", "라고", "과의", "와의",
  "은", "는", "이", "가", "을", "를", "에", "의", "와", "과", "도", "로", "만", "부터", "까지",
].sort((a, b) => b.length - a.length);

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const stripParticle = (word) => {
  for (const particle of PARTICLES) {
    if (word.length >= particle.length + 2 && word.endsWith(particle)) {
      return word.slice(0, -particle.length);
    }
  }
  return word;
};

const normalizeTitle = (title, source) => {
  let value = String(title || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\([^)]*\)|\[[^\]]*\]|\{[^}]*\}|【[^】]*】|〈[^〉]*〉|《[^》]*》/g, " ")
    .toLowerCase();

  const sourceNames = [source, "스포츠경향", "마이데일리", "뉴시스", "mbn", "연합뉴스", "뉴스1", "osen"];
  for (const name of sourceNames) {
    if (name) value = value.replace(new RegExp(escapeRegExp(name), "gi"), " ");
  }

  return value
    .replace(/&(?:nbsp|amp|lt|gt|quot|apos);/gi, " ")
    .replace(/[^0-9a-z가-힣\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const titleTokens = (title, source) => {
  const normalized = normalizeTitle(title, source);
  const tokens = normalized.split(" ")
    .map(stripParticle)
    .filter((word) => word.length >= 2 && !STOP_WORDS.has(word));
  return { normalized, tokens: new Set(tokens) };
};

const intersection = (left, right) => {
  const smaller = left.size <= right.size ? left : right;
  const larger = left.size <= right.size ? right : left;
  return [...smaller].filter((word) => larger.has(word));
};

const jaccard = (left, right) => {
  if (!left.size || !right.size) return 0;
  const common = intersection(left, right).length;
  return common / (left.size + right.size - common);
};

// 형태소 분석기 없이도 공통 고유명사를 보수적으로 찾기 위한 휴리스틱이다.
// 일반 연예 용어를 제외한 2자 이상의 공통 토큰만 인물명/프로그램명 후보로 인정한다.
const hasCommonEntity = (left, right) => intersection(left, right)
  .some((word) => word.length >= 2 && !GENERIC_ANCHORS.has(word) && !/^\d+$/.test(word));

const sourceKey = (source) => String(source || "").trim().toLowerCase() || "unknown";

const quotedEntities = (title) => new Set([
  ...String(title || "").matchAll(/[‘'“"《〈<]([^’'”"》〉>]{2,30})[’'”"》〉>]/g),
  ...String(title || "").matchAll(/([가-힣A-Za-z0-9]{2,20})(?: 측| 소속사| 제작진| 시즌| 감독| 작가)/g),
].map((match) => normalizeTitle(match[1]).trim()).filter(Boolean));

const entitySet = (article, tokens) => new Set([
  ...quotedEntities(article.title),
  ...[...tokens].filter((token) => token.length >= 2 && !GENERIC_ANCHORS.has(token) && !/^\d+$/.test(token)),
]);

const timeSimilarity = (left, right, maxHours) => {
  const a = new Date(left.published_at || left.created_at).getTime();
  const b = new Date(right.published_at || right.created_at).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0.5;
  return Math.max(0, 1 - Math.abs(a - b) / (maxHours * 3600000));
};

const combinedScore = (left, right, settings) => {
  const tokenScore = jaccard(left.tokens, right.tokens);
  const entityScore = jaccard(left.entities, right.entities);
  const temporalScore = timeSimilarity(left, right, settings.max_time_gap_hours);
  return tokenScore * settings.token_weight
    + entityScore * settings.entity_weight
    + temporalScore * settings.time_weight;
};

export const buildGroups = (articles, settings) => {
  const prepared = [];
  for (const article of articles) {
    try {
      const title = titleTokens(article.title, article.source);
      if (title.tokens.size) prepared.push({ ...article, ...title, entities: entitySet(article, title.tokens) });
    } catch (error) {
      console.error("Article title preparation failed", article?.id, error);
    }
  }

  const assigned = new Set();
  const groups = [];
  for (const seed of prepared) {
    if (assigned.has(seed.id)) continue;
    const members = [{ article: seed, score: 1 }];

    for (const candidate of prepared) {
      if (candidate.id === seed.id || assigned.has(candidate.id)) continue;
      try {
        const score = combinedScore(seed, candidate, settings);
        if (score >= settings.similarity_threshold
          && (hasCommonEntity(seed.tokens, candidate.tokens)
            || intersection(seed.entities, candidate.entities).length > 0)) {
          members.push({ article: candidate, score });
        }
      } catch (error) {
        console.error("Article comparison failed", candidate.id, error);
      }
    }

    const knownSources = new Set(members.map(({ article }) => sourceKey(article.source))
      .filter((source) => source !== "unknown"));
    if (members.length >= 2 && knownSources.size >= 2) {
      members.forEach(({ article }) => assigned.add(article.id));
      groups.push(members);
    }
  }
  // 다른 언론사의 동일 이슈가 없어도 수집 기사가 초안 생성 흐름에서 사라지지 않도록
  // 다중 출처 그룹을 우선 만든 뒤 남은 기사는 각각 단일 이슈 그룹으로 승격한다.
  for (const article of articles) {
    if (!assigned.has(article.id)) groups.push([{ article, score: 1 }]);
  }
  return groups;
};

const saveGroup = async (env, members) => {
  const ids = members.map(({ article }) => Number(article.id)).sort((a, b) => a - b);
  const topicKey = `articles:${ids.join(",")}`;
  const existingCombination = await env.DB.prepare(
    "SELECT id FROM article_groups WHERE topic_key = ? LIMIT 1",
  ).bind(topicKey).first();

  const placeholders = ids.map(() => "?").join(",");
  const alreadyGrouped = await env.DB.prepare(
    `SELECT article_id FROM article_group_items WHERE article_id IN (${placeholders}) LIMIT 1`,
  ).bind(...ids).first();
  if (alreadyGrouped) return { created: false, groupedIds: [] };

  const representative = members[0].article.title;
  const inserted = existingCombination || await env.DB.prepare(
    "INSERT OR IGNORE INTO article_groups (topic_key, representative_title) VALUES (?, ?) RETURNING id",
  ).bind(topicKey, representative).first();
  if (!inserted?.id) return { created: false, groupedIds: [] };

  const savedIds = [];
  for (const { article, score } of members) {
    try {
      const updated = await env.DB.prepare(
        "UPDATE articles SET status = 'grouped', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'new'",
      ).bind(article.id).run();
      if (!updated.meta?.changes) continue;
      try {
        const item = await env.DB.prepare(
          "INSERT OR IGNORE INTO article_group_items (group_id, article_id, similarity_score) VALUES (?, ?, ?)",
        ).bind(inserted.id, article.id, Number(score.toFixed(4))).run();
        if (item.meta?.changes) {
          savedIds.push(article.id);
        } else {
          await env.DB.prepare("UPDATE articles SET status = 'new' WHERE id = ?").bind(article.id).run();
        }
      } catch (error) {
        await env.DB.prepare("UPDATE articles SET status = 'new' WHERE id = ?").bind(article.id).run();
        throw error;
      }
    } catch (error) {
      console.error("Group item save failed", article.id, error);
    }
  }

  if (savedIds.length < 1) {
    // 부분 실패로 유효한 그룹이 되지 못한 경우 다음 실행에서 재처리할 수 있게 정리한다.
    for (const id of savedIds) {
      try {
        await env.DB.prepare("UPDATE articles SET status = 'new' WHERE id = ?").bind(id).run();
      } catch (error) {
        console.error("Article status restore failed", id, error);
      }
    }
    await env.DB.prepare("DELETE FROM article_group_items WHERE group_id = ?").bind(inserted.id).run();
    await env.DB.prepare("DELETE FROM article_groups WHERE id = ?").bind(inserted.id).run();
    return { created: false, groupedIds: [] };
  }
  return { created: true, groupedIds: savedIds };
};

export async function groupNews(env) {
  try {
    const settings = await env.DB.prepare("SELECT * FROM grouping_settings WHERE id = 1").first()
      || { similarity_threshold: 0.56, token_weight: 0.5, entity_weight: 0.35, time_weight: 0.15, max_time_gap_hours: 72 };
    const { results } = await env.DB.prepare(`SELECT a.id, a.title, a.source, a.published_at, a.created_at
      FROM articles a
      WHERE a.status = 'new'
        AND NOT EXISTS (SELECT 1 FROM article_group_items i WHERE i.article_id = a.id)
      ORDER BY COALESCE(a.published_at, a.created_at) DESC, a.id DESC
      LIMIT ?`).bind(ARTICLE_LIMIT).all();
    const articles = results || [];
    const candidates = buildGroups(articles, settings);
    let groupsCreated = 0;
    const groupedIds = new Set();
    const createdGroupIds = [];

    for (const members of candidates) {
      try {
        const result = await saveGroup(env, members);
        if (result.created) {
          groupsCreated += 1;
          const group = await env.DB.prepare(`SELECT gi.group_id id FROM article_group_items gi
            WHERE gi.article_id IN (${result.groupedIds.map(() => "?").join(",")})
            ORDER BY gi.group_id DESC LIMIT 1`).bind(...result.groupedIds).first();
          if (group?.id) createdGroupIds.push(group.id);
        }
        result.groupedIds.forEach((id) => groupedIds.add(id));
      } catch (error) {
        console.error("Group save failed", error);
      }
    }

    return {
        processed: articles.length,
        groupsCreated,
        createdGroupIds,
        articlesGrouped: groupedIds.size,
        remaining: Math.max(0, articles.length - groupedIds.size),
        similarity_threshold: settings.similarity_threshold,
    };
  } catch (error) {
    console.error("Article grouping error", error);
    throw error;
  }
}

export async function onRequestPost({ env }) {
  try {
    return json({ success: true, data: await groupNews(env) });
  } catch {
    return failure("유사 기사 그룹화 작업을 완료하지 못했습니다.", 500);
  }
}

export function onRequest(context) {
  if (context.request.method !== "POST") {
    return failure("POST 요청만 허용됩니다.", 405, { Allow: "POST" });
  }
  return onRequestPost(context);
}
