const counts = { calendar: 0, contacts: 0, zoom: 0, files: 0, inbox: 0 };

export function noteLookup(kind: keyof typeof counts) {
  counts[kind] += 1;
}

export function readLookupLog() {
  return { ...counts };
}

export function resetLookupLog() {
  counts.calendar = 0;
  counts.contacts = 0;
  counts.zoom = 0;
  counts.files = 0;
  counts.inbox = 0;
}
