const SIGNALS = [
  [/협찬|유료\s*광고|브랜드\s*제공/g, 35, "유료·제공 표시"],
  [/광고|프로모션|체험단|단독\s*특가/g, 22, "광고·프로모션 표현"],
  [/구매하기|할인|쇼핑|판매/g, 12, "구매 유도 표현"],
  [/가격|원|제품\s*(?:설명|사양)/g, 7, "가격·제품 중심 표현"],
];

export function scoreAdvertisement(article = {}) {
  const text = `${article.title || ""}\n${article.summary || ""}\n${article.content || ""}`;
  const reasons = [];
  let score = 0;
  for (const [pattern, weight, reason] of SIGNALS) {
    const count = [...text.matchAll(pattern)].length;
    if (count) { score += Math.min(weight * count, weight * 2); reasons.push(reason); }
  }
  const links = [...text.matchAll(/https?:\/\/[^\s"'<>]+/g)].length;
  if (links >= 3) { score += Math.min(30, links * 5); reasons.push("외부 구매 링크 과다"); }
  if (/쇼핑|보도자료/.test(article.category || "")) { score += 25; reasons.push("쇼핑·보도자료 카테고리"); }
  const buyCount = (text.match(/구매|주문|할인|판매|가격/g) || []).length;
  const sentenceCount = Math.max(1, (text.match(/[.!?。]|다\./g) || []).length);
  if (buyCount >= 4 && buyCount / sentenceCount >= 0.35) { score += 25; reasons.push("본문보다 구매 유도 비중이 높음"); }
  score = Math.min(100, score);
  return { isAdvertisement: score >= 60, score, reasons: [...new Set(reasons)] };
}
