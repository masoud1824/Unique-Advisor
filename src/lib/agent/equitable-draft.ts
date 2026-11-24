import { PDFCheckBox, PDFDocument, PDFTextField } from "pdf-lib";
import { pdfAssignments, SIGNATURE_FIELDS, type DraftFacts } from "./equitable-fields.ts";

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

/** Fill the verified 671BCF mapping. Signature fields stay blank. Nothing is uploaded. */
export async function fillMappedDraft(bytes: Uint8Array, facts: DraftFacts) {
  const plan = pdfAssignments(facts);
  const pdf = await PDFDocument.load(bytes);
  const form = pdf.getForm();
  const names = new Set(form.getFields().map((field) => field.getName()));
  for (const name of Object.keys(plan.text)) {
    if (!names.has(name)) throw new Error(`The Equitable form has no field ${name}.`);
    const field = form.getField(name);
    if (!(field instanceof PDFTextField)) throw new Error(`The Equitable field ${name} is not text.`);
    field.setText(plan.text[name]);
  }
  for (const name of plan.checks) {
    if (!names.has(name)) throw new Error(`The Equitable form has no field ${name}.`);
    const field = form.getField(name);
    if (!(field instanceof PDFCheckBox)) throw new Error(`The Equitable field ${name} is not a checkbox.`);
    field.check();
  }
  const saved = await pdf.save();
  const check = await PDFDocument.load(saved);
  const readBack: Record<string, string> = {};
  for (const name of Object.keys(plan.text)) readBack[name] = check.getForm().getTextField(name).getText() || "";
  const signatures: Record<string, string> = {};
  for (const name of SIGNATURE_FIELDS) signatures[name] = check.getForm().getTextField(name).getText() || "";
  if (Object.values(signatures).some((value) => value.trim())) throw new Error("A signature field was filled.");
  return {
    bytes: saved,
    readBack,
    signatures,
    checks: plan.checks,
    unsigned: true as const,
    uploaded: false as const,
  };
}
