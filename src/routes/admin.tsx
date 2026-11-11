import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { browserPublicUrl } from "@/lib/preview-path-prefix";
import { packDrip, readDripPack, type DripStep } from "@/lib/drips";
import {
  addPlatformTag,
  addTemplate,
  changeOperatorCode,
  getOperatorGate,
  deletePlatformCard,
  deletePlatformTemplate,
  hideCatalogCard,
  listCatalogCards,
  listPlatformTags,
  listPromotions,
  listSubscribers,
  listTemplates,
  loadPlatformSettings,
  resetOperatorCode,
  setPreviewOperatorPassword,
  saveBaseDomain,
  saveCatalogWording,
  savePlatformSettings,
  savePromotion,
  deletePromotion,
  setSetupFee,
  setSubscriberPlan,
  setSubscriberStatus,
  updatePlatformCard,
} from "@/lib/advisor.functions";
import { DEFAULT_PLATFORM, FONT_LABELS, PLAN_LABELS, PLANS, SETUP_FEES, discountLabel, monthlyPrice, type PlanId, type PlatformSettings, type Promotion, type Subscriber } from "@/lib/site-types";
import { FileDrop } from "@/components/file-drop";
import { loadAssistantSettings, saveAssistantSettings, loadOpenAiAccount, connectOpenAiAccount, disconnectOpenAiAccount, testOpenAiAccount, loadAssistantDiagnostics, loadDefaultRules, saveDefaultRules, loadOperatingInstructions, saveOperatingInstructions } from "@/lib/assistant.functions";
import { DEFAULT_ASSISTANT, type AssistantSettings } from "@/lib/assistant-policy";
import { CARDS } from "@/lib/catalog";
import { ELETTER_DESIGNS, ELETTER_SWATCH, packEletter, type EletterDesign } from "@/lib/eletter";
import { loadLinkApps, saveConnectionApp } from "@/lib/advisor-links.functions";
import { ZOOM_REDIRECT } from "@/lib/zoom-oauth";
import { emptySocial } from "@/lib/newsletter";
import { SupportAdmin, SupportSettings } from "@/components/support-admin";
import { VoiceLogsAdmin } from "@/components/voice-logs-admin";
import { loadSupportDesk } from "@/lib/support.functions";

export const Route = createFileRoute("/admin")({
  loader: () => getOperatorGate(),
  head: () => ({ meta: [{ title: "Superadmin — Unique Advisor" }] }),
  component: Admin,
});

type Panel = "overview" | "openai" | "subscribers" | "payments" | "plans" | "promotions" | "assistant" | "instructions" | "templates" | "tags" | "website" | "settings" | "tickets" | "voice";
type Template = { id: number; kind: string; name: string; detail: string; body: string; hasImage?: boolean };

function shrinkCardPhoto(file: File) {
  return new Promise<string>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const max = 800;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext("2d");
      URL.revokeObjectURL(url);
      if (!ctx) {
        reject(new Error("Could not read that picture."));
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.72));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Choose a JPG or PNG picture."));
    };
    img.src = url;
  });
}

