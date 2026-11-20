import { createServerFn } from "@tanstack/react-start";
import { enforcePreviewOperator } from "@/lib/advisor-db";
import { codesMatch } from "@/lib/codes";
import { dbSource, getSql } from "@/lib/db";
import { microsoftAppStatus } from "@/lib/microsoft-mail";

export type SetupItem = {
  id: "admin" | "advisor" | "openai" | "microsoft" | "outlook";
  label: string;
  ready: boolean;
  detail: string;
  href: string;
};

export const loadPreviewSetup = createServerFn({ method: "GET" }).handler(async () => {
  if (dbSource !== "pglite") {
    return {
      storage: "production" as const,
      isolated: false,
      persists: false,
      markerAt: "",
      items: [] as SetupItem[],
    };
  }
  const sql = await getSql();
  await enforcePreviewOperator();
  const operator = (await sql<{ code_hash: string | null; code_is_default: boolean | string | number }>`
    select code_hash, code_is_default from operators where id = 1
  `)[0];
  const flag = operator?.code_is_default;
  const defaultFlag = flag === true || flag === "t" || flag === "true" || flag === 1 || flag === "1";
  const defaultCode = codesMatch(String(operator?.code_hash || ""), "superadmin");
  const adminReady = Boolean(operator?.code_hash) && !defaultFlag && !defaultCode;
  const advisors = await sql<{ n: number }>`select count(*)::int as n from advisors`;
  const advisorCount = Number(advisors[0]?.n || 0);
  let openAiSaved = false;
  try {
    const openAiRow = (await sql<{ saved: boolean }>`
      select (coalesce(openai_api_key, '') <> '') as saved from operators where id = 1
    `)[0];
    openAiSaved = Boolean(openAiRow?.saved);
  } catch {
    openAiSaved = false;
  }
  const openAiEnv = Boolean(process.env.OPENAI_API_KEY?.trim());
  const openAiReady = openAiSaved || openAiEnv;
  const microsoft = await microsoftAppStatus().catch(() => ({ configured: false, source: "none" as const, clientId: "" }));
  let outlookCount = 0;
  try {
    const rows = await sql<{ n: number }>`
      select count(*)::int as n from advisor_links
      where provider = 'outlook_calendar' and coalesce(refresh_token, '') <> ''
    `;
    outlookCount = Number(rows[0]?.n || 0);
  } catch {
    outlookCount = 0;
  }
  const marker = (await sql<{ created_at: string }>`select created_at from _preview_store where id = 1`)[0];
  const items: SetupItem[] = [
    {
      id: "admin",
      label: "Private admin setup",
      ready: adminReady,
      detail: adminReady ? "A private Superadmin password is already saved." : "Set a private Superadmin password. The default is not accepted.",
      href: "/admin",
    },
    {
      id: "advisor",
      label: "Advisor account",
      ready: advisorCount > 0,
      detail: advisorCount > 0 ? `${advisorCount} advisor account${advisorCount === 1 ? "" : "s"} saved on this preview.` : "Create one advisor account. It stays on this preview after a restart.",
      href: "/signup",
    },
    {
      id: "openai",
      label: "OpenAI connection",
      ready: openAiReady,
      detail: openAiReady ? "A key is saved. It is not shown here." : "Save the OpenAI key in Superadmin. Do not paste it into chat.",
      href: "/admin",
    },
    {
      id: "microsoft",
      label: "Microsoft app configuration",
      ready: Boolean(microsoft.configured),
      detail: microsoft.configured ? "The Microsoft app is saved. The secret is not shown." : "On the advisor desk, save the Microsoft app. Add this preview’s callback without removing the production one.",
      href: advisorCount > 0 ? "/login" : "/signup",
    },
    {
      id: "outlook",
      label: "Outlook sign-in",
      ready: outlookCount > 0,
      detail: outlookCount > 0 ? "Outlook calendar read is connected." : "After the Microsoft app is saved, open Calendar and use Sign in with Microsoft. Read-only.",
      href: advisorCount > 0 ? "/login" : "/signup",
    },
  ];
  return {
    storage: "preview-disk" as const,
    isolated: true,
    persists: true,
    markerAt: marker?.created_at ? new Date(marker.created_at).toISOString() : "",
    items,
  };
});
