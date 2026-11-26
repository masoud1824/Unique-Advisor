import { readDropbox, readZoom } from "./advisor-links.ts";
import { connectionSetupBlocked } from "./isolated-test-desk.ts";
import { accessTokenForAdvisor, graphInbox } from "./microsoft-mail.ts";

export type ProviderReadKind = "inbox" | "dropbox" | "zoom";

/** The isolated test copy stays closed. Staging may list mail, files, and meetings. */
export function providerReadBlocked() {
  return connectionSetupBlocked();
}

const CLOSED = "This isolated test copy did not contact the provider. Nothing was sent, booked, or uploaded.";

export async function readConnectedPreview(advisorId: number, kind: ProviderReadKind) {
  if (providerReadBlocked()) return CLOSED;
  if (kind === "inbox") return readInbox(advisorId);
  if (kind === "dropbox") return readFiles(advisorId);
  return readMeetings(advisorId);
}

async function readInbox(advisorId: number) {
  try {
    const token = await accessTokenForAdvisor(advisorId);
    const box = await graphInbox(token);
    if (!box.ok) return `${box.error}\nNothing was sent.`;
    const lines = box.messages.map((item) => `- ${item.from}: ${item.subject}${item.preview ? ` — ${item.preview}` : ""}`);
    return `Latest inbox mail:\n${lines.join("\n") || "The inbox is empty."}\nNothing was sent.`;
  } catch (error) {
    const message = error instanceof Error ? error.message : "The mailbox could not be read.";
    return `${message}\nNothing was sent.`;
  }
}

async function readFiles(advisorId: number) {
  try {
    const folder = await readDropbox(advisorId);
    if (!folder.connected) return `${folder.error || "Dropbox is not connected."}\nNothing was uploaded.`;
    if (folder.error) return `${folder.error}\nNothing was uploaded.`;
    const files: unknown[] = Array.isArray(folder.files) ? folder.files : [];
    const names = files.filter((name): name is string => typeof name === "string" && name.length > 0);
    return `Dropbox files:\n${names.map((name) => `- ${name}`).join("\n") || "That folder is empty."}\nNothing was uploaded.`;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Dropbox could not be read.";
    return `${message}\nNothing was uploaded.`;
  }
}

async function readMeetings(advisorId: number) {
  try {
    const zoom = await readZoom(advisorId);
    if (!zoom.connected) return `${zoom.error || "Zoom is not signed in."}\nNothing was booked.`;
    if (zoom.error) return `${zoom.error}\nNothing was booked.`;
    const lines = (zoom.meetings || []).map((meeting: { topic?: string; start?: string }) => `- ${meeting.topic || "Meeting"}${meeting.start ? ` — ${meeting.start}` : ""}`);
    return `Upcoming Zoom meetings:\n${lines.join("\n") || "Zoom did not return any upcoming meetings."}\nNothing was booked.`;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Zoom could not be read.";
    return `${message}\nNothing was booked.`;
  }
}