function Admin() {
  const gate = Route.useLoaderData();
  const [code, setCode] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [defaultHint, setDefaultHint] = useState(gate.codeIsDefault);
  const [domain, setDomain] = useState(gate.domain);
  const [domainDraft, setDomainDraft] = useState(gate.domain);
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [nextCode, setNextCode] = useState("");
  const [privatePassword, setPrivatePassword] = useState("");
  const [privateConfirm, setPrivateConfirm] = useState("");
  const [panel, setPanel] = useState<Panel>("overview");
  const [templateMenu, setTemplateMenu] = useState<"cards" | "letters" | "eletters" | "drips" | "banners">("cards");
  const [planAdvisor, setPlanAdvisor] = useState("");
  const [newPlan, setNewPlan] = useState<PlanId>("professional");
  const [nlName, setNlName] = useState("");
  const [nlSubject, setNlSubject] = useState("");
  const [nlBody, setNlBody] = useState("");
  const [elName, setElName] = useState("");
  const [elSubject, setElSubject] = useState("");
  const [elBody, setElBody] = useState("");
  const [elDesign, setElDesign] = useState<EletterDesign>("plum");
  const [ecName, setEcName] = useState("");
  const [ecMessage, setEcMessage] = useState("Dear [Contact Name],\n\n");
  const [ecImage, setEcImage] = useState("");
  const [dripName, setDripName] = useState("");
  const [dripBoxes, setDripBoxes] = useState(1);
  const [dripDesign, setDripDesign] = useState<EletterDesign>("plum");
  const [dripSteps, setDripSteps] = useState<DripStep[]>([{ title: "", body: "" }]);
  const [bannerName, setBannerName] = useState("");
  const [bannerImage, setBannerImage] = useState("");
  const [tagName, setTagName] = useState("");
  const [platformTags, setPlatformTags] = useState<{ id: number; name: string }[]>([]);
  const [catalog, setCatalog] = useState(CARDS);
  const [wording, setWording] = useState<Record<string, string>>({});
  const [settings, setSettings] = useState<PlatformSettings>(DEFAULT_PLATFORM);
  const [siteSave, setSiteSave] = useState<"idle" | "saving" | "saved">("idle");
  const [settingsMsg, setSettingsMsg] = useState(false);
  const [promos, setPromos] = useState<Promotion[]>([]);
  const emptyPromo = { id: 0, code: "", monthlyPercent: "0", setupPercent: "0", note: "", maxUses: "", expiresOn: "", active: true };
  const [promoForm, setPromoForm] = useState(emptyPromo);
  const [assistant, setAssistant] = useState<AssistantSettings>(DEFAULT_ASSISTANT);
  const [openAiHint, setOpenAiHint] = useState("");
  const [openAiSource, setOpenAiSource] = useState<"saved" | "server" | "none">("none");
  const [zoomClientId, setZoomClientId] = useState("");
  const [zoomSecret, setZoomSecret] = useState("");
  const [zoomReady, setZoomReady] = useState(false);
  const [zoomSavedId, setZoomSavedId] = useState("");
  const [zoomSecretMask, setZoomSecretMask] = useState("");
  const [boxClientId, setBoxClientId] = useState("");
  const [boxSecret, setBoxSecret] = useState("");
  const [boxReady, setBoxReady] = useState(false);
  const [driveClientId, setDriveClientId] = useState("");
  const [driveSecret, setDriveSecret] = useState("");
  const [driveReady, setDriveReady] = useState(false);
  const [dropboxClientId, setDropboxClientId] = useState("");
  const [dropboxSecret, setDropboxSecret] = useState("");
  const [dropboxReady, setDropboxReady] = useState(false);
  const [savedApp, setSavedApp] = useState("");
  const [openAiKey, setOpenAiKey] = useState("");
  const [diagnostics, setDiagnostics] = useState<Array<{ id: number; advisorId: number | null; handledBy: string; at: string; calls: Array<{ provider: string; model: string; requestId: string; promptTokens: number | null; completionTokens: number | null; totalTokens: number | null; at: string; status?: number | null; detail?: string; reference?: string }> }>>([]);
  const [openTickets, setOpenTickets] = useState(0);
  const [defaultRules, setDefaultRules] = useState<Array<{ id?: string; category?: string; text: string; on: boolean }>>([]);
  const [defaultRuleText, setDefaultRuleText] = useState("");
  const [editingDefault, setEditingDefault] = useState<number | null>(null);
  const [defaultEdit, setDefaultEdit] = useState("");
  const [operatingText, setOperatingText] = useState("");

  async function unlockWith(next: string, quiet = false) {
    if (!quiet) setError("");
    const password = next.trim();
    if (password.length < 8) {
      if (!quiet) setError(gate.preview ? "Use at least 8 characters." : "Enter the Superadmin password. The first one is superadmin.");
      return;
    }
    try {
      const result = await listSubscribers({ data: { code: password } });
      if (!result?.ok) {
        sessionStorage.removeItem("ua-operator");
        if (!quiet) setError(result?.error || "That password is not right.");
        return;
      }
      sessionStorage.setItem("ua-operator", password);
      setCode(password);
      setSubscribers(result.subscribers || []);
      setPlanAdvisor(String(result.subscribers?.[0]?.id ?? ""));
      setUnlocked(true);
      setTemplates(await listTemplates().catch(() => []));
      setCatalog(await listCatalogCards().catch(() => CARDS));
      const tags = await listPlatformTags({ data: { code: password } }).catch(() => null);
      if (tags?.ok) setPlatformTags(tags.tags);
      const loaded = await loadPlatformSettings({ data: { code: password } }).catch(() => null);
      if (loaded?.ok) setSettings(loaded.settings);
      const promos = await listPromotions({ data: { code: password } }).catch(() => null);
      if (promos?.ok) setPromos(promos.promotions);
      const assistantSettings = await loadAssistantSettings({ data: { code: password } }).catch(() => null);
      if (assistantSettings?.ok) setAssistant(assistantSettings.settings);
      const openai = await loadOpenAiAccount({ data: { code: password } }).catch(() => null);
      if (openai?.ok) {
        setOpenAiHint(openai.hint);
        setOpenAiSource(openai.source);
      }
      const logged = await loadAssistantDiagnostics({ data: { code: password } }).catch(() => null);
      if (logged?.ok) setDiagnostics(logged.requests);
      const defaults = await loadDefaultRules({ data: { code: password } }).catch(() => null);
      if (defaults?.ok) setDefaultRules(defaults.rules);
      const operating = await loadOperatingInstructions({ data: { code: password } }).catch(() => null);
      if (operating?.ok) setOperatingText(operating.text);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sign-in could not finish. Try again.");
    }
  }

  useEffect(() => {
    const saved = sessionStorage.getItem("ua-operator");
    if (saved) void unlockWith(saved, true);
  }, []);

  async function refresh() {
    const result = await listSubscribers({ data: { code } });
    if (result.ok) setSubscribers(result.subscribers);
    setTemplates(await listTemplates());
    setCatalog(await listCatalogCards());
    const tags = await listPlatformTags({ data: { code } });
    if (tags.ok) setPlatformTags(tags.tags);
    const promos = await listPromotions({ data: { code } });
    if (promos.ok) setPromos(promos.promotions);
    const apps = await loadLinkApps({ data: { code } });
    if (apps.ok) {
      const zoom = apps.apps.find((app) => app.provider === "zoom");
      setZoomReady(Boolean(zoom?.clientId));
      setZoomSavedId(zoom?.clientId || "");
      setZoomSecretMask(zoom?.secretMask || "");
      setBoxReady(Boolean(apps.apps.find((app) => app.provider === "box")?.configured));
      setDriveReady(Boolean(apps.apps.find((app) => app.provider === "google_drive")?.configured));
      setDropboxReady(Boolean(apps.apps.find((app) => app.provider === "dropbox")?.configured));
    }
    const tickets = await loadSupportDesk({ data: { code } });
    if (tickets.ok) setOpenTickets(tickets.open);
  }

  async function changePlan() {
    const result = await setSubscriberPlan({ data: { code, id: Number(planAdvisor), plan: newPlan } });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNotice(`Plan updated to ${PLAN_LABELS[newPlan]}`);
    await refresh();
  }

  async function setStatus(id: number, status: "active" | "suspended") {
    const result = await setSubscriberStatus({ data: { code, id, status } });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await refresh();
  }

  async function onDomain(event: React.FormEvent) {
    event.preventDefault();
    const result = await saveBaseDomain({ data: { code, domain: domainDraft } });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDomain(result.domain);
    setNotice(result.domain ? `Domain saved as ${result.domain}.` : "Domain cleared.");
  }

  async function onCode(event: React.FormEvent) {
    event.preventDefault();
    const result = await changeOperatorCode({ data: { code, next: nextCode } });
    if (!result.ok) {
      setError(result.error || "The password was not changed.");
      return;
    }
    const next = nextCode.trim();
    sessionStorage.setItem("ua-operator", next);
    setCode(next);
    setNextCode("");
    setDefaultHint(false);
    setError("");
    setNotice("Super admin password updated.");
  }

  async function addLetter(event: React.FormEvent) {
    event.preventDefault();
    const result = await addTemplate({ data: { code, kind: "letter", name: nlName, detail: nlSubject, body: nlBody } });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNlName("");
    setNlSubject("");
    setNlBody("");
    setNotice("Newsletter template added. It is on every advisor desk now, including people who already signed up.");
    await refresh();
  }

  async function addEletter(event: React.FormEvent) {
    event.preventDefault();
    const body = packEletter({
      kind: "eletter",
      design: elDesign,
      kicker: "A letter",
      title: elName.trim(),
      subject: elSubject.trim() || elName.trim(),
      body: elBody,
      social: emptySocial(),
    });
    const result = await addTemplate({ data: { code, kind: "eletter", name: elName, detail: elSubject, body } });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setElName("");
    setElSubject("");
    setElBody("");
    setElDesign("plum");
    setNotice("E-letter template added. It is on every advisor desk now, including people who already signed up.");
    await refresh();
  }

  async function addDrip(event: React.FormEvent) {
    event.preventDefault();
    const steps = dripSteps.slice(0, dripBoxes).map((step) => ({ title: step.title.trim(), body: step.body.trim() }));
    if (dripName.trim().length < 2 || steps.length === 0) {
      setError("Name the campaign and choose how many articles.");
      return;
    }
    const result = await addTemplate({
      data: { code, kind: "drip", name: dripName.trim(), detail: `${steps.length} article${steps.length === 1 ? "" : "s"}`, body: packDrip(steps, 7, dripDesign) },
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDripName("");
    setDripBoxes(1);
    setDripDesign("plum");
    setDripSteps([{ title: "", body: "" }]);
    setNotice("Drip campaign added. It is on every advisor desk now, including people who already signed up.");
    await refresh();
  }

  async function addBanner(event: React.FormEvent) {
    event.preventDefault();
    if (!bannerImage) {
      setError("Upload a banner picture.");
      return;
    }
    const result = await addTemplate({ data: { code, kind: "banner", name: bannerName.trim(), detail: "banner", body: "", image: bannerImage } });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setBannerName("");
    setBannerImage("");
    setNotice("Banner added. Every advisor can choose it in the website library.");
    await refresh();
  }

  async function removeTemplate(id: number, kind: "letter" | "eletter" | "drip" | "banner", name: string) {
    if (!window.confirm(`Remove ${name} from every advisor desk?`)) return;
    const result = await deletePlatformTemplate({ data: { code, id, kind } });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNotice(`${name} removed from every desk.`);
    await refresh();
  }

  async function addCard(event: React.FormEvent) {
    event.preventDefault();
    if (!ecImage) {
      setError("Upload a picture for the card.");
      return;
    }
    const result = await addTemplate({ data: { code, kind: "card", name: ecName, detail: "", body: ecMessage, image: ecImage } });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setEcName("");
    setEcMessage("Dear [Contact Name],\n\n");
    setEcImage("");
    setNotice("E-card added. It is now on every advisor desk, including people who already signed up.");
    await refresh();
  }

  const active = subscribers.filter((item) => item.status === "active").length;
  const due = (item: Subscriber) => monthlyPrice(item.plan, item.promoKind, item.promoAmount);
  const mrr = subscribers.reduce((sum, item) => (item.status === "active" ? sum + due(item) : sum), 0);
  const menus: [Panel, string][] = [
    ["overview", "Overview"],
    ["openai", "OpenAI"],
    ["tickets", "Tickets"],
    ["subscribers", "Subscribers"],
    ["payments", "Payments & History"],
    ["plans", "Plan Management"],
    ["promotions", "Promotions"],
    ["assistant", "AI assistant"],
    ["instructions", "Operating instructions"],
    ["voice", "Voice logs"],
    ["templates", "Templates"],
    ["tags", "Tags"],
    ["website", "Corporate Website"],
    ["settings", "Admin Settings"],
  ];

  if (!unlocked && gate.preview) {
    return (
      <div className="ua-auth">
        <form
          className="ua-auth-card"
          onSubmit={(event) => {
            event.preventDefault();
            const password = privatePassword.trim();
            const confirm = privateConfirm.trim();
            setError("");
            setNotice("");
            if (password.length < 8) {
              setError("Use at least 8 characters.");
              return;
            }
            if (password !== confirm) {
              setError("Those passwords do not match.");
              return;
            }
            void setPreviewOperatorPassword({ data: { password, confirm } }).then((result: { ok?: boolean; error?: string }) => {
              if (!result?.ok) {
                setError(result?.error || "The password was not saved.");
                return;
              }
              setPrivatePassword("");
              setPrivateConfirm("");
              setDefaultHint(false);
              void unlockWith(password);
            }).catch(() => {
              setError("The password was not saved. Try again.");
            });
          }}
        >
          <h1>Superadmin</h1>
          <p className="subtitle">Choose a private password of at least 8 characters, enter it twice, then press Save and open. The old public password does not work.</p>
          <label>
            New password
            <input name="new-password" type="password" autoComplete="new-password" value={privatePassword} onChange={(event) => setPrivatePassword(event.target.value)} />
          </label>
          <label>
            Confirm password
            <input name="confirm-password" type="password" autoComplete="new-password" value={privateConfirm} onChange={(event) => setPrivateConfirm(event.target.value)} />
          </label>
          {error && <p className="ua-auth-error" style={{ color: "#b42318", fontWeight: 800 }}>{error}</p>}
          {notice && <p style={{ color: "#0d7a4f", fontWeight: 700 }}>{notice}</p>}
          <button type="submit">Save and open</button>
        </form>
      </div>
    );
  }
  if (!unlocked) {
    return (
      <div className="ua-auth">
        <form
          className="ua-auth-card"
          onSubmit={(event) => {
            event.preventDefault();
            const password = String(new FormData(event.currentTarget).get("password") || "");
            void unlockWith(password);
          }}
        >
          <h1>Superadmin</h1>
          <p className="subtitle">{gate.preview ? "Use the private preview password. The public default does not work here." : defaultHint ? "First password is superadmin. Change it after you open this." : "If you changed the password, the word superadmin no longer works."}</p>
          <label>
            Password
            <input name="password" type="password" autoComplete="current-password" />
          </label>
          {error && <p className="ua-auth-error" style={{ color: "#b42318", fontWeight: 800 }}>{error}</p>}
          <button type="submit">Open</button>
          {!gate.preview && (
          <button
            type="button"
            style={{ width: "100%", marginTop: 12, background: "#b42318", color: "#fff", border: "none", padding: 14, borderRadius: 8, fontWeight: 800 }}
            onClick={() => {
              setError("");
              void resetOperatorCode({ data: {} }).then((result: { ok?: boolean; error?: string }) => {
                if (!result?.ok) {
                  setError(result?.error || "The password could not be reset.");
                  return;
                }
                setDefaultHint(true);
                void unlockWith("superadmin");
              }).catch((caught: unknown) => {
                setError(caught instanceof Error ? caught.message : "The password could not be reset.");
              });
            }}
          >
            I cannot get in. Set the password to superadmin and open
          </button>
          )}
        </form>
      </div>
    );
  }

  return (
    <div className="ua-admin">
      <aside>
        <h2>Unique Advisor</h2>
        <nav className="ua-admin-nav">
          {menus.map(([id, label]) => (
            <div key={id} style={{ display: "contents" }}>
              <button key={id} type="button" className={`menu-item ${panel === id ? "active" : ""}`} onClick={() => setPanel(id)}>
                {label}
              </button>
              {id === "templates" && panel === "templates" && (
                <>
                  {([
                    ["banners", "Banner library"],
                    ["cards", "E-Cards"],
                    ["letters", "E-Newsletters"],
                    ["eletters", "E-Letters"],
                    ["drips", "Drip campaigns"],
                  ] as const).map(([key, name]) => (
                    <button key={key} type="button" className={`submenu ${templateMenu === key ? "active" : ""}`} onClick={() => setTemplateMenu(key)}>
                      {name}
                    </button>
                  ))}
                </>
              )}
            </div>
          ))}
        </nav>
      </aside>
      <main>
        {error && <p style={{ color: "#c0392b", marginBottom: 12 }}>{error}</p>}
        {notice && <p style={{ color: "#0d7a4f", marginBottom: 12 }}>{notice}</p>}
        {panel === "overview" && (
          <div>
            <h1 style={{ marginBottom: 20 }}>Overview</h1>
            <div className="stats">
              <div className="stat"><div className="num">{subscribers.length}</div><div>Total Subscribers</div></div>
              <div className="stat"><div className="num">{active}</div><div>Active</div></div>
              <div className="stat"><div className="num">{subscribers.length - active}</div><div>Paused</div></div>
              <div className="stat"><div className="num">{openTickets}</div><div>Open tickets</div></div>
              <div className="stat"><div className="num">${mrr}</div><div>Monthly Recurring</div></div>
            </div>
            <p style={{ color: "#5a6a7a" }}>Use the sidebar to manage subscribers, view payment history, and change plans.</p>
            <button type="button" className="btn-sm btn-primary" style={{ marginTop: 16 }} onClick={() => setPanel("openai")}>OpenAI key</button>
          </div>
        )}
        {panel === "openai" && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void connectOpenAiAccount({ data: { code, apiKey: openAiKey } }).then((result) => {
                if (!result.ok) {
                  setError(result.error);
                  return;
                }
                setOpenAiKey("");
                setOpenAiHint(result.hint);
                setOpenAiSource("saved");
                setNotice("OpenAI key saved on the server.");
              });
            }}
            style={{ background: "#fff", padding: 24, borderRadius: 12, maxWidth: 720, marginBottom: 16 }}
          >
            <h1 style={{ marginBottom: 8 }}>OpenAI</h1>
            <p style={{ color: "#5a6a7a", marginBottom: 12 }}>
              This key is for the company assistant only. Advisors never see it. The saved key stays on the server and is not shown again.
            </p>
            <p style={{ fontWeight: 700, marginBottom: 12 }}>
              {openAiSource === "none" ? "Not connected." : `Connected. ${openAiHint}. ${openAiSource === "saved" ? "Saved in Superadmin." : "Using the key already on the server."}`}
            </p>
            <label style={{ display: "block", fontWeight: 700, marginBottom: 8 }}>
              API key
              <input type="password" name="openai-api-key" value={openAiKey} onChange={(event) => setOpenAiKey(event.target.value)} placeholder={openAiSource === "none" ? "Paste the OpenAI API key" : "Paste a new key to replace the saved one"} autoComplete="new-password" spellCheck={false} style={{ marginTop: 8, marginBottom: 12 }} />
            </label>
            <button type="submit" className="btn-sm btn-primary">Save</button>
            <button
              type="button"
              className="btn-sm btn-success"
              onClick={() => {
                setError("");
                void testOpenAiAccount({ data: { code, apiKey: openAiKey } }).then((result) => {
                  if (!result.ok) {
                    setError(result.error);
                    return;
                  }
                  setNotice(result.hint);
                  if (!openAiKey && result.source !== "typed") setOpenAiSource(result.source === "server" ? "server" : "saved");
                });
              }}
            >
              Test connection
            </button>
            {openAiSource === "saved" && (
              <button
                type="button"
                className="btn-sm btn-danger"
                onClick={() => {
                  void disconnectOpenAiAccount({ data: { code } }).then((result) => {
                    if (!result.ok) {
                      setError(result.error);
                      return;
                    }
                    setOpenAiKey("");
                    setOpenAiHint("");
                    setOpenAiSource("none");
                    setNotice("Saved OpenAI key removed. A server key still works if one is set.");
                  });
                }}
              >
                Remove saved key
              </button>
            )}
          </form>
        )}
        {panel === "tickets" && <SupportAdmin code={code} />}
        {panel === "voice" && <VoiceLogsAdmin code={code} />}
        {panel === "subscribers" && (
          <div>
            <h1 style={{ marginBottom: 20 }}>Subscribers</h1>
            <div style={{ overflow: "auto" }}>
              <table>
                <thead>
                  <tr><th>Name</th><th>Email</th><th>Subdomain</th><th>Plan</th><th>Status</th><th>Joined</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {subscribers.map((item) => (
                    <tr key={item.id}>
                      <td><strong>{item.advisorName}</strong></td>
                      <td>{item.email}</td>
                      <td>
                        <a href={browserPublicUrl(`/a/${item.slug}/desk`)}>
                          {domain ? `${item.slug}.${domain}` : item.slug}
                        </a>
                      </td>
                      <td>{PLAN_LABELS[item.plan]}</td>
                      <td><span className={`badge ${item.status === "active" ? "active" : "paused"}`}>{item.status === "active" ? "Active" : "Cancelled"}</span></td>
                      <td>{new Date(item.createdAt).toLocaleDateString()}</td>
                      <td>
                        {item.status !== "active" && (
                          <button type="button" className="btn-sm btn-success" onClick={() => void setStatus(item.id, "active")}>Activate</button>
                        )}
                        {item.status === "active" && (
                          <button type="button" className="btn-sm btn-danger" onClick={() => void setStatus(item.id, "suspended")}>Unsubscribe</button>
                        )}
                        {item.status !== "active" && (
                          <button type="button" className="btn-sm btn-primary" onClick={() => void setStatus(item.id, "active")}>Reactivate</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {panel === "payments" && (
          <div>
            <h1 style={{ marginBottom: 20 }}>Payment History</h1>
            <table>
              <thead><tr><th>Date</th><th>Advisor</th><th>Plan</th><th>Monthly</th><th>Setup fee</th><th>Status</th><th>Method</th></tr></thead>
              <tbody>
                {subscribers.length === 0 && <tr><td colSpan={7}>No payments yet</td></tr>}
                {subscribers.map((item) => (
                  <tr key={item.id}>
                    <td>{new Date(item.createdAt).toLocaleDateString()}</td>
                    <td>{item.advisorName}</td>
                    <td>{PLAN_LABELS[item.plan]}</td>
                    <td>
                      ${due(item)}
                      {item.promoCode ? <span style={{ color: "#5a6a7a" }}> · {item.promoCode}</span> : null}
                    </td>
                    <td>{item.setupWaived ? "Waived" : `$${item.setupFee ?? SETUP_FEES[item.plan]} once`}</td>
                    <td>{item.status === "active" ? "Paid" : "Paused"}</td>
                    <td>Card</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {panel === "plans" && (
          <div>
            <h1 style={{ marginBottom: 20 }}>Plan Management</h1>
            <div style={{ background: "#fff", padding: 24, borderRadius: 12, maxWidth: 640, marginBottom: 16 }}>
              <h3 style={{ marginBottom: 8 }}>One-time setup fee</h3>
              <p style={{ color: "#5a6a7a", marginBottom: 8 }}>Charged once when the advisor joins. It is not added to the monthly price.</p>
              <p>Starter: ${SETUP_FEES.starter}</p>
              <p>Professional: ${SETUP_FEES.professional}</p>
              <p>Team: ${SETUP_FEES.team}</p>
            </div>
            <div style={{ background: "#fff", padding: 24, borderRadius: 12, maxWidth: 500 }}>
              <h3 style={{ marginBottom: 16 }}>Change Subscriber Plan</h3>
              <select value={planAdvisor} onChange={(event) => setPlanAdvisor(event.target.value)} style={{ marginBottom: 12 }}>
                {subscribers.map((item) => (
                  <option key={item.id} value={item.id}>{item.advisorName} ({PLAN_LABELS[item.plan]})</option>
                ))}
              </select>
              <select value={newPlan} onChange={(event) => setNewPlan(event.target.value as PlanId)} style={{ marginBottom: 12 }}>
                {PLANS.map((id) => (
                  <option key={id} value={id}>{PLAN_LABELS[id]}</option>
                ))}
              </select>
              <button type="button" className="btn-sm btn-primary" onClick={() => void changePlan()}>Update Plan</button>
              <h3 style={{ margin: "20px 0 8px" }}>Setup fee for this advisor</h3>
              <p style={{ color: "#5a6a7a", marginBottom: 12 }}>Charge the one-time setup fee for their plan, or waive it. A promotion code can also reduce it at sign-up.</p>
              <button
                type="button"
                className="btn-sm btn-primary"
                onClick={() => {
                  void setSetupFee({ data: { code, id: Number(planAdvisor), waived: false } }).then(async (result: any) => {
                    if (!result.ok) {
                      setError(result.error);
                      return;
                    }
                    setNotice(`Setup fee charged: $${result.setupFee}.`);
                    await refresh();
                  });
                }}
              >
                Charge setup fee
              </button>
              <button
                type="button"
                className="btn-sm"
                style={{ marginLeft: 8 }}
                onClick={() => {
                  void setSetupFee({ data: { code, id: Number(planAdvisor), waived: true } }).then(async (result: any) => {
                    if (!result.ok) {
                      setError(result.error);
                      return;
                    }
                    setNotice("Setup fee waived.");
                    await refresh();
                  });
                }}
              >
                Waive setup fee
              </button>
            </div>
          </div>
        )}
        {panel === "promotions" && (
          <div>
            <h1 style={{ marginBottom: 8 }}>Promotions</h1>
            <p style={{ color: "#5a6a7a", marginBottom: 20, maxWidth: 720 }}>
              Create a code. The monthly fee and the setup fee each have their own percent. Use 0 if that fee is not discounted. An advisor enters the code on sign-up.
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void savePromotion({
                  data: {
                    code,
                    id: promoForm.id,
                    promoCode: promoForm.code,
                    kind: "percent",
                    applies: Number(promoForm.setupPercent) > 0 && Number(promoForm.monthlyPercent) > 0 ? "both" : Number(promoForm.setupPercent) > 0 ? "setup" : "monthly",
                    amount: Number(promoForm.monthlyPercent),
                    monthlyPercent: Number(promoForm.monthlyPercent),
                    setupPercent: Number(promoForm.setupPercent),
                    note: promoForm.note,
                    maxUses: promoForm.maxUses === "" ? 0 : Number(promoForm.maxUses),
                    expiresOn: promoForm.expiresOn,
                    active: promoForm.active,
                  },
                }).then(async (result: any) => {
                  if (!result.ok) {
                    setError(result.error);
                    return;
                  }
                  setPromoForm(emptyPromo);
                  setNotice(promoForm.id ? "Promotion updated." : "Promotion code created.");
                  await refresh();
                });
              }}
              style={{ background: "#fff", padding: 24, borderRadius: 12, maxWidth: 640, marginBottom: 20 }}
            >
              <h3 style={{ marginBottom: 16 }}>{promoForm.id ? `Edit ${promoForm.code}` : "New promotion code"}</h3>
              <label style={{ display: "block", marginBottom: 6, fontWeight: 600 }}>Code</label>
              <input value={promoForm.code} onChange={(event) => setPromoForm({ ...promoForm, code: event.target.value.toUpperCase() })} placeholder="SPRING20" style={{ marginBottom: 12 }} />
              <label style={{ display: "block", marginBottom: 6, fontWeight: 600 }}>Monthly fee percent off</label>
              <input type="number" min={0} max={100} value={promoForm.monthlyPercent} onChange={(event) => setPromoForm({ ...promoForm, monthlyPercent: event.target.value })} style={{ width: 120, marginBottom: 12 }} />
              <label style={{ display: "block", marginBottom: 6, fontWeight: 600 }}>Setup fee percent off</label>
              <input type="number" min={0} max={100} value={promoForm.setupPercent} onChange={(event) => setPromoForm({ ...promoForm, setupPercent: event.target.value })} style={{ width: 120, marginBottom: 12 }} />
              <label style={{ display: "block", marginBottom: 6, fontWeight: 600 }}>Note, only you see this</label>
              <input value={promoForm.note} onChange={(event) => setPromoForm({ ...promoForm, note: event.target.value })} placeholder="Spring campaign" style={{ marginBottom: 12 }} />
              <label style={{ display: "block", marginBottom: 6, fontWeight: 600 }}>Expires</label>
              <input type="date" value={promoForm.expiresOn} onChange={(event) => setPromoForm({ ...promoForm, expiresOn: event.target.value })} style={{ marginBottom: 12 }} />
              <label style={{ display: "block", marginBottom: 6, fontWeight: 600 }}>How many people can use it</label>
              <input type="number" min={0} value={promoForm.maxUses} onChange={(event) => setPromoForm({ ...promoForm, maxUses: event.target.value })} placeholder="Leave blank for no limit" style={{ marginBottom: 12 }} />
              <label style={{ display: "block", marginBottom: 16 }}>
                <input type="checkbox" checked={promoForm.active} onChange={(event) => setPromoForm({ ...promoForm, active: event.target.checked })} /> Code is active
              </label>
              <button type="submit" className="btn-sm btn-primary">{promoForm.id ? "Save code" : "Create code"}</button>
              {promoForm.id > 0 && (
                <button type="button" className="btn-sm" style={{ marginLeft: 8 }} onClick={() => setPromoForm(emptyPromo)}>Cancel</button>
              )}
            </form>
            <div style={{ overflow: "auto" }}>
              <table>
                <thead>
                  <tr><th>Code</th><th>Discount</th><th>Used</th><th>Expires</th><th>Status</th><th></th></tr>
                </thead>
                <tbody>
                  {promos.length === 0 && <tr><td colSpan={6}>No promotion codes yet.</td></tr>}
                  {promos.map((item) => (
                    <tr key={item.id}>
                      <td><strong>{item.code}</strong>{item.note ? <div style={{ color: "#5a6a7a" }}>{item.note}</div> : null}</td>
                      <td>{discountLabel(item.kind, item.amount, item.applies, item.monthlyPercent, item.setupPercent)}</td>
                      <td>{item.maxUses > 0 ? `${item.usedCount} / ${item.maxUses}` : item.usedCount}</td>
                      <td>{item.expiresOn || "No end date"}</td>
                      <td>{item.active ? "Active" : "Off"}</td>
                      <td>
                        <button
                          type="button"
                          className="btn-sm btn-primary"
                          onClick={() => setPromoForm({
                            id: item.id,
                            code: item.code,
                            monthlyPercent: String(item.monthlyPercent ?? 0),
                            setupPercent: String(item.setupPercent ?? 0),
                            note: item.note,
                            maxUses: item.maxUses ? String(item.maxUses) : "",
                            expiresOn: item.expiresOn,
                            active: item.active,
                          })}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn-sm"
                          onClick={() => {
                            void savePromotion({
                              data: {
                                code,
                                id: item.id,
                                promoCode: item.code,
                                kind: "percent",
                                applies: item.applies || "monthly",
                                amount: item.monthlyPercent || item.amount,
                                monthlyPercent: item.monthlyPercent || 0,
                                setupPercent: item.setupPercent || 0,
                                note: item.note,
                                maxUses: item.maxUses,
                                expiresOn: item.expiresOn,
                                active: !item.active,
                              },
                            }).then(async (result: any) => {
                              if (!result.ok) {
                                setError(result.error);
                                return;
                              }
                              setNotice(item.active ? `${item.code} is off.` : `${item.code} is active.`);
                              await refresh();
                            });
                          }}
                        >
                          {item.active ? "Turn off" : "Turn on"}
                        </button>
                        <button
                          type="button"
                          className="btn-sm btn-danger"
                          onClick={() => {
                            void deletePromotion({ data: { code, id: item.id } }).then(async (result: any) => {
                              if (!result.ok) {
                                setError(result.error);
                                return;
                              }
                              setNotice(`${item.code} deleted.`);
                              await refresh();
                            });
                          }}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {panel === "instructions" && (
          <div>
            <h1 style={{ marginBottom: 8 }}>Operating instructions</h1>
            <p style={{ color: "#5a6a7a", marginBottom: 16 }}>These instructions are stored on the server. Typed requests and voice requests both use them. Advisors cannot change them from chat.</p>
            <div style={{ background: "#fff", padding: 24, borderRadius: 12 }}>
              <textarea value={operatingText} onChange={(event) => setOperatingText(event.target.value)} rows={22} style={{ width: "100%", fontFamily: "inherit" }} />
              <button type="button" className="btn-sm btn-primary" style={{ marginTop: 12 }} onClick={() => {
                void saveOperatingInstructions({ data: { code, text: operatingText } }).then((result) => {
                  if (!result.ok) {
                    setError(result.error);
                    return;
                  }
                  setOperatingText(result.text);
                  setNotice("Operating instructions saved. The next typed or voice request uses them.");
                });
              }}>Save instructions</button>
            </div>
          </div>
        )}
        {panel === "assistant" && (
          <div>
            <h1 style={{ marginBottom: 8 }}>AI assistant</h1>
            <p style={{ color: "#5a6a7a", marginBottom: 16 }}>The company key is under OpenAI in the left menu. It is not shown here.</p>
            <div style={{ background: "#fff", padding: 24, borderRadius: 12, marginBottom: 16, overflow: "auto" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 12 }}>
                <h3 style={{ margin: 0 }}>Assistant requests</h3>
                <button type="button" className="btn-sm btn-primary" onClick={() => { void loadAssistantDiagnostics({ data: { code } }).then((result) => { if (result.ok) setDiagnostics(result.requests); }); }}>Refresh</button>
              </div>
              <p style={{ color: "#5a6a7a", marginBottom: 12 }}>Each line is taken from the server path and the provider response. No message text is stored.</p>
              <table>
                <thead>
                  <tr><th>Time</th><th>Handled by</th><th>Provider</th><th>Model</th><th>Status</th><th>Reference</th><th>Request ID</th><th>Prompt</th><th>Completion</th><th>Total</th><th>Detail</th></tr>
                </thead>
                <tbody>
                  {diagnostics.length === 0 && <tr><td colSpan={11}>No assistant requests yet.</td></tr>}
                  {diagnostics.flatMap((item) => {
                    const rows = item.calls.length ? item.calls : [{ provider: "", model: "", requestId: "", promptTokens: null, completionTokens: null, totalTokens: null, at: item.at, status: null, detail: "", reference: "" }];
                    return rows.map((call, index) => (
                      <tr key={`${item.id}-${index}`}>
                        <td>{new Date(call.at || item.at).toLocaleString()}</td>
                        <td>{item.handledBy === "openai" ? "OpenAI" : "Fixed rules"}</td>
                        <td>{call.provider || "—"}</td>
                        <td>{call.model || "—"}</td>
                        <td>{call.status || "—"}</td>
                        <td>{call.reference || "—"}</td>
                        <td>{call.requestId || "—"}</td>
                        <td>{call.promptTokens ?? "—"}</td>
                        <td>{call.completionTokens ?? "—"}</td>
                        <td>{call.totalTokens ?? "—"}</td>
                        <td>{call.detail || "—"}</td>
                      </tr>
                    ));
                  })}
                </tbody>
              </table>
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const text = defaultRuleText.trim();
                if (!text) return;
                const next = [...defaultRules, { text: text.slice(0, 2000), on: true }];
                void saveDefaultRules({ data: { code, rules: next } }).then((result) => {
                  if (!result.ok) {
                    setError(result.error);
                    return;
                  }
                  setDefaultRules(result.rules);
                  setDefaultRuleText("");
                  setNotice("Default rule saved for new advisors only.");
                });
              }}
              style={{ background: "#fff", padding: 24, borderRadius: 12, maxWidth: 720, marginBottom: 16 }}
            >
              <h3 style={{ marginBottom: 8 }}>Default assistant rules for new advisors</h3>
              <p style={{ color: "#5a6a7a", marginBottom: 12 }}>
                These rules are copied onto a desk only when that advisor is created. Advisors who already have a desk are not changed.
                After a new advisor gets a rule, they can turn it off or remove it. That does not change this list.
              </p>
              {defaultRules.length === 0 && <p style={{ color: "#5a6a7a" }}>No default rules yet.</p>}
              {defaultRules.map((rule, index) => (
                <div key={`${index}-${rule.text.slice(0, 24)}`} style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 8, flexWrap: "wrap" }}>
                  {editingDefault === index ? (
                    <div style={{ flex: "1 1 240px" }}>
                      <textarea value={defaultEdit} onChange={(event) => setDefaultEdit(event.target.value)} maxLength={2000} rows={4} style={{ width: "100%", marginBottom: 8 }} />
                      <button
                        type="button"
                        className="btn-sm btn-primary"
                        onClick={() => {
                          const text = defaultEdit.trim();
                          if (!text) return;
                          const next = defaultRules.map((item, itemIndex) => itemIndex === index ? { ...item, text: text.slice(0, 2000) } : item);
                          void saveDefaultRules({ data: { code, rules: next } }).then((result) => {
                            if (!result.ok) {
                              setError(result.error);
                              return;
                            }
                            setDefaultRules(result.rules);
                            setEditingDefault(null);
                            setNotice("Default rule updated. Existing advisors are unchanged.");
                          });
                        }}
                      >
                        Save
                      </button>
                      <button type="button" className="btn-sm" style={{ marginLeft: 8 }} onClick={() => setEditingDefault(null)}>Cancel</button>
                    </div>
                  ) : (
                    <>
                      <p style={{ flex: 1, margin: 0, whiteSpace: "pre-wrap" }}>{rule.text}</p>
                      <button
                        type="button"
                        className="btn-sm"
                        onClick={() => {
                          setEditingDefault(index);
                          setDefaultEdit(rule.text);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn-sm btn-danger"
                        onClick={() => {
                          const next = defaultRules.filter((_, itemIndex) => itemIndex !== index);
                          void saveDefaultRules({ data: { code, rules: next } }).then((result) => {
                            if (!result.ok) {
                              setError(result.error);
                              return;
                            }
                            setDefaultRules(result.rules);
                            setEditingDefault(null);
                            setNotice("Default rule removed. Existing advisors are unchanged.");
                          });
                        }}
                      >
                        Remove
                      </button>
                    </>
                  )}
                </div>
              ))}
              <textarea value={defaultRuleText} onChange={(event) => setDefaultRuleText(event.target.value)} maxLength={2000} rows={4} placeholder="Write a rule for new advisors" style={{ margin: "12px 0", width: "100%" }} />
              <button type="submit" className="btn-sm btn-primary">Add default rule</button>
            </form>
            <p style={{ color: "#5a6a7a", marginBottom: 20, maxWidth: 720 }}>
              These instructions apply to every advisor. A paused advisor is blocked on the server, even if this switch stays on. The assistant cannot send mail until that advisor approves the draft.
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void saveAssistantSettings({ data: { code, settings: assistant } }).then((result) => {
                  if (!result.ok) {
                    setError(result.error);
                    return;
                  }
                  setAssistant(result.settings);
                  setNotice("AI assistant settings saved.");
                });
              }}
              style={{ background: "#fff", padding: 24, borderRadius: 12, maxWidth: 720 }}
            >
              <label style={{ display: "block", marginBottom: 16 }}>
                <input type="checkbox" checked={assistant.enabled} onChange={(event) => setAssistant({ ...assistant, enabled: event.target.checked })} /> AI assistant is available
              </label>
              <label style={{ display: "block", marginBottom: 6, fontWeight: 600 }}>Instructions</label>
              <textarea value={assistant.instructions} rows={8} maxLength={4000} onChange={(event) => setAssistant({ ...assistant, instructions: event.target.value })} style={{ marginBottom: 12, width: "100%" }} />
              <p style={{ color: "#5a6a7a", marginBottom: 16 }}>A locked rule is always added: the assistant only uses that advisor’s records and connected accounts, and it cannot send, book, or upload until the advisor approves.</p>
              <p style={{ fontWeight: 600, marginBottom: 8 }}>Plans that include the AI assistant</p>
              <p style={{ color: "#5a6a7a", marginBottom: 8 }}>Starter includes e-cards, newsletters, and drip campaigns only.</p>
              {PLANS.filter((plan) => plan !== "starter").map((plan) => (
                <label key={plan} style={{ display: "block", marginBottom: 8 }}>
                  <input
                    type="checkbox"
                    checked={assistant.plans.includes(plan)}
                    onChange={(event) => {
                      const plans = event.target.checked ? [...assistant.plans, plan] : assistant.plans.filter((item) => item !== plan);
                      setAssistant({ ...assistant, plans });
                    }}
                  /> {PLAN_LABELS[plan]}
                </label>
              ))}
              <p style={{ fontWeight: 600, margin: "16px 0 8px" }}>Tools</p>
              <label style={{ display: "block", marginBottom: 8 }}>
                <input type="checkbox" checked={assistant.tools.clients} onChange={(event) => setAssistant({ ...assistant, tools: { ...assistant.tools, clients: event.target.checked } })} /> Look up this advisor’s clients
              </label>
              <label style={{ display: "block", marginBottom: 8 }}>
                <input type="checkbox" checked={assistant.tools.draft} onChange={(event) => setAssistant({ ...assistant, tools: { ...assistant.tools, draft: event.target.checked } })} /> Prepare an email for approval
              </label>
              <label style={{ display: "block", marginBottom: 8 }}>
                <input type="checkbox" checked={assistant.tools.calendar} onChange={(event) => setAssistant({ ...assistant, tools: { ...assistant.tools, calendar: event.target.checked } })} /> Read the calendar and prepare an event
              </label>
              <label style={{ display: "block", marginBottom: 8 }}>
                <input type="checkbox" checked={assistant.tools.zoom} onChange={(event) => setAssistant({ ...assistant, tools: { ...assistant.tools, zoom: event.target.checked } })} /> Read Zoom and prepare a meeting
              </label>
              <label style={{ display: "block", marginBottom: 16 }}>
                <input type="checkbox" checked={assistant.tools.dropbox} onChange={(event) => setAssistant({ ...assistant, tools: { ...assistant.tools, dropbox: event.target.checked } })} /> Prepare a Dropbox note for approval
              </label>
              <button type="submit" className="btn-sm btn-primary">Save assistant</button>
            </form>
          </div>
        )}
        {panel === "templates" && (
          <div>
            <h1 style={{ marginBottom: 8 }}>Templates</h1>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
              {([
                ["banners", "Banner library"],
                ["cards", "E-Cards"],
                ["letters", "E-Newsletters"],
                ["eletters", "E-Letters"],
                ["drips", "Drip campaigns"],
              ] as const).map(([key, name]) => (
                <button key={key} type="button" className={templateMenu === key ? "btn-sm btn-primary" : "btn-sm"} onClick={() => setTemplateMenu(key)} style={templateMenu === key ? undefined : { background: "#fff", color: "#0f4c81", border: "1px solid #0f4c81" }}>
                  {name}
                </button>
              ))}
            </div>
            <h2 style={{ marginBottom: 8 }}>{templateMenu === "cards" ? "E-Cards" : templateMenu === "letters" ? "E-Newsletters" : templateMenu === "eletters" ? "E-Letters" : templateMenu === "drips" ? "Drip campaigns" : "Banner library"}</h2>
            <p style={{ color: "#5a6a7a", marginBottom: 20, maxWidth: 720 }}>
              A template you add here appears on every advisor desk, including people who already signed up. New advisors see it too.
            </p>
            {templateMenu === "cards" && (
            <>
            <h3 style={{ marginBottom: 12 }}>Cards already on every desk</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 16, marginBottom: 24 }}>
              {catalog.map((card) => (
                <div key={card.id} style={{ background: "#fff", borderRadius: 12, overflow: "hidden" }}>
                  <img src={card.image} alt="" style={{ width: "100%", height: "auto", display: "block" }} />
                  <div style={{ padding: 12 }}>
                    <strong>{card.title}</strong>
                    <textarea
                      value={wording[card.id] ?? card.message}
                      onChange={(event) => setWording({ ...wording, [card.id]: event.target.value })}
                      style={{ height: 90, marginTop: 8 }}
                    />
                    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                      <button
                        type="button"
                        className="btn-sm btn-primary"
                        onClick={() => {
                          void saveCatalogWording({ data: { code, cardId: card.id, message: wording[card.id] ?? card.message } }).then(async (result: any) => {
                            if (!result.ok) {
                              setError(result.error);
                              return;
                            }
                            setNotice(`Wording saved for ${card.title}. Every desk will use it.`);
                            await refresh();
                          });
                        }}
                      >
                        Save wording
                      </button>
                      <button
                        type="button"
                        className="btn-sm btn-danger"
                        onClick={() => {
                          if (!window.confirm(`Remove ${card.title} from every advisor desk?`)) return;
                          void hideCatalogCard({ data: { code, cardId: card.id } }).then(async (result: any) => {
                            if (!result.ok) {
                              setError(result.error);
                              return;
                            }
                            setNotice(`${card.title} removed from every desk.`);
                            await refresh();
                          });
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <form onSubmit={addCard} style={{ background: "#fff", padding: 24, borderRadius: 12, maxWidth: 640 }}>
              <h3 style={{ marginBottom: 16 }}>Add E-Card</h3>
              <input value={ecName} onChange={(event) => setEcName(event.target.value)} placeholder="Card name" style={{ marginBottom: 10 }} />
              <textarea value={ecMessage} onChange={(event) => setEcMessage(event.target.value)} placeholder="Dear [Contact Name]," style={{ height: 120, marginBottom: 10 }} />
              <FileDrop
                label={ecImage ? "Change picture" : "Upload picture"}
                accept="image/*"
                preview={ecImage}
                previewName="Card picture"
                shape="wide"
                onClearPreview={() => setEcImage("")}
                onFiles={(picked) => {
                  const file = picked[0];
                  if (!file) return;
                  void shrinkCardPhoto(file).then(setEcImage).catch((reason: unknown) => {
                    setEcImage("");
                    setError(reason instanceof Error ? reason.message : "Could not read that picture.");
                  });
                }}
              />
              <button type="submit" className="btn-sm btn-primary">Add E-Card</button>
              <p style={{ color: "#5a6a7a", marginTop: 10, fontSize: 13 }}>Shows on every current desk and on desks created later.</p>
            </form>
            </>
            )}
            {templateMenu === "letters" && (
            <form onSubmit={addLetter} style={{ background: "#fff", padding: 24, borderRadius: 12, maxWidth: 640 }}>
              <h3 style={{ marginBottom: 16 }}>Add E-Newsletter Template</h3>
              <input value={nlName} onChange={(event) => setNlName(event.target.value)} placeholder="Template name" style={{ marginBottom: 10 }} />
              <input value={nlSubject} onChange={(event) => setNlSubject(event.target.value)} placeholder="Subject line" style={{ marginBottom: 10 }} />
              <textarea value={nlBody} onChange={(event) => setNlBody(event.target.value)} placeholder="Body (use [FirstName])" style={{ height: 120, marginBottom: 10 }} />
              <button type="submit" className="btn-sm btn-primary">Add E-Newsletter</button>
              <p style={{ color: "#5a6a7a", marginTop: 10, fontSize: 13 }}>Shows on every current desk and on desks created later.</p>
            </form>
            )}
            {templateMenu === "eletters" && (
            <form onSubmit={addEletter} style={{ background: "#fff", padding: 24, borderRadius: 12, maxWidth: 720 }}>
              <h3 style={{ marginBottom: 8 }}>Add E-Letter Template</h3>
              <p style={{ color: "#5a6a7a", marginBottom: 12 }}>One letter, not several articles. Pick a style. Old Lined Paper is cream stationery with blue lines and a red margin. It appears on every advisor desk, including people already signed up.</p>
              <input value={elName} onChange={(event) => setElName(event.target.value)} placeholder="Template name" style={{ marginBottom: 10 }} />
              <input value={elSubject} onChange={(event) => setElSubject(event.target.value)} placeholder="Subject line" style={{ marginBottom: 10 }} />
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                {ELETTER_DESIGNS.map((item) => (
                  <button key={item.id} type="button" onClick={() => setElDesign(item.id)} style={{ border: elDesign === item.id ? "2px solid #c9a227" : "1px solid #ddd", borderRadius: 8, padding: "8px 10px", background: "#fff", textAlign: "left" }}>
                    <span style={{ display: "block", height: 8, borderRadius: 99, background: ELETTER_SWATCH[item.id], marginBottom: 6 }} />
                    {item.name}
                  </button>
                ))}
              </div>
              <textarea value={elBody} onChange={(event) => setElBody(event.target.value)} placeholder="Letter (use [Contact Name])" style={{ height: 140, marginBottom: 10 }} />
              <button type="submit" className="btn-sm btn-primary">Add E-Letter</button>
            </form>
            )}
            {templateMenu === "letters" && (
            <div style={{ background: "#fff", padding: 20, borderRadius: 12, marginTop: 24, maxWidth: 720 }}>
              <h3>E-Newsletter templates ({templates.filter((item) => item.kind === "letter").length})</h3>
              {templates.filter((item) => item.kind === "letter").map((item) => (
                <div key={item.id} style={{ padding: "8px 0", borderBottom: "1px solid #eee", display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <span>{item.name} — {item.detail}</span>
                  <button type="button" className="btn-sm btn-danger" onClick={() => void removeTemplate(item.id, "letter", item.name)}>Remove</button>
                </div>
              ))}
            </div>
            )}
            {templateMenu === "drips" && (
            <form onSubmit={addDrip} style={{ background: "#fff", padding: 24, borderRadius: 12, maxWidth: 720 }}>
              <h3 style={{ marginBottom: 8 }}>Add drip campaign</h3>
              <p style={{ color: "#5a6a7a", marginBottom: 12 }}>Choose how many articles. Title and body can stay blank for now. The advisor chooses contacts and how often to send, on their own desk.</p>
              <input value={dripName} onChange={(event) => setDripName(event.target.value)} placeholder="Campaign name" style={{ marginBottom: 10 }} />
              <label style={{ display: "block", marginBottom: 10, fontWeight: 600 }}>
                How many articles
                <select value={dripBoxes} onChange={(event) => {
                  const count = Number(event.target.value);
                  setDripBoxes(count);
                  setDripSteps((current) => Array.from({ length: count }, (_, index) => current[index] ?? { title: "", body: "" }));
                }} style={{ display: "block", marginTop: 6, fontWeight: 400 }}>
                  {Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}
                </select>
              </label>
              <p style={{ fontWeight: 600, marginBottom: 8 }}>Design</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
                {ELETTER_DESIGNS.map((item) => (
                  <button key={item.id} type="button" onClick={() => setDripDesign(item.id)} style={{ textAlign: "left", border: dripDesign === item.id ? "2px solid #c9a227" : "1px solid #e1e8ef", borderRadius: 8, padding: 10, background: "#fff" }}>
                    <span style={{ display: "block", height: 8, borderRadius: 99, background: ELETTER_SWATCH[item.id], marginBottom: 6 }} />
                    <strong>{item.name}</strong>
                    <span style={{ display: "block", color: "#5a6a7a", fontSize: 13 }}>{item.detail}</span>
                  </button>
                ))}
              </div>
              {dripSteps.slice(0, dripBoxes).map((step, index) => (
                <div key={index} style={{ border: "1px solid #eee", borderRadius: 8, padding: 12, marginBottom: 10 }}>
                  <input value={step.title} onChange={(event) => setDripSteps(dripSteps.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item))} placeholder={`Article ${index + 1} title, can be blank`} style={{ marginBottom: 8 }} />
                  <textarea value={step.body} onChange={(event) => setDripSteps(dripSteps.map((item, itemIndex) => itemIndex === index ? { ...item, body: event.target.value } : item))} placeholder={`Article ${index + 1} body, can be blank`} style={{ height: 90 }} />
                </div>
              ))}
              <button type="submit" className="btn-sm btn-primary">Add campaign</button>
            </form>
            )}
            {templateMenu === "eletters" && (
            <div style={{ background: "#fff", padding: 20, borderRadius: 12, marginTop: 24, maxWidth: 720 }}>
              <h3>E-Letter templates ({templates.filter((item) => item.kind === "eletter").length})</h3>
              {templates.filter((item) => item.kind === "eletter").map((item) => (
                <div key={item.id} style={{ padding: "8px 0", borderBottom: "1px solid #eee", display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <span>{item.name} — {item.detail}</span>
                  <button type="button" className="btn-sm btn-danger" onClick={() => void removeTemplate(item.id, "eletter", item.name)}>Remove</button>
                </div>
              ))}
            </div>
            )}
            {templateMenu === "drips" && (
            <div style={{ background: "#fff", padding: 20, borderRadius: 12, marginTop: 24, maxWidth: 720 }}>
              <h3>Drip campaigns ({templates.filter((item) => item.kind === "drip").length})</h3>
              {templates.filter((item) => item.kind === "drip").map((item) => {
                const packed = readDripPack(item.body);
                return (
                  <div key={item.id} style={{ padding: "8px 0", borderBottom: "1px solid #eee", display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <span>{item.name} — {packed ? `${packed.steps.length} article${packed.steps.length === 1 ? "" : "s"}` : item.detail}</span>
                    <button type="button" className="btn-sm btn-danger" onClick={() => void removeTemplate(item.id, "drip", item.name)}>Remove</button>
                  </div>
                );
              })}
            </div>
            )}
            {templateMenu === "banners" && (
            <form onSubmit={addBanner} style={{ background: "#fff", padding: 24, borderRadius: 12, maxWidth: 720 }}>
              <h3 style={{ marginBottom: 8 }}>Add a banner to the library</h3>
              <p style={{ color: "#5a6a7a", marginBottom: 12 }}>Upload a picture and name it. It shows in the banner library on every advisor website, including desks that already exist.</p>
              <input value={bannerName} onChange={(event) => setBannerName(event.target.value)} placeholder="Banner name" style={{ marginBottom: 10 }} />
              <FileDrop
                label={bannerImage ? "Change banner" : "Upload banner"}
                accept="image/*"
                preview={bannerImage}
                previewName={bannerName || "Banner"}
                shape="wide"
                onClearPreview={() => setBannerImage("")}
                onFiles={(picked) => {
                  const file = picked[0];
                  if (!file) return;
                  void shrinkCardPhoto(file).then(setBannerImage).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Choose a JPG or PNG picture."));
                }}
              />
              <button type="submit" className="btn-sm btn-primary">Add banner</button>
            </form>
            )}
            {templateMenu === "banners" && (
            <div style={{ background: "#fff", padding: 20, borderRadius: 12, marginTop: 24, maxWidth: 720 }}>
              <h3>Banners you added ({templates.filter((item) => item.kind === "banner").length})</h3>
              {templates.filter((item) => item.kind === "banner").map((item) => (
                <div key={item.id} style={{ padding: "8px 0", borderBottom: "1px solid #eee", display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <img src={`/api/platform-banners/${item.id}`} alt="" style={{ width: 96, height: 48, objectFit: "cover", borderRadius: 6 }} />
                    {item.name}
                  </span>
                  <button type="button" className="btn-sm btn-danger" onClick={() => void removeTemplate(item.id, "banner", item.name)}>Remove</button>
                </div>
              ))}
            </div>
            )}
            {templateMenu === "cards" && (
            <div style={{ background: "#fff", padding: 20, borderRadius: 12, marginTop: 24 }}>
              <h3 style={{ marginBottom: 12 }}>E-Cards you added ({templates.filter((item) => item.kind === "card").length})</h3>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 16, marginTop: 12 }}>
                {templates.filter((item) => item.kind === "card").map((item) => {
                  const key = `added-${item.id}`;
                  const text = wording[key] ?? (item.body || "Dear [Contact Name],\n\n");
                  return (
                    <div key={item.id} style={{ border: "1px solid #eee", borderRadius: 12, overflow: "hidden" }}>
                      {item.hasImage ? (
                        <img src={`/api/platform-cards/${item.id}?v=2`} alt="" style={{ width: "100%", height: "auto", display: "block" }} />
                      ) : (
                        <div style={{ height: 120, background: "#0f4c81" }} />
                      )}
                      <div style={{ padding: 12 }}>
                        <strong>{item.name}</strong>
                        <textarea
                          value={text}
                          onChange={(event) => setWording({ ...wording, [key]: event.target.value })}
                          style={{ height: 90, marginTop: 8 }}
                        />
                        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                          <button
                            type="button"
                            className="btn-sm btn-primary"
                            onClick={() => {
                              void updatePlatformCard({ data: { code, id: item.id, body: text } }).then(async (result: any) => {
                                if (!result.ok) {
                                  setError(result.error);
                                  return;
                                }
                                setNotice(`Wording saved for ${item.name}. Every desk will use it.`);
                                await refresh();
                              });
                            }}
                          >
                            Save wording
                          </button>
                          <button
                            type="button"
                            className="btn-sm btn-danger"
                            onClick={() => {
                              if (!window.confirm(`Remove ${item.name} from every advisor desk?`)) return;
                              void deletePlatformCard({ data: { code, id: item.id } }).then(async (result: any) => {
                                if (!result.ok) {
                                  setError(result.error);
                                  return;
                                }
                                setNotice(`${item.name} removed from every desk.`);
                                await refresh();
                              });
                            }}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            )}
          </div>
        )}
        {panel === "tags" && (
          <div>
            <h1 style={{ marginBottom: 8 }}>Tags for new advisors</h1>
            <p style={{ color: "#5a6a7a", marginBottom: 20, maxWidth: 640 }}>
              A tag you add here is given only to advisors who sign up after it. Advisors already on the list keep the tags they have, and each of them can still create their own.
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void addPlatformTag({ data: { code, name: tagName } }).then(async (result: any) => {
                  if (!result.ok) {
                    setError(result.error);
                    return;
                  }
                  setTagName("");
                  setNotice("Tag saved. It will be on the next advisor who signs up.");
                  await refresh();
                });
              }}
              style={{ background: "#fff", padding: 24, borderRadius: 12, maxWidth: 520 }}
            >
              <input value={tagName} onChange={(event) => setTagName(event.target.value)} placeholder="New tag" style={{ marginBottom: 12 }} />
              <button type="submit" className="btn-sm btn-primary">Add tag</button>
            </form>
            <div style={{ background: "#fff", padding: 20, borderRadius: 12, marginTop: 20, maxWidth: 520 }}>
              <h3>Tags waiting for new advisors ({platformTags.length})</h3>
              {platformTags.length === 0 && <p style={{ color: "#5a6a7a", marginTop: 8 }}>None yet.</p>}
              {platformTags.map((item) => (
                <div key={item.id} style={{ padding: "8px 0", borderBottom: "1px solid #eee" }}>{item.name}</div>
              ))}
            </div>
          </div>
        )}
        {panel === "website" && (
          <div>
            <h1 style={{ marginBottom: 8 }}>Corporate website</h1>
            <p style={{ color: "#5a6a7a", marginBottom: 20, maxWidth: 640 }}>
              This is the public Unique Advisor page. Save, then click Open home page to see your changes.
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (siteSave === "saving") return;
                setError("");
                setNotice("");
                setSiteSave("saving");
                void savePlatformSettings({ data: { code, settings } }).then((result: any) => {
                  if (!result?.ok) {
                    setSiteSave("idle");
                    setError(result?.error || "The website could not be saved.");
                    return;
                  }
                  setSettings(result.settings);
                  setSiteSave("saved");
                }).catch(() => {
                  setSiteSave("idle");
                  setError("The website could not be saved.");
                });
              }}
              style={{ background: "#fff", padding: 24, borderRadius: 12, maxWidth: 720 }}
            >
              <p style={{ color: "#5a6a7a", marginBottom: 16 }}>Clear a box or press Remove to take that part off the home page. Save when you are finished.</p>
              <h3 style={{ margin: "8px 0" }}>Font size and color</h3>
              <p style={{ color: "#5a6a7a", marginBottom: 10 }}>Size is in pixels. The color box sets the font color.</p>
              {FONT_LABELS.map(([key, label]) => (
                <div key={key} style={{ display: "grid", gridTemplateColumns: "1fr 88px 52px", gap: 8, alignItems: "center", marginBottom: 8 }}>
                  <span>{label}</span>
                  <input type="number" min={10} max={96} value={settings.site.fonts[key].size} onChange={(event) => { setSiteSave("idle"); setSettings({ ...settings, site: { ...settings.site, fonts: { ...settings.site.fonts, [key]: { ...settings.site.fonts[key], size: Number(event.target.value) } } } }); }} />
                  <input type="color" value={settings.site.fonts[key].color} onChange={(event) => { setSiteSave("idle"); setSettings({ ...settings, site: { ...settings.site, fonts: { ...settings.site.fonts, [key]: { ...settings.site.fonts[key], color: event.target.value } } } }); }} />
                </div>
              ))}
              <h3 style={{ margin: "8px 0" }}>Menu</h3>
              {settings.site.links.map((link, index) => (
                <div key={`nav-${index}`} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8, marginBottom: 8 }}>
                  <input value={link.label} onChange={(event) => { setSiteSave("idle"); const links = settings.site.links.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item); setSettings({ ...settings, site: { ...settings.site, links } }); }} placeholder="Label" />
                  <input value={link.href} onChange={(event) => { setSiteSave("idle"); const links = settings.site.links.map((item, itemIndex) => itemIndex === index ? { ...item, href: event.target.value } : item); setSettings({ ...settings, site: { ...settings.site, links } }); }} placeholder="#assistant or /login" />
                  <button type="button" className="btn-sm" style={{ background: "#8a3a3a" }} onClick={() => { setSiteSave("idle"); setSettings({ ...settings, site: { ...settings.site, links: settings.site.links.filter((_, itemIndex) => itemIndex !== index) } }); }}>Remove</button>
                </div>
              ))}
              <button type="button" className="btn-sm btn-primary" style={{ marginBottom: 18 }} onClick={() => { setSiteSave("idle"); setSettings({ ...settings, site: { ...settings.site, links: [...settings.site.links, { label: "New link", href: "#" }] } }); }}>Add menu link</button>
              <h3 style={{ margin: "8px 0" }}>Top of the page</h3>
              <label style={{ display: "block", marginBottom: 6, fontWeight: 600 }}>Small line above the title</label>
              <input value={settings.site.kicker} onChange={(event) => { setSiteSave("idle"); setSettings({ ...settings, site: { ...settings.site, kicker: event.target.value } }); }} style={{ marginBottom: 12 }} />
              <label style={{ display: "block", marginBottom: 6, fontWeight: 600 }}>Bold colored line</label>
              <input value={settings.site.accent} onChange={(event) => { setSiteSave("idle"); setSettings({ ...settings, site: { ...settings.site, accent: event.target.value } }); }} style={{ marginBottom: 12 }} />
              <label style={{ display: "block", marginBottom: 6, fontWeight: 600 }}>Title</label>
              <textarea value={settings.site.headline} onChange={(event) => { setSiteSave("idle"); setSettings({ ...settings, site: { ...settings.site, headline: event.target.value } }); }} style={{ minHeight: 70, marginBottom: 12 }} />
              <label style={{ display: "block", marginBottom: 6, fontWeight: 600 }}>Introduction</label>
              <textarea value={settings.site.subhead} onChange={(event) => { setSiteSave("idle"); setSettings({ ...settings, site: { ...settings.site, subhead: event.target.value } }); }} style={{ minHeight: 80, marginBottom: 12 }} />
              <h3 style={{ margin: "18px 0 8px" }}>Trial button color</h3>
              <p style={{ color: "#5a6a7a", marginBottom: 8 }}>This color is used on every Start free trial button.</p>
              <input type="color" value={settings.site.buttonColor} onChange={(event) => { setSiteSave("idle"); setSettings({ ...settings, site: { ...settings.site, buttonColor: event.target.value } }); }} style={{ width: 64, height: 36, marginBottom: 16 }} />
              <label style={{ display: "block", marginBottom: 6, fontWeight: 600 }}>Gold button</label>
              <input value={settings.site.primaryButton} onChange={(event) => { setSiteSave("idle"); setSettings({ ...settings, site: { ...settings.site, primaryButton: event.target.value } }); }} style={{ marginBottom: 12 }} />
              <label style={{ display: "block", marginBottom: 6, fontWeight: 600 }}>Second button</label>
              <input value={settings.site.secondaryButton} onChange={(event) => { setSiteSave("idle"); setSettings({ ...settings, site: { ...settings.site, secondaryButton: event.target.value } }); }} style={{ marginBottom: 18 }} />
              <h3 style={{ margin: "8px 0" }}>AI assistant section</h3>
              <label style={{ display: "block", marginBottom: 12 }}><input type="checkbox" checked={settings.site.assistantVisible} onChange={(event) => { setSiteSave("idle"); setSettings({ ...settings, site: { ...settings.site, assistantVisible: event.target.checked } }); }} /> Show this section</label>
              <input value={settings.site.assistantKicker} onChange={(event) => { setSiteSave("idle"); setSettings({ ...settings, site: { ...settings.site, assistantKicker: event.target.value } }); }} placeholder="Small line" style={{ marginBottom: 8 }} />
              <input value={settings.site.assistantTitle} onChange={(event) => { setSiteSave("idle"); setSettings({ ...settings, site: { ...settings.site, assistantTitle: event.target.value } }); }} placeholder="Section title" style={{ marginBottom: 8 }} />
              <textarea value={settings.site.assistantLead} onChange={(event) => { setSiteSave("idle"); setSettings({ ...settings, site: { ...settings.site, assistantLead: event.target.value } }); }} placeholder="Section introduction" style={{ minHeight: 70, marginBottom: 8 }} />
              {settings.site.assistantCards.map((feature, index) => (
                <div key={`assistant-${index}`} style={{ marginBottom: 12 }}>
                  <input value={feature.title} onChange={(event) => { setSiteSave("idle"); const assistantCards = settings.site.assistantCards.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item); setSettings({ ...settings, site: { ...settings.site, assistantCards } }); }} placeholder="Card title" style={{ marginBottom: 8 }} />
                  <textarea value={feature.body} onChange={(event) => { setSiteSave("idle"); const assistantCards = settings.site.assistantCards.map((item, itemIndex) => itemIndex === index ? { ...item, body: event.target.value } : item); setSettings({ ...settings, site: { ...settings.site, assistantCards } }); }} style={{ minHeight: 60 }} />
                  <button type="button" className="btn-sm" style={{ background: "#8a3a3a", marginTop: 6 }} onClick={() => { setSiteSave("idle"); setSettings({ ...settings, site: { ...settings.site, assistantCards: settings.site.assistantCards.filter((_, itemIndex) => itemIndex !== index) } }); }}>Remove card</button>
                </div>
              ))}
              <button type="button" className="btn-sm btn-primary" style={{ marginBottom: 18 }} onClick={() => { setSiteSave("idle"); setSettings({ ...settings, site: { ...settings.site, assistantCards: [...settings.site.assistantCards, { title: "", body: "" }] } }); }}>Add card</button>
              <h3 style={{ margin: "8px 0" }}>Feature section</h3>
              <label style={{ display: "block", marginBottom: 12 }}><input type="checkbox" checked={settings.site.featuresVisible} onChange={(event) => { setSiteSave("idle"); setSettings({ ...settings, site: { ...settings.site, featuresVisible: event.target.checked } }); }} /> Show this section</label>
              <input value={settings.site.featuresKicker} onChange={(event) => { setSiteSave("idle"); setSettings({ ...settings, site: { ...settings.site, featuresKicker: event.target.value } }); }} placeholder="Small line" style={{ marginBottom: 8 }} />
              <input value={settings.site.featuresTitle} onChange={(event) => { setSiteSave("idle"); setSettings({ ...settings, site: { ...settings.site, featuresTitle: event.target.value } }); }} placeholder="Section title" style={{ marginBottom: 8 }} />
              {settings.site.features.map((feature, index) => (
                <div key={`feature-${index}`} style={{ marginBottom: 12 }}>
                  <input value={feature.title} onChange={(event) => { setSiteSave("idle"); const features = settings.site.features.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item); setSettings({ ...settings, site: { ...settings.site, features } }); }} placeholder="Card title" style={{ marginBottom: 8 }} />
                  <textarea value={feature.body} onChange={(event) => { setSiteSave("idle"); const features = settings.site.features.map((item, itemIndex) => itemIndex === index ? { ...item, body: event.target.value } : item); setSettings({ ...settings, site: { ...settings.site, features } }); }} style={{ minHeight: 60 }} />
                  <button type="button" className="btn-sm" style={{ background: "#8a3a3a", marginTop: 6 }} onClick={() => { setSiteSave("idle"); setSettings({ ...settings, site: { ...settings.site, features: settings.site.features.filter((_, itemIndex) => itemIndex !== index) } }); }}>Remove card</button>
                </div>
              ))}
              <button type="button" className="btn-sm btn-primary" style={{ marginBottom: 18 }} onClick={() => { setSiteSave("idle"); setSettings({ ...settings, site: { ...settings.site, features: [...settings.site.features, { title: "", body: "" }] } }); }}>Add card</button>
              <h3 style={{ margin: "8px 0" }}>Pricing section</h3>
              <label style={{ display: "block", marginBottom: 12 }}><input type="checkbox" checked={settings.site.pricingVisible} onChange={(event) => { setSiteSave("idle"); setSettings({ ...settings, site: { ...settings.site, pricingVisible: event.target.checked } }); }} /> Show this section</label>
              <input value={settings.site.pricingKicker} onChange={(event) => { setSiteSave("idle"); setSettings({ ...settings, site: { ...settings.site, pricingKicker: event.target.value } }); }} placeholder="Small line" style={{ marginBottom: 8 }} />
              <input value={settings.site.pricingTitle} onChange={(event) => { setSiteSave("idle"); setSettings({ ...settings, site: { ...settings.site, pricingTitle: event.target.value } }); }} placeholder="Section title" style={{ marginBottom: 8 }} />
              {settings.site.plans.map((plan, index) => (
                <div key={`plan-${index}`} style={{ marginBottom: 16, paddingBottom: 12, borderBottom: "1px solid #eee" }}>
                  <input value={plan.name} onChange={(event) => { setSiteSave("idle"); const plans = settings.site.plans.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item); setSettings({ ...settings, site: { ...settings.site, plans } }); }} placeholder="Plan name" style={{ marginBottom: 8 }} />
                  <input value={plan.note} onChange={(event) => { setSiteSave("idle"); const plans = settings.site.plans.map((item, itemIndex) => itemIndex === index ? { ...item, note: event.target.value } : item); setSettings({ ...settings, site: { ...settings.site, plans } }); }} placeholder="Short note" style={{ marginBottom: 8 }} />
                  <input value={plan.price} onChange={(event) => { setSiteSave("idle"); const plans = settings.site.plans.map((item, itemIndex) => itemIndex === index ? { ...item, price: event.target.value } : item); setSettings({ ...settings, site: { ...settings.site, plans } }); }} placeholder="$49" style={{ marginBottom: 8 }} />
                  <textarea value={plan.points} onChange={(event) => { setSiteSave("idle"); const plans = settings.site.plans.map((item, itemIndex) => itemIndex === index ? { ...item, points: event.target.value } : item); setSettings({ ...settings, site: { ...settings.site, plans } }); }} placeholder="One benefit on each line" style={{ minHeight: 80, marginBottom: 8 }} />
                  <input value={plan.button} onChange={(event) => { setSiteSave("idle"); const plans = settings.site.plans.map((item, itemIndex) => itemIndex === index ? { ...item, button: event.target.value } : item); setSettings({ ...settings, site: { ...settings.site, plans } }); }} placeholder="Button" style={{ marginBottom: 8 }} />
                  <label style={{ display: "block", marginBottom: 8 }}><input type="checkbox" checked={plan.featured} onChange={(event) => { setSiteSave("idle"); const plans = settings.site.plans.map((item, itemIndex) => itemIndex === index ? { ...item, featured: event.target.checked } : item); setSettings({ ...settings, site: { ...settings.site, plans } }); }} /> Highlight this plan</label>
                  <button type="button" className="btn-sm" style={{ background: "#8a3a3a" }} onClick={() => { setSiteSave("idle"); setSettings({ ...settings, site: { ...settings.site, plans: settings.site.plans.filter((_, itemIndex) => itemIndex !== index) } }); }}>Remove plan</button>
                </div>
              ))}
              <button type="button" className="btn-sm btn-primary" style={{ marginBottom: 18 }} onClick={() => { setSiteSave("idle"); setSettings({ ...settings, site: { ...settings.site, plans: [...settings.site.plans, { name: "New plan", note: "", price: "", points: "", button: "Start free trial", featured: false }] } }); }}>Add plan</button>
              <h3 style={{ margin: "8px 0" }}>Footer</h3>
              <textarea value={settings.site.footer} onChange={(event) => { setSiteSave("idle"); setSettings({ ...settings, site: { ...settings.site, footer: event.target.value } }); }} style={{ minHeight: 60, marginBottom: 8 }} />
              {settings.site.footerLinks.map((link, index) => (
                <div key={`foot-${index}`} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8, marginBottom: 8 }}>
                  <input value={link.label} onChange={(event) => { setSiteSave("idle"); const footerLinks = settings.site.footerLinks.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item); setSettings({ ...settings, site: { ...settings.site, footerLinks } }); }} placeholder="Label" />
                  <input value={link.href} onChange={(event) => { setSiteSave("idle"); const footerLinks = settings.site.footerLinks.map((item, itemIndex) => itemIndex === index ? { ...item, href: event.target.value } : item); setSettings({ ...settings, site: { ...settings.site, footerLinks } }); }} placeholder="/login" />
                  <button type="button" className="btn-sm" style={{ background: "#8a3a3a" }} onClick={() => { setSiteSave("idle"); setSettings({ ...settings, site: { ...settings.site, footerLinks: settings.site.footerLinks.filter((_, itemIndex) => itemIndex !== index) } }); }}>Remove</button>
                </div>
              ))}
              <button type="button" className="btn-sm btn-primary" style={{ marginBottom: 16 }} onClick={() => { setSiteSave("idle"); setSettings({ ...settings, site: { ...settings.site, footerLinks: [...settings.site.footerLinks, { label: "New link", href: "/" }] } }); }}>Add footer link</button>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button
                type="submit"
                className="btn-sm btn-primary"
                style={siteSave === "idle" ? { padding: "10px 18px" } : { background: "#c9a227", color: "#1a1916", fontWeight: 800, padding: "10px 18px" }}
              >
                {siteSave === "saving" ? "Saving…" : siteSave === "saved" ? "Saved" : "Save website"}
              </button>
              <a className="btn-sm btn-primary" href="https://youradviser.grok.me" target="_blank" rel="noreferrer" style={{ padding: "10px 18px" }}>Open home page</a>
              </div>
            </form>
          </div>
        )}
        {panel === "settings" && (
          <div>
            <h1 style={{ marginBottom: 20 }}>Admin Settings</h1>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void savePlatformSettings({ data: { code, settings } }).then((result: any) => {
                  if (!result.ok) {
                    setError(result.error);
                    setSettingsMsg(false);
                    return;
                  }
                  setSettings(result.settings);
                  setSettingsMsg(true);
                });
              }}
              style={{ background: "#fff", padding: 28, borderRadius: 12, maxWidth: 560, marginBottom: 20 }}
            >
              <h3 style={{ marginBottom: 16 }}>Platform Controls</h3>
              <label style={{ display: "block", marginBottom: 6, fontWeight: 600 }}>Your domain</label>
              <input value={domainDraft} onChange={(event) => setDomainDraft(event.target.value)} placeholder="uniqueadvisor.com" style={{ marginBottom: 12 }} />
              <button type="button" className="btn-sm btn-primary" onClick={(event) => void onDomain(event as unknown as React.FormEvent)}>Save domain</button>
              <p style={{ margin: "16px 0", color: "#5a6a7a" }}>{domain ? `Subdomains use ${domain}.` : "No domain saved yet."}</p>
              <label style={{ display: "block", marginBottom: 6, fontWeight: 600 }}>Trial Length (days)</label>
              <input
                type="number"
                value={settings.trialDays}
                min={0}
                max={365}
                onChange={(event) => setSettings({ ...settings, trialDays: Number(event.target.value) })}
                style={{ width: 120, marginBottom: 16 }}
              />
              <label style={{ display: "block", marginBottom: 6, fontWeight: 600 }}>Default Plan for New Signups</label>
              <select
                value={settings.defaultPlan}
                onChange={(event) => setSettings({ ...settings, defaultPlan: event.target.value as PlanId })}
                style={{ marginBottom: 16 }}
              >
                <option value="starter">Starter</option>
                <option value="professional">Professional</option>
                <option value="team">Team</option>
              </select>
              <label style={{ display: "block", marginBottom: 16 }}>
                <input type="checkbox" checked={settings.allowCustomTags} onChange={(event) => setSettings({ ...settings, allowCustomTags: event.target.checked })} /> Allow custom tags on Professional and Team
              </label>
              <label style={{ display: "block", marginBottom: 16 }}>
                <input type="checkbox" checked={settings.allowWebsite} onChange={(event) => setSettings({ ...settings, allowWebsite: event.target.checked })} /> Allow website integration on Professional+
              </label>
              <label style={{ display: "block", marginBottom: 6, fontWeight: 600 }}>Billing Currency</label>
              <select
                value={settings.currency}
                onChange={(event) => setSettings({ ...settings, currency: event.target.value === "USD" ? "USD" : "CAD" })}
                style={{ marginBottom: 20 }}
              >
                <option value="CAD">CAD</option>
                <option value="USD">USD</option>
              </select>
              <button type="submit" className="btn-sm btn-primary">Save Settings</button>
              {settingsMsg && <p style={{ marginTop: 12, color: "#0d7a4f" }}>Settings saved.</p>}
            </form>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void saveConnectionApp({ data: { code, provider: "zoom", clientId: zoomClientId, clientSecret: zoomSecret } }).then((result) => {
                  if (!result.ok) {
                    setError(result.error);
                    return;
                  }
                  setZoomSecret("");
                  setZoomClientId("");
                  setZoomReady(true);
                  setZoomSavedId(zoomClientId.trim());
                  setZoomSecretMask(`••••••••${zoomSecret.trim().slice(-4)}`);
                  setNotice("Zoom app saved. Advisors can press Sign in with Zoom.");
                });
              }}
              style={{ background: "#fff", padding: 28, borderRadius: 12, maxWidth: 560, marginBottom: 20 }}
            >
              <h3 style={{ marginBottom: 8 }}>Zoom app</h3>
              <p style={{ color: "#5a6a7a", marginBottom: 12 }}>One app for Unique Advisor. Each advisor then presses Sign in with Zoom on their own desk.</p>
              {zoomReady && zoomSavedId ? (
                <p style={{ marginBottom: 12, fontWeight: 700, color: "#0d7a4f" }}>
                  Zoom app saved.<br />
                  Client ID: {zoomSavedId}<br />
                  Client Secret: {zoomSecretMask || "••••••••"}
                </p>
              ) : (
                <p style={{ color: "#5a6a7a", marginBottom: 12 }}>No Zoom app is saved yet.</p>
              )}
              <p style={{ marginBottom: 12 }}>Redirect URL: {ZOOM_REDIRECT}</p>
              <input value={zoomClientId} onChange={(event) => setZoomClientId(event.target.value)} placeholder="Client ID" style={{ marginBottom: 8 }} autoComplete="off" />
              <input type="password" value={zoomSecret} onChange={(event) => setZoomSecret(event.target.value)} placeholder="Client Secret" style={{ marginBottom: 12 }} autoComplete="off" />
              <button type="submit" className="btn-sm btn-primary">Save Zoom app</button>
            </form>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void saveConnectionApp({ data: { code, provider: "dropbox", clientId: dropboxClientId, clientSecret: dropboxSecret } }).then((result) => {
                  if (!result.ok) {
                    setError(result.error);
                    setSavedApp("");
                    return;
                  }
                  setDropboxSecret("");
                  setDropboxClientId("");
                  setDropboxReady(true);
                  setSavedApp("dropbox");
                  setNotice("Dropbox app saved.");
                });
              }}
              style={{ background: "#fff", padding: 28, borderRadius: 12, maxWidth: 560, marginBottom: 20 }}
            >
              <h3 style={{ marginBottom: 8 }}>Dropbox app</h3>
              <p style={{ color: "#5a6a7a", marginBottom: 12 }}>Paste the Dropbox app key and secret. Advisors then press Sign in with Dropbox. {dropboxReady ? "A Dropbox app is already saved." : "No Dropbox app is saved yet."}</p>
              <p style={{ marginBottom: 12, fontWeight: 700 }}>Redirect URL: https://youradviser.grok.me/api/link/callback</p>
              <input value={dropboxClientId} onChange={(event) => setDropboxClientId(event.target.value)} placeholder="Client ID / App key" style={{ marginBottom: 8 }} autoComplete="off" />
              <input type="password" value={dropboxSecret} onChange={(event) => setDropboxSecret(event.target.value)} placeholder="Client Secret" style={{ marginBottom: 12 }} autoComplete="off" />
              <button type="submit" className="btn-sm btn-primary">Save Dropbox app</button>
              {savedApp === "dropbox" && <p style={{ marginTop: 12, color: "#0d7a4f", fontWeight: 700 }}>Dropbox app saved.</p>}
            </form>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void saveConnectionApp({ data: { code, provider: "box", clientId: boxClientId, clientSecret: boxSecret } }).then((result) => {
                  if (!result.ok) {
                    setError(result.error);
                    setSavedApp("");
                    return;
                  }
                  setBoxSecret("");
                  setBoxClientId("");
                  setBoxReady(true);
                  setSavedApp("box");
                  setNotice("Box app saved.");
                });
              }}
              style={{ background: "#fff", padding: 28, borderRadius: 12, maxWidth: 560, marginBottom: 20 }}
            >
              <h3 style={{ marginBottom: 8 }}>Box app</h3>
              <p style={{ color: "#5a6a7a", marginBottom: 12 }}>Paste the Box Client ID and Client Secret. Advisors then press Sign in with Box. {boxReady ? "A Box app is already saved." : "No Box app is saved yet."}</p>
              <p style={{ marginBottom: 12, fontWeight: 700 }}>Redirect URL: https://youradviser.grok.me/api/box/callback</p>
              <input value={boxClientId} onChange={(event) => setBoxClientId(event.target.value)} placeholder="Client ID" style={{ marginBottom: 8 }} autoComplete="off" />
              <input type="password" value={boxSecret} onChange={(event) => setBoxSecret(event.target.value)} placeholder="Client Secret" style={{ marginBottom: 12 }} autoComplete="off" />
              <button type="submit" className="btn-sm btn-primary">Save Box app</button>
              {savedApp === "box" && <p style={{ marginTop: 12, color: "#0d7a4f", fontWeight: 700 }}>Box app saved.</p>}
            </form>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void saveConnectionApp({ data: { code, provider: "google_drive", clientId: driveClientId, clientSecret: driveSecret } }).then((result) => {
                  if (!result.ok) {
                    setError(result.error);
                    setSavedApp("");
                    return;
                  }
                  setDriveSecret("");
                  setDriveClientId("");
                  setDriveReady(true);
                  setSavedApp("google");
                  setNotice("Google app saved.");
                });
              }}
              style={{ background: "#fff", padding: 28, borderRadius: 12, maxWidth: 560, marginBottom: 20 }}
            >
              <h3 style={{ marginBottom: 8 }}>Google app</h3>
              <p style={{ color: "#5a6a7a", marginBottom: 12 }}>Paste the Google Client ID and Client Secret. This is for Google Drive and Google Docs. {driveReady ? "A Google app is already saved." : "No Google app is saved yet."}</p>
              <p style={{ marginBottom: 12, fontWeight: 700 }}>Redirect URL: https://youradviser.grok.me/api/google/callback</p>
              <input value={driveClientId} onChange={(event) => setDriveClientId(event.target.value)} placeholder="Client ID" style={{ marginBottom: 8 }} autoComplete="off" />
              <input type="password" value={driveSecret} onChange={(event) => setDriveSecret(event.target.value)} placeholder="Client Secret" style={{ marginBottom: 12 }} autoComplete="off" />
              <button type="submit" className="btn-sm btn-primary">Save Google app</button>
              {savedApp === "google" && <p style={{ marginTop: 12, color: "#0d7a4f", fontWeight: 700 }}>Google app saved.</p>}
            </form>
            <SupportSettings code={code} />
            <form onSubmit={onCode} style={{ background: "#fff", padding: 28, borderRadius: 12, maxWidth: 560 }}>
              <h3 style={{ marginBottom: 12 }}>Super admin password</h3>
              <input type="password" value={nextCode} onChange={(event) => setNextCode(event.target.value)} placeholder="New password, at least 8 characters" />
              <button type="submit" className="btn-sm btn-primary" style={{ marginTop: 12 }}>Update password</button>
              {error && <p style={{ color: "#c0392b", marginTop: 12 }}>{error}</p>}
            </form>
          </div>
        )}
      </main>
    </div>
  );
}
