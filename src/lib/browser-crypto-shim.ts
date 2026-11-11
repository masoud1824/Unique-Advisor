// Dev-preview stand-in for node:crypto. The desk client imports server modules
// that mention these names; Vite's default browser shim throws on import and
// the page never hydrates. The real server keeps Node's crypto. Calling any of
// these in the browser is a mistake and throws.
function serverOnly(name: string): never {
  throw new Error(`${name} is only available on the server.`);
}

export function createHash(): never {
  return serverOnly("createHash");
}
export function createHmac(): never {
  return serverOnly("createHmac");
}
export function createCipheriv(): never {
  return serverOnly("createCipheriv");
}
export function createDecipheriv(): never {
  return serverOnly("createDecipheriv");
}
export function randomBytes(): never {
  return serverOnly("randomBytes");
}
export function timingSafeEqual(): never {
  return serverOnly("timingSafeEqual");
}
export function generateKeyPairSync(): never {
  return serverOnly("generateKeyPairSync");
}

const cryptoShim = { createHash, createHmac, createCipheriv, createDecipheriv, randomBytes, timingSafeEqual, generateKeyPairSync };
export default cryptoShim;
