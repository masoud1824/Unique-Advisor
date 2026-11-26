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
    status: "connection-required",
    note: "Desk preparation exists. No Microsoft or Google mailbox is connected, so nothing is read or sent.",
  },
  {
    id: "cards",
    label: "Personalized cards",
    status: "connection-required",
    note: "Desk preparation exists. Card delivery needs a connected mailbox, so no card is sent.",
  },
  {
    id: "newsletters",
    label: "Newsletters and e-letters",
    status: "connection-required",
    note: "Desk preparation exists. Newsletter delivery needs a connected mailbox, so nothing is sent.",
  },
  {
    id: "drips",
    label: "Scheduled drip campaigns",
    status: "connection-required",
    note: "Desk preparation exists. A drip stops on unsubscribe or reply, but no campaign mailbox is connected. Nothing is scheduled or sent.",
  },
  {
    id: "dropbox-search",
    label: "Dropbox client search",
    status: "connection-required",
    note: "Desk file listing exists. Dropbox is not connected, so no client files were searched.",
  },
  {
    id: "scheduling",
    label: "Calendar, Zoom, and in-person meetings",
    status: "connection-required",
    note: "Desk meeting tools exist. Calendar and Zoom are not connected, so nothing is booked and no notice is sent.",
  },
  {
    id: "morning",
    label: "Morning briefing and meeting follow-up",
    status: "connection-required",
    note: "A briefing needs the mailbox and calendar. Neither is connected, so nothing was invented.",
  },
  {
    id: "client-reviews",
    label: "Client reviews",
    status: "connection-required",
    note: "Desk review tools exist. No mailbox is connected, so no review was created.",
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
