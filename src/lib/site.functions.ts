import { createServerFn } from "@tanstack/react-start";
import { getSql } from "@/lib/db";
import { hashCode } from "@/lib/codes";
import { clearDeskSession } from "@/lib/desk-session";
import { cleanSlug, findAdvisorBySlug, gateAdvisor, toPublic } from "@/lib/advisor-db";
import { sanitizeWebsite, readWebsite } from "@/lib/website";
import {
  applyPackage,
  PACKAGES,
  PALETTES,
  type Lead,
  type LeadStep,
  type PackageId,
  type Palette,
  type PublicSite,
  type SiteSettings,
} from "@/lib/site-types";

const FOLLOWUP_STEPS: { key: string; days: number; title: string; detail: string }[] = [
  {
    key: "reply",
    days: 0,
    title: "Reply to the question",
    detail: "Write back on the email they left. Confirm you have the question. Do not name a product.",
  },
  {
    key: "explain",
    days: 3,
    title: "Send the plain explanation",
    detail: "Send a short note that matches their topic, in your own words.",
  },
  {
    key: "ask",
    days: 14,
    title: "Ask if they want to talk",
    detail: "One follow-up only. If they do not reply, stop.",
  },
];

function dueDate(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export const getPublicSite = createServerFn({ method: "GET" })
  .validator((input: { slug: string }) => input)
  .handler(async ({ data }): Promise<PublicSite | null> => {
    const slug = cleanSlug(data.slug ?? "");
    if (!slug) return null;
    const row = await findAdvisorBySlug(slug);
    return row ? toPublic(row) : null;
  });

export const saveAdvisorWebsite = createServerFn({ method: "POST" })
  .validator((input: { slug: string; code: string; mode: "builtin" | "own"; url: string }) => input)
  .handler(async ({ data }): Promise<{ ok: true } | { ok: false; error: string }> => {
    const gate = await gateAdvisor(data.slug, data.code);
    if (!gate.ok) return gate;
    const mode = data.mode === "own" ? "own" : "builtin";
    const url = (data.url ?? "").trim();
    if (mode === "own") {
      if (!/^https?:\/\/[^\s]+$/i.test(url) || url.length > 300) {
        return { ok: false, error: "Add the full link to your website, starting with https://." };
      }
    }
    const sql = await getSql();
    await sql`
      update advisors
      set site_mode = ${mode}, site_url = ${mode === "own" ? url : ""}
      where id = ${gate.row.id}
    `;
    return { ok: true };
  });

export const saveAdvisorSite = createServerFn({ method: "POST" })
  .validator((input: { slug: string; code: string; website: unknown }) => input)
  .handler(async ({ data }): Promise<{ ok: true } | { ok: false; error: string }> => {
    const gate = await gateAdvisor(data.slug, data.code);
    if (!gate.ok) return gate;
    const website = sanitizeWebsite(data.website);
    if (!website) return { ok: false, error: "That page could not be saved. Check the tabs and try again." };
    const packed = JSON.stringify(website);
    if (packed.length > 1_200_000) return { ok: false, error: "The pictures are too large. Use fewer or smaller photos." };
    const sql = await getSql();
    if (website.palette && PALETTES.includes(website.palette)) {
      await sql`update advisors set site_content = ${packed}, palette = ${website.palette} where id = ${gate.row.id}`;
    } else {
      await sql`update advisors set site_content = ${packed} where id = ${gate.row.id}`;
    }
    return { ok: true };
  });

export const saveAdvisorIdentity = createServerFn({ method: "POST" })
  .validator((input: { slug: string; code: string; name: string; title: string; photo: string; phone?: string; cardEmail?: string; company?: string; website?: string; social?: string }) => input)
  .handler(async ({ data }): Promise<{ ok: true } | { ok: false; error: string }> => {
    const gate = await gateAdvisor(data.slug, data.code);
    if (!gate.ok) return gate;
    const name = (data.name ?? "").trim().slice(0, 80);
    const title = (data.title ?? "").trim().slice(0, 80);
    const photo = (data.photo ?? "").trim();
    const phone = (data.phone ?? "").trim().slice(0, 40);
    const cardEmail = (data.cardEmail ?? "").trim().slice(0, 120);
    const company = (data.company ?? "").trim().slice(0, 80);
    const website = (data.website ?? "").trim().slice(0, 160);
    const social = (data.social ?? "").trim().slice(0, 2000);
    if (name.length < 2) return { ok: false, error: "Add the name that should appear on your page." };
    if (photo.length > 700_000) return { ok: false, error: "That picture is too large. Use a smaller photo." };
    if (photo && !photo.startsWith("data:image/")) return { ok: false, error: "Use a photo file." };
    const sql = await getSql();
    await sql`
      update advisors
      set public_name = ${name}, public_title = ${title}, public_photo = ${photo},
          public_phone = ${phone}, public_card_email = ${cardEmail}, public_company = ${company}, public_website = ${website},
          public_social = ${social}
      where id = ${gate.row.id}
    `;
    return { ok: true };
  });

type SaveInput = {
  slug: string;
  code: string;
  packageId: PackageId;
  palette: Palette;
  showLife: boolean;
  showCritical: boolean;
  showDisability: boolean;
  showGroup: boolean;
  showFacts: boolean;
  showForm: boolean;
};

export const saveSettings = createServerFn({ method: "POST" })
  .validator((input: SaveInput) => input)
  .handler(async ({ data }): Promise<{ ok: true; settings: PublicSite } | { ok: false; error: string }> => {
    if (!PACKAGES.includes(data.packageId)) return { ok: false, error: "Choose one of the packages." };
    if (!PALETTES.includes(data.palette)) return { ok: false, error: "Choose one of the site colors." };
    const gate = await gateAdvisor(data.slug, data.code);
    if (!gate.ok) return gate;
    const next: SiteSettings = applyPackage({
      packageId: data.packageId,
      palette: data.palette,
      showLife: data.showLife,
      showCritical: data.showCritical,
      showDisability: data.showDisability,
      showGroup: data.showGroup,
      showFacts: data.showFacts,
      showForm: data.showForm,
      codeIsDefault: gate.site.codeIsDefault,
    });
    const sql = await getSql();
    await sql`
      update advisors set
        package = ${next.packageId},
        palette = ${next.palette},
        show_life = ${next.showLife},
        show_critical = ${next.showCritical},
        show_disability = ${next.showDisability},
        show_group = ${next.showGroup},
        show_facts = ${next.showFacts},
        show_form = ${next.showForm}
      where id = ${gate.row.id}
    `;
    return { ok: true, settings: { ...gate.site, ...next } };
  });

export const saveAdvisorPalette = createServerFn({ method: "POST" })
  .validator((input: { slug: string; code: string; palette: string }) => input)
  .handler(async ({ data }): Promise<{ ok: true } | { ok: false; error: string }> => {
    if (!PALETTES.includes(data.palette as Palette)) return { ok: false, error: "Choose one of the themes." };
    const gate = await gateAdvisor(data.slug, data.code);
    if (!gate.ok) return gate;
    const sql = await getSql();
    await sql`update advisors set palette = ${data.palette} where id = ${gate.row.id}`;
    return { ok: true };
  });

export const changeAccessCode = createServerFn({ method: "POST" })
  .validator((input: { slug: string; code: string; next: string }) => input)
  .handler(async ({ data }): Promise<{ ok: true } | { ok: false; error: string }> => {
    const next = (data.next ?? "").trim();
    if (next.length < 6) return { ok: false, error: "Use at least 6 characters for the new code." };
    const gate = await gateAdvisor(data.slug, data.code);
    if (!gate.ok) return gate;
    const sql = await getSql();
    await sql`
      update advisors
      set code_hash = ${hashCode(next)}, code_is_default = false
      where id = ${gate.row.id}
    `;
    await clearDeskSession(gate.row.id).catch(() => undefined);
    return { ok: true };
  });

type LeadInput = {
  slug: string;
  fullName: string;
  email: string;
  phone: string;
  interest: string;
  note: string;
};

export const submitLead = createServerFn({ method: "POST" })
  .validator((input: LeadInput) => input)
  .handler(async ({ data }): Promise<{ ok: true } | { ok: false; error: string }> => {
    const slug = cleanSlug(data.slug ?? "");
    if (!slug) return { ok: false, error: "That practice is not on this host." };
    const row = await findAdvisorBySlug(slug);
    if (!row) return { ok: false, error: "That practice is not on this host." };
    const settings = toPublic(row);
    if (settings.status !== "active") return { ok: false, error: "This page is paused." };
    const custom = readWebsite(settings.siteContent);
    if (custom ? !custom.ask : !settings.showForm) return { ok: false, error: "The question form is turned off." };
    const fullName = (data.fullName ?? "").trim();
    const email = (data.email ?? "").trim().toLowerCase();
    const phone = (data.phone ?? "").trim();
    const note = (data.note ?? "").trim();
    const interest = String(data.interest ?? "unsure").trim().slice(0, 40) || "unsure";
    if (fullName.length < 2 || fullName.length > 80) return { ok: false, error: "Please add your name." };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) {
      return { ok: false, error: "Please add a real email address." };
    }
    if (phone.length > 30) return { ok: false, error: "That phone number looks too long." };
    if (interest.length < 2) return { ok: false, error: "Choose what you want to talk about." };
    if (note.length > 500) return { ok: false, error: "Keep the note under 500 characters." };
    const sql = await getSql();
    const inserted = await sql<{ id: number }>`
      insert into leads (advisor_id, full_name, email, phone, interest, note)
      values (${row.id}, ${fullName}, ${email}, ${phone}, ${interest}, ${note})
      returning id
    `;
    const leadId = Number(inserted[0]?.id);
    if (settings.packageId === "followup" && leadId) {
      for (const step of FOLLOWUP_STEPS) {
        await sql`
          insert into lead_steps (lead_id, step_key, title, detail, due_on)
          values (${leadId}, ${step.key}, ${step.title}, ${step.detail}, ${dueDate(step.days)})
        `;
      }
    }
    return { ok: true };
  });

