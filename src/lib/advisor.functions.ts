// Recovered server module.
// @ts-nocheck
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { clearDeskSession, startDeskSession } from "@/lib/desk-session";
import {
  accessTokenForAdvisor,
  assertCallbackUrl,
  authorizeUrl,
  createPkce,
  graphSendMail,
  loadMicrosoftConfig,
  microsoftAppStatus,
  saveMicrosoftAppCredentials,
} from "@/lib/microsoft-mail";
import { getSql, dbSource } from "@/lib/db";
import { hashCode, codesMatch } from "@/lib/codes";
import { CARDS, personalize, TAGS } from "@/lib/catalog";
import { cleanSteps, DRIP_INTERVALS } from "@/lib/drips";
import { readNewsletterPayload, renderNewsletter, signatureLines } from "@/lib/newsletter";
import { ELETTER_DESIGNS, readEletterSend, renderEletter } from "@/lib/eletter";
import {
  allocateSlug,
  baseDomain,
  cleanDomain,
  cleanSlug,
  findAdvisorByEmail,
  gateAdvisor,
  gateOperator,
  enforcePreviewOperator,
  nameSlug,
  operatorIsDefault,
  ready,
  shownWebsite,
  useCurrentWebsite,
} from "@/lib/advisor-db";
import { cardHtml, signatureWithWebsite, websiteButtonText } from "@/lib/advisor-website";
import { privateOperatorPassword } from "@/lib/operator-password";
import { allowsCustom, DEFAULT_PLATFORM, PLANS, setupPrice } from "@/lib/site-types";
import { cleanProductIds, contactHistory, ensureContactRecords, writeContactLog } from "@/lib/contact-records";
import { contactMatchesQuery, nameTokens } from "@/lib/contact-match";
import { seedNewAdvisorRules } from "@/lib/assistant-work";

