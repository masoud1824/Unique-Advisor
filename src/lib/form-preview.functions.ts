import { createServerFn } from "@tanstack/react-start";
import { PDFDocument } from "pdf-lib";
import { gateAdvisor } from "@/lib/advisor-db";
import { accessToken } from "@/lib/advisor-links";
import { getSql } from "@/lib/db";
import { chooseForm, formsFromPage, insurerLinksForFill } from "@/lib/desk-workflows";
import { planC1001Fill } from "@/lib/c1001-form-plan";

const REQUEST = "Fill the ivari insurance application LP257 for client id C-1001. Do not send it.";

export async function buildFormPreview(advisorId: number) {
  const sql = await getSql();
  await sql.query(`create table if not exists useful_links (
    id serial primary key,
    advisor_id integer not null references advisors(id) on delete cascade,
    label text not null,
    url text not null,
    created_at timestamptz not null default now()
  )`);
  const links = await sql`select label, url from useful_links where advisor_id = ${advisorId} order by id`;
  const matched = insurerLinksForFill(links.map((row) => ({ label: String(row.label || ""), url: String(row.url || "") })), REQUEST);
  if (matched.length !== 1) return { ok: false as const, error: "No single saved ivari Useful Link is on this desk. I did not open another page." };
  const pageUrl = matched[0].url;
  const page = await fetch(pageUrl, { signal: AbortSignal.timeout(20000) });
  if (!page.ok) return { ok: false as const, error: `The saved forms page did not open (${page.status}).` };
  const html = (await page.text()).slice(0, 1500000);
  const choice = chooseForm(formsFromPage(html, pageUrl), REQUEST);
  if (choice.kind !== "one") return { ok: false as const, error: "The saved page did not identify one insurance application. I did not substitute a file." };
  const file = await fetch(choice.form.href, { signal: AbortSignal.timeout(20000) });
  if (!file.ok) return { ok: false as const, error: `The form file from the saved page did not open (${file.status}).` };
  const original = new Uint8Array(await file.arrayBuffer());
  const { visibleEdition, readAssistantClient } = await import("@/lib/assistant-test-live");
  const edition = await visibleEdition(original);
  const token = await accessToken(advisorId, "dropbox");
  if (!token) return { ok: false as const, error: "Dropbox is not connected. I did not open a folder." };
  const read = await readAssistantClient(token, "C-1001");
  if (!read.ok) return { ok: false as const, error: read.detail };
  const records = read.files.map((item) => ({
    path: item.path,
    name: item.name,
    modified: item.modified.slice(0, 10),
    text: item.text,
    clientId: "C-1001",
    advisorId: String(advisorId),
  }));
  const plan = planC1001Fill(records);
  const doc = await PDFDocument.load(original);
  const form = doc.getForm();
  for (const line of plan) {
    if (line.status !== "filled" || !line.field) continue;
    form.getTextField(line.field).setText(line.value);
  }
  form.updateFieldAppearances();
  const saved = await doc.save();
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < saved.length; index += chunk) {
    binary += String.fromCharCode(...saved.subarray(index, index + chunk));
  }
  return {
    ok: true as const,
    sent: false as const,
    uploaded: false as const,
    link: `${matched[0].label} — ${pageUrl}`,
    form: choice.form.title,
    file: choice.form.href,
    pageDate: choice.form.version,
    edition: edition.edition,
    folder: read.folder,
    files: read.files.map((item) => item.name),
    plan,
    pdfBase64: btoa(binary),
  };
}

export const loadFormPreview = createServerFn({ method: "POST" }).validator((input: unknown) => input).handler(async ({ data }) => {
  const body = data as { slug?: string; code?: string };
  const gate = await gateAdvisor(body.slug || "", body.code || "");
  if (!gate.ok) return gate;
  return buildFormPreview(gate.row.id);
});
