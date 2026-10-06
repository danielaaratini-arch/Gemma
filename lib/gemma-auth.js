import {
  createHmac,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import postgres from "postgres";
import { ensureGemmaSchema } from "./gemma-store";

const COOKIE_NAME = "gemma_auth";
const SESSION_SECONDS = 60 * 60 * 8;

function database() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL non configurata.");
  return postgres(url, {
    max: 2,
    idle_timeout: 8,
    connect_timeout: 7,
    prepare: false,
  });
}

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
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function hashPassword(password) {
  const value = String(password || "");
  if (value.length < 8) {
    throw new Error("La password deve contenere almeno 8 caratteri.");
  }

  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(value, salt, 64).toString("hex");
  return salt + ":" + hash;
}

export function verifyPassword(password, stored) {
  try {
    const parts = String(stored || "").split(":");
    const salt = parts[0];
    const expectedHex = parts[1];
    if (!salt || !expectedHex) return false;
    const expected = Buffer.from(expectedHex, "hex");
    const actual = scryptSync(String(password || ""), salt, expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
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
    exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS,
  };

  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const token = encoded + "." + sign(encoded);

  return [
    COOKIE_NAME + "=" + encodeURIComponent(token),
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=" + SESSION_SECONDS,
    process.env.VERCEL ? "Secure" : "",
  ].filter(Boolean).join("; ");
}

export function clearAuthCookie() {
  return [
    COOKIE_NAME + "=",
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    process.env.VERCEL ? "Secure" : "",
  ].filter(Boolean).join("; ");
}

export function readAuthSession(request) {
  const token = request?.cookies?.get?.(COOKIE_NAME)?.value;
  if (!token) return null;

  try {
    const parts = token.split(".");
    const encoded = parts[0];
    const signature = parts[1];

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
      payload.exp < Math.floor(Date.now() / 1000)
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
  return "user:" + user.id;
}

export function requireRole(request, roles) {
  const user = readAuthSession(request);
  if (!user || !roles.includes(user.role)) return null;
  return user;
}

export async function adminExists() {
  await ensureGemmaSchema();
  const sql = database();

  try {
    const rows = await sql.unsafe(
      "SELECT EXISTS(SELECT 1 FROM gemma.user_account WHERE role = 'ADMIN' AND active = true) AS exists",
    );
    return rows[0]?.exists === true;
  } finally {
    await sql.end({ timeout: 1 }).catch(() => {});
  }
}

export async function createUser({ email, name, password, role = "CUSTOMER" }) {
  await ensureGemmaSchema();
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedName = String(name || "").trim().slice(0, 120);

  if (!normalizedEmail || !normalizedEmail.includes("@")) {
    throw new Error("Inserisci un indirizzo email valido.");
  }

  if (!["CUSTOMER", "OPERATOR", "ADMIN"].includes(role)) {
    throw new Error("Ruolo non valido.");
  }

  const sql = database();
  const id = randomUUID();
  const passwordHash = hashPassword(password);

  try {
    const rows = await sql.unsafe(
      "INSERT INTO gemma.user_account (id, email, name, password_hash, role, active) VALUES ($1,$2,$3,$4,$5,true) RETURNING id,email,name,role,active,created_at",
      [
        id,
        normalizedEmail,
        normalizedName || normalizedEmail.split("@")[0],
        passwordHash,
        role,
      ],
    );
    return rows[0];
  } catch (error) {
    if (String(error?.code) === "23505") {
      throw new Error("Esiste già un account con questa email.");
    }
    throw error;
  } finally {
    await sql.end({ timeout: 1 }).catch(() => {});
  }
}

export async function authenticateUser({ email, password, mode }) {
  await ensureGemmaSchema();
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const sql = database();

  try {
    const rows = await sql.unsafe(
      "SELECT id,email,name,role,active,password_hash FROM gemma.user_account WHERE email = $1 LIMIT 1",
      [normalizedEmail],
    );
    const user = rows[0];

    if (!user || !user.active || !verifyPassword(password, user.password_hash)) {
      return null;
    }

    if (mode === "CUSTOMER" && user.role !== "CUSTOMER") return null;
    if (mode === "ADMIN" && user.role !== "ADMIN") return null;

    if (
      mode === "STAFF" &&
      user.role !== "ADMIN" &&
      user.role !== "OPERATOR"
    ) {
      return null;
    }

    await sql.unsafe(
      "UPDATE gemma.user_account SET last_login_at = now() WHERE id = $1",
      [user.id],
    );

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    };
  } finally {
    await sql.end({ timeout: 1 }).catch(() => {});
  }
}

export async function listStaffUsers() {
  await ensureGemmaSchema();
  const sql = database();

  try {
    return await sql.unsafe(
      "SELECT id,email,name,role,active,created_at,last_login_at FROM gemma.user_account WHERE role IN ('ADMIN','OPERATOR') ORDER BY role ASC, name ASC",
    );
  } finally {
    await sql.end({ timeout: 1 }).catch(() => {});
  }
}