var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function asPlan(value) {
	return PLANS.includes(value) ? value : null;
}
function parseTags(value) {
	return String(value ?? "").split(",").map((tag) => tag.trim()).filter(Boolean);
}
function cleanTagName(value) {
	const name = value.trim().replace(/\s+/g, " ");
	if (name.length < 2 || name.length > 40 || name.includes(",")) return null;
	return name;
}
function cleanTags(tags) {
	const unique = [];
	for (const raw of tags) {
		const name = cleanTagName(raw);
		if (!name) return {
			ok: false,
			error: "Keep each tag between 2 and 40 characters, with no commas."
		};
		if (!unique.some((item) => item.toLowerCase() === name.toLowerCase())) unique.push(name);
	}
	if (unique.length > 8) return {
		ok: false,
		error: "Use at most 8 tags."
	};
	return {
		ok: true,
		tags: unique
	};
}
async function rememberAdvisorTags(advisorId, tags) {
	const sql = await getSql();
	for (const name of tags) {
		if (TAGS.some((item) => item.toLowerCase() === name.toLowerCase())) continue;
		await sql`
      insert into advisor_tags (advisor_id, name, source)
      values (${advisorId}, ${name}, 'own')
      on conflict (advisor_id, name) do nothing
    `;
	}
}
async function grantCurrentPlatformTags(advisorId) {
	await (await getSql())`
    insert into advisor_tags (advisor_id, name, source)
    select ${advisorId}, name, 'platform' from platform_tags
    on conflict (advisor_id, name) do nothing
  `;
}
export const getOperatorGate = createServerFn({ method: "GET" }).handler(async (): Promise<any> => {
	await enforcePreviewOperator();
	return {
		codeIsDefault: await operatorIsDefault(),
		domain: await baseDomain(),
		preview: dbSource === "pglite"
	};
});
export const listTemplates = createServerFn({ method: "GET" }).handler(async (): Promise<any> => {
	return (await (await getSql())`
    select id, kind, name, detail, body, (image_data <> '') as has_image from platform_templates order by created_at desc limit 100
  `).map((row) => ({
		id: Number(row.id),
		kind: row.kind,
		name: row.name,
		detail: row.detail,
		body: row.body,
		hasImage: row.has_image === true || String(row.has_image) === "t" || String(row.has_image) === "true"
	}));
});
export const listPlatformTags = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }): Promise<any> => {
	const gate = await gateOperator(data.code);
	if (!gate.ok) return gate;
	return {
		ok: true,
		tags: (await (await getSql())`
      select id, name, created_at from platform_tags order by created_at desc
    `).map((row) => ({
			id: Number(row.id),
			name: row.name,
			createdAt: new Date(row.created_at).toISOString()
		}))
	};
});
export const addPlatformTag = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }): Promise<any> => {
	const gate = await gateOperator(data.code);
	if (!gate.ok) return gate;
	const name = cleanTagName(data.name ?? "");
	if (!name) return {
		ok: false,
		error: "Use a tag of 2 to 40 characters, with no commas."
	};
	const sql = await getSql();
	if ((await sql`select id from platform_tags where lower(name) = lower(${name})`)[0]) return {
		ok: false,
		error: "That tag is already on the list."
	};
	await sql`insert into platform_tags (name) values (${name})`;
	return { ok: true };
});
export const addAdvisorTag = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }): Promise<any> => {
	const gate = await gateAdvisor(data.slug, data.code);
	if (!gate.ok) return gate;
	const name = cleanTagName(data.name ?? "");
	if (!name) return {
		ok: false,
		error: "Use a tag of 2 to 40 characters, with no commas."
	};
	if (TAGS.some((item) => item.toLowerCase() === name.toLowerCase())) return {
		ok: true,
		name
	};
	const sql = await getSql();
	const existing = await sql`
      select name from advisor_tags where advisor_id = ${gate.row.id} and lower(name) = lower(${name})
    `;
	if (!existing[0]) await sql`
        insert into advisor_tags (advisor_id, name, source)
        values (${gate.row.id}, ${name}, 'own')
      `;
	return {
		ok: true,
		name: existing[0]?.name ?? name
	};
});
export const addTemplate = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }): Promise<any> => {
	const gate = await gateOperator(data.code);
	if (!gate.ok) return gate;
	const name = data.name.trim();
	if (name.length < 2) return {
		ok: false,
		error: "Add a name."
	};
	const image = typeof data.image === "string" && data.image.startsWith("data:image/") ? data.image : "";
	if ((data.kind === "card" || data.kind === "banner") && !image) return { ok: false, error: "Upload a picture." };
	if (image.length > 900000) return { ok: false, error: "That picture is too large. Choose a smaller one." };
	await (await getSql())`
      insert into platform_templates (kind, name, detail, body, image_data)
      values (${data.kind}, ${name}, ${data.detail.trim()}, ${data.body}, ${image})
    `;
	return { ok: true };
});
export const resolveEntry = createServerFn({ method: "GET" }).handler(async (): Promise<any> => {
	const domain = await baseDomain();
	const request = getRequest();
	const host = (request?.headers.get("x-forwarded-host") || request?.headers.get("host") || "").split(",")[0]?.trim().split(":")[0]?.toLowerCase() ?? "";
	if (domain && host.endsWith(`.${domain}`)) {
		const sub = host.slice(0, -(domain.length + 1));
		if (sub && !sub.includes(".") && cleanSlug(sub)) return {
			kind: "advisor",
			slug: sub,
			domain
		};
	}
	return {
		kind: "platform",
		slug: "",
		domain
	};
});
async function insertAdvisor(input) {
	const firstName = input.firstName.trim();
	const lastName = input.lastName.trim();
	const email = input.email.trim().toLowerCase();
	const accessCode = input.accessCode.trim();
	const name = `${firstName} ${lastName}`.trim();
	if (firstName.length < 2 || lastName.length < 2 || name.length > 80) return {
		ok: false,
		error: "Use a first and last name."
	};
	if (!EMAIL.test(email) || email.length > 120) return {
		ok: false,
		error: "Add a real email address."
	};
	if (accessCode.length < 6 || accessCode.length > 80) return {
		ok: false,
		error: "Use an access code of at least 6 characters."
	};
	const label = nameSlug(firstName, lastName);
	if (!label) return {
		ok: false,
		error: "Use a first and last name with letters."
	};
	const sql = await getSql();
	if (await findAdvisorByEmail(email)) return {
		ok: false,
		error: "That email already has a copy."
	};
	const slug = await allocateSlug(sql, label);
	if (!slug) return {
		ok: false,
		error: "That name cannot be used as a subdomain."
	};
	await sql`
    insert into advisors (
      slug, practice_name, advisor_name, email, plan, status, package, palette,
      show_life, show_critical, show_disability, show_group, show_facts, show_form,
      code_hash, code_is_default, promo_code, promo_kind, promo_amount
    ) values (
      ${slug}, ${name}, ${name}, ${email}, ${input.plan}, 'active', 'explain', 'ink',
      true, true, true, true, true, true,
      ${hashCode(accessCode)}, false, ${input.promoCode || ""}, ${input.promoKind || ""}, ${Number(input.promoAmount) || 0}
    )
  `;
	const created = await sql`select id from advisors where slug = ${slug}`;
	if (created[0]) {
		await grantCurrentPlatformTags(Number(created[0].id));
		await seedNewAdvisorRules(Number(created[0].id));
		await sql.query("alter table advisors add column if not exists setup_fee integer not null default 0");
		await sql.query("alter table advisors add column if not exists setup_waived boolean not null default false");
		await sql.query("alter table advisors add column if not exists setup_priced boolean not null default false");
		const listed = input.plan === "team" ? 1000 : input.plan === "professional" ? 500 : 100;
		const fee = Number.isFinite(Number(input.setupFee)) ? Math.max(0, Math.round(Number(input.setupFee))) : listed;
		await sql`update advisors set setup_fee = ${fee}, setup_waived = false, setup_priced = true where slug = ${slug}`;
	}
	return {
		ok: true,
		slug,
		name
	};
}
export const signupAdvisor = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }): Promise<any> => {
	const plan = asPlan(data.plan);
	if (!plan) return {
		ok: false,
		error: "Choose a plan."
	};
	const parsed = readPromoCode(data.promoCode);
	if (!parsed.ok) return parsed;
	let promo = null;
	if (parsed.code) {
		const claimed = await claimPromotion(parsed.code);
		if (!claimed.ok) return claimed;
		promo = claimed;
	}
	const created = await insertAdvisor({
		...data,
		plan,
		promoCode: promo?.code ?? "",
		promoKind: promo && promo.monthlyPercent >= 0 ? (promo.monthlyPercent > 0 ? "percent" : "") : promo?.kind ?? "",
		promoAmount: promo && promo.monthlyPercent >= 0 ? promo.monthlyPercent : promo?.amount ?? 0,
		setupFee: setupPrice(plan, promo?.kind, promo?.amount, promo?.applies, promo && promo.setupPercent >= 0 ? promo.setupPercent : undefined)
	});
	if (!created.ok && promo) await releasePromotion(promo.id);
	return created;
});
export const createAdvisorCopy = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }): Promise<any> => {
	const gate = await gateOperator(data.code);
	if (!gate.ok) return gate;
	const plan = asPlan(data.plan);
	if (!plan) return {
		ok: false,
		error: "Choose a plan."
	};
	const accessCode = randomBytes(5).toString("hex");
	const created = await insertAdvisor({
		firstName: data.firstName,
		lastName: data.lastName,
		email: data.email,
		accessCode,
		plan
	});
	if (!created.ok) return created;
	const domain = await baseDomain();
	return {
		ok: true,
		slug: created.slug,
		name: created.name,
		accessCode,
		domain
	};
});
export const saveBaseDomain = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }): Promise<any> => {
	const gate = await gateOperator(data.code);
	if (!gate.ok) return gate;
	const domain = cleanDomain(data.domain ?? "");
	if (domain === null) return {
		ok: false,
		error: "Use a domain like uniqueadvisor.com, with no https and no path."
	};
	await (await getSql())`update operators set base_domain = ${domain} where id = 1`;
	return {
		ok: true,
		domain
	};
});
function siteColor(source, key, fallback) {
	if (!source || !Object.prototype.hasOwnProperty.call(source, key)) return fallback;
	const color = String(source[key] ?? "");
	return /^#[0-9a-fA-F]{6}$/.test(color) ? color : fallback;
}
function siteText(source, key, max, fallback) {
	if (!source || !Object.prototype.hasOwnProperty.call(source, key)) return fallback;
	return String(source[key] ?? "").replace(/[ \t]+/g, " ").trim().slice(0, max);
}
function safeHref(value) {
	const href = String(value ?? "").trim();
	if (href.startsWith("/") || href.startsWith("#")) return href.slice(0, 80);
	return "";
}
function siteLinks(raw, fallback) {
	if (!Array.isArray(raw)) return fallback;
	return raw.slice(0, 8).map((item) => ({
		label: String(item?.label ?? "").replace(/\s+/g, " ").trim().slice(0, 40),
		href: safeHref(item?.href)
	})).filter((item) => item.label && item.href);
}
function siteCards(raw, fallback) {
	if (!Array.isArray(raw)) return fallback;
	return raw.slice(0, 12).map((item) => ({
		title: String(item?.title ?? "").replace(/\s+/g, " ").trim().slice(0, 120),
		body: String(item?.body ?? "").replace(/[ \t]+/g, " ").trim().slice(0, 600)
	})).filter((item) => item.title || item.body);
}
function siteFonts(raw, fallback) {
	const fonts = {};
	for (const key of Object.keys(fallback)) {
		const item = raw && raw[key] ? raw[key] : {};
		const size = Number(item.size);
		const color = String(item.color ?? "");
		fonts[key] = {
			size: Number.isFinite(size) ? Math.max(10, Math.min(96, Math.round(size))) : fallback[key].size,
			color: /^#[0-9a-fA-F]{6}$/.test(color) ? color : fallback[key].color
		};
	}
	return fonts;
}
function sitePlans(raw, fallback) {
	if (!Array.isArray(raw)) return fallback;
	return raw.slice(0, 6).map((item) => ({
		name: String(item?.name ?? "").replace(/\s+/g, " ").trim().slice(0, 40),
		note: String(item?.note ?? "").replace(/\s+/g, " ").trim().slice(0, 60),
		price: String(item?.price ?? "").replace(/\s+/g, " ").trim().slice(0, 20),
		points: String(item?.points ?? "").trim().slice(0, 500),
		button: String(item?.button ?? "").replace(/\s+/g, " ").trim().slice(0, 40),
		featured: item?.featured === true
	})).filter((item) => item.name || item.price);
}
function parseSettings(raw) {
	let parsed = {};
	try {
		if (raw.trim()) parsed = JSON.parse(raw);
	} catch {
		parsed = {};
	}
	const days = Number(parsed.trialDays);
	const base = DEFAULT_PLATFORM.site;
	const source = parsed.site ?? null;
	return {
		trialDays: Number.isFinite(days) && days !== 14 ? Math.max(0, Math.min(365, Math.round(days))) : DEFAULT_PLATFORM.trialDays,
		defaultPlan: asPlan(String(parsed.defaultPlan ?? "")) ?? DEFAULT_PLATFORM.defaultPlan,
		currency: parsed.currency === "USD" ? "USD" : "CAD",
		allowCustomTags: parsed.allowCustomTags !== false,
		allowWebsite: parsed.allowWebsite !== false,
		site: {
			links: siteLinks(source?.links, base.links),
			kicker: siteText(source, "kicker", 80, base.kicker),
			accent: siteText(source, "accent", 80, base.accent),
			headline: siteText(source, "headline", 220, base.headline),
			subhead: siteText(source, "subhead", 600, base.subhead),
			primaryButton: siteText(source, "primaryButton", 60, base.primaryButton),
			secondaryButton: siteText(source, "secondaryButton", 40, base.secondaryButton),
			buttonColor: siteColor(source, "buttonColor", base.buttonColor),
			assistantVisible: source && Object.prototype.hasOwnProperty.call(source, "assistantVisible") ? source.assistantVisible !== false : true,
			assistantKicker: siteText(source, "assistantKicker", 80, base.assistantKicker),
			assistantTitle: siteText(source, "assistantTitle", 160, base.assistantTitle),
			assistantLead: siteText(source, "assistantLead", 600, base.assistantLead),
			assistantCards: siteCards(source?.assistantCards, base.assistantCards),
			featuresVisible: source && Object.prototype.hasOwnProperty.call(source, "featuresVisible") ? source.featuresVisible !== false : true,
			featuresKicker: siteText(source, "featuresKicker", 80, base.featuresKicker),
			featuresTitle: siteText(source, "featuresTitle", 160, base.featuresTitle),
			features: siteCards(source?.features, base.features),
			pricingVisible: source && Object.prototype.hasOwnProperty.call(source, "pricingVisible") ? source.pricingVisible !== false : true,
			pricingKicker: siteText(source, "pricingKicker", 80, base.pricingKicker),
			pricingTitle: siteText(source, "pricingTitle", 160, base.pricingTitle),
			plans: sitePlans(source?.plans, base.plans),
			footer: siteText(source, "footer", 180, base.footer),
			footerLinks: siteLinks(source?.footerLinks, base.footerLinks),
			fonts: siteFonts(source?.fonts, base.fonts)
		}
	};
}
async function readSettings() {
	await ready();
	return parseSettings((await (await getSql())`select settings_json from operators where id = 1`)[0]?.settings_json ?? "");
}
export const getCorporateSite = createServerFn({ method: "GET" }).handler(async (): Promise<any> => {
	const settings = await readSettings();
	return {
		trialDays: settings.trialDays,
		defaultPlan: settings.defaultPlan,
		site: settings.site
	};
});
export const loadPlatformSettings = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }): Promise<any> => {
	const gate = await gateOperator(data.code);
	if (!gate.ok) return gate;
	return {
		ok: true,
		settings: await readSettings()
	};
});
export const savePlatformSettings = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }): Promise<any> => {
	const gate = await gateOperator(data.code);
	if (!gate.ok) return gate;
	const settings = parseSettings(JSON.stringify(data.settings ?? {}));
	await (await getSql())`update operators set settings_json = ${JSON.stringify(settings)} where id = 1`;
	return {
		ok: true,
		settings
	};
});
export const loginAdvisor = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }): Promise<any> => {
	const email = (data.email ?? "").trim().toLowerCase();
	const row = await findAdvisorByEmail(email);
	if (!row?.code_hash || !codesMatch(row.code_hash, data.accessCode ?? "")) return {
		ok: false,
		error: "That email or access code is not right."
	};
	if (row.status === "suspended") return {
		ok: false,
		error: "This service is paused. The operator has to turn it back on."
	};
	await startDeskSession(row).catch(() => undefined);
	return {
		ok: true,
		slug: row.slug,
		practiceName: row.practice_name
	};
});
export const signOutDesk = createServerFn({ method: "POST" }).handler(async () => {
	await clearDeskSession().catch(() => undefined);
	return { ok: true as const };
});
export const listSubscribers = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }): Promise<any> => {
	const gate = await gateOperator(String(data?.code ?? ""));
	if (!gate.ok) return { ok: false, error: "That password is not right." };
	try {
		const sql = await getSql();
		await ensurePromoColumns();
		await sql`
    update advisors
    set setup_fee = case plan when 'professional' then 500 when 'team' then 1000 else 100 end,
        setup_priced = true
    where setup_priced = false and setup_waived = false and setup_fee = 0
  `;
		return {
			ok: true,
			subscribers: (await sql`
      select id, slug, practice_name, advisor_name, email, plan, status, created_at,
        promo_code, promo_kind, promo_amount, setup_fee, setup_waived
      from advisors
      order by created_at desc
      limit 500
    `).map((row) => ({
				id: Number(row.id),
				slug: row.slug,
				practiceName: row.practice_name,
				advisorName: row.advisor_name,
				email: row.email,
				plan: asPlan(row.plan) ?? "starter",
				status: row.status === "suspended" ? "suspended" : "active",
				createdAt: new Date(row.created_at).toISOString(),
				promoCode: row.promo_code || "",
				promoKind: row.promo_kind || "",
				promoAmount: Number(row.promo_amount) || 0,
				setupFee: Number(row.setup_fee) || 0,
				setupWaived: Boolean(row.setup_waived)
			}))
		};
	} catch {
		return { ok: true, subscribers: [] };
	}
});
function readPromoCode(value) {
	const code = String(value ?? "").trim().toUpperCase().replace(/\s+/g, "");
	if (!code) return { ok: true, code: "" };
	if (!/^[A-Z0-9-]{3,24}$/.test(code)) return { ok: false, error: "That promotion code is not valid." };
	return { ok: true, code };
}
function promoPercents(row) {
	const kind = row.kind === "amount" ? "amount" : "percent";
	const amount = Number(row.amount) || 0;
	const applies = row.applies === "setup" || row.applies === "both" ? row.applies : "monthly";
	let monthlyPercent = row.monthly_percent == null ? null : Number(row.monthly_percent);
	let setupPercent = row.setup_percent == null ? null : Number(row.setup_percent);
	if (monthlyPercent == null && setupPercent == null && kind === "percent") {
		monthlyPercent = applies === "setup" ? 0 : amount;
		setupPercent = applies === "monthly" ? 0 : amount;
	}
	if (monthlyPercent == null && setupPercent == null) {
		monthlyPercent = -1;
		setupPercent = -1;
	}
	if (monthlyPercent == null) monthlyPercent = 0;
	if (setupPercent == null) setupPercent = 0;
	return { kind, amount, applies, monthlyPercent, setupPercent };
}
function mapPromotion(row) {
	const percents = promoPercents(row);
	return {
		id: Number(row.id),
		code: row.code,
		kind: percents.kind,
		amount: percents.amount,
		applies: percents.applies,
		monthlyPercent: percents.monthlyPercent,
		setupPercent: percents.setupPercent,
		note: row.note || "",
		active: Boolean(row.active),
		maxUses: Number(row.max_uses) || 0,
		usedCount: Number(row.used_count) || 0,
		expiresOn: row.expires_on ? String(row.expires_on).slice(0, 10) : ""
	};
}
async function ensurePromoColumns() {
	const sql = await getSql();
	await sql.query(`create table if not exists promotions (
    id serial primary key,
    code text not null unique,
    kind text not null default 'percent',
    amount integer not null,
    note text not null default '',
    active boolean not null default true,
    max_uses integer not null default 0,
    used_count integer not null default 0,
    expires_on date,
    created_at timestamptz not null default now()
  )`);
	await sql.query("alter table promotions add column if not exists applies text not null default 'monthly'");
	await sql.query("alter table promotions add column if not exists monthly_percent integer");
	await sql.query("alter table promotions add column if not exists setup_percent integer");
	await sql.query("alter table advisors add column if not exists setup_fee integer not null default 0");
	await sql.query("alter table advisors add column if not exists setup_waived boolean not null default false");
	await sql.query("alter table advisors add column if not exists setup_priced boolean not null default false");
	await sql.query("alter table advisors add column if not exists promo_code text not null default ''");
	await sql.query("alter table advisors add column if not exists promo_kind text not null default ''");
	await sql.query("alter table advisors add column if not exists promo_amount integer not null default 0");
}
async function explainPromo(code) {
	const row = (await (await getSql())`select active, max_uses, used_count, expires_on from promotions where code = ${code} limit 1`)[0];
	if (!row) return "That promotion code is not valid.";
	if (!row.active) return "That promotion code is turned off.";
	if (row.expires_on && String(row.expires_on).slice(0, 10) < new Date().toISOString().slice(0, 10)) return "That promotion code has expired.";
	if (Number(row.max_uses) > 0 && Number(row.used_count) >= Number(row.max_uses)) return "That promotion code has been used up.";
	return "That promotion code cannot be used.";
}
async function claimPromotion(code) {
	await ensurePromoColumns();
	const row = (await (await getSql())`
    update promotions
    set used_count = used_count + 1
    where code = ${code}
      and active = true
      and (max_uses = 0 or used_count < max_uses)
      and (expires_on is null or expires_on >= current_date)
    returning id, code, kind, amount, applies, monthly_percent, setup_percent
  `)[0];
	if (!row) return { ok: false, error: await explainPromo(code) };
	const percents = promoPercents(row);
	return { ok: true, id: Number(row.id), code: row.code, ...percents };
}
async function releasePromotion(id) {
	await (await getSql())`update promotions set used_count = greatest(used_count - 1, 0) where id = ${id}`;
}
export const checkPromotion = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }): Promise<any> => {
	const plan = asPlan(data.plan);
	if (!plan) return { ok: false, error: "Choose a plan." };
	const parsed = readPromoCode(data.code);
	if (!parsed.ok) return parsed;
	if (!parsed.code) return { ok: false, error: "Enter a promotion code." };
	await ensurePromoColumns();
	const row = (await (await getSql())`
    select id, code, kind, amount, applies, monthly_percent, setup_percent
    from promotions
    where code = ${parsed.code}
      and active = true
      and (max_uses = 0 or used_count < max_uses)
      and (expires_on is null or expires_on >= current_date)
    limit 1
  `)[0];
	if (!row) return { ok: false, error: await explainPromo(parsed.code) };
	return { ok: true, code: row.code, ...promoPercents(row) };
});
export const listPromotions = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }): Promise<any> => {
	const gate = await gateOperator(data.code);
	if (!gate.ok) return gate;
	await ensurePromoColumns();
	const rows = await (await getSql())`
    select id, code, kind, amount, applies, monthly_percent, setup_percent, note, active, max_uses, used_count, expires_on
    from promotions
    order by created_at desc
    limit 200
  `;
	return { ok: true, promotions: rows.map(mapPromotion) };
});
export const savePromotion = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }): Promise<any> => {
	const gate = await gateOperator(data.code);
	if (!gate.ok) return gate;
	const parsed = readPromoCode(data.promoCode);
	if (!parsed.ok || !parsed.code) return { ok: false, error: parsed.error || "Enter a code of at least 3 letters or numbers." };
	const monthlyPercent = Math.max(0, Math.min(100, Math.round(Number(data.monthlyPercent) || 0)));
	const setupPercent = Math.max(0, Math.min(100, Math.round(Number(data.setupPercent) || 0)));
	if (active && monthlyPercent === 0 && setupPercent === 0) return { ok: false, error: "Enter a percent for the monthly fee, the setup fee, or both." };
	const note = String(data.note ?? "").trim().slice(0, 200);
	const maxUses = Math.max(0, Math.round(Number(data.maxUses) || 0));
	const expiresOn = /^\d{4}-\d{2}-\d{2}$/.test(String(data.expiresOn ?? "")) ? String(data.expiresOn) : null;
	const active = data.active !== false;
	const applies = monthlyPercent > 0 && setupPercent > 0 ? "both" : setupPercent > 0 ? "setup" : "monthly";
	const id = Number(data.id) || 0;
	const sql = await getSql();
	await ensurePromoColumns();
	const clash = (await sql`select id from promotions where code = ${parsed.code} limit 1`)[0];
	if (clash && Number(clash.id) !== id) return { ok: false, error: "That code is already in use." };
	if (id) {
		const saved = (await sql`
      update promotions
      set code = ${parsed.code}, kind = ${"percent"}, amount = ${monthlyPercent}, note = ${note},
          active = ${active}, max_uses = ${maxUses}, expires_on = ${expiresOn}, applies = ${applies},
          monthly_percent = ${monthlyPercent}, setup_percent = ${setupPercent}
      where id = ${id}
      returning id
    `)[0];
		if (!saved) return { ok: false, error: "That promotion was not found." };
	} else {
		await sql`
      insert into promotions (code, kind, amount, note, active, max_uses, expires_on, applies, monthly_percent, setup_percent)
      values (${parsed.code}, ${"percent"}, ${monthlyPercent}, ${note}, ${active}, ${maxUses}, ${expiresOn}, ${applies}, ${monthlyPercent}, ${setupPercent})
    `;
	}
	return { ok: true };
});
export const deletePromotion = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }): Promise<any> => {
	const gate = await gateOperator(data.code);
	if (!gate.ok) return gate;
	const id = Number(data.id);
	if (!Number.isInteger(id)) return { ok: false, error: "That promotion was not found." };
	const row = (await (await getSql())`select used_count from promotions where id = ${id}`)[0];
	if (!row) return { ok: false, error: "That promotion was not found." };
	if (Number(row.used_count) > 0) return { ok: false, error: "This code has already been used. Turn it off instead of deleting it." };
	await (await getSql())`delete from promotions where id = ${id}`;
	return { ok: true };
});
export const setSubscriberPlan = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }): Promise<any> => {
	const gate = await gateOperator(data.code);
	if (!gate.ok) return gate;
	const plan = asPlan(data.plan);
	const id = Number(data.id);
	if (!plan || !Number.isInteger(id)) return {
		ok: false,
		error: "Choose a plan."
	};
	if (!(await (await getSql())`update advisors set plan = ${plan} where id = ${id} returning id`)[0]) return {
		ok: false,
		error: "That subscriber is not on the list."
	};
	return { ok: true };
});
export const setSetupFee = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }): Promise<any> => {
	const gate = await gateOperator(data.code);
	if (!gate.ok) return gate;
	const id = Number(data.id);
	const waived = data.waived === true;
	if (!Number.isInteger(id)) return { ok: false, error: "Choose an advisor." };
	await ensurePromoColumns();
	const row = (await (await getSql())`select plan from advisors where id = ${id}`)[0];
	if (!row) return { ok: false, error: "That advisor was not found." };
	const listed = row.plan === "team" ? 1000 : row.plan === "professional" ? 500 : 100;
	await (await getSql())`
    update advisors
    set setup_waived = ${waived},
        setup_priced = true,
        setup_fee = ${waived ? 0 : listed}
    where id = ${id}
  `;
	return { ok: true, waived, setupFee: waived ? 0 : listed };
});
export const setSubscriberStatus = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }): Promise<any> => {
	const gate = await gateOperator(data.code);
	if (!gate.ok) return gate;
	const status = data.status === "suspended" ? "suspended" : data.status === "active" ? "active" : null;
	const id = Number(data.id);
	if (!status || !Number.isInteger(id)) return {
		ok: false,
		error: "Choose active or paused."
	};
	if (!(await (await getSql())`update advisors set status = ${status} where id = ${id} returning id`)[0]) return {
		ok: false,
		error: "That subscriber is not on the list."
	};
	return { ok: true };
});
export const resetOperatorCode = createServerFn({ method: "POST" }).validator((input) => input).handler(async (): Promise<any> => {
	if (dbSource === "pglite") return { ok: false, error: "The preview password cannot be reset to the default." };
	await ready();
	const hash = hashCode("superadmin");
	const sql = await getSql();
	const updated = await sql`update operators set code_hash = ${hash}, code_is_default = true where id = 1 returning id`;
	if (!updated[0]) {
		await sql`insert into operators (id, code_hash, code_is_default) values (1, ${hash}, true)`;
	}
	return { ok: true };
});
export const setPreviewOperatorPassword = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }): Promise<any> => {
	if (dbSource !== "pglite") return { ok: false, error: "The production password is not changed here." };
	await ready();
	const outside = String(process.env.PREVIEW_OPERATOR_PASSWORD || "").trim();
	if (!privateOperatorPassword(outside)) return { ok: false, error: "This preview password is configured outside the page." };
	const password = String(data?.password || "").trim();
	if (password !== String(data?.confirm || "").trim()) return { ok: false, error: "Those passwords do not match." };
	const problem = privateOperatorPassword(password);
	if (problem) return { ok: false, error: problem };
	const sql = await getSql();
	const hash = hashCode(password);
	const updated = await sql`update operators set code_hash = ${hash}, code_is_default = false where id = 1 returning code_hash`;
	if (!codesMatch(String(updated[0]?.code_hash || ""), password)) return { ok: false, error: "The password was not saved." };
	return { ok: true };
});
export const changeOperatorCode = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }): Promise<any> => {
	const next = (data.next ?? "").trim();
	if (dbSource === "pglite" && privateOperatorPassword(next)) return { ok: false, error: privateOperatorPassword(next) };
	if (next.length < 6) return {
		ok: false,
		error: "Use at least 6 characters for the new code."
	};
	const gate = await gateOperator(data.code);
	if (!gate.ok) return gate;
	await (await getSql())`
      update operators set code_hash = ${hashCode(next)}, code_is_default = false where id = 1
    `;
	return { ok: true };
});
function cleanBirthday(value) {
	const text = String(value ?? "").trim();
	if (!text) return "";
	const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (!iso) return null;
	const month = Number(iso[2]);
	const day = Number(iso[3]);
	if (month < 1 || month > 12 || day < 1 || day > 31) return null;
	return `${iso[1]}-${iso[2]}-${iso[3]}`;
}
function toContact(row) {
	return {
		id: Number(row.id),
		fullName: row.full_name,
		email: row.email,
		phone: row.phone,
		birthday: row.birthday || "",
		products: cleanProductIds(row.products),
		productNote: row.product_note || "",
		kycOn: row.kyc_on || "",
		tags: parseTags(row.tags)
	};
}
export const loadDesk = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }): Promise<any> => {
	const gate = await gateAdvisor(data.slug, data.code);
	if (!gate.ok) return gate;
	void runAllDueDrips();
	const sql = await getSql();
	await ensureContactRecords();
	const id = gate.row.id;
	const contacts = await sql`
      select id, full_name, email, phone, birthday, products, product_note, kyc_on, tags from contacts
      where advisor_id = ${id}
      order by created_at desc
      limit 5000
    `;
	const cards = await sql`
      select id, title, message, (image_data <> '') as has_image from saved_cards
      where advisor_id = ${id}
      order by created_at desc
      limit 50
    `;
	const letters = await sql`
      select id, title, subject, body from saved_letters
      where advisor_id = ${id}
      order by created_at desc
      limit 50
    `;
	const messages = await sql`
      select id, kind, title, subject, body, contact_name, contact_email, created_at
      from messages
      where advisor_id = ${id}
      order by created_at desc
      limit 100
    `;
	const savedCards = cards.map((card) => ({
		id: Number(card.id),
		title: card.title,
		subject: "",
		body: card.message,
		image: card.has_image === true || String(card.has_image) === "t" || String(card.has_image) === "true" ? `/api/cards/${Number(card.id)}?v=2` : ""
	}));
	const savedLetters = letters.map((letter) => ({
		id: Number(letter.id),
		title: letter.title,
		subject: letter.subject,
		body: letter.body
	}));
	const archived = messages.map((message) => ({
		id: Number(message.id),
		kind: message.kind,
		title: message.title,
		subject: message.subject,
		body: message.body,
		contactName: message.contact_name,
		contactEmail: message.contact_email,
		createdAt: new Date(message.created_at).toISOString()
	}));
	const extra = await sql`
      select name from advisor_tags where advisor_id = ${id} order by created_at
    `;
	const tags = [...TAGS];
	for (const row of extra) if (!tags.some((item) => item.toLowerCase() === row.name.toLowerCase())) tags.push(row.name);
	const hidden = await sql`select card_id from hidden_catalog_cards where advisor_id = ${id}`;
	const shared = await sql`
      select id, name, detail, body, (image_data <> '') as has_image
      from platform_templates where kind = 'card' order by created_at desc limit 100
    `;
	const social = socialFromSaved(gate.site.publicSocial);
	return {
		ok: true,
		sessionToken: gate.sessionToken || "",
		desk: {
			slug: gate.site.slug,
			practiceName: gate.site.practiceName,
			advisorName: gate.site.advisorName,
			plan: gate.site.plan,
			palette: gate.site.palette,
			contacts: contacts.map(toContact),
			cards: savedCards,
			letters: savedLetters,
			messages: archived,
			tags,
			hiddenCardIds: hidden.map((row) => row.card_id),
			contactTitle: gate.site.publicTitle,
			contactPhone: gate.site.publicPhone,
			contactEmail: gate.site.publicCardEmail,
			contactCompany: gate.site.publicCompany,
			contactWebsite: shownWebsite(gate.site),
			siteMode: gate.site.siteMode,
			siteUrl: gate.site.siteUrl,
			...social,
			photo: gate.site.publicPhoto || "",
			photoOnNewsletter: Boolean(social.photoOnNewsletter),
			photoOnEletter: Boolean(social.photoOnEletter),
			sharedCards: shared.map((row) => ({
				id: Number(row.id),
				name: row.name,
				body: row.body || row.detail,
				image: row.has_image === true || String(row.has_image) === "t" || String(row.has_image) === "true" ? `/api/platform-cards/${Number(row.id)}?v=2` : ""
			}))
		}
	};
});

