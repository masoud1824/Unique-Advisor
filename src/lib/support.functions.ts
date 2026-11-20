import { createServerFn } from "@tanstack/react-start";
import { gateAdvisor, gateOperator } from "@/lib/advisor-db";
import {
  advisorReply,
  cleanFiles,
  createTicket,
  findTicketByNumber,
  issueSupportApiKey,
  listAdvisorTickets,
  listAllTickets,
  openTicketCount,
  readAdvisorTicket,
  readAnyTicket,
  readSupportFile,
  readSupportSettings,
  staffNote,
  staffReply,
  staffUpdate,
  writeSupportSettings,
} from "@/lib/support";

export const loadMyTickets = createServerFn({ method: "POST" })
  .validator((input: { slug?: string; code?: string }) => input)
  .handler(async ({ data }) => {
    const gate = await gateAdvisor(data.slug || "", data.code || "");
    if (!gate.ok) return gate;
    return { ok: true as const, tickets: await listAdvisorTickets(gate.row.id) };
  });

export const openMyTicket = createServerFn({ method: "POST" })
  .validator((input: { slug?: string; code?: string; subject?: string; category?: string; priority?: string; description?: string; files?: unknown }) => input)
  .handler(async ({ data }) => {
    const gate = await gateAdvisor(data.slug || "", data.code || "");
    if (!gate.ok) return gate;
    return createTicket(gate.row.id, {
      subject: String(data.subject ?? ""),
      category: String(data.category ?? ""),
      priority: String(data.priority ?? ""),
      description: String(data.description ?? ""),
      files: cleanFiles(data.files),
    });
  });

export const readMyTicket = createServerFn({ method: "POST" })
  .validator((input: { slug?: string; code?: string; id?: number }) => input)
  .handler(async ({ data }) => {
    const gate = await gateAdvisor(data.slug || "", data.code || "");
    if (!gate.ok) return gate;
    return readAdvisorTicket(gate.row.id, Number(data.id));
  });

export const replyMyTicket = createServerFn({ method: "POST" })
  .validator((input: { slug?: string; code?: string; id?: number; body?: string; files?: unknown }) => input)
  .handler(async ({ data }) => {
    const gate = await gateAdvisor(data.slug || "", data.code || "");
    if (!gate.ok) return gate;
    return advisorReply(gate.row.id, Number(data.id), String(data.body ?? ""), cleanFiles(data.files));
  });

export const downloadMyFile = createServerFn({ method: "POST" })
  .validator((input: { slug?: string; code?: string; ticketId?: number; fileId?: number }) => input)
  .handler(async ({ data }) => {
    const gate = await gateAdvisor(data.slug || "", data.code || "");
    if (!gate.ok) return gate;
    const file = await readSupportFile(Number(data.ticketId), Number(data.fileId), gate.row.id);
    if (!file) return { ok: false as const, error: "That file was not found." };
    return { ok: true as const, name: file.name, data: file.data };
  });

export const loadSupportDesk = createServerFn({ method: "POST" })
  .validator((input: { code?: string; status?: string; priority?: string; category?: string; advisor?: string; search?: string }) => input)
  .handler(async ({ data }) => {
    const gate = await gateOperator(data.code || "");
    if (!gate.ok) return gate;
    return {
      ok: true as const,
      open: await openTicketCount(),
      tickets: await listAllTickets(data),
      settings: await readSupportSettings(),
    };
  });

export const readStaffTicket = createServerFn({ method: "POST" })
  .validator((input: { code?: string; id?: number; number?: string }) => input)
  .handler(async ({ data }) => {
    const gate = await gateOperator(data.code || "");
    if (!gate.ok) return gate;
    const id = Number(data.id) || (data.number ? await findTicketByNumber(String(data.number)) : 0);
    return readAnyTicket(id);
  });

export const replyStaffTicket = createServerFn({ method: "POST" })
  .validator((input: { code?: string; id?: number; body?: string }) => input)
  .handler(async ({ data }) => {
    const gate = await gateOperator(data.code || "");
    if (!gate.ok) return gate;
    return staffReply(Number(data.id), String(data.body ?? ""));
  });

export const noteStaffTicket = createServerFn({ method: "POST" })
  .validator((input: { code?: string; id?: number; body?: string }) => input)
  .handler(async ({ data }) => {
    const gate = await gateOperator(data.code || "");
    if (!gate.ok) return gate;
    return staffNote(Number(data.id), String(data.body ?? ""));
  });

export const updateStaffTicket = createServerFn({ method: "POST" })
  .validator((input: { code?: string; id?: number; status?: string; priority?: string; assignee?: string }) => input)
  .handler(async ({ data }) => {
    const gate = await gateOperator(data.code || "");
    if (!gate.ok) return gate;
    return staffUpdate(Number(data.id), data);
  });

export const downloadStaffFile = createServerFn({ method: "POST" })
  .validator((input: { code?: string; ticketId?: number; fileId?: number }) => input)
  .handler(async ({ data }) => {
    const gate = await gateOperator(data.code || "");
    if (!gate.ok) return gate;
    const file = await readSupportFile(Number(data.ticketId), Number(data.fileId));
    if (!file) return { ok: false as const, error: "That file was not found." };
    return { ok: true as const, name: file.name, data: file.data };
  });

export const saveSupportSettings = createServerFn({ method: "POST" })
  .validator((input: { code?: string; email?: string; webhook?: string; webhookSecret?: string }) => input)
  .handler(async ({ data }) => {
    const gate = await gateOperator(data.code || "");
    if (!gate.ok) return gate;
    return { ok: true as const, settings: await writeSupportSettings(data) };
  });

export const createSupportApiKey = createServerFn({ method: "POST" })
  .validator((input: { code?: string }) => input)
  .handler(async ({ data }) => {
    const gate = await gateOperator(data.code || "");
    if (!gate.ok) return gate;
    return { ok: true as const, key: await issueSupportApiKey() };
  });
