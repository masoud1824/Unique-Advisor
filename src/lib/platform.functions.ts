import { createServerFn } from "@tanstack/react-start";
import { gateAdvisor, gateOperator } from "@/lib/advisor-db";
import { getSql } from "@/lib/db";
import {
  assertLibraryWriter,
  copySnapshotsIntoNewsletter,
  filterArticles,
  normalizeArticleInput,
  sameAdvisor,
  snapshotPublished,
  statusOrThrow,
  type LibraryArticle,
  type LibraryStatus,
} from "@/lib/article-library";
import { applyCopyEdits } from "@/lib/library-store";
import { packNewsletter, unpackNewsletter, type NewsletterIssue } from "@/lib/newsletter";
import { cleanAnnouncementLink, advisorRibbonLanguage, displayedDeskLanguage, ribbonDirection, visibleAnnouncements, RIBBON_LANGUAGE_FALLBACK, type Announcement } from "@/lib/news-ribbon";
import { planBirthdayRun, summarizeAdvisorNotice, type BirthdaySettings } from "@/lib/birthday-job";
import { outboundBlocked, OUTBOUND_BLOCKED } from "@/lib/outbound-guard";

type Sql = Awaited<ReturnType<typeof getSql>>;

function rowArticle(row: Record<string, unknown>): LibraryArticle {
  return {
    id: Number(row.id),
    status: String(row.status) as LibraryStatus,
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

async function articles(sql: Sql) {
  await ensureSampleLibrary(sql);
  const rows = await sql`select * from library_articles order by updated_at desc, id desc`;
  return rows.map((row) => rowArticle(row as Record<string, unknown>));
}

const SAMPLE_LIBRARY = [
  { title: "What life insurance is for", topics: "Life Insurance", body: "Life insurance pays a benefit after the person insured dies. Families use it to replace income, pay a mortgage, or leave money for children. This is a test library article, not a quote." },
  { title: "Who is named on a life policy", topics: "Life Insurance", body: "The beneficiary is the person or trust named to receive the benefit. The name, relationship, and share should match what the client intends. This is a test library article, not a quote." },
  { title: "When the amount should be reviewed", topics: "Life Insurance", body: "A new child, a home, a divorce, or a change in income is a reason to look at the amount again. The old number may no longer fit. This is a test library article, not a quote." },
  { title: "What disability insurance covers", topics: "Disability Insurance", body: "Disability insurance replaces part of income when illness or injury stops the client from working. It is not life insurance and it does not pay because someone dies. This is a test library article, not a quote." },
  { title: "The disability waiting period", topics: "Disability Insurance", body: "The waiting period is the time the client must be disabled before benefits start. A longer wait usually means a lower cost. This is a test library article, not a quote." },
  { title: "Coverage already provided at work", topics: "Disability Insurance", body: "A group plan at work may cover only part of income and may end if the job ends. A personal plan can sit beside it. This is a test library article, not a quote." },
];

async function ensureSampleLibrary(sql: Sql) {
  try {
    for (const sample of SAMPLE_LIBRARY) {
      const found = await sql<{ id: number }>`select id from library_articles where title = ${sample.title} limit 1`;
      if (found[0]) continue;
      const html = `<p>${sample.body}</p>`;
      const inserted = await sql<{ id: number }>`
        insert into library_articles (status, title, body_html, body_text, image_url, image_alt, source_note, author_note, topics, language, version)
        values ('published', ${sample.title}, ${html}, ${sample.body}, '', '', 'Test library article', 'Superadmin library', ${sample.topics}, 'en', 1)
        returning id
      `;
      const id = Number(inserted[0]?.id || 0);
      if (!id) continue;
      await sql`
        insert into library_article_versions (article_id, version, title, body_html, body_text, image_url, image_alt, source_note, author_note, topics, language)
        values (${id}, 1, ${sample.title}, ${html}, ${sample.body}, '', '', 'Test library article', 'Superadmin library', ${sample.topics}, 'en')
      `;
    }
  } catch (error) {
    console.error("[library] sample articles", error instanceof Error ? error.message : "failed");
  }
}

export const saveLibraryArticle = createServerFn({ method: "POST" }).validator((input: unknown) => input).handler(async ({ data }) => {
  const body = data as { code?: string; id?: number; publish?: boolean; archive?: boolean; title?: string; bodyHtml?: string; imageUrl?: string; imageAlt?: string; sourceNote?: string; authorNote?: string; topics?: string; language?: string };
  const gate = await gateOperator(body.code || "");
  if (!gate.ok) return gate;
  assertLibraryWriter({ role: "superadmin" });
  const sql = await getSql();
  const clean = normalizeArticleInput(body);
  const nextStatus: LibraryStatus = body.archive ? "archived" : body.publish ? "published" : "draft";
  statusOrThrow(nextStatus);
  if (body.id) {
    const current = await sql<{ version: number }>`select version from library_articles where id = ${Number(body.id)}`;
    if (!current[0]) return { ok: false as const, error: "That article is not in the library." };
    const version = Number(current[0].version) + 1;
    await sql`
      update library_articles set
        status = ${nextStatus}, title = ${clean.title}, body_html = ${clean.bodyHtml}, body_text = ${clean.bodyText},
        image_url = ${clean.imageUrl}, image_alt = ${clean.imageAlt}, source_note = ${clean.sourceNote},
        author_note = ${clean.authorNote}, topics = ${clean.topics}, language = ${clean.language},
        version = ${version}, updated_at = now()
      where id = ${Number(body.id)}
    `;
    await sql`
      insert into library_article_versions (article_id, version, title, body_html, body_text, image_url, image_alt, source_note, author_note, topics, language)
      values (${Number(body.id)}, ${version}, ${clean.title}, ${clean.bodyHtml}, ${clean.bodyText}, ${clean.imageUrl}, ${clean.imageAlt}, ${clean.sourceNote}, ${clean.authorNote}, ${clean.topics}, ${clean.language})
    `;
    return { ok: true as const, id: Number(body.id), version, status: nextStatus };
  }
  const inserted = await sql<{ id: number }>`
    insert into library_articles (status, title, body_html, body_text, image_url, image_alt, source_note, author_note, topics, language, version)
    values (${nextStatus}, ${clean.title}, ${clean.bodyHtml}, ${clean.bodyText}, ${clean.imageUrl}, ${clean.imageAlt}, ${clean.sourceNote}, ${clean.authorNote}, ${clean.topics}, ${clean.language}, 1)
    returning id
  `;
  const id = Number(inserted[0].id);
  await sql`
    insert into library_article_versions (article_id, version, title, body_html, body_text, image_url, image_alt, source_note, author_note, topics, language)
    values (${id}, 1, ${clean.title}, ${clean.bodyHtml}, ${clean.bodyText}, ${clean.imageUrl}, ${clean.imageAlt}, ${clean.sourceNote}, ${clean.authorNote}, ${clean.topics}, ${clean.language})
  `;
  return { ok: true as const, id, version: 1, status: nextStatus };
});

export const searchLibrary = createServerFn({ method: "POST" }).validator((input: unknown) => input).handler(async ({ data }) => {
  const body = data as { code?: string; slug?: string; text?: string; topic?: string; language?: string; status?: string; superadmin?: boolean };
  const sql = await getSql();
  const list = await articles(sql);
  if (body.superadmin) {
    const gate = await gateOperator(body.code || "");
    if (!gate.ok) return gate;
    return { ok: true as const, articles: filterArticles(list, body) };
  }
  const gate = await gateAdvisor(body.slug || "", body.code || "");
  if (!gate.ok) return gate;
  return { ok: true as const, articles: filterArticles(list, { ...body, advisor: true }) };
});

export const copyLibraryIntoNewsletter = createServerFn({ method: "POST" }).validator((input: unknown) => input).handler(async ({ data }) => {
  const body = data as { slug?: string; code?: string; articleIds?: number[]; newsletterId?: number; title?: string; mode?: "new" | "append"; edits?: Array<{ id: number; title?: string; bodyHtml?: string }> };
  const gate = await gateAdvisor(body.slug || "", body.code || "");
  if (!gate.ok) return gate;
  const sql = await getSql();
  const ids = (body.articleIds || []).map(Number).filter((id) => id > 0);
  const list = (await articles(sql)).filter((article) => ids.includes(article.id));
  if (list.length !== ids.length) return { ok: false as const, error: "One of those articles is not in the library." };
  const snapshots = applyCopyEdits(list.map(snapshotPublished), body.edits || []);
  let issue: NewsletterIssue;
  let newsletterId = Number(body.newsletterId || 0);
  if (body.mode === "append" && newsletterId) {
    const rows = await sql<{ advisor_id: number; body: string; title: string }>`select advisor_id, title, body from saved_letters where id = ${newsletterId}`;
    const row = rows[0];
    if (!row || !sameAdvisor(Number(row.advisor_id), Number(gate.row.id))) return { ok: false as const, error: "That newsletter belongs to another advisor." };
    const unpacked = unpackNewsletter(String(row.body));
    if (!unpacked) return { ok: false as const, error: "That saved newsletter could not be read." };
    issue = copySnapshotsIntoNewsletter(unpacked, snapshots, "append") as NewsletterIssue;
    await sql`update saved_letters set body = ${packNewsletter(issue)}, subject = ${issue.subject} where id = ${newsletterId} and advisor_id = ${gate.row.id}`;
  } else {
    const title = String(body.title || "Newsletter from the library").slice(0, 120);
    issue = copySnapshotsIntoNewsletter({ title, articles: [] }, snapshots, "new") as NewsletterIssue;
    issue.design = "pine";
    issue.kicker = "Newsletter";
    issue.subject = title;
    const inserted = await sql<{ id: number }>`
      insert into saved_letters (advisor_id, title, subject, body)
      values (${gate.row.id}, ${title}, ${title}, ${packNewsletter(issue)})
      returning id
    `;
    newsletterId = Number(inserted[0].id);
  }
  return { ok: true as const, newsletterId, articles: issue.articles, recipients: [] as string[], sent: false as const };
});

function announcement(row: Record<string, unknown>): Announcement {
  return {
    id: Number(row.id),
    title: String(row.title || ""),
    text: String(row.body || ""),
    link: String(row.link || ""),
    priority: Number(row.priority || 100),
    language: String(row.language || "en"),
    status: String(row.status || "draft") as Announcement["status"],
    startsAt: row.starts_at ? new Date(String(row.starts_at)).toISOString() : "",
    endsAt: row.ends_at ? new Date(String(row.ends_at)).toISOString() : "",
  };
}

export const saveAnnouncement = createServerFn({ method: "POST" }).validator((input: unknown) => input).handler(async ({ data }) => {
  const body = data as { code?: string; id?: number; title?: string; text?: string; link?: string; priority?: number; language?: string; status?: string; startsAt?: string; endsAt?: string };
  const gate = await gateOperator(body.code || "");
  if (!gate.ok) return gate;
  const title = String(body.title || "").trim().slice(0, 140);
  const text = String(body.text || "").trim().slice(0, 500);
  if (!title || !text) return { ok: false as const, error: "A news item needs a title and text." };
  const link = cleanAnnouncementLink(String(body.link || ""));
  if (body.link && !link) return { ok: false as const, error: "That link is not an ordinary web address." };
  const status = body.status === "published" || body.status === "archived" ? body.status : "draft";
  const sql = await getSql();
  const starts = body.startsAt ? new Date(body.startsAt).toISOString() : null;
  const ends = body.endsAt ? new Date(body.endsAt).toISOString() : null;
  if (body.id) {
    await sql`
      update desk_announcements set title = ${title}, body = ${text}, link = ${link}, priority = ${Number(body.priority || 100)},
        language = ${String(body.language || "en").slice(0, 12)}, status = ${status}, starts_at = ${starts}, ends_at = ${ends}, updated_at = now()
      where id = ${Number(body.id)}
    `;
    return { ok: true as const, id: Number(body.id) };
  }
  const inserted = await sql<{ id: number }>`
    insert into desk_announcements (title, body, link, priority, language, status, starts_at, ends_at)
    values (${title}, ${text}, ${link}, ${Number(body.priority || 100)}, ${String(body.language || "en").slice(0, 12)}, ${status}, ${starts}, ${ends})
    returning id
  `;
  return { ok: true as const, id: Number(inserted[0].id) };
});

export const listDeskAnnouncements = createServerFn({ method: "POST" }).validator((input: unknown) => input).handler(async ({ data }) => {
  const body = data as { slug?: string; code?: string; language?: string };
  const gate = await gateAdvisor(body.slug || "", body.code || "");
  if (!gate.ok) return gate;
  const sql = await getSql();
  let stored = "";
  try {
    const rows = await sql<{ desk_language: string }>`select desk_language from advisors where id = ${gate.row.id}`;
    stored = String(rows[0]?.desk_language || "");
  } catch {
    stored = "";
  }
  const language = displayedDeskLanguage(body.language || stored);
  const rows = await sql`select * from desk_announcements order by priority, id`;
  const items = rows.map((row) => announcement(row as Record<string, unknown>));
  return {
    ok: true as const,
    language,
    direction: ribbonDirection(language),
    fallback: RIBBON_LANGUAGE_FALLBACK,
    items: visibleAnnouncements(items, new Date(), language),
  };
});

export const setDeskLanguage = createServerFn({ method: "POST" }).validator((input: unknown) => input).handler(async ({ data }) => {
  const body = data as { slug?: string; code?: string; language?: string; advisorId?: number };
  const gate = await gateAdvisor(body.slug || "", body.code || "");
  if (!gate.ok) return gate;
  if (body.advisorId && Number(body.advisorId) !== Number(gate.row.id)) {
    return { ok: false as const, error: "That language belongs to another advisor." };
  }
  const language = advisorRibbonLanguage(body.language || "");
  const sql = await getSql();
  await sql`update advisors set desk_language = ${language} where id = ${gate.row.id}`;
  return { ok: true as const, language, direction: ribbonDirection(language), fallback: RIBBON_LANGUAGE_FALLBACK };
});

export const previewBirthdayPlan = createServerFn({ method: "POST" }).validator((input: unknown) => input).handler(async ({ data }) => {
  const body = data as { slug?: string; code?: string; now?: string; settings?: BirthdaySettings; people?: Parameters<typeof planBirthdayRun>[0]["people"]; claims?: Parameters<typeof planBirthdayRun>[0]["claims"]; lastRunDate?: string };
  const gate = await gateAdvisor(body.slug || "", body.code || "");
  if (!gate.ok) return gate;
  if (!outboundBlocked()) return { ok: false as const, error: "Birthday preview is only available while outbound sending is blocked." };
  const plan = planBirthdayRun({
    advisorId: Number(gate.row.id),
    settings: body.settings || { enabled: false, source: "", timezone: "America/Toronto", feb29: "skip", templateVersion: 1, confirmedVersion: 0, cardTitle: "" },
    people: body.people || [],
    claims: body.claims || [],
    now: body.now ? new Date(body.now) : new Date(),
    lastRunDate: body.lastRunDate || "",
  });
  const outcomes = plan.recipients.map((item) => ({ name: item.name, outcome: item.action === "send" || item.action === "retry" ? "would accept in the fake delivery" : item.reason }));
  return { ok: true as const, live: false as const, blocked: OUTBOUND_BLOCKED, plan, notice: summarizeAdvisorNotice(outcomes) || plan.notice };
});
