import {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { operationalDb } from "./db";
import { ensureGemmaSchema } from "./gemma-store";
import {
  authCookieForUser,
  clearAuthCookie,
  readAuthSession,
  userCustomerKey,
} from "./gemma-session-token";

function database() {
  const sql = operationalDb();
  if (!sql) throw new Error("DATABASE_URL non configurata.");
  return sql;
}

export {
  authCookieForUser,
  clearAuthCookie,
  readAuthSession,
  userCustomerKey,
};

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
    const [salt, expectedHex] = String(stored || "").split(":");
    if (!salt || !expectedHex) return false;

    const expected = Buffer.from(expectedHex, "hex");
    const actual = scryptSync(String(password || ""), salt, expected.length);

    return (
      expected.length === actual.length &&
      timingSafeEqual(expected, actual)
    );
  } catch {
    return false;
  }
}

export async function activeAuthSession(request) {
  const session = readAuthSession(request);
  if (!session) return null;

  await ensureGemmaSchema();
  const rows = await database().unsafe(
    "SELECT id,email,name,role,active FROM gemma.user_account WHERE id=$1 LIMIT 1",
    [session.id],
  );
  const user = rows[0];

  if (!user || user.active !== true) return null;

  return {
    id: String(user.id),
    email: String(user.email || ""),
    name: String(user.name || ""),
    role: String(user.role || ""),
  };
}

export async function requireRole(request, roles) {
  const user = await activeAuthSession(request);
  if (!user || !roles.includes(user.role)) return null;
  return user;
}

export async function adminExists() {
  await ensureGemmaSchema();
  const rows = await database().unsafe(
    "SELECT EXISTS(SELECT 1 FROM gemma.user_account WHERE role='ADMIN' AND active=true) AS exists",
  );
  return rows[0]?.exists === true;
}

export async function createUser({
  email,
  name,
  password,
  role = "CUSTOMER",
}) {
  await ensureGemmaSchema();

  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedName = String(name || "").trim().slice(0, 120);

  if (!normalizedEmail || !normalizedEmail.includes("@")) {
    throw new Error("Inserisci un indirizzo email valido.");
  }

  if (!["CUSTOMER", "OPERATOR", "ADMIN"].includes(role)) {
    throw new Error("Ruolo non valido.");
  }

  try {
    const rows = await database().unsafe(
      "INSERT INTO gemma.user_account (id,email,name,password_hash,role,active,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,true,now(),now()) RETURNING id,email,name,role,active,created_at,last_login_at",
      [
        randomUUID(),
        normalizedEmail,
        normalizedName || normalizedEmail.split("@")[0],
        hashPassword(password),
        role,
      ],
    );
    return rows[0];
  } catch (error) {
    if (String(error?.code) === "23505") {
      throw new Error("Esiste già un account con questa email.");
    }
    throw error;
  }
}

export async function authenticateUser({ email, password, mode }) {
  await ensureGemmaSchema();

  const normalizedEmail = String(email || "").trim().toLowerCase();
  const sql = database();
  const rows = await sql.unsafe(
    "SELECT id,email,name,role,active,password_hash FROM gemma.user_account WHERE email=$1 LIMIT 1",
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
    "UPDATE gemma.user_account SET last_login_at=now(),updated_at=now() WHERE id=$1",
    [user.id],
  );

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  };
}

export async function adoptAnonymousCustomer(request, user) {
  if (!user || user.role !== "CUSTOMER") return;

  const anonymousKey =
    request?.cookies?.get?.("gemma_customer")?.value || "";

  if (!anonymousKey || anonymousKey === userCustomerKey(user)) return;

  await ensureGemmaSchema();
  const sql = database();
  const targetKey = userCustomerKey(user);

  await sql.begin("read write", async (tx) => {
    await tx.unsafe(
      "UPDATE gemma.conversation SET customer_key=$2,updated_at=now() WHERE customer_key=$1",
      [anonymousKey, targetKey],
    );
    await tx.unsafe(
      "UPDATE gemma.ticket SET customer_key=$2,customer_name=CASE WHEN customer_name='Cliente Demo' THEN $3 ELSE customer_name END,notification_email=coalesce(notification_email,$4),updated_at=now() WHERE customer_key=$1",
      [
        anonymousKey,
        targetKey,
        String(user.name || "Cliente").slice(0, 120),
        String(user.email || "").trim().toLowerCase() || null,
      ],
    );
  });
}

export async function listStaffUsers() {
  await ensureGemmaSchema();
  return await database().unsafe(
    "SELECT id,email,name,role,active,created_at,last_login_at FROM gemma.user_account WHERE role IN ('ADMIN','OPERATOR') ORDER BY role,name",
  );
}
