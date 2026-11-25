/** What this preview actually does. Status is shown to the advisor and returned by the agent. */
export const ASSISTANT_NAME = "Unique Advisor AI Assistant";

export type CapabilityStatus = "testing" | "not-available";

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
    label: "Prepare one Equitable Life form",
    status: "testing",
    note: "671BCF beneficiary change is the only provider mapping. Missing beneficiary details are asked, not invented. Signatures stay blank.",
  },
  {
    id: "other-provider-forms",
    label: "Fill forms for other providers",
    status: "not-available",
    note: "Other insurer field mappings are not implemented. A found link can be shown, and nothing is filled.",
  },
  {
    id: "client-reviews",
    label: "Client reviews",
    status: "not-available",
    note: "Client reviews are not available in this preview.",
  },
  {
    id: "newsletters",
    label: "Newsletters",
    status: "not-available",
    note: "Newsletters are not available in this preview.",
  },
  {
    id: "scheduling",
    label: "Scheduling",
    status: "not-available",
    note: "Scheduling is not available in this preview. Nothing is booked.",
  },
  {
    id: "approved-save",
    label: "Approved file save",
    status: "testing",
    note: "A save can be proposed and approved. Dropbox upload is not performed.",
  },
];

export function capabilityNote(id: string) {
  return ASSISTANT_CAPABILITIES.find((item) => item.id === id)?.note || "That capability is not available in this preview.";
}
