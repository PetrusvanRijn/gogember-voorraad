export const COOKIE_NAME = "gg_session";

const TOKEN_MESSAGE = "gogember-voorraad.v1";

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sessionToken(password: string): Promise<string> {
  const encoded = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoded.encode(password),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoded.encode(TOKEN_MESSAGE));
  return toHex(signature);
}

function sameHex(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export async function tokensEqual(submitted: string, expected: string): Promise<boolean> {
  if (!expected || submitted.length > 256) return false;
  const [left, right] = await Promise.all([sessionToken(submitted), sessionToken(expected)]);
  return sameHex(left, right);
}

export async function cookieMatches(cookie: string | undefined, password: string | undefined): Promise<boolean> {
  if (!cookie || !password) return false;
  const expected = await sessionToken(password);
  return sameHex(cookie, expected);
}

export function safeNextPath(raw: string): string {
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/login")) return "/";
  return raw;
}
