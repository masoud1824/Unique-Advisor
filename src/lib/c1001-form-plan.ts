import { factsFromFolder, type ClientRecord } from "./desk-workflows.ts";

export type FillLine = {
  label: string;
  field: string;
  value: string;
  status: "filled" | "left blank";
  source: string;
};

function sources(fact: { sources: Array<{ file: string; modified: string; value: string }> }) {
  return fact.sources.map((item) => `${item.file} (${item.modified || "date unknown"}): ${item.value}`).join("; ");
}

export function planC1001Fill(files: ClientRecord[]): FillLine[] {
  const name = factsFromFolder(files, "name");
  const email = factsFromFolder(files, "email");
  const city = factsFromFolder(files, "city");
  const province = factsFromFolder(files, "province");
  const policy = factsFromFolder(files, "policy number");
  const lines: FillLine[] = [];
  if (name.missing) {
    lines.push({ label: "First name", field: "3 First Name", value: "", status: "left blank", source: "No name line is in the test folder." });
    lines.push({ label: "Last name", field: "3 First Name 2", value: "", status: "left blank", source: "No name line is in the test folder." });
  } else if (name.conflict) {
    lines.push({ label: "First name", field: "3 First Name", value: "", status: "left blank", source: `Name conflicts: ${sources(name)}. I did not choose one.` });
    lines.push({ label: "Last name", field: "3 First Name 2", value: "", status: "left blank", source: `Name conflicts: ${sources(name)}. I did not choose one.` });
  } else {
    const parts = name.values[0].trim().split(/\s+/);
    const first = parts[0] || "";
    const last = parts.slice(1).join(" ");
    const source = sources(name);
    if (!last) {
      lines.push({ label: "First name", field: "3 First Name", value: "", status: "left blank", source: `${source}. The form has separate first and last name boxes, and this value is not split. I did not guess.` });
      lines.push({ label: "Last name", field: "3 First Name 2", value: "", status: "left blank", source: `${source}. The form has separate first and last name boxes, and this value is not split. I did not guess.` });
    } else {
      lines.push({ label: "First name", field: "3 First Name", value: first, status: "filled", source: `${source}. The file has one full name. The first word is written under the visible “First name” label.` });
      lines.push({ label: "Last name", field: "3 First Name 2", value: last, status: "filled", source: `${source}. The rest of that name is written under the visible “Last name” label. The box’s internal name is “3 First Name 2”.` });
    }
  }
  if (province.missing) {
    lines.push({ label: "Province", field: "Text Field 225", value: "", status: "left blank", source: "No province line is in the test folder." });
  } else if (province.conflict) {
    lines.push({ label: "Province", field: "Text Field 225", value: "", status: "left blank", source: `Province conflicts: ${sources(province)}. I did not choose one.` });
  } else {
    lines.push({ label: "Province", field: "Text Field 225", value: province.values[0], status: "filled", source: `${sources(province)}. Written in the box beside the visible “Province:” label on the residential address row.` });
  }
  lines.push({
    label: "City",
    field: "5 City 2",
    value: "",
    status: "left blank",
    source: city.conflict ? `City conflicts: ${sources(city)}. I did not choose one.` : city.missing ? "No city line is in the test folder." : sources(city),
  });
  lines.push({
    label: "Email",
    field: "",
    value: "",
    status: "left blank",
    source: email.missing
      ? "No email line is in the test folder."
      : `${sources(email)}. The email boxes on this form are labeled for an owner, and the file does not say Alex is the owner. I did not write it there, and I will not send to it.`,
  });
  lines.push({
    label: "Policy number",
    field: "Policy No 2",
    value: "",
    status: "left blank",
    source: policy.missing
      ? "No policy number is in the test folder."
      : `${sources(policy)}. The form’s “Policy no.” box is the carrier’s number for this application. The test note’s policy number was not mapped to it.`,
  });
  lines.push({ label: "SIN", field: "4 SIN 2", value: "", status: "left blank", source: "No SIN is in the test folder. I did not invent one." });
  lines.push({ label: "Street address", field: "5 Number and street  2", value: "", status: "left blank", source: "No street address is in the test folder." });
  lines.push({ label: "Postal code", field: "5 postal code 2", value: "", status: "left blank", source: "No postal code is in the test folder." });
  lines.push({ label: "Date of birth", field: "Insured name A date A", value: "", status: "left blank", source: "No date of birth is in the test folder." });
  lines.push({ label: "Signature", field: "", value: "", status: "left blank", source: "Signing was not requested. Signature placement stays closed, and no signature box was added." });
  return lines;
}
