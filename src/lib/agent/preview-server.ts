import { OpenAIProvider } from "@openai/agents-openai";
import { gateAdvisor } from "../advisor-db.ts";
import { getSql } from "../db.ts";
import {
  formsOnSavedPage,
  formWebPrompt,
  matchSavedFormLinks,
  readApprovedPdfBytes,
  readApprovedUsefulLink,
  savedLinkBlockedNote,
  searchPublicFormPages,
} from "../form-lookup.ts";
import { redactPrivate } from "../hosted-runtime.ts";
import { modelTransportOpen } from "../outbound-guard.ts";
import { FORM_CODE, type DraftPayload } from "./equitable-fields.ts";
import { decideDraft, MemoryDraftStore, runDraftTurn, type DraftRecord } from "./draft-agent.ts";
import { verifyModelAccess } from "./model-config.ts";
import { speechSegments } from "./voice-bridge.ts";
import { ALLOWANCE_STOP, accountView, agreePurchase, packQuote, paymentConfigured, reserve, cancelReservation, reconcile, withBilling } from "../billing/usage.ts";

type Sql = Awaited<ReturnType<typeof getSql>>;

let tablesReady: Promise<void> | null = null;

export function ensurePreviewTables(sql: Sql) {
  tablesReady ??= sql.query(`
    create table if not exists agent_preview_runs (
      id text primary key,
      advisor_id integer not null,
      status text not null default 'open',
      messages jsonb not null default '[]'::jsonb,
      facts jsonb not null default '{}'::jsonb,
      pending jsonb,
      consumed_hashes jsonb not null default '[]'::jsonb,
      approval_status text not null default '',
      serialized text not null default '',
      pdf bytea,
      template_pdf bytea,
      tool_trace jsonb not null default '[]'::jsonb,
      form_title text not null default '',
      form_href text not null default '',
      form_code text not null default '',
      draft_active boolean not null default false,
      designation_conflict text not null default '',
      read_back jsonb not null default '{}'::jsonb,
      stale_hashes jsonb not null default '[]'::jsonb,
      slug text not null default '',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create index if not exists agent_preview_runs_advisor_idx on agent_preview_runs (advisor_id, updated_at desc);
    alter table agent_preview_runs add column if not exists form_code text not null default '';
    alter table agent_preview_runs add column if not exists draft_active boolean not null default false;
    alter table agent_preview_runs add column if not exists designation_conflict text not null default '';
    create table if not exists agent_form_templates (
      form_code text primary key,
      source_url text not null default '',
      pdf bytea not null,
      fetched_at timestamptz not null default now()
    );
  `).then(() => undefined);
  return tablesReady;
}

async function serverModel() {
  const transport = modelTransportOpen();
  if (!transport.ok) return { ok: false as const, calledModel: false, reason: transport.reason };
  const sql = await getSql();
  const row = (await sql.query<{ openai_api_key: string }>("select openai_api_key from operators where id = 1"))[0];
  const apiKey = String(row?.openai_api_key || "").trim() || String(process.env.OPENAI_API_KEY || "").trim();
  const verified = await verifyModelAccess(apiKey);
  if (!verified.ok) return { ok: false as const, calledModel: false, reason: verified.blocker, model: verified.model };
  const provider = new OpenAIProvider({ apiKey, useResponses: false });
  try {
    return { ok: true as const, model: await provider.getModel(verified.model), modelId: verified.model };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unavailable";
    return { ok: false as const, calledModel: false, model: verified.model, reason: `${verified.model} could not be opened (${detail}). No fallback model was used.` };
  }
}

async function dropboxConnected(sql: Sql, advisorId: number) {
  const rows = await sql.query<{ connected: number }>(
    `select 1 as connected from advisor_links
     where advisor_id = $1 and provider = 'dropbox'
       and (length(refresh_token) > 0 or length(access_token) > 0)
     limit 1`,
    [advisorId],
  );
  return Boolean(rows[0]);
}

function asBytes(value: unknown) {
  if (!value) return null;
  if (value instanceof Uint8Array) return value;
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) return new Uint8Array(value);
  return null;
}

function asJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === "string") {
    try { return JSON.parse(value) as T; } catch { return fallback; }
  }
  return value as T;
}

