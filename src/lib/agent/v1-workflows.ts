export function sharedAdvisorRunId(advisorId: string | number) {
  return `advisor:${advisorId}`;
}

export type WorkflowKind = "email" | "cards" | "newsletters" | "drips" | "dropbox" | "scheduling" | "morning" | "reviews";

export type WorkflowConnections = {
  mailbox: boolean;
  dropbox: boolean;
  calendar: boolean;
  zoom: boolean;
};

function requiredConnection(kind: WorkflowKind, connections: WorkflowConnections) {
  if (kind === "dropbox") return { ready: connections.dropbox, missing: "Dropbox" };
  if (kind === "scheduling") return { ready: connections.calendar || connections.zoom, missing: "Calendar or Zoom" };
  if (kind === "morning") {
    return {
      ready: connections.mailbox && (connections.calendar || connections.zoom),
      missing: "Microsoft or Google mailbox and Calendar or Zoom",
    };
  }
  return { ready: connections.mailbox, missing: "Microsoft or Google mailbox" };
}

export function runWorkflow(kind: WorkflowKind, connections: WorkflowConnections) {
  const required = requiredConnection(kind, connections);
  if (!required.ready) {
    return {
      implemented: true,
      connection: "missing" as const,
      performed: false,
      sent: false,
      booked: false,
      uploaded: false,
      notice: `${required.missing} is not connected for this advisor. The ${kind} workflow is implemented and did not run. Nothing was read, sent, booked, or uploaded.`,
    };
  }
  return {
    implemented: true,
    connection: "connected" as const,
    performed: false,
    sent: false,
    booked: false,
    uploaded: false,
    notice: `${kind} has a connection on file. Staging still does not read, send, book, or upload from this tool. Nothing was sent.`,
  };
}