function safeContact(row) {
	try {
		return toContact({
			...row,
			full_name: row?.full_name ?? "",
			email: row?.email ?? "",
			phone: row?.phone ?? "",
			birthday: row?.birthday ?? "",
			products: row?.products ?? "",
			product_note: row?.product_note ?? "",
			kyc_on: row?.kyc_on ?? "",
			tags: row?.tags ?? ""
		});
	} catch (error) {
		console.error("[contacts] row", error);
		return null;
	}
}
function pickContactMatches(rows, query) {
	const matches = [];
	for (const row of rows) {
		const contact = safeContact(row);
		if (!contact || !contactMatchesQuery(contact, query)) continue;
		matches.push(contact);
		if (matches.length >= 100) break;
	}
	return matches;
}
export const searchDeskContacts = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }) => {
	const gate = await gateAdvisor(data.slug, data.code);
	if (!gate.ok) return gate;
	const query = String(data.query || "").trim().slice(0, 80);
	const words = nameTokens(query).slice(0, 6);
	if (!words.length) return { ok: true, contacts: [] };
	try {
		await ensureContactRecords();
		const sql = await getSql();
		const first = words[0];
		const narrowed = await sql`
      select id, full_name, email, phone, birthday, products, product_note, kyc_on, tags
      from contacts
      where advisor_id = ${gate.row.id}
        and (
          strpos(lower(coalesce(full_name, '')), ${first}) > 0
          or strpos(lower(coalesce(email, '')), ${first}) > 0
          or strpos(lower(coalesce(phone, '')), ${first}) > 0
          or strpos(lower(coalesce(tags, '')), ${first}) > 0
        )
      order by full_name
      limit 500
    `;
		let contacts = pickContactMatches(narrowed, query);
		if (contacts.length === 0) {
			const found = [];
			let offset = 0;
			while (offset < 20000 && found.length < 100) {
				const page = await sql`
          select id, full_name, email, phone, birthday, products, product_note, kyc_on, tags
          from contacts
          where advisor_id = ${gate.row.id}
          order by full_name, id
          limit 2000 offset ${offset}
        `;
				if (!page.length) break;
				for (const row of page) {
					const contact = safeContact(row);
					if (contact && contactMatchesQuery(contact, query)) found.push(contact);
					if (found.length >= 100) break;
				}
				offset += page.length;
				if (page.length < 2000) break;
			}
			contacts = found;
		}
		console.info(`[contacts] search ${words.join(" ")} -> ${contacts.length}`);
		return { ok: true, contacts };
	} catch (error) {
		console.error("[contacts] search", error);
		return { ok: false, error: "The contact search could not be completed. Try again." };
	}
});