type LeadRow = {
  id: number;
  full_name: string;
  email: string;
  phone: string;
  interest: string;
  note: string;
  created_at: string | Date;
  step_id: number | null;
  step_title: string | null;
  step_detail: string | null;
  step_due: string | Date | null;
  step_done: boolean | null;
};

export const listLeads = createServerFn({ method: "POST" })
  .validator((input: { slug: string; code: string }) => input)
  .handler(async ({ data }): Promise<{ ok: true; leads: Lead[] } | { ok: false; error: string }> => {
    const gate = await gateAdvisor(data.slug, data.code);
    if (!gate.ok) return gate;
    const sql = await getSql();
    const rows = await sql<LeadRow>`
      select l.id, l.full_name, l.email, l.phone, l.interest, l.note, l.created_at,
             s.id as step_id, s.title as step_title, s.detail as step_detail,
             s.due_on as step_due, s.done as step_done
      from leads l
      left join lead_steps s on s.lead_id = l.id
      where l.advisor_id = ${gate.row.id}
      order by l.created_at desc, s.due_on asc
      limit 600
    `;
    const byId = new Map<number, Lead>();
    for (const r of rows) {
      const id = Number(r.id);
      let lead = byId.get(id);
      if (!lead) {
        lead = {
          id,
          fullName: r.full_name,
          email: r.email,
          phone: r.phone,
          interest: r.interest,
          note: r.note,
          createdAt: new Date(r.created_at).toISOString(),
          steps: [],
        };
        byId.set(id, lead);
      }
      if (r.step_id != null && r.step_title && r.step_detail && r.step_due) {
        const step: LeadStep = {
          id: Number(r.step_id),
          title: r.step_title,
          detail: r.step_detail,
          dueOn: String(r.step_due).slice(0, 10),
          done: Boolean(r.step_done),
        };
        lead.steps.push(step);
      }
    }
    return { ok: true, leads: [...byId.values()].slice(0, 200) };
  });

export const toggleLeadStep = createServerFn({ method: "POST" })
  .validator((input: { slug: string; code: string; stepId: number }) => input)
  .handler(async ({ data }): Promise<{ ok: true; done: boolean } | { ok: false; error: string }> => {
    const gate = await gateAdvisor(data.slug, data.code);
    if (!gate.ok) return gate;
    const stepId = Number(data.stepId);
    if (!Number.isInteger(stepId) || stepId < 1) return { ok: false, error: "That step is not on the list." };
    const sql = await getSql();
    const updated = await sql<{ done: boolean }>`
      update lead_steps as s
      set done = not s.done
      from leads as l
      where s.id = ${stepId} and s.lead_id = l.id and l.advisor_id = ${gate.row.id}
      returning s.done
    `;
    if (!updated[0]) return { ok: false, error: "That step is not on the list." };
    return { ok: true, done: Boolean(updated[0].done) };
  });
