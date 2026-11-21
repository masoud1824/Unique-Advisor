/** Persist a library search or a recipient-free copy. Callers pass the database; this file does not open one. */

import { assertLibraryWriter, editOwnCopy, filterArticles, normalizeArticleInput, snapshotPublished, statusOrThrow, type LibraryArticle, type LibraryStatus } from "./article-library.ts";
import {
  asksLibraryConversation,
  formatLibraryCopy,
  formatLibrarySearch,
  libraryCopyMode,
  libraryCopyTitles,
  libraryNewsletterId,
  librarySearchTerm,
  libraryTurnAllowsSend,
} from "./library-conversation.ts";
import { emptySocial, packNewsletter, unpackNewsletter, type NewsletterArticle, type NewsletterIssue } from "./newsletter.ts";

export type QuerySql = {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

function article(row: Record<string, unknown>): LibraryArticle {
  return {
    id: Number(row.id),
    status: String(row.status || "draft") as LibraryStatus,
    title: String(row.title || ""),
    bodyHtml: String(row.body_html || ""),
    bodyText: String(row.body_text || ""),
    imageUrl: String(row.image_url || ""),
    imageAlt: String(row.image_alt || ""),
    sourceNote: String(row.source_note || ""),
    authorNote: String(row.author_note || ""),
    topics: String(row.topics || ""),
    language: String(row.language || "en"),
    version: Number(row.version || 1),
    updatedAt: String(row.updated_at || ""),
  };
}

async function publishedArticles(sql: QuerySql) {
  const rows = await sql.query("select * from library_articles order by id");
  return rows.map((row) => article(row)).filter((item) => item.status === "published");
}

export async function saveLibraryRecord(sql: QuerySql, actor: { role: string }, input: Partial<LibraryArticle> & { title?: string; bodyHtml?: string; publish?: boolean }) {
  assertLibraryWriter(actor);
  const clean = normalizeArticleInput(input);
  const status = statusOrThrow(input.publish ? "published" : "draft");
  const rows = await sql.query<{ id: number }>(
    `insert into library_articles (status, title, body_html, body_text, image_url, image_alt, source_note, author_note, topics, language, version)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1) returning id`,
    [status, clean.title, clean.bodyHtml, clean.bodyText, clean.imageUrl, clean.imageAlt, clean.sourceNote, clean.authorNote, clean.topics, clean.language],
  );
  const id = Number(rows[0]?.id);
  await sql.query(
    `insert into library_article_versions (article_id, version, title, body_html, body_text, image_url, image_alt, source_note, author_note, topics, language)
     values ($1, 1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [id, clean.title, clean.bodyHtml, clean.bodyText, clean.imageUrl, clean.imageAlt, clean.sourceNote, clean.authorNote, clean.topics, clean.language],
  );
  return { id, version: 1, status };
}

function issueFromSnapshots(title: string, articles: NewsletterArticle[]): NewsletterIssue {
  return { design: "pine", kicker: "Newsletter", title, subject: title, articles, social: emptySocial() };
}

export async function performLibraryTurn(sql: QuerySql, advisorId: number, text: string) {
  const kind = asksLibraryConversation(text);
  if (!kind) return "That was not an article-library request. Nothing was copied or sent.";
  if (libraryTurnAllowsSend(text)) return "A library copy cannot be emailed from this request. Nothing was sent.";
  const articles = await publishedArticles(sql);
  if (kind === "search") {
    const term = librarySearchTerm(text);
    const hits = filterArticles(articles, { text: term, advisor: true });
    return formatLibrarySearch(term, hits);
  }
  const titles = libraryCopyTitles(text);
  const chosen = titles.length
    ? articles.filter((item) => titles.some((title) => item.title.toLowerCase() === title.toLowerCase()))
    : [];
  if (!chosen.length) return "Name the published library articles to copy. Nothing was copied or sent.";
  const snapshots = chosen.map((item) => snapshotPublished(item));
  const mode = libraryCopyMode(text);
  if (mode === "append") {
    const newsletterId = libraryNewsletterId(text);
    const rows = await sql.query<{ advisor_id: number; body: string }>("select advisor_id, body from saved_letters where id = $1", [newsletterId]);
    const row = rows[0];
    if (!row || Number(row.advisor_id) !== advisorId) return "That newsletter belongs to another advisor. Nothing was copied or sent.";
    const unpacked = unpackNewsletter(String(row.body));
    if (!unpacked) return "That saved newsletter could not be read. Nothing was copied or sent.";
    const articlesNext = [...unpacked.articles, ...snapshots].slice(0, 12);
    await sql.query("update saved_letters set body = $1 where id = $2 and advisor_id = $3", [packNewsletter({ ...unpacked, articles: articlesNext }), newsletterId, advisorId]);
    return formatLibraryCopy({ newsletterId, count: snapshots.length, mode });
  }
  const title = "Library selection";
  const inserted = await sql.query<{ id: number }>(
    "insert into saved_letters (advisor_id, title, subject, body) values ($1, $2, $2, $3) returning id",
    [advisorId, title, packNewsletter(issueFromSnapshots(title, snapshots))],
  );
  return formatLibraryCopy({ newsletterId: Number(inserted[0]?.id), count: snapshots.length, mode: "new" });
}

export function applyCopyEdits<T extends NewsletterArticle>(snapshots: T[], edits: Array<{ id: number; title?: string; bodyHtml?: string }>): T[] {
  return snapshots.map((snapshot) => {
    const edit = edits.find((item) => item.id === snapshot.libraryArticleId);
    if (!edit) return snapshot;
    return editOwnCopy(snapshot, { title: edit.title, bodyHtml: edit.bodyHtml });
  });
}