export const saveContact = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }): Promise<any> => {
	const gate = await gateAdvisor(data.slug, data.code);
	if (!gate.ok) return gate;
	const fullName = (data.fullName ?? "").trim();
	const email = (data.email ?? "").trim().toLowerCase();
	const phone = (data.phone ?? "").trim();
	const birthday = cleanBirthday(data.birthday);
	const kycOn = cleanBirthday(data.kycOn);
	const products = cleanProductIds(data.products).join(",");
	const productNote = String(data.productNote ?? "").trim().slice(0, 2000);
	if (birthday === null) return { ok: false, error: "Use a real birth date, or leave it blank." };
	if (kycOn === null) return { ok: false, error: "Use a real KYC date, or leave it blank." };
	if (fullName.length < 2 || fullName.length > 80) return {
		ok: false,
		error: "Add the contact's name."
	};
	if (email && (!EMAIL.test(email) || email.length > 120)) return {
		ok: false,
		error: "That email does not look right."
	};
	if (phone.length > 30) return {
		ok: false,
		error: "That phone number looks too long."
	};
	const tags = cleanTags(data.tags ?? []);
	if (!tags.ok) return tags;
	const sql = await getSql();
	await ensureContactRecords();
	await rememberAdvisorTags(gate.row.id, tags.tags);
	const stored = tags.tags.join(", ");
	const id = Number(data.id);
	if (Number.isInteger(id) && id > 0) {
		if (!(await sql`
        update contacts
        set full_name = ${fullName}, email = ${email}, phone = ${phone}, birthday = ${birthday}, products = ${products}, product_note = ${productNote}, kyc_on = ${kycOn}, tags = ${stored}
        where id = ${id} and advisor_id = ${gate.row.id}
        returning id
      `)[0]) return {
			ok: false,
			error: "That contact is not in this service."
		};
		return { ok: true };
	}
	await sql`
      insert into contacts (advisor_id, full_name, email, phone, birthday, products, product_note, kyc_on, tags)
      values (${gate.row.id}, ${fullName}, ${email}, ${phone}, ${birthday}, ${products}, ${productNote}, ${kycOn}, ${stored})
    `;
	return { ok: true };
});
export const deleteContact = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }): Promise<any> => {
	const gate = await gateAdvisor(data.slug, data.code);
	if (!gate.ok) return gate;
	const id = Number(data.id);
	await (await getSql())`delete from contacts where id = ${id} and advisor_id = ${gate.row.id}`;
	return { ok: true };
});
export const saveCard = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }): Promise<any> => {
	const gate = await gateAdvisor(data.slug, data.code);
	if (!gate.ok) return gate;
	if (!allowsCustom(gate.site.plan)) return {
		ok: false,
		error: "Custom e-cards are on the Professional and Team plans."
	};
	const title = (data.title ?? "").trim();
	const message = (data.message ?? "").trim();
	if (title.length < 2 || title.length > 60) return {
		ok: false,
		error: "Add a short title."
	};
	if (message.length < 2 || message.length > 800) return {
		ok: false,
		error: "Keep the card under 800 characters."
	};
	const image = typeof data.image === "string" && data.image.startsWith("data:image/") ? data.image : "";
	await (await getSql())`
      insert into saved_cards (advisor_id, title, message, image_data)
      values (${gate.row.id}, ${title}, ${message}, ${image})
    `;
	return { ok: true };
});
export const saveLetter = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }): Promise<any> => {
	const gate = await gateAdvisor(data.slug, data.code);
	if (!gate.ok) return gate;
	const title = (data.title ?? "").trim();
	const subject = (data.subject ?? "").trim();
	const body = (data.body ?? "").trim();
	if (title.length < 2 || title.length > 120) return {
		ok: false,
		error: "Add a newsletter title."
	};
	if (subject.length > 120) return {
		ok: false,
		error: "Keep the subject under 120 characters."
	};
	if (body.length < 2 || body.length > 50000) return {
		ok: false,
		error: "That newsletter is too long to save."
	};
	await (await getSql())`
      insert into saved_letters (advisor_id, title, subject, body)
      values (${gate.row.id}, ${title}, ${subject}, ${body})
    `;
	return { ok: true };
});
export const deleteLetter = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }): Promise<any> => {
	const gate = await gateAdvisor(data.slug, data.code);
	if (!gate.ok) return gate;
	const id = Number(data.id);
	if (!Number.isInteger(id) || id < 1) return { ok: false, error: "That newsletter was not found." };
	await (await getSql())`delete from saved_letters where id = ${id} and advisor_id = ${gate.row.id}`;
	return { ok: true };
});
async function ensureUsefulLinks() {
	await (await getSql()).query(`create table if not exists useful_links (
    id serial primary key,
    advisor_id integer not null references advisors(id) on delete cascade,
    label text not null,
    url text not null,
    created_at timestamptz not null default now()
  )`);
}
function cleanLink(value) {
	const text = String(value ?? "").trim();
	if (!text) return "";
	const withScheme = /^https?:\/\//i.test(text) ? text : `https://${text}`;
	try {
		const url = new URL(withScheme);
		if (url.protocol !== "http:" && url.protocol !== "https:") return "";
		return url.toString().slice(0, 500);
	} catch {
		return "";
	}
}
export const listUsefulLinks = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }): Promise<any> => {
	const gate = await gateAdvisor(data.slug, data.code);
	if (!gate.ok) return gate;
	await ensureUsefulLinks();
	const rows = await (await getSql())`
      select id, label, url from useful_links
      where advisor_id = ${gate.row.id}
      order by created_at desc
      limit 80
    `;
	return { ok: true, links: rows.map((row) => ({ id: Number(row.id), label: row.label, url: row.url })) };
});
export const saveUsefulLink = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }): Promise<any> => {
	const gate = await gateAdvisor(data.slug, data.code);
	if (!gate.ok) return gate;
	const label = String(data.label ?? "").trim().slice(0, 80);
	const url = cleanLink(data.url);
	if (label.length < 2) return { ok: false, error: "Add a name for this link." };
	if (!url) return { ok: false, error: "Enter a web address, such as https://example.com." };
	await ensureUsefulLinks();
	const count = await (await getSql())`select count(*)::int as total from useful_links where advisor_id = ${gate.row.id}`;
	if (Number(count[0]?.total) >= 80) return { ok: false, error: "You already have 80 links. Remove one before adding another." };
	await (await getSql())`
      insert into useful_links (advisor_id, label, url)
      values (${gate.row.id}, ${label}, ${url})
    `;
	return { ok: true };
});
export const deleteUsefulLink = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }): Promise<any> => {
	const gate = await gateAdvisor(data.slug, data.code);
	if (!gate.ok) return gate;
	const id = Number(data.id);
	if (!Number.isInteger(id) || id < 1) return { ok: false, error: "That link was not found." };
	await ensureUsefulLinks();
	await (await getSql())`delete from useful_links where id = ${id} and advisor_id = ${gate.row.id}`;
	return { ok: true };
});
export const archiveMessages = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }): Promise<any> => {
	const gate = await gateAdvisor(data.slug, data.code);
	if (!gate.ok) return gate;
	const title = (data.title ?? "").trim();
	const subject = (data.subject ?? "").trim();
	const body = (data.body ?? "").trim();
	const kind = data.kind === "card" ? "card" : data.kind === "letter" ? "letter" : null;
	const html = (data.html ?? "").trim();
	const newsletter = (data.newsletter ?? "").trim();
	if (!kind || title.length < 2) return { ok: false, error: "Choose a card or letter first." };
	if (kind === "letter" && (html || newsletter)) {
		if ((html || newsletter).length > 300000) return { ok: false, error: "That newsletter is too large to send." };
		if (body.length > 4000) return { ok: false, error: "That note is too long to archive." };
	} else if (body.length < 2 || body.length > 4000 || subject.length > 120) {
		return { ok: false, error: "That note is too long to archive." };
	}
	if (subject.length > 120) return { ok: false, error: "Keep the subject under 120 characters." };
	const ids = [...new Set((data.contactIds ?? []).map(Number))].filter((id) => Number.isInteger(id) && id > 0);
	if (ids.length === 0) return { ok: false, error: "Choose at least one contact." };
	if (ids.length > 50) return { ok: false, error: "Send to 50 people at a time." };
	const sql = await getSql();
	const contacts = await sql`
      select id, full_name, email from contacts
      where advisor_id = ${gate.row.id} and id = any(${ids})
    `;
	if (contacts.length !== ids.length) return { ok: false, error: "One of those contacts is not in this service." };
	const missing = contacts.filter((contact) => !contact.email.trim());
	if ((kind === "card" || html || newsletter) && missing.length > 0) {
		return { ok: false, error: `Add an email for ${missing.map((contact) => contact.full_name).join(", ")}.` };
	}
	let account = null;
	let image = null;
	let imageUrl = "";
	let logo = null;
	let letterHtml = html;
	let sentEletter = false;
	if (kind === "card" || html || newsletter) {
		const ready = await readMailAccount(gate.row.id);
		if (!ready.ok) return ready;
		account = ready.account;
	}
	if (kind === "card") {
		image = await cardImage(data.image ?? "");
		imageUrl = cardPublicUrl(data.image ?? "");
	}
	if ((html || newsletter) && data.logo) {
		logo = logoBytes(data.logo);
		if (!logo) return { ok: false, error: "That picture could not be used. Upload a smaller photo." };
	}
	if (newsletter) {
		const stored = readNewsletterPayload(newsletter);
		const eletter = stored ? null : readEletterSend(newsletter);
		if (!stored && !eletter) return { ok: false, error: "That letter could not be read. Check it and try again." };
		sentEletter = Boolean(eletter);
		const website = shownWebsite(gate.site);
		if (stored && website) stored.contact.website = website;
		if (eletter && website) eletter.contact.website = website;
		const token = randomBytes(12).toString("hex");
		await sql`
        insert into newsletters (advisor_id, token, payload, logo_data)
        values (${gate.row.id}, ${token}, ${JSON.stringify(stored || eletter)}, ${data.logo && logo ? data.logo : ""})
      `;
		const origin = await siteOrigin();
		letterHtml = stored
			? renderNewsletter({
				issue: stored.issue,
				contact: stored.contact,
				logoSrc: logo ? "cid:logo" : "",
				mode: "email",
				articleHref: () => `${origin}/n/${token}`,
			})
			: renderEletter({
				letter: eletter.letter,
				contact: eletter.contact,
				logoSrc: logo ? "cid:logo" : "",
				mode: "email",
				href: `${origin}/n/${token}`,
			});
		letterHtml = useCurrentWebsite(letterHtml, website, [gate.site.siteUrl, gate.site.publicWebsite]);
	}
	const currentSite = shownWebsite(gate.site);
	if (letterHtml) letterHtml = useCurrentWebsite(letterHtml, currentSite, [gate.site.siteUrl, gate.site.publicWebsite]);
	const supplied = (data.signature ?? "").trim().slice(0, 500);
	const signature = kind === "card" ? signatureWithWebsite(supplied || (await savedCardContact(gate.row.id)), currentSite) : supplied;
	const siteLine = websiteButtonText(currentSite);
	for (const contact of contacts) {
		const note = personalize(body, contact.full_name);
		const letterPlain = siteLine && !note.includes("Visit my website:") ? `${note}\n\n${siteLine}` : note;
		const text = signature ? `${note}\n\n${signature}` : kind === "letter" ? letterPlain : note;
		if (account && kind === "card") {
			try {
				await sendFromAdvisor(account, contact.email, title, note, image, imageUrl, signature);
			} catch (error) {
				const detail = error instanceof Error ? error.message : "Mail server refused the message.";
				return { ok: false, error: `Could not send from ${account.fromEmail}. ${detail}`.slice(0, 280) };
			}
		}
		if (account && kind === "letter" && letterHtml) {
			try {
				await sendNewsletter(account, contact.email, personalize(subject || title, contact.full_name), personalizeHtml(letterHtml, contact.full_name), letterPlain, logo);
			} catch (error) {
				const detail = error instanceof Error ? error.message : "Mail server refused the message.";
				return { ok: false, error: `Could not send from ${account.fromEmail}. ${detail}`.slice(0, 280) };
			}
		}
		await sql`
        insert into messages (advisor_id, kind, title, subject, body, contact_name, contact_email)
        values (${gate.row.id}, ${kind}, ${title}, ${personalize(subject, contact.full_name)}, ${text}, ${contact.full_name}, ${contact.email})
      `;
		await writeContactLog(gate.row.id, Number(contact.id), kind === "card" ? "card" : sentEletter ? "eletter" : "newsletter", `${sentEletter ? "E-letter" : title} sent`);
	}
	return { ok: true, count: contacts.length, names: contacts.map((contact) => contact.full_name) };
});
export const listContactLogs = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }): Promise<any> => {
	const gate = await gateAdvisor(data.slug, data.code);
	if (!gate.ok) return gate;
	const id = Number(data.id);
	if (!Number.isInteger(id) || id <= 0) return { ok: false, error: "Choose a contact." };
	return { ok: true, logs: await contactHistory(gate.row.id, id) };
});
export const addContactLog = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }): Promise<any> => {
	const gate = await gateAdvisor(data.slug, data.code);
	if (!gate.ok) return gate;
	const id = Number(data.id);
	const note = String(data.note ?? "").trim();
	if (!Number.isInteger(id) || id <= 0) return { ok: false, error: "Choose a contact." };
	if (note.length < 2) return { ok: false, error: "Write a short note for the log." };
	const owns = await (await getSql())`select id from contacts where id = ${id} and advisor_id = ${gate.row.id}`;
	if (!owns[0]) return { ok: false, error: "That contact is not in this service." };
	const kind = data.kind === "text" ? "text" : "note";
	await writeContactLog(gate.row.id, id, kind, note);
	return { ok: true, logs: await contactHistory(gate.row.id, id) };
});
export const logDrip = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }): Promise<any> => {
	const gate = await gateAdvisor(data.slug, data.code);
	if (!gate.ok) return gate;
	const name = String(data.name ?? "").trim().slice(0, 80);
	const tag = String(data.tag ?? "").trim();
	const steps = Array.isArray(data.steps) ? data.steps.map((step) => String(step).trim()).filter(Boolean).slice(0, 12) : [];
	if (name.length < 2) return { ok: false, error: "Name the drip campaign." };
	const summary = `Drip campaign “${name}” sent. ${steps.join(" · ")}`.slice(0, 500);
	const rows = await (await getSql())<{ id: number; tags: string }>`select id, tags from contacts where advisor_id = ${gate.row.id}`;
	const matches = rows.filter((row) => tag && row.tags.split(",").map((item) => item.trim().toLowerCase()).includes(tag.toLowerCase()));
	if (matches.length === 0) return { ok: false, error: "No contacts have that tag." };
	for (const row of matches) await writeContactLog(gate.row.id, Number(row.id), "drip", summary);
	return { ok: true, count: matches.length };
});

