/** What this preview actually does. Status is shown to the advisor and returned by the agent. */
export const ASSISTANT_NAME = "Unique Advisor AI Assistant";

export type CapabilityStatus = "testing" | "premium-deferred" | "not-connected";

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
    note: "In the v1 plan, but no Microsoft or Google mailbox is connected for this advisor. Nothing is read or sent.",
  },
  {
    id: "cards",
    label: "Personalized cards",
    status: "not-connected",
    note: "In the v1 plan. Card delivery is not connected, so no card is sent.",
  },
  {
    id: "newsletters",
    label: "Newsletters and e-letters",
    status: "not-connected",
    note: "In the v1 plan. Newsletter delivery is not connected, so nothing is sent.",
  },
  {
    id: "drips",
    label: "Scheduled drip campaigns",
    status: "not-connected",
    note: "In the v1 plan. A drip would stop on unsubscribe or reply, but no campaign sender is connected. Nothing is scheduled or sent.",
  },
  {
    id: "dropbox-search",
    label: "Dropbox client search",
    status: "not-connected",
    note: "In the v1 plan. Dropbox is not connected, so no client files were searched and no contact list was produced.",
  },
  {
    id: "scheduling",
    label: "Calendar, Zoom, and in-person meetings",
    status: "not-connected",
    note: "In the v1 plan. Calendar and Zoom are not connected, so nothing is booked and no notice is sent.",
  },
  {
    id: "morning",
    label: "Morning briefing and meeting follow-up",
    status: "not-connected",
    note: "In the v1 plan. It needs the mailbox, calendar, and client files before it can brief you. Nothing was invented.",
  },
  {
    id: "client-reviews",
    label: "Client reviews",
    status: "not-connected",
    note: "Not part of the connected v1 tools yet. No review was created.",
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
