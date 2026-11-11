import { useEffect, useState } from "react";
import { SiteHeader } from "@/components/site-header";
import { changeAccessCode, listLeads, saveSettings, toggleLeadStep } from "@/lib/site.functions";
import {
  applyPackage,
  INTEREST_LABELS,
  locksLeadTools,
  PACKAGE_DETAILS,
  PACKAGE_LABELS,
  PACKAGES,
  PALETTE_LABELS,
  PALETTES,
  type Interest,
  type Lead,
  type PublicSite,
  type SiteSettings,
} from "@/lib/site-types";

const TOGGLES: { key: keyof SiteSettings; label: string; detail: string; locked?: boolean }[] = [
  { key: "showLife", label: "Life insurance", detail: "The life section and its Did you know card." },
  { key: "showCritical", label: "Critical illness", detail: "The critical illness section and its card." },
  { key: "showDisability", label: "Disability income", detail: "The disability section and its card." },
  { key: "showGroup", label: "Group benefits", detail: "The group benefits section and its card." },
  { key: "showFacts", label: "Did you know", detail: "The lead-generating facts block.", locked: true },
  { key: "showForm", label: "Question form", detail: "The form that writes a lead into this practice’s database.", locked: true },
];

export function PracticeStudio({ site }: { site: PublicSite }) {
  const [code, setCode] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [draft, setDraft] = useState<SiteSettings>(site);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [nextCode, setNextCode] = useState("");
  const [busy, setBusy] = useState(false);

  async function unlockWith(next: string) {
    setBusy(true);
    setError("");
    const result = await listLeads({ data: { slug: site.slug, code: next } });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      sessionStorage.removeItem(`ua:${site.slug}`);
      return;
    }
    sessionStorage.setItem(`ua:${site.slug}`, next);
    setCode(next);
    setLeads(result.leads);
    setUnlocked(true);
  }

  useEffect(() => {
    const saved = sessionStorage.getItem(`ua:${site.slug}`);
    if (saved) void unlockWith(saved);
  }, [site.slug]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const result = await saveSettings({
      data: {
        slug: site.slug,
        code,
        packageId: draft.packageId,
        palette: draft.palette,
        showLife: draft.showLife,
        showCritical: draft.showCritical,
        showDisability: draft.showDisability,
        showGroup: draft.showGroup,
        showFacts: draft.showFacts,
        showForm: draft.showForm,
      },
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDraft(result.settings);
    setNotice("Saved. Visitors to this temporary domain get this package.");
  }

  async function rotateCode(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const result = await changeAccessCode({ data: { slug: site.slug, code, next: nextCode } });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const next = nextCode.trim();
    sessionStorage.setItem(`ua:${site.slug}`, next);
    setCode(next);
    setNextCode("");
    setDraft({ ...draft, codeIsDefault: false });
    setNotice("Access code updated. The old one no longer opens this service.");
  }

  async function toggleStep(stepId: number) {
    const result = await toggleLeadStep({ data: { slug: site.slug, code, stepId } });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setLeads(
      leads.map((lead) => ({
        ...lead,
        steps: lead.steps.map((step) => (step.id === stepId ? { ...step, done: result.done } : step)),
      })),
    );
  }

  const toolsLocked = locksLeadTools(draft.packageId);

  return (
    <div data-theme={draft.palette} className="min-h-screen bg-bg text-fg">
      <SiteHeader slug={site.slug} practiceName={site.practiceName} mode="studio" />
      <main className="mx-auto max-w-6xl px-5 py-10">
        <p className="text-sm font-medium tracking-wide text-accent">Studio · {site.practiceName}</p>
        <h1 className="mt-2 font-display text-4xl text-primary">Package, color, and questions</h1>
        <p className="mt-3 max-w-2xl text-muted">
          This studio belongs to this practice only. A package is the public page plus what happens when someone sends the form.
        </p>

        {!unlocked ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void unlockWith(code);
            }}
            className="mt-8 max-w-md rounded-card border border-line bg-surface p-6"
          >
            <label className="grid gap-2 text-sm font-medium">
              Access code
              <input
                type="password"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                autoComplete="current-password"
                className="rounded-xl border border-line bg-bg px-3 py-3 text-base font-normal"
              />
            </label>
            {error && <p className="mt-3 text-sm text-primary">{error}</p>}
            <button
              type="submit"
              disabled={busy}
              className="mt-4 rounded-full bg-primary px-5 py-3 text-sm font-medium text-primary-fg disabled:opacity-60"
            >
              {busy ? "Checking…" : "Open studio"}
            </button>
          </form>
        ) : (
          <div className="mt-10 grid items-start gap-8 lg:grid-cols-5">
            <div className="grid gap-8 lg:col-span-2">
              <form onSubmit={save} className="grid gap-6">
                <fieldset className="rounded-card border border-line bg-surface p-5">
                  <legend className="px-1 font-display text-xl text-primary">Package</legend>
                  <div className="mt-4 grid gap-3">
                    {PACKAGES.map((packageId) => (
                      <button
                        key={packageId}
                        type="button"
                        onClick={() => setDraft(applyPackage({ ...draft, packageId }))}
                        className={`rounded-xl border p-3 text-left ${
                          draft.packageId === packageId ? "border-accent ring-2 ring-accent" : "border-line"
                        }`}
                      >
                        <span className="block font-medium">{PACKAGE_LABELS[packageId]}</span>
                        <span className="mt-1 block text-sm text-muted">{PACKAGE_DETAILS[packageId]}</span>
                      </button>
                    ))}
                  </div>
                </fieldset>

                <fieldset className="rounded-card border border-line bg-surface p-5">
                  <legend className="px-1 font-display text-xl text-primary">Color</legend>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    {PALETTES.map((palette) => (
                      <button
                        key={palette}
                        type="button"
                        onClick={() => setDraft({ ...draft, palette })}
                        data-theme={palette}
                        className={`rounded-xl border bg-bg p-3 text-left text-sm text-fg ${
                          draft.palette === palette ? "border-accent ring-2 ring-accent" : "border-line"
                        }`}
                      >
                        <span className="block h-8 rounded-lg bg-primary" />
                        <span className="mt-2 block font-medium">{PALETTE_LABELS[palette]}</span>
                      </button>
                    ))}
                  </div>
                </fieldset>

                <fieldset className="rounded-card border border-line bg-surface p-5">
                  <legend className="px-1 font-display text-xl text-primary">Sections</legend>
                  <div className="mt-4 grid gap-4">
                    {TOGGLES.map((item) => {
                      const locked = Boolean(item.locked) && toolsLocked;
                      return (
                        <label key={item.key} className={`flex items-start gap-3 text-sm ${locked ? "opacity-80" : ""}`}>
                          <input
                            type="checkbox"
                            className="mt-1 size-5"
                            checked={Boolean(draft[item.key])}
                            disabled={locked}
                            onChange={(event) =>
                              setDraft(applyPackage({ ...draft, [item.key]: event.target.checked }))
                            }
                          />
                          <span>
                            <span className="font-medium">{item.label}</span>
                            <span className="mt-0.5 block text-muted">
                              {locked ? "Included in this package." : item.detail}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>

                {error && <p className="text-sm text-primary">{error}</p>}
                {notice && <p className="text-sm text-primary">{notice}</p>}
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-full bg-primary px-5 py-3 text-sm font-medium text-primary-fg disabled:opacity-60"
                >
                  {busy ? "Saving…" : "Save this practice"}
                </button>
              </form>

              <form onSubmit={rotateCode} className="rounded-card border border-line bg-surface p-5">
                <h2 className="font-display text-xl text-primary">Change access code</h2>
                <p className="mt-2 text-sm text-muted">At least 6 characters. This replaces the code for this practice only.</p>
                <input
                  value={nextCode}
                  onChange={(event) => setNextCode(event.target.value)}
                  className="mt-3 w-full rounded-xl border border-line bg-bg px-3 py-3 text-base"
                  autoComplete="new-password"
                />
                <button type="submit" disabled={busy} className="mt-3 rounded-full border border-line px-4 py-2 text-sm font-medium">
                  Update code
                </button>
              </form>
            </div>

            <section className="lg:col-span-3">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="font-display text-2xl text-primary">Questions</h2>
                <p className="text-sm text-muted">{leads.length} saved</p>
              </div>
              <p className="mt-2 text-sm text-muted">{PACKAGE_DETAILS[draft.packageId]}</p>
              {leads.length === 0 ? (
                <p className="mt-6 rounded-card border border-dashed border-line bg-surface p-8 text-muted">
                  No questions yet. When a visitor sends the form on this practice’s page, the note appears here.
                </p>
              ) : (
                <ul className="mt-4 divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
                  {leads.map((lead) => (
                    <li key={lead.id} className="grid gap-1 px-5 py-4">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="font-medium">{lead.fullName}</p>
                        <p className="text-xs text-muted">
                          {new Date(lead.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                        </p>
                      </div>
                      <p className="text-sm">
                        <a className="underline decoration-accent underline-offset-2" href={`mailto:${lead.email}`}>
                          {lead.email}
                        </a>
                        {lead.phone ? <span className="text-muted"> · {lead.phone}</span> : null}
                      </p>
                      <p className="text-sm text-accent">{INTEREST_LABELS[lead.interest as Interest] ?? lead.interest}</p>
                      {lead.note ? <p className="text-sm text-muted">{lead.note}</p> : null}
                      {lead.steps.length > 0 && (
                        <ul className="mt-3 grid gap-2">
                          {lead.steps.map((step) => (
                            <li key={step.id}>
                              <label className="flex items-start gap-3 rounded-xl border border-line bg-bg px-3 py-2 text-sm">
                                <input
                                  type="checkbox"
                                  className="mt-1 size-5"
                                  checked={step.done}
                                  onChange={() => toggleStep(step.id)}
                                />
                                <span>
                                  <span className={`font-medium ${step.done ? "text-muted line-through" : ""}`}>{step.title}</span>
                                  <span className="mt-0.5 block text-muted">
                                    Due {step.dueOn}. {step.detail}
                                  </span>
                                </span>
                              </label>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
