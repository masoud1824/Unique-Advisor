/** Chat previews stay on the message that created them. A later cancel or revision does not delete that preview, and it cannot be sent. */

export type ChatPreviewRow = {
  id: number;
  messageId: number;
  kind: string;
  status: string;
  summary?: string;
  preview?: string;
  previewHtml?: string;
  previewImage?: string;
  canSend?: boolean;
};

type Sql = {
  query: <T = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<T[]>;
};

export function previewCanSend(action: { status?: string; kind?: string; canSend?: boolean }) {
  if (action.canSend === false) return false;
  const kind = String(action.kind || "");
  if (kind.endsWith("-preview")) return false;
  const status = String(action.status || "pending");
  return status === "pending";
}

export function previewTitle(kind: string) {
  if (kind === "card" || kind === "card-preview") return "E-card preview";
  if (kind === "eletter" || kind === "eletter-preview") return "E-letter preview";
  if (kind === "newsletter" || kind === "newsletter-preview") return "Newsletter preview";
  if (kind === "campaign" || kind === "campaign-preview") return "Campaign preview";
  if (kind === "signature") return "Signature preview";
  return "Waiting for approval";
}

export function approveLabel(kind: string) {
  if (kind === "campaign") return "Run the campaign";
  if (kind === "signature" || kind === "card" || kind === "eletter" || kind === "newsletter") return "Approve and send";
  return "Approve";
}

/** The tray may offer a row only when it is still sendable and not already attached to a message. */
export function trayOffers(action: { id?: number; status?: string; kind?: string; canSend?: boolean }, linkedIds: ReadonlySet<number> | number[]) {
  const linked = linkedIds instanceof Set ? linkedIds : new Set(linkedIds);
  if (linked.has(Number(action.id))) return false;
  return previewCanSend(action);
}

export function attachPreviews<M extends { id?: number }>(messages: M[], actions: ChatPreviewRow[]) {
  return messages.map((message) => ({
    ...message,
    previews: actions
      .filter((action) => Number(action.messageId) > 0 && Number(action.messageId) === Number(message.id))
      .map((action) => ({ ...action, canSend: action.canSend === false ? false : previewCanSend(action) })),
  }));
}

export async function ensurePreviewColumns(sql: Sql) {
  await sql.query("alter table assistant_actions add column if not exists chat_id integer");
  await sql.query("alter table assistant_actions add column if not exists message_id integer");
}

/** Links a new action to this chat message. An already linked preview is left on its original message. */
export async function bindPreviewMessages(sql: Sql, advisorId: number, chatId: number, messageId: number, actionIds: number[]) {
  if (!(advisorId > 0) || !(chatId > 0) || !(messageId > 0)) return;
  await ensurePreviewColumns(sql);
  for (const id of actionIds) {
    if (!(Number(id) > 0)) continue;
    await sql.query(
      "update assistant_actions set chat_id = $1, message_id = $2 where id = $3 and advisor_id = $4 and coalesce(message_id, 0) = 0",
      [chatId, messageId, Number(id), advisorId],
    );
  }
}

export async function readChatPreviewRows(sql: Sql, advisorId: number, chatId: number) {
  await ensurePreviewColumns(sql);
  return sql.query<Record<string, unknown>>(
    "select id, kind, summary, payload, status, message_id from assistant_actions where advisor_id = $1 and chat_id = $2 and message_id is not null order by id",
    [advisorId, chatId],
  );
}

function escapeBoard(value: string) {
  const amp = String.fromCharCode(38);
  return String(value || "")
    .replace(/&/g, `${amp}amp;`)
    .replace(/</g, `${amp}lt;`)
    .replace(/>/g, `${amp}gt;`)
    .replace(/"/g, `${amp}quot;`);
}

export function previewMarkup(action: { id: number; kind: string; summary: string; status?: string; canSend?: boolean }) {
  const sendable = previewCanSend(action);
  const historical = Boolean(action.status && action.status !== "pending");
  const status = escapeBoard(action.status || "pending");
  return [
    `<article class="ua-mail-preview" data-preview-id="${Number(action.id)}" data-can-send="${sendable ? "yes" : "no"}" data-preview-status="${status}">`,
    `<p>${escapeBoard(previewTitle(action.kind))}</p>`,
    `<p>${escapeBoard(action.summary)}</p>`,
    historical ? "<p>Earlier preview kept with this message. Nothing can be sent from it.</p>" : "",
    sendable ? `<button type="button">${escapeBoard(approveLabel(action.kind))}</button>` : "",
    "</article>",
  ].filter(Boolean).join("");
}

/** Isolated board used by the UI test. The desk uses the same send rule, title, and historical sentence. */
export function previewBoardHtml(input: {
  turns: Array<{ id: number; role?: string; content: string; previews?: Array<{ id: number; kind: string; summary: string; status?: string; canSend?: boolean }> }>;
  tray?: Array<{ id: number; kind: string; summary: string; status?: string; canSend?: boolean }>;
}) {
  const linked = new Set(input.turns.flatMap((turn) => (turn.previews || []).map((preview) => Number(preview.id))));
  const turns = input.turns.map((turn) => {
    const previews = (turn.previews || []).map((preview) => previewMarkup(preview)).join("");
    return `<section data-message-id="${Number(turn.id)}"><p>${escapeBoard(turn.content)}</p>${previews}</section>`;
  }).join("");
  const tray = (input.tray || []).filter((item) => trayOffers(item, linked)).map((item) => previewMarkup(item)).join("");
  return `<!DOCTYPE html><html><body>${turns}<div data-preview-tray>${tray}</div></body></html>`;
}