async function ensureDripTable() {
	await (await getSql()).query(`create table if not exists drip_campaigns (
    id bigserial primary key,
    advisor_id integer not null,
    name text not null,
    tag text not null default '',
    steps text not null default '[]',
    every_days integer not null default 7,
    active boolean not null default false,
    next_index integer not null default 0,
    next_at timestamptz,
    created_at timestamptz not null default now()
  )`);
	await (await getSql()).query("alter table drip_campaigns add column if not exists contact_ids text not null default '[]'");
	await (await getSql()).query("alter table drip_campaigns add column if not exists design text not null default 'plum'");
}

function dripEvery(value: unknown) {
	const days = Number(value);
	return DRIP_INTERVALS.some((item) => item[0] === days) ? days : 7;
}

function readDripSteps(raw: string) {
	try {
		return cleanSteps(JSON.parse(raw));
	} catch {
		return [];
	}
}

function dripContactIds(raw) {
	try {
		const list = JSON.parse(String(raw || "[]"));
		return Array.isArray(list) ? list.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0) : [];
	} catch {
		return [];
	}
}

async function sendDripStep(gate, row, index: number) {
	const steps = readDripSteps(row.steps);
	const step = steps[index];
	if (!step.title.trim() && !step.body.trim()) return { ok: false, error: "This article is still blank, so it was not emailed." };
	const ready = await readMailAccount(gate.row.id);
	if (!ready.ok) return ready;
	const contacts = await (await getSql())<{ id: number; full_name: string; email: string; tags: string }>`
    select id, full_name, email, tags from contacts where advisor_id = ${gate.row.id}
  `;
	const chosen = dripContactIds(row.contact_ids);
	const tag = String(row.tag ?? "").trim().toLowerCase();
	const matches = contacts.filter((contact) => {
		if (!contact.email.trim()) return false;
		if (chosen.length > 0) return chosen.includes(Number(contact.id));
		return Boolean(tag) && contact.tags.split(",").map((item) => item.trim().toLowerCase()).includes(tag);
	});
	if (matches.length === 0) return { ok: false, error: "Choose contacts who have an email address." };
	const design = ELETTER_DESIGNS.some((item) => item.id === row.design) ? row.design : "";
	if (!design) return { ok: false, error: "Choose a campaign template before sending." };
	const advisor = (await (await getSql())`
    select advisor_name, practice_name, email, public_phone, public_card_email, public_website, site_mode, site_url, slug
    from advisors where id = ${gate.row.id}
  `)[0];
	const letterContact = {
		name: advisor?.advisor_name || "Advisor",
		title: advisor?.practice_name || "",
		phone: advisor?.public_phone || "",
		email: advisor?.public_card_email || advisor?.email || "",
		place: "",
		website: shownWebsite({ siteMode: advisor?.site_mode, siteUrl: advisor?.site_url, publicWebsite: advisor?.public_website, slug: advisor?.slug }),
	};
	for (const contact of matches) {
		const subject = personalize(step.title || row.name, contact.full_name);
		const text = personalize(step.body, contact.full_name);
		const siteLine = websiteButtonText(letterContact.website);
		const plain = siteLine && !text.includes("Visit my website:") ? `${text}\n\n${siteLine}` : text;
		const html = renderEletter({
			letter: {
				kind: "eletter",
				design,
				kicker: "A note",
				title: subject || row.name,
				subject: subject || row.name,
				body: text,
				social: { linkedin: "", instagram: "", facebook: "", youtube: "" },
			},
			contact: letterContact,
			logoSrc: "",
			mode: "email",
		});
		await sendNewsletter(ready.account, contact.email, subject || row.name, html, plain, null);
		await (await getSql())`
      insert into messages (advisor_id, kind, title, subject, body, contact_name, contact_email)
      values (${gate.row.id}, 'drip', ${row.name}, ${subject}, ${text}, ${contact.full_name}, ${contact.email})
    `;
		await writeContactLog(gate.row.id, Number(contact.id), "drip", `${row.name}: ${step.title || "Article"} emailed`);
	}
	return { ok: true, count: matches.length };
}

