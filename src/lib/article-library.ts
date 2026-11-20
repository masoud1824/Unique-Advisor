/** Internal article library. Snapshots copied into newsletters do not follow later library edits. */

export type LibraryStatus = "draft" | "published" | "archived";

export type LibraryArticle = {
  id: number;
  status: LibraryStatus;
  title: string;
  bodyHtml: string;
  bodyText: string;
  imageUrl: string;
  imageAlt: string;
  sourceNote: string;
  authorNote: string;
  topics: string;
  language: string;
  version: number;
  updatedAt: string;
};

export type LibrarySnapshot = {
  libraryArticleId: number;
  libraryVersion: number;
  title: string;
  body: string;
  bodyHtml: string;
  imageUrl: string;
  imageAlt: string;
  sourceNote: string;
};

const STATUSES = new Set<LibraryStatus>(["draft", "published", "archived"]);

export function sanitizeArticleHtml(input: string): string {
  let html = String(input || "");
  html = html.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "");
  html = html.replace(/<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi, "");
  html = html.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  html = html.replace(/javascript\s*:/gi, "");
  return html.slice(0, 100_000);
}

export function htmlToText(html: string): string {
  return sanitizeArticleHtml(html).replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

export function cleanImageUrl(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw.slice(0, 500);
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return "";
    return url.toString().slice(0, 500);
  } catch {
    return "";
  }
}

export function normalizeArticleInput(input: Partial<LibraryArticle> & { title?: string; bodyHtml?: string }) {
  const title = String(input.title || "").trim().slice(0, 180);
  const bodyHtml = sanitizeArticleHtml(String(input.bodyHtml || ""));
  const imageUrl = cleanImageUrl(String(input.imageUrl || ""));
  const imageAlt = String(input.imageAlt || "").trim().slice(0, 180);
  if (!title) throw new Error("An article needs a title.");
  if (imageUrl && !imageAlt) throw new Error("An image needs alt text.");
  const language = String(input.language || "en").trim().toLowerCase().slice(0, 12) || "en";
  return {
    title,
    bodyHtml,
    bodyText: htmlToText(bodyHtml),
    imageUrl,
    imageAlt: imageUrl ? imageAlt : "",
    sourceNote: String(input.sourceNote || "").trim().slice(0, 240),
    authorNote: String(input.authorNote || "").trim().slice(0, 240),
    topics: String(input.topics || "").trim().slice(0, 240),
    language,
  };
}

export function articleVisibleToAdvisor(status: string): boolean {
  return status === "published";
}

export function filterArticles(
  articles: LibraryArticle[],
  query: { text?: string; topic?: string; language?: string; status?: string; advisor?: boolean },
) {
  const text = String(query.text || "").trim().toLowerCase();
  const topic = String(query.topic || "").trim().toLowerCase();
  return articles.filter((article) => {
    if (query.advisor && !articleVisibleToAdvisor(article.status)) return false;
    if (query.status && article.status !== query.status) return false;
    if (query.language && article.language !== query.language) return false;
    if (topic && !article.topics.toLowerCase().includes(topic)) return false;
    if (!text) return true;
    return `${article.title}\n${article.bodyText}`.toLowerCase().includes(text);
  });
}

export function assertLibraryWriter(actor: { role: string }) {
  if (actor.role !== "superadmin") throw new Error("Only a superadmin can change the article library.");
}

export function snapshotPublished(article: LibraryArticle): LibrarySnapshot {
  if (article.status !== "published") throw new Error("Only a published library article can be copied. Drafts and archived articles stay in the library.");
  return {
    libraryArticleId: article.id,
    libraryVersion: article.version,
    title: article.title,
    body: article.bodyText,
    bodyHtml: article.bodyHtml,
    imageUrl: article.imageUrl,
    imageAlt: article.imageAlt,
    sourceNote: article.sourceNote,
  };
}

export function copySnapshotsIntoNewsletter(
  issue: { title: string; articles: Array<{ title: string; body: string; libraryArticleId?: number; libraryVersion?: number; bodyHtml?: string; imageUrl?: string; imageAlt?: string; sourceNote?: string }> },
  snapshots: LibrarySnapshot[],
  mode: "new" | "append",
) {
  const copied = snapshots.map((item) => ({ ...item }));
  const articles = mode === "append" ? [...issue.articles, ...copied] : copied;
  return {
    ...issue,
    articles: articles.slice(0, 12),
  };
}

export function libraryEditLeavesSnapshot(snapshot: LibrarySnapshot, edited: LibraryArticle) {
  return snapshot.title !== edited.title || snapshot.body !== edited.bodyText || snapshot.libraryVersion !== edited.version
    ? snapshot
    : snapshot;
}

export function editOwnCopy<T extends { title: string; body: string; bodyHtml?: string }>(article: T, patch: { title?: string; body?: string; bodyHtml?: string }): T {
  const bodyHtml = patch.bodyHtml === undefined ? article.bodyHtml : sanitizeArticleHtml(patch.bodyHtml);
  const body = patch.body !== undefined
    ? String(patch.body).slice(0, 8000)
    : patch.bodyHtml !== undefined
      ? htmlToText(bodyHtml || "")
      : article.body;
  return {
    ...article,
    title: patch.title === undefined ? article.title : String(patch.title).trim().slice(0, 140),
    body,
    ...(bodyHtml === undefined ? {} : { bodyHtml }),
  };
}

export function reorderOwnArticles<T>(articles: T[], from: number, to: number): T[] {
  if (from < 0 || to < 0 || from >= articles.length || to >= articles.length || from === to) return articles.slice();
  const next = articles.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function sameAdvisor(rowAdvisorId: number, actorId: number) {
  return actorId > 0 && Number(rowAdvisorId) === Number(actorId);
}

export function statusOrThrow(value: string): LibraryStatus {
  if (!STATUSES.has(value as LibraryStatus)) throw new Error("Unknown article status.");
  return value as LibraryStatus;
}
