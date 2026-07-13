export const nateEntertainmentRankingSelectors = Object.freeze({
  rankingList: ".postRank, #postRankSubject",
  rankingItem: ".mduSubjectList, #postRankSubject li",
  rankingNumber: ".mduRank dt em",
  articleLink: ".mlt01 > a.lt1, a:has(> h2)",
  title: "h2.tit, a > h2",
  thumbnail: ".mlt01 img",
  articleTitle: "#articleView h1.articleSubecjt",
  articleBody: "#realArtcContents",
  articleImage: "#realArtcContents img",
  publisher: "#articleView .articleInfo a.medium",
  publishedAt: "#articleView .articleInfo .firstDate em",
});

export const NATE_RANK_START = 1;
export const NATE_RANK_END = 10;
export const NATE_RANK_LIMIT = 10;
export const NATE_SOURCE_TYPE = "nate_entertainment_ranking";
export const DISABLED_ENTERTAINMENT_SOURCES = Object.freeze([
  "sports_khan", "mydaily", "newsis", "mbn", "rss",
]);
