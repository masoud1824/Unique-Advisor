import { createServerFn } from "@tanstack/react-start";
import { gateAdvisor } from "@/lib/advisor-db";
import { getSql } from "@/lib/db";
import { DOCUMENT_MAIL, documentMailPreview, MAIL_MONITORING } from "@/lib/document-mail";
import { selectedMailAttachment, startDocumentMailWatch } from "@/lib/document-mail-live";
import { graphMe, microsoftAppStatus } from "@/lib/microsoft-mail";
import { accessTokenForAdvisor } from "@/lib/microsoft-mail";
import { storedAdvisorLink, storedMailboxLink } from "@/lib/advisor-links";
import { externalSideEffectsBlocked, isolatedProviderNotice } from "@/lib/isolated-test-desk";

const SETUP = [
  "Open this advisor's desk, then Settings, and press Connect Microsoft Email.",
  "Sign in to the mailbox that should send. Do not use another advisor's connection.",
  "Accept Mail.Send, Mail.Read, and offline access.",
  "The Microsoft app is already saved in this preview. If Microsoft rejects the return address, add this preview's exact /api/microsoft/callback address in Entra.",
  "This preview's Microsoft send function refuses to send while the local preview database is in use. Connecting the mailbox does not remove that block.",
];

export const loadDocumentMailPreview = createServerFn({ method: "POST" }).validator((input: unknown) => input).handler(async ({ data }) => {
  const body = data as { slug?: string; code?: string };
  const gate = await gateAdvisor(body.slug || "", body.code || "");
  if (!gate.ok) return gate;
  if (externalSideEffectsBlocked()) {
    const mailbox = await storedMailboxLink(gate.row.id);
    const dropbox = await storedAdvisorLink(gate.row.id, "dropbox");
    return {
      ok: false as const,
      sent: false as const,
      isolated: true as const,
      preserved: mailbox === true || dropbox === true,
      sender: "",
      recipient: "",
      subject: "",
      body: "",
      error: `${isolatedProviderNotice("mailbox", mailbox)} ${isolatedProviderNotice("dropbox", dropbox)}`,
    };
  }
  startDocumentMailWatch();
  const attachment = await selectedMailAttachment(gate.row.id);
  if (!attachment.ok) return { ...attachment, sent: false as const };
  const row = (await (await getSql())<{ ms_refresh: string }>`select ms_refresh from advisors where id = ${gate.row.id}`)[0];
  const app = await microsoftAppStatus();
  if (!row?.ms_refresh) {
    return {
      ok: false as const,
      sent: false as const,
      sender: "",
      recipient: DOCUMENT_MAIL.recipient,
      subject: DOCUMENT_MAIL.subject,
      body: DOCUMENT_MAIL.body,
      attachment,
      monitoring: MAIL_MONITORING,
      appConfigured: app.configured,
      setup: SETUP,
      error: "This advisor has no connected mailbox. Nothing was sent.",
    };
  }
  try {
    const token = await accessTokenForAdvisor(gate.row.id);
    const me = await graphMe(token);
    const preview = documentMailPreview({ sender: me.email, attachment });
    return { ...preview, sent: false as const, sender: me.email, attachment, monitoring: MAIL_MONITORING };
  } catch (error) {
    return {
      ok: false as const,
      sent: false as const,
      error: error instanceof Error ? error.message : "This advisor's mailbox could not be opened.",
      setup: SETUP,
      attachment,
      recipient: DOCUMENT_MAIL.recipient,
      subject: DOCUMENT_MAIL.subject,
      body: DOCUMENT_MAIL.body,
      monitoring: MAIL_MONITORING,
    };
  }
});