let dripBusy = false;
async function advanceDripRows(rows) {
	if (dripBusy) return { sent: 0, error: "" };
	dripBusy = true;
	try {
	let sent = 0;
	let error = "";
	for (const row of rows) {
		const steps = readDripSteps(row.steps);
		const index = Number(row.next_index) || 0;
		if (index >= steps.length) {
			await (await getSql())`update drip_campaigns set active = false where id = ${row.id}`;
			continue;
		}
		try {
			const result = await sendDripStep({ row: { id: Number(row.advisor_id || row.advisorId) } }, row, index);
			if (!result.ok) {
				error = result.error || error;
				continue;
			}
			const next = index + 1;
			const done = next >= steps.length;
			const nextAt = new Date(Date.now() + Number(row.every_days) * 24 * 60 * 60 * 1000);
			await (await getSql())`
        update drip_campaigns
        set next_index = ${next}, active = ${!done}, next_at = ${done ? null : nextAt}
        where id = ${row.id}
      `;
			sent += 1;
		} catch (caught) {
			error = caught instanceof Error ? caught.message : "The email could not be sent.";
		}
	}
	return { sent, error };
	} finally {
		dripBusy = false;
	}
}

async function sendDueDrips(gate) {
	await ensureDripTable();
	const due = await (await getSql())`
    select id, advisor_id, name, tag, steps, every_days, next_index, contact_ids, design from drip_campaigns
    where advisor_id = ${gate.row.id} and active = true and (next_at is null or next_at <= now())
    order by id
  `;
	return advanceDripRows(due);
}

async function runAllDueDrips() {
	try {
		await ensureDripTable();
		const due = await (await getSql())`
      select d.id, d.advisor_id, d.name, d.tag, d.steps, d.every_days, d.next_index, d.contact_ids, d.design
      from drip_campaigns d
      join advisors a on a.id = d.advisor_id
      where d.active = true and a.status <> 'suspended' and (d.next_at is null or d.next_at <= now())
      order by d.id
      limit 20
    `;
		return await advanceDripRows(due);
	} catch {
		return { sent: 0, error: "" };
	}
}

const dripClock = globalThis as { uaDripClock?: ReturnType<typeof setInterval> };
if (typeof window === "undefined" && !dripClock.uaDripClock) {
	dripClock.uaDripClock = setInterval(() => {
		void runAllDueDrips();
	}, 5 * 60 * 1000);
}

function dripRow(row) {
	return {
		id: Number(row.id),
		name: row.name,
		tag: row.tag,
		steps: readDripSteps(row.steps),
		contactIds: dripContactIds(row.contact_ids),
		everyDays: dripEvery(row.every_days),
		design: ELETTER_DESIGNS.some((item) => item.id === row.design) ? row.design : "",
		active: row.active === true || row.active === "t" || row.active === "true",
		nextIndex: Number(row.next_index) || 0,
		nextAt: row.next_at ? new Date(row.next_at).toISOString() : "",
	};
}

export const listDrips = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }): Promise<any> => {
	const gate = await gateAdvisor(data.slug, data.code);
	if (!gate.ok) return gate;
	await ensureDripTable();
	const sent = await sendDueDrips(gate);
	const rows = await (await getSql())`select * from drip_campaigns where advisor_id = ${gate.row.id} order by id desc`;
	const defaults = await (await getSql())`
    select id, name, body from platform_templates where kind = 'drip' order by id desc limit 100
  `;
	return {
		ok: true,
		campaigns: rows.map(dripRow),
		defaults: defaults.map((row) => ({ id: Number(row.id), name: row.name, body: row.body || "" })),
		sent: sent.sent,
		warning: sent.error,
	};
});

export const saveDrip = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }): Promise<any> => {
	const gate = await gateAdvisor(data.slug, data.code);
	if (!gate.ok) return gate;
	await ensureDripTable();
	const name = String(data.name ?? "").trim().slice(0, 80);
	const steps = cleanSteps(data.steps);
	if (name.length < 2) return { ok: false, error: "Name the campaign." };
	if (steps.length === 0) return { ok: false, error: "Choose how many articles." };
	const design = ELETTER_DESIGNS.some((item) => item.id === data.design) ? data.design : "";
	const packed = JSON.stringify(steps);
	const id = Number(data.id);
	if (Number.isInteger(id) && id > 0) {
		const owns = await (await getSql())`select id from drip_campaigns where id = ${id} and advisor_id = ${gate.row.id}`;
		if (!owns[0]) return { ok: false, error: "That campaign is not on this desk." };
		await (await getSql())`update drip_campaigns set name = ${name}, steps = ${packed}, design = ${design} where id = ${id}`;
	} else {
		await (await getSql())`
      insert into drip_campaigns (advisor_id, name, tag, steps, every_days, active, next_index, next_at, contact_ids, design)
      values (${gate.row.id}, ${name}, '', ${packed}, 7, false, 0, null, '[]', ${design})
    `;
	}
	const rows = await (await getSql())`select * from drip_campaigns where advisor_id = ${gate.row.id} order by id desc`;
	return { ok: true, campaigns: rows.map(dripRow) };
});

export const startDrip = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }): Promise<any> => {
	const gate = await gateAdvisor(data.slug, data.code);
	if (!gate.ok) return gate;
	await ensureDripTable();
	const id = Number(data.id);
	const everyDays = dripEvery(data.everyDays);
	const tag = String(data.tag ?? "").trim().slice(0, 80);
	const contactIds = Array.isArray(data.contactIds) ? data.contactIds.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0).slice(0, 200) : [];
	if (!Number.isInteger(id) || id <= 0) return { ok: false, error: "Pick a campaign." };
	if (contactIds.length === 0) return { ok: false, error: "Choose the contacts who should receive it." };
	const design = ELETTER_DESIGNS.some((item) => item.id === data.design) ? data.design : "";
	if (!design) return { ok: false, error: "Choose a campaign template before sending." };
	const owns = await (await getSql())`select id from drip_campaigns where id = ${id} and advisor_id = ${gate.row.id}`;
	if (!owns[0]) return { ok: false, error: "That campaign is not on this desk." };
	await (await getSql())`
    update drip_campaigns
    set tag = ${tag}, contact_ids = ${JSON.stringify(contactIds)}, every_days = ${everyDays}, design = ${design},
        active = true, next_index = 0, next_at = ${new Date()}
    where id = ${id}
  `;
	const due = await sendDueDrips(gate);
	const rows = await (await getSql())`select * from drip_campaigns where advisor_id = ${gate.row.id} order by id desc`;
	return { ok: true, campaigns: rows.map(dripRow), sent: due.sent, warning: due.error };
});

export const deleteDrip = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }): Promise<any> => {
	const gate = await gateAdvisor(data.slug, data.code);
	if (!gate.ok) return gate;
	await ensureDripTable();
	const id = Number(data.id);
	if (!Number.isInteger(id)) return { ok: false, error: "Choose a campaign." };
	await (await getSql())`delete from drip_campaigns where id = ${id} and advisor_id = ${gate.row.id}`;
	const rows = await (await getSql())`select * from drip_campaigns where advisor_id = ${gate.row.id} order by id desc`;
	return { ok: true, campaigns: rows.map(dripRow) };
});

