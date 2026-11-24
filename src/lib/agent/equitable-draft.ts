import { PDFDocument } from "pdf-lib";

export type EquitableFacts = {
  owner: string;
  policyNumber: string;
  email: string;
  address: string;
  phone: string;
};

const FILLED_FIELDS: Array<[keyof EquitableFacts, string]> = [
  ["owner", "Policy Owner Name first middle last"],
  ["policyNumber", "Policy Number"],
  ["email", "Email Address of Policy Owner"],
  ["address", "Address"],
  ["phone", "Phone Number"],
];

/** Fill only fields that match the supplied facts. This does not upload or sign. */
export async function fillEquitableDraft(bytes: Uint8Array, facts: EquitableFacts) {
  const pdf = await PDFDocument.load(bytes);
  const form = pdf.getForm();
  const names = new Set(form.getFields().map((field) => field.getName()));
  const filled: string[] = [];
  for (const [key, name] of FILLED_FIELDS) {
    if (!names.has(name)) throw new Error(`The Equitable form has no field ${name}.`);
    form.getTextField(name).setText(facts[key]);
    filled.push(name);
  }
  const saved = await pdf.save();
  const check = await PDFDocument.load(saved);
  const readBack = check.getForm().getTextField("Policy Number").getText();
  return {
    pages: pdf.getPageCount(),
    fieldCount: names.size,
    filled,
    leftBlank: [...names].filter((name) => !filled.includes(name)),
    bytes: saved.byteLength,
    policyReadBack: readBack,
    uploaded: false as const,
  };
}
