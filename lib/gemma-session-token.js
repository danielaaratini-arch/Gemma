import { createHmac, timingSafeEqual } from "node:crypto";

export const GEMMA_AUTH_COOKIE = "gemma_auth";
export const GEMMA_AUTH_SESSION_SECONDS = 60 * 60 * 8;

function secret() {
  const value = process.env.GEMMA_AUTH_SECRET?.trim();
  if (!value) throw new Error("GEMMA_AUTH_SECRET non configurato.");
  return value;
}

function sign(value) {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

function safeEqual(left, right) {
  try {
    const a = Buffer.from(String(left || ""));
    const b = Buffer.from(String(right || ""));
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function authCookieForUser(user) {
  const payload = {
    uid: user.id,
    role: user.role,
    email: user.email,
    name: user.name,
    exp:
      Math.floor(Date.now() / 1000) +
      GEMMA_AUTH_SESSION_SECONDS,
  };

  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const token = encoded + "." + sign(encoded);

  return [
    GEMMA_AUTH_COOKIE + "=" + encodeURIComponent(token),
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=" + GEMMA_AUTH_SESSION_SECONDS,
    process.env.VERCEL ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

export function clearAuthCookie() {
  return [
    GEMMA_AUTH_COOKIE + "=",
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    process.env.VERCEL ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

export function readAuthSession(request) {
  const token = request?.cookies?.get?.(GEMMA_AUTH_COOKIE)?.value;
  if (!token) return null;

  try {
    const [encoded, signature] = token.split(".");
    if (!encoded || !signature || !safeEqual(sign(encoded), signature)) {
      return null;
    }

    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    );

    if (
      !payload?.uid ||
      !payload?.role ||
      !payload?.exp ||
      Number(payload.exp) < Math.floor(Date.now() / 1000)
    ) {
      return null;
    }

    return {
      id: String(payload.uid),
      role: String(payload.role),
      email: String(payload.email || ""),
      name: String(payload.name || ""),
    };
  } catch {
    return null;
  }
}

export function userCustomerKey(user) {
  return "user:" + String(user?.id || "");
}