function isMicrosoftMailbox(email, host) {
	const domain = email.split("@")[1]?.toLowerCase() ?? "";
	return [
		"outlook.com",
		"hotmail.com",
		"live.com",
		"msn.com"
	].includes(domain) || /outlook|office365|office\.com/.test(host);
}
async function readMailAccount(advisorId) {
	const row = (await (await getSql())`
    select mail_from, mail_name, mail_host, mail_port, mail_pass, mail_provider, ms_refresh
    from advisors where id = ${advisorId}
  `)[0];
	if (!row) return {
		ok: false,
		error: "Add the email address you send from in Settings."
	};
	if (row.mail_provider === "microsoft" || row.ms_refresh) {
		if (!row.ms_refresh) return {
			ok: false,
			error: "Connect Microsoft Email in Settings before sending."
		};
		return {
			ok: true,
			account: {
				kind: "microsoft",
				advisorId,
				fromEmail: row.mail_from,
				fromName: row.mail_name
			}
		};
	}
	if (isMicrosoftMailbox(row.mail_from, row.mail_host)) return {
		ok: false,
		error: "Outlook no longer uses a mailbox password. Connect Microsoft Email in Settings."
	};
	const host = mailHost(row.mail_from, row.mail_host);
	if (!row.mail_from || !row.mail_pass || !host) return {
		ok: false,
		error: "Add the email address you send from in Settings."
	};
	return {
		ok: true,
		account: {
			kind: "smtp",
			fromEmail: row.mail_from,
			fromName: row.mail_name,
			host,
			port: Number(row.mail_port) || 587,
			user: row.mail_from,
			pass: row.mail_pass
		}
	};
}
function mailHost(email, host) {
	const saved = host.trim().toLowerCase();
	if (saved === "smtp.gmail.com") return saved;
	if (saved === "smtp.office365.com" || saved === "smtp-mail.outlook.com") return "";
	const domain = email.split("@")[1]?.toLowerCase() ?? "";
	const gmail = domain === "gmail.com" || domain === "googlemail.com";
	if ([
		"outlook.com",
		"hotmail.com",
		"live.com",
		"msn.com"
	].includes(domain)) return "";
	if (!saved) return gmail ? "smtp.gmail.com" : "";
	return saved;
}
function mailFailure(error, host) {
	const detail = error instanceof Error ? error.message : "Mail server refused the message.";
	if (/auth|535|534|invalid login|username and password/i.test(detail)) {
		if (host.includes("gmail")) return "Gmail rejected that password. Use a Google app password, not your normal Gmail password.";
		return "That mailbox rejected the password. Check the mail server, and use an app password if the provider asks for one.";
	}
	return detail.slice(0, 220);
}
async function cardImage(image) {
	const name = String(image ?? "").trim();
	const custom = name.match(/^\/api\/cards\/(\d+)(?:\?.*)?$/);
	const platform = name.match(/^\/api\/platform-cards\/(\d+)(?:\?.*)?$/);
	if (custom || platform) {
		const rows = custom
			? await (await getSql())`select image_data from saved_cards where id = ${Number(custom[1])}`
			: await (await getSql())`select image_data from platform_templates where id = ${Number(platform[1])} and kind = 'card'`;
		const data = rows[0]?.image_data ?? "";
		if (!data) return null;
		const bytes = Buffer.from(String(data).replace(/^data:image\/\w+;base64,/, ""), "base64");
		return bytes.length ? bytes : null;
	}
	if (!/^\/cards\/[a-z0-9-]+\.jpg$/.test(name)) return null;
	try {
		const local = await readFile(`${process.cwd()}/public${name}`);
		if (local.length) return local;
	} catch {}
	try {
		const response = await fetch(cardPublicUrl(name));
		if (!response.ok) return null;
		const bytes = Buffer.from(await response.arrayBuffer());
		return bytes.length ? bytes : null;
	} catch {
		return null;
	}
}
async function siteOrigin() {
	try {
		const request = getRequest();
		const found: string[] = [];
		if (request) {
			for (const header of ["origin", "referer", "x-forwarded-host", "host"]) {
				for (const part of (request.headers.get(header) || "").split(",")) {
					const host = hostOf(part);
					if (host) found.push(host);
				}
			}
		}
		const domain = await baseDomain();
		if (domain && !isInternalHost(domain)) found.unshift(domain);
		const chosen = found.find((host) => !isInternalHost(host)) || found[0] || "";
		if (!chosen) return "";
		const name = chosen.split(":")[0].toLowerCase();
		const proto = name === "localhost" || name === "127.0.0.1" ? "http" : "https";
		return `${proto}://${chosen}`;
	} catch {
		return "";
	}
}
function hostOf(value) {
	const item = String(value ?? "").trim();
	if (!item) return "";
	try {
		return (item.includes("://") ? new URL(item).host : item.split("/")[0]).toLowerCase();
	} catch {
		return "";
	}
}
function isInternalHost(host) {
	const name = String(host ?? "").split(":")[0].toLowerCase();
	return !name || name === "localhost" || name === "127.0.0.1" || name.endsWith(".vercel.app") || name.endsWith(".vercel.sh") || name.endsWith(".now.sh") || name.includes("preview.grok") || name === "preview.invalid";
}
function cardPublicUrl(image) {
	const name = String(image ?? "").trim();
	if (/^\/cards\/[a-z0-9-]+\.jpg$/.test(name) || /^\/api\/(?:platform-)?cards\/\d+$/.test(name)) return `https://youradviser.grok.me${name}`;
	return "";
}
function logoBytes(value) {
	const match = String(value ?? "").trim().match(/^data:image\/(?:jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=\s]+)$/);
	if (!match) return null;
	const bytes = Buffer.from(match[1].replace(/\s/g, ""), "base64");
	if (bytes.length < 32 || bytes.length > 400000) return null;
	return bytes;
}
function escapeHtml(value) {
	return String(value ?? "")
		.replace(/&/g, "\u0026amp;")
		.replace(/</g, "\u0026lt;")
		.replace(/>/g, "\u0026gt;")
		.replace(/"/g, "\u0026quot;");
}
function personalizeHtml(html, fullName) {
	const trimmed = String(fullName ?? "").trim();
	const name = escapeHtml(trimmed || "there");
	const first = escapeHtml(trimmed.split(/\s+/)[0] || "there");
	return html.replaceAll("[Contact Name]", name).replaceAll("[FirstName]", first);
}
function messageHtml(text, imageUrl, signature = "") {
	return cardHtml(text, imageUrl, signature);
}
async function deliver(account, to, subject, text, image, html, logo = null) {
	const port = account.port === 465 ? 465 : 587;
	const nodemailer = (await import("nodemailer")).default;
	const transport = nodemailer.createTransport({
		host: account.host,
		port,
		secure: port === 465,
		requireTLS: port === 587,
		auth: { user: account.user, pass: account.pass },
		tls: { minVersion: "TLSv1.2" },
	});
	const from = account.fromName ? `"${account.fromName.replace(/"/g, "")}" <${account.fromEmail}>` : account.fromEmail;
	await transport.sendMail({
		from,
		to,
		replyTo: account.fromEmail,
		subject,
		text,
		html,
		attachments: [
			...(image ? [{ filename: "e-card.jpg", content: image, contentType: "image/jpeg", cid: "card" }] : []),
			...(logo ? [{ filename: "logo.jpg", content: logo, contentType: "image/jpeg", cid: "logo" }] : []),
		],
	});
}
async function sendFromAdvisor(account, to, subject, text, image, imageUrl = "", signature = "") {
	const linked = imageUrl.length > 0;
	const html = messageHtml(text, linked ? imageUrl : image ? "cid:card" : "", signature);
	const attachment = linked ? null : image;
	const plain = signature ? `${text}\n\n${signature}` : text;
	if (account.kind === "microsoft") {
		const { accessTokenForAdvisor, graphSendMail } = await import("@/lib/microsoft-mail");
		const token = await accessTokenForAdvisor(account.advisorId);
		await graphSendMail({ accessToken: token, to, subject, html, image: attachment });
		return;
	}
	try {
		await deliver(account, to, subject, plain, attachment, html);
	} catch (error) {
		throw new Error(mailFailure(error, account.host));
	}
}
async function sendNewsletter(account, to, subject, html, text, logo) {
	if (account.kind === "microsoft") {
		const { accessTokenForAdvisor, graphSendMail } = await import("@/lib/microsoft-mail");
		const token = await accessTokenForAdvisor(account.advisorId);
		await graphSendMail({
			accessToken: token,
			to,
			subject,
			html,
			inline: logo ? [{ name: "logo.jpg", contentType: "image/jpeg", contentId: "logo", bytes: logo }] : [],
		});
		return;
	}
	try {
		await deliver(account, to, subject, text, null, html, logo);
	} catch (error) {
		throw new Error(mailFailure(error, account.host));
	}
}
async function savedCardContact(advisorId) {
	const rows = await (await getSql())`
    select advisor_name, practice_name, email, public_name, public_title, public_phone, public_card_email, public_company, public_website, site_mode, site_url, slug
    from advisors where id = ${advisorId}
  `;
	const row = rows[0];
	if (!row) return "";
	const name = (row.public_name || row.advisor_name || "").trim();
	const company = (row.public_company || row.practice_name || "").trim();
	const website = shownWebsite({ siteMode: row.site_mode, siteUrl: row.site_url, publicWebsite: row.public_website, slug: row.slug });
	return signatureLines({
		name,
		title: row.public_title,
		company,
		phone: row.public_phone,
		email: row.public_card_email || row.email,
		website,
	}).join("\n");
}

export const getMailSettings = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }): Promise<any> => {
	const gate = await gateAdvisor(data.slug, data.code);
	if (!gate.ok) return gate;
	const row = (await (await getSql())`
      select mail_from, mail_name, mail_host, mail_port, mail_pass, mail_provider, ms_refresh
      from advisors where id = ${gate.row.id}
    `)[0];
	const microsoftConnected = Boolean(row?.ms_refresh) && row?.mail_provider === "microsoft";
	const microsoftAddress = isMicrosoftMailbox(row?.mail_from ?? "", row?.mail_host ?? "");
	const app = await microsoftAppStatus().catch(() => ({
		configured: false,
		source: "none",
		clientId: ""
	}));
	return {
		ok: true,
		fromEmail: row?.mail_from ?? "",
		fromName: row?.mail_name ?? "",
		host: microsoftConnected || microsoftAddress ? "" : row?.mail_host ?? "",
		port: Number(row?.mail_port) || 587,
		password: microsoftConnected || microsoftAddress ? "" : row?.mail_pass ?? "",
		hasPassword: !microsoftConnected && !microsoftAddress && Boolean(row?.mail_pass),
		microsoftConnected,
		oauthConfigured: app.configured
	};
});
export const saveMailSettings = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }): Promise<any> => {
	const gate = await gateAdvisor(data.slug, data.code);
	if (!gate.ok) return gate;
	const fromEmail = (data.fromEmail ?? "").trim().toLowerCase();
	const fromName = (data.fromName ?? "").trim().slice(0, 80);
	const host = (data.host ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0] ?? "";
	const port = Number(data.port) === 465 ? 465 : 587;
	const password = (data.password ?? "").trim();
	if (!EMAIL.test(fromEmail)) return {
		ok: false,
		error: "Add the email address you want to send from."
	};
	if (isMicrosoftMailbox(fromEmail, host)) return {
		ok: false,
		error: "Outlook and Microsoft 365 do not use a mailbox password. Choose Outlook and use Connect Microsoft Email."
	};
	if (host && !/^[a-z0-9.-]+$/.test(host)) return {
		ok: false,
		error: "That mail server does not look right."
	};
	const resolvedHost = mailHost(fromEmail, host);
	const sql = await getSql();
	const existing = await sql`
      select mail_from, mail_pass from advisors where id = ${gate.row.id}
    `;
	const changing = (existing[0]?.mail_from ?? "").trim().toLowerCase() !== fromEmail;
	const nextPass = password || (changing ? "" : existing[0]?.mail_pass || "");
	if (!nextPass) return {
		ok: false,
		error: changing ? "That is a different address. Enter the password for the new mailbox." : "Add the password or app password for that mailbox."
	};
	const account = {
		kind: "smtp",
		fromEmail,
		fromName,
		host: resolvedHost || host,
		port,
		user: fromEmail,
		pass: nextPass
	};
	let workingHost = account.host;
	let warning = "";
	if (account.host) try {
		await verifyMailbox(account);
		workingHost = account.host;
	} catch (error) {
		warning = error instanceof Error ? error.message : "That mailbox could not sign in.";
	}
	else warning = "Address saved. Add the mail server for this mailbox before a card can be sent.";
	await sql`
      update advisors
      set mail_provider = 'smtp',
          mail_from = ${fromEmail},
          mail_name = ${fromName},
          mail_host = ${workingHost},
          mail_port = ${port},
          mail_user = ${fromEmail},
          mail_pass = ${nextPass},
          ms_refresh = '',
          ms_access = '',
          ms_expires = 0
      where id = ${gate.row.id}
    `;
	return {
		ok: true,
		warning
	};
});
async function verifyMailbox(account) {
	try {
		const port = account.port === 465 ? 465 : 587;
		const nodemailer = (await import("nodemailer")).default;
		await nodemailer.createTransport({
			host: account.host,
			port,
			secure: port === 465,
			requireTLS: port === 587,
			auth: {
				user: account.user,
				pass: account.pass
			},
			tls: { minVersion: "TLSv1.2" }
		}).verify();
	} catch (error) {
		throw new Error(mailFailure(error, account.host));
	}
}
export const saveMicrosoftApp = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }): Promise<any> => {
	if (!(await gateOperator(data.code)).ok) return {
		ok: false,
		error: "That super admin password is not right."
	};
	const clientId = (data.clientId ?? "").trim();
	const clientSecret = (data.clientSecret ?? "").trim();
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId)) return {
		ok: false,
		error: "Paste the Application (client) ID from Entra. It looks like 12345678-1234-1234-1234-123456789abc."
	};
	if (clientSecret.length < 12 || clientSecret === clientId) return {
		ok: false,
		error: "Paste the client secret Value from Certificates & secrets, not the Secret ID."
	};
	await saveMicrosoftAppCredentials(clientId, clientSecret);
	return { ok: true };
});
export const getMicrosoftAppStatus = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }): Promise<any> => {
	const gate = await gateOperator(data.code);
	if (!gate.ok) return gate;
	const status = await microsoftAppStatus();
	return {
		ok: true,
		configured: status.configured,
		source: status.source,
		clientId: status.clientId
	};
});
export const beginMicrosoftConnect = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }): Promise<any> => {
	const gate = await gateAdvisor(data.slug, data.code);
	if (!gate.ok) return gate;
	if (!(await microsoftAppStatus()).configured) return {
		ok: false,
		error: "Microsoft sign-in is not ready yet. Register the app in Entra, then save the Application (client) ID and secret Value below."
	};
	let redirectUri = "";
	try {
		redirectUri = assertCallbackUrl(data.redirectUri ?? "", getRequest());
	} catch (error) {
		return {
			ok: false,
			error: error instanceof Error ? error.message : "The Microsoft return address is not valid."
		};
	}
	const { verifier, challenge } = createPkce();
	const state = randomBytes(24).toString("base64url");
	const displayName = (data.displayName ?? "").trim().slice(0, 80);
	const sql = await getSql();
	await sql`delete from oauth_states where advisor_id = ${gate.row.id} or created_at < now() - interval '20 minutes'`;
	await sql`
      insert into oauth_states (state, advisor_id, slug, verifier, redirect_uri, display_name)
      values (${state}, ${gate.row.id}, ${gate.row.slug}, ${verifier}, ${redirectUri}, ${displayName})
    `;
	const config = await loadMicrosoftConfig();
	if (!config) return {
		ok: false,
		error: "Microsoft sign-in is not ready yet."
	};
	return {
		ok: true,
		url: authorizeUrl({
			clientId: config.clientId,
			redirectUri,
			state,
			challenge
		})
	};
});
export const disconnectMicrosoft = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }): Promise<any> => {
	const gate = await gateAdvisor(data.slug, data.code);
	if (!gate.ok) return gate;
	await (await getSql())`
      update advisors
      set mail_provider = '',
          mail_pass = '',
          mail_host = '',
          ms_refresh = '',
          ms_access = '',
          ms_expires = 0
      where id = ${gate.row.id}
    `;
	return { ok: true };
});
export const sendTestEmail = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }): Promise<any> => {
	const gate = await gateAdvisor(data.slug, data.code);
	if (!gate.ok) return gate;
	const ready = await readMailAccount(gate.row.id);
	if (!ready.ok) return ready;
	const to = (data.to || ready.account.fromEmail).trim().toLowerCase();
	if (!EMAIL.test(to) || to.includes(",")) return {
		ok: false,
		error: "Enter one email address for the test."
	};
	const text = `This is a test from Unique Advisor.\n\nIf you can read this, ${ready.account.fromEmail} can send e-cards.`;
	try {
		await sendFromAdvisor(ready.account, to, "Unique Advisor test email", text, null);
	} catch (error) {
		return {
			ok: false,
			error: (error instanceof Error ? error.message : "The test email was not sent.").slice(0, 280)
		};
	}
	return {
		ok: true,
		to
	};
});