async function readRun(sql: Sql, advisorId: number, runId: string): Promise<DraftRecord | null> {
  const rows = await sql.query<Record<string, unknown>>(
    `select id, advisor_id, slug, messages, facts, pending, consumed_hashes, stale_hashes, approval_status,
            serialized, pdf, template_pdf, tool_trace, form_title, form_href, form_code, draft_active, designation_conflict, read_back
     from agent_preview_runs where id = $1 and advisor_id = $2`,
    [runId, advisorId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    runId: String(row.id),
    advisorId: String(row.advisor_id),
    slug: String(row.slug || ""),
    messages: asJson(row.messages, []),
    facts: asJson(row.facts, {}),
    pending: asJson(row.pending, null),
    consumed: asJson(row.consumed_hashes, []),
    staleHashes: asJson(row.stale_hashes, []),
    approvalStatus: (String(row.approval_status || "") || "") as DraftRecord["approvalStatus"],
    serialized: String(row.serialized || ""),
    template: asBytes(row.template_pdf),
    pdf: asBytes(row.pdf),
    readBack: asJson(row.read_back, {}),
    formTitle: String(row.form_title || ""),
    formHref: String(row.form_href || ""),
    formCode: String(row.form_code || ""),
    draftActive: row.draft_active === true || row.draft_active === "t" || row.draft_active === "true",
    designationConflict: String(row.designation_conflict || ""),
    toolTrace: asJson(row.tool_trace, []),
    dropboxConnected: false,
    dropboxUploaded: false,
  };
}

async function writeRun(sql: Sql, advisorId: number, record: DraftRecord) {
  await sql.query(
    `insert into agent_preview_runs
      (id, advisor_id, slug, status, messages, facts, pending, consumed_hashes, stale_hashes, approval_status,
       serialized, pdf, template_pdf, tool_trace, form_title, form_href, form_code, draft_active, designation_conflict, read_back, updated_at)
     values ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14::jsonb,$15,$16,$17,$18,$19,$20::jsonb, now())
     on conflict (id) do update set
       status = excluded.status,
       messages = excluded.messages,
       facts = excluded.facts,
       pending = excluded.pending,
       consumed_hashes = excluded.consumed_hashes,
       stale_hashes = excluded.stale_hashes,
       approval_status = excluded.approval_status,
       serialized = excluded.serialized,
       pdf = excluded.pdf,
       template_pdf = excluded.template_pdf,
       tool_trace = excluded.tool_trace,
       form_title = excluded.form_title,
       form_href = excluded.form_href,
       form_code = excluded.form_code,
       draft_active = excluded.draft_active,
       designation_conflict = excluded.designation_conflict,
       read_back = excluded.read_back,
       updated_at = now()
     where agent_preview_runs.advisor_id = excluded.advisor_id`,
    [
      record.runId,
      advisorId,
      record.slug,
      record.approvalStatus || "open",
      JSON.stringify(record.messages),
      JSON.stringify(record.facts),
      record.pending ? JSON.stringify(record.pending) : null,
      JSON.stringify(record.consumed),
      JSON.stringify(record.staleHashes),
      record.approvalStatus,
      record.serialized,
      record.pdf ? Buffer.from(record.pdf) : null,
      record.template ? Buffer.from(record.template) : null,
      JSON.stringify(record.toolTrace),
      record.formTitle,
      record.formHref,
      record.formCode,
      record.draftActive,
      record.designationConflict || "",
      JSON.stringify(record.readBack),
    ],
  );
}

async function loadForm(sql: Sql, advisorId: number, query: string) {
  const links = await sql.query<{ label: string; url: string }>(
    "select label, url from useful_links where advisor_id = $1 order by id",
    [advisorId],
  );
  const matched = matchSavedFormLinks(links, query);
  if (!matched.length) return { ok: false as const, notice: formWebPrompt(query) };
  if (matched.length > 1) {
    return { ok: false as const, notice: `Which saved page?\n${matched.map((link) => `- ${link.label}`).join("\n")}\nNothing was sent.` };
  }
  const link = matched[0];
  const page = await readApprovedUsefulLink(link.url);
  if (!page.ok) {
    const notice = page.blocked ? savedLinkBlockedNote(link.label, link.url) : `${link.label}\n${link.url}\n${page.access}`;
    return { ok: false as const, notice };
  }
  const forms = formsOnSavedPage(page.text, page.finalUrl, query);
  if (!forms.length) return { ok: false as const, notice: formWebPrompt(query) };
  if (forms.length > 1) {
    return {
      ok: false as const,
      notice: "More than one form matches. Tell me which one to use.",
      choices: forms.map((form) => ({ title: form.title, href: form.href })),
    };
  }
  const cached = await sql.query<{ pdf: unknown; source_url: string }>(
    "select pdf, source_url from agent_form_templates where form_code = $1",
    [FORM_CODE],
  );
  const bytes = asBytes(cached[0]?.pdf);
  if (bytes && cached[0]?.source_url === forms[0].href) {
    return { ok: true as const, title: forms[0].title, href: forms[0].href, bytes, notice: `${forms[0].title}\n${forms[0].href}` };
  }
  const pdf = await readApprovedPdfBytes(forms[0].href);
  if (!pdf.ok) return { ok: false as const, notice: pdf.access };
  await sql.query(
    `insert into agent_form_templates (form_code, source_url, pdf, fetched_at)
     values ($1, $2, $3, now())
     on conflict (form_code) do update set source_url = excluded.source_url, pdf = excluded.pdf, fetched_at = now()`,
    [FORM_CODE, pdf.finalUrl, Buffer.from(pdf.bytes)],
  );
  return { ok: true as const, title: forms[0].title, href: pdf.finalUrl, bytes: pdf.bytes, notice: `${forms[0].title}\n${pdf.finalUrl}` };
}

type Body = {
  slug?: string;
  code?: string;
  sessionToken?: string;
  runId?: string;
  text?: string;
  source?: string;
  decision?: string;
  payload?: DraftPayload;
  line?: string;
  intent?: string;
};

export async function previewOpen(body: Body) {
  const gate = await gateAdvisor(body.slug || "", body.code || "", body.sessionToken || "");
  if (!gate.ok) return { ok: false as const, calledModel: false as const, error: gate.error };
  return {
    ok: true as const,
    calledModel: false as const,
    sessionToken: gate.sessionToken,
    reply: "Signed in. Type a request and press Send.",
  };
}

async function openScope(body: Body) {
  const gate = await gateAdvisor(body.slug || "", body.code || "", body.sessionToken || "");
  if (!gate.ok) return { ok: false as const, error: gate.error, calledModel: false as const };
  const sql = await getSql();
  await ensurePreviewTables(sql);
  const connected = await dropboxConnected(sql, gate.row.id);
  const scope = {
    advisorId: String(gate.row.id),
    slug: gate.row.slug,
    dropboxConnected: connected,
    formFillEnabled: false,
    loadForm: (query: string) => loadForm(sql, gate.row.id, query),
    searchWeb: (query: string) => searchPublicFormPages(query),
  };
  return { ok: true as const, gate, sql, scope };
}

function publicResult(result: Awaited<ReturnType<typeof runDraftTurn>>, sessionToken: string) {
  return { ...result, sessionToken };
}

export async function previewTurn(body: Body) {
  if (body.intent === "open") return previewOpen(body);
  const opened = await openScope(body);
  if (!opened.ok) return opened;
  if (body.intent === "usage" || body.intent === "billing-quote" || body.intent === "billing-agree") {
    try {
      return await withBilling(opened.sql, opened.scope.advisorId, new Date(), (state) => {
        if (body.intent === "billing-quote") return { ok: true, calledModel: false, sessionToken: opened.gate.sessionToken, quote: packQuote(), paymentConfigured: paymentConfigured() };
        if (body.intent === "billing-agree") {
          const purchase = agreePurchase(opened.scope.advisorId);
          if ("error" in purchase) return { ok: false, calledModel: false, sessionToken: opened.gate.sessionToken, error: purchase.error, credited: false };
          state.purchases.set(purchase.id, purchase);
          return { ok: true, calledModel: false, sessionToken: opened.gate.sessionToken, purchaseId: purchase.id, quote: packQuote(), credited: false, checkout: "test-webhook", cardStored: false };
        }
        return { ok: true, calledModel: false, sessionToken: opened.gate.sessionToken, usage: accountView(state.ledger.account) };
      });
    } catch (error) {
      return { ok: false, calledModel: false, sessionToken: opened.gate.sessionToken, error: redactPrivate(error instanceof Error ? error.message : "Usage metering is not available. No AI request was run.") };
    }
  }
  const model = await serverModel();
  if (!model.ok) return { ...model, sessionToken: opened.gate.sessionToken };
  const runId = String(body.runId || "").trim() || crypto.randomUUID();
  const operationId = `turn:${runId}:${crypto.randomUUID()}`;
  let held = false;
  try {
    const reservation = await withBilling(opened.sql, opened.scope.advisorId, new Date(), (state) => reserve(state.ledger, { operationId, kind: "model", estimateTokens: 8_000 }));
    if (!reservation.ok) return { ok: false, calledModel: false, code: reservation.code, reply: ALLOWANCE_STOP, sessionToken: opened.gate.sessionToken };
    held = true;
  } catch (error) {
    return { ok: false, calledModel: false, reply: redactPrivate(error instanceof Error ? error.message : "Usage metering is not available. This AI request was not run."), sessionToken: opened.gate.sessionToken };
  }
  const store = new MemoryDraftStore();
  const existing = await readRun(opened.sql, opened.gate.row.id, runId);
  if (existing) store.save(existing);
  try {
    const result = await runDraftTurn({
      store,
      scope: opened.scope,
      request: String(body.text || ""),
      source: body.source === "voice" ? "voice" : "typed",
      model: model.model,
      requestedModel: model.modelId,
      runId,
    });
    const saved = store.load(runId, opened.scope.advisorId);
    if (saved) await writeRun(opened.sql, opened.gate.row.id, saved);
    const measured = result.usage?.source === "provider" ? result.usage.inputTokens + result.usage.outputTokens : 8_000;
    await withBilling(opened.sql, opened.scope.advisorId, new Date(), (state) => reconcile(state.ledger, {
      operationId,
      actualTokens: measured,
      providerRequestId: result.usage?.requestIds?.[0] || "",
      usageSource: result.usage?.source === "provider" ? "provider" : "estimate",
    }));
    return { ...publicResult(result, opened.gate.sessionToken), requestedModel: model.modelId, returnedModel: result.usage?.returnedModel || "" };
  } catch (error) {
    if (held) await withBilling(opened.sql, opened.scope.advisorId, new Date(), (state) => cancelReservation(state.ledger, operationId)).catch(() => undefined);
    const reason = redactPrivate(error instanceof Error ? error.message : "The agent run failed.");
    return { ok: false, calledModel: true, reason, sessionToken: opened.gate.sessionToken };
  }
}

export async function previewDecide(body: Body) {
  const opened = await openScope(body);
  if (!opened.ok) return opened;
  const decision = body.decision === "approve" || body.decision === "deny" || body.decision === "cancel" ? body.decision : "";
  if (!decision || !body.payload || !body.runId) return { ok: false, calledModel: false, reason: "The approval request was incomplete. Nothing was uploaded." };
  const model = await serverModel();
  if (!model.ok) return { ...model, sessionToken: opened.gate.sessionToken };
  const store = new MemoryDraftStore();
  const existing = await readRun(opened.sql, opened.gate.row.id, body.runId);
  if (existing) store.save(existing);
  const result = await decideDraft({
    store,
    scope: opened.scope,
    runId: body.runId,
    decision,
    payload: body.payload,
    model: model.model,
  });
  const saved = store.load(body.runId, opened.scope.advisorId);
  if (saved) await writeRun(opened.sql, opened.gate.row.id, saved);
  return publicResult(result, opened.gate.sessionToken);
}

export async function previewPdf(body: Body) {
  const opened = await openScope(body);
  if (!opened.ok) return { ok: false as const, error: opened.error };
  const record = await readRun(opened.sql, opened.gate.row.id, String(body.runId || ""));
  if (!record?.pdf?.byteLength) return { ok: false as const, error: "There is no draft to preview." };
  return { ok: true as const, bytes: record.pdf, filename: `${FORM_CODE}-draft.pdf` };
}

export async function previewSpeech(body: Body) {
  const opened = await openScope(body);
  if (!opened.ok) return { ok: false as const, error: opened.error };
  const record = await readRun(opened.sql, opened.gate.row.id, String(body.runId || ""));
  const line = String(body.line || "").replace(/\s+/g, " ").trim();
  const last = [...(record?.messages || [])].reverse().find((message) => message.role === "assistant")?.text.replace(/\s+/g, " ").trim() || "";
  if (!line || line !== last) return { ok: false as const, error: "That line is not the reply on screen. Nothing was run again." };
  const transport = modelTransportOpen();
  if (!transport.ok) return { ok: false as const, error: transport.reason };
  const { selectedAdvisorVoice, speakSentence } = await import("../assistant.functions.ts");
  const voice = await selectedAdvisorVoice(opened.gate.row.id);
  if (!voice) return { ok: false as const, error: "No voice is selected. A different voice was not used." };
  const segments = speechSegments(line);
  const operationId = `speech:${crypto.randomUUID()}`;
  const estimate = Math.max(200, line.length);
  try {
    const reservation = await withBilling(opened.sql, opened.scope.advisorId, new Date(), (state) => reserve(state.ledger, { operationId, kind: "speech", estimateTokens: estimate }));
    if (!reservation.ok) return { ok: false as const, error: ALLOWANCE_STOP };
  } catch (error) {
    return { ok: false as const, error: redactPrivate(error instanceof Error ? error.message : "Usage metering is not available. Nothing was spoken.") };
  }
  const parts: string[] = [];
  try {
    for (const segment of segments) {
      const chunks: Buffer[] = [];
      await speakSentence(segment, (chunk) => chunks.push(chunk), opened.gate.row.id, voice);
      parts.push(Buffer.concat(chunks).toString("base64"));
    }
  } catch (error) {
    await withBilling(opened.sql, opened.scope.advisorId, new Date(), (state) => cancelReservation(state.ledger, operationId)).catch(() => undefined);
    return { ok: false as const, error: redactPrivate(error instanceof Error ? error.message : "The spoken reply was not ready."), voice };
  }
  await withBilling(opened.sql, opened.scope.advisorId, new Date(), (state) => reconcile(state.ledger, { operationId, actualTokens: estimate, usageSource: "estimate" }));
  return { ok: true as const, voice, parts };
}
