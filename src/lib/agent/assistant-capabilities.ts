/** What this preview actually does. Status is shown to the advisor and returned by the agent. */
export const ASSISTANT_NAME = "Unique Advisor AI Assistant";

export type CapabilityStatus = "testing" | "premium-deferred" | "connection-required" | "not-connected";

export type AssistantCapability = {
  id: string;
  label: string;
  status: CapabilityStatus;
  note: string;
};

export const ASSISTANT_CAPABILITIES: AssistantCapability[] = [
  {
    id: "forms-lookup",
    label: "Find a form in Useful Links",
    status: "testing",
    note: "Checks the advisor's saved links first. A wider search waits for an explicit yes.",
  },
  {
    id: "equitable-671bcf",
    label: "Fill a form",
    status: "premium-deferred",
    note: "Form filling, including the Equitable 671BCF mapping, is kept in the product but turned off for v1. It is reserved for a later premium package. Nothing is filled.",
  },
  {
    id: "other-provider-forms",
    label: "Fill forms for other providers",
    status: "premium-deferred",
    note: "Other insurer field mappings are not in v1. A found link can be shown, and nothing is filled.",
  },
  {
    id: "email",
    label: "Read mail and draft replies",
    status: "not-connected",
    note: "Desk can prepare an email draft for approval. Live mailbox reading is not implemented, and no mailbox is connected. Nothing is read or sent.",
  },
  {
    id: "cards",
    label: "Personalized cards",
    status: "not-connected",
    note: "Desk can prepare a card for approval. Live delivery is not implemented, and no mailbox is connected. No card is sent.",
  },
  {
    id: "newsletters",
    label: "Newsletters and e-letters",
    status: "not-connected",
    note: "Desk can prepare a newsletter for approval. Live delivery is not implemented, and no mailbox is connected. Nothing is sent.",
  },
  {
    id: "drips",
    label: "Scheduled drip campaigns",
    status: "not-connected",
    note: "Desk can prepare a drip for approval. Live campaign sending is not implemented, and no mailbox is connected. Nothing is scheduled or sent.",
  },
  {
    id: "dropbox-search",
    label: "Dropbox client search",
    status: "not-connected",
    note: "Desk can list files when a connection exists. Dropbox search is not implemented on staging, and Dropbox is not connected. Nothing was uploaded.",
  },
  {
    id: "scheduling",
    label: "Calendar, Zoom, and in-person meetings",
    status: "not-connected",
    note: "Desk can prepare a meeting for approval. Live booking is not implemented, and Calendar and Zoom are not connected. Nothing is booked.",
  },
  {
    id: "morning",
    label: "Morning briefing and meeting follow-up",
    status: "not-connected",
    note: "A briefing needs a mailbox and a calendar. Those live reads are not implemented, and neither is connected. Nothing was invented.",
  },
  {
    id: "client-reviews",
    label: "Client reviews",
    status: "not-connected",
    note: "Client reviews are not implemented. No mailbox is connected, and no review was created.",
  },
  {
    id: "approved-save",
    label: "Approved file save",
    status: "premium-deferred",
    note: "Saving a filled form waits with form filling. Dropbox upload is not performed.",
  },
];

export function capabilityNote(id: string) {
  return ASSISTANT_CAPABILITIES.find((item) => item.id === id)?.note || "That capability is not available in this preview.";
}