async function sendAdvisorPlain(advisorId, to, subject, text, toName = "") {
	const ready = await readMailAccount(advisorId);
	if (!ready.ok) return ready;
	const email = String(to ?? "").trim().toLowerCase();
	const title = String(subject ?? "").trim().slice(0, 120);
	const note = String(text ?? "").trim().slice(0, 4000);
	if (!EMAIL.test(email) || email.includes(",") || title.length < 2 || note.length < 2) {
		return { ok: false, error: "The draft needs one email address, a subject, and a message." };
	}
	try {
		await sendFromAdvisor(ready.account, email, title, note, null);
	} catch (error) {
		return { ok: false, error: (error instanceof Error ? error.message : "The email was not sent.").slice(0, 280) };
	}
	await (await getSql())`
    insert into messages (advisor_id, kind, title, subject, body, contact_name, contact_email)
    values (${advisorId}, 'letter', ${title}, ${title}, ${note}, ${String(toName ?? "").slice(0, 80)}, ${email})
  `;
	return { ok: true };
}

export const sendApprovedAdvisorMail = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }) => {
	const gate = await gateAdvisor(data.slug, data.code);
	if (!gate.ok) return gate;
	return sendAdvisorPlain(gate.row.id, data.to, data.subject, data.body, data.toName);
});

function socialFromSaved(raw) {
	const empty = { linkedin: "", linkedinShow: false, instagram: "", instagramShow: false, facebook: "", facebookShow: false, photoOnNewsletter: false, photoOnEletter: false };
	if (!raw) return empty;
	try {
		const parsed = JSON.parse(raw);
		return {
			linkedin: String(parsed.linkedin ?? "").slice(0, 200),
			linkedinShow: Boolean(parsed.linkedinShow),
			instagram: String(parsed.instagram ?? "").slice(0, 200),
			instagramShow: Boolean(parsed.instagramShow),
			facebook: String(parsed.facebook ?? "").slice(0, 200),
			facebookShow: Boolean(parsed.facebookShow),
			photoOnNewsletter: Boolean(parsed.photoOnNewsletter),
			photoOnEletter: parsed.photoOnEletter === undefined ? Boolean(parsed.photoOnNewsletter) : Boolean(parsed.photoOnEletter),
		};
	} catch {
		return empty;
	}
}

export const deleteContacts = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }): Promise<any> => {
	const gate = await gateAdvisor(data.slug, data.code);
	if (!gate.ok) return gate;
	const ids = [...new Set((data.ids ?? []).map(Number))].filter((id) => Number.isInteger(id) && id > 0);
	if (ids.length === 0) return { ok: false, error: "Choose at least one contact." };
	await (await getSql())`delete from contacts where advisor_id = ${gate.row.id} and id = any(${ids})`;
	return { ok: true };
});

export const deleteAllContacts = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }): Promise<any> => {
	const gate = await gateAdvisor(data.slug, data.code);
	if (!gate.ok) return gate;
	await (await getSql())`delete from contacts where advisor_id = ${gate.row.id}`;
	return { ok: true };
});

export const removeCard = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }): Promise<any> => {
	const gate = await gateAdvisor(data.slug, data.code);
	if (!gate.ok) return gate;
	const sql = await getSql();
	if (data.kind === "saved") {
		const id = Number(data.id);
		if (!Number.isInteger(id)) return { ok: false, error: "That card was not found." };
		await sql`delete from saved_cards where id = ${id} and advisor_id = ${gate.row.id}`;
		return { ok: true };
	}
	const cardId = String(data.id ?? "").trim().slice(0, 40);
	if (!/^[a-z0-9-]+$/.test(cardId)) return { ok: false, error: "That card was not found." };
	await sql`
      insert into hidden_catalog_cards (advisor_id, card_id)
      values (${gate.row.id}, ${cardId})
      on conflict (advisor_id, card_id) do nothing
    `;
	return { ok: true };
});

export const listCatalogCards = createServerFn({ method: "GET" }).handler(async (): Promise<any> => {
	const edits = await (await getSql())`select card_id, message, hidden from platform_card_edits`;
	const byId = new Map(edits.map((row) => [row.card_id, row]));
	return CARDS.filter((card) => !byId.get(card.id)?.hidden).map((card) => ({
		...card,
		message: byId.get(card.id)?.message || card.message,
	}));
});

export const saveCatalogWording = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }): Promise<any> => {
	const gate = await gateOperator(data.code);
	if (!gate.ok) return gate;
	const cardId = String(data.cardId ?? "").trim();
	if (!CARDS.some((card) => card.id === cardId)) return { ok: false, error: "That card was not found." };
	const message = String(data.message ?? "").trim().slice(0, 800);
	if (message.length < 2) return { ok: false, error: "Write the card wording." };
	await (await getSql())`
      insert into platform_card_edits (card_id, message, hidden)
      values (${cardId}, ${message}, false)
      on conflict (card_id) do update set message = ${message}
    `;
	return { ok: true };
});

export const hideCatalogCard = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }): Promise<any> => {
	const gate = await gateOperator(data.code);
	if (!gate.ok) return gate;
	const cardId = String(data.cardId ?? "").trim();
	if (!CARDS.some((card) => card.id === cardId)) return { ok: false, error: "That card was not found." };
	await (await getSql())`
      insert into platform_card_edits (card_id, message, hidden)
      values (${cardId}, '', true)
      on conflict (card_id) do update set hidden = true
    `;
	return { ok: true };
});

export const updatePlatformCard = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }): Promise<any> => {
	const gate = await gateOperator(data.code);
	if (!gate.ok) return gate;
	const id = Number(data.id);
	const body = String(data.body ?? "").trim().slice(0, 800);
	if (!Number.isInteger(id) || body.length < 2) return { ok: false, error: "Write the card wording." };
	const updated = await (await getSql())`update platform_templates set body = ${body} where id = ${id} and kind = 'card' returning id`;
	if (!updated[0]) return { ok: false, error: "That card was not found." };
	return { ok: true };
});

export const deletePlatformTemplate = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }): Promise<any> => {
	const gate = await gateOperator(data.code);
	if (!gate.ok) return gate;
	const id = Number(data.id);
	const kind = data.kind === "eletter" ? "eletter" : data.kind === "letter" ? "letter" : data.kind === "drip" ? "drip" : data.kind === "banner" ? "banner" : "";
	if (!Number.isInteger(id) || !kind) return { ok: false, error: "That template was not found." };
	await (await getSql())`delete from platform_templates where id = ${id} and kind = ${kind}`;
	return { ok: true };
});

export const deletePlatformCard = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }): Promise<any> => {
	const gate = await gateOperator(data.code);
	if (!gate.ok) return gate;
	const id = Number(data.id);
	if (!Number.isInteger(id)) return { ok: false, error: "That card was not found." };
	await (await getSql())`delete from platform_templates where id = ${id} and kind = 'card'`;
	return { ok: true };
});

function readSheet(csv) {
	const first = csv.split(/\r?\n/, 1)[0] ?? "";
	const delimiter = first.includes("\t") ? "\t" : !first.includes(",") && first.includes(";") ? ";" : ",";
	const rows = [];
	let row = [];
	let cell = "";
	let quoted = false;
	const src = csv.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	for (let i = 0; i < src.length; i += 1) {
		const char = src[i];
		if (quoted) {
			if (char === "\"" && src[i + 1] === "\"") { cell += "\""; i += 1; }
			else if (char === "\"") quoted = false;
			else cell += char;
			continue;
		}
		if (char === "\"") quoted = true;
		else if (char === delimiter) { row.push(cell); cell = ""; }
		else if (char === "\n") {
			row.push(cell);
			if (row.some((item) => item.trim())) rows.push(row);
			row = [];
			cell = "";
		} else cell += char;
	}
	if (cell.length || row.length) {
		row.push(cell);
		if (row.some((item) => item.trim())) rows.push(row);
	}
	if (rows.length === 0) return null;
	const header = rows[0].map((item) => item.trim());
	const named = header.some((item) => /name|email|phone|tag/i.test(item));
	return { titles: named ? header : header.map((_, index) => `Column ${index + 1}`), rows: named ? rows.slice(1) : rows };
}

export const previewContactSheet = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }): Promise<any> => {
	const gate = await gateAdvisor(data.slug, data.code);
	if (!gate.ok) return gate;
	const csv = (data.csv ?? "").trim();
	if (csv.length < 2) return { ok: false, error: "That file is empty." };
	if (csv.length > 200000) return { ok: false, error: "That file is too large. Upload 300 contacts at a time." };
	const sheet = readSheet(csv);
	if (!sheet || sheet.rows.length === 0) return { ok: false, error: "No contacts were found in that file." };
	if (sheet.rows.length > 300) return { ok: false, error: "Upload 300 contacts at a time." };
	return { ok: true, titles: sheet.titles, count: sheet.rows.length };
});

export const importContacts = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }): Promise<any> => {
	const gate = await gateAdvisor(data.slug, data.code);
	if (!gate.ok) return gate;
	const csv = (data.csv ?? "").trim();
	const sheet = readSheet(csv);
	if (!sheet) return { ok: false, error: "No contacts were found in that file." };
	const columns = data.columns ?? {};
	const nameIndex = Number(columns.name);
	const lastIndex = Number(columns.last ?? -1);
	const emailIndex = Number(columns.email);
	const phoneIndex = Number(columns.phone);
	const tagsIndex = Number(columns.tags);
	if (!Number.isInteger(nameIndex) || nameIndex < 0) return { ok: false, error: "Match Name to one column." };
	let added = 0;
	let skipped = 0;
	const sql = await getSql();
	for (const cells of sheet.rows) {
		const first = (cells[nameIndex] ?? "").trim();
		const last = lastIndex >= 0 ? (cells[lastIndex] ?? "").trim() : "";
		const fullName = `${first} ${last}`.trim();
		const email = emailIndex >= 0 ? (cells[emailIndex] ?? "").trim().toLowerCase() : "";
		const phone = phoneIndex >= 0 ? (cells[phoneIndex] ?? "").trim() : "";
		const tags = tagsIndex >= 0 ? (cells[tagsIndex] ?? "").trim() : "";
		if (fullName.length < 2) { skipped += 1; continue; }
		await sql`
        insert into contacts (advisor_id, full_name, email, phone, tags)
        values (${gate.row.id}, ${fullName.slice(0, 80)}, ${email.slice(0, 120)}, ${phone.slice(0, 30)}, ${tags.slice(0, 200)})
      `;
		added += 1;
	}
	return { ok: true, added, skipped };
});

