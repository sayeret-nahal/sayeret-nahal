// Local gateway that looks like a Supabase project URL:
//   /auth/v1/*  → a small GoTrue-compatible auth server (passwords, sessions, TOTP two-factor)
//   /rest/v1/*  → PostgREST (the same REST layer Supabase uses)
// For local development and testing only.
import http from "node:http";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import QRCode from "qrcode";
import { SignJWT, jwtVerify } from "jose";
import { connString, localSecrets } from "./db.mjs";

export const GATEWAY_PORT = 54321;
export const REST_PORT = 54323;
const ACCESS_TTL = 3600;
const ISSUER = "http://127.0.0.1:54321/auth/v1";

const { jwtSecret } = localSecrets();
const key = new TextEncoder().encode(jwtSecret);
const pool = new pg.Pool({ connectionString: connString(), max: 5 });

/** Long-lived anon token: the local "publishable key". */
export async function anonKey() {
  return new SignJWT({ role: "anon", iss: "supabase-local" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" }).setIssuedAt().setExpirationTime("10y").sign(key);
}

// ---------- TOTP (RFC 6238) ----------
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32(buf) {
  let bits = "", out = "";
  for (const b of buf) bits += b.toString(2).padStart(8, "0");
  for (let i = 0; i < bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5).padEnd(5, "0"), 2)];
  return out;
}
function unbase32(s) {
  let bits = "";
  for (const ch of s.replace(/=+$/, "")) bits += B32.indexOf(ch).toString(2).padStart(5, "0");
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
export function totp(secret, step = Math.floor(Date.now() / 30000)) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", unbase32(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}
const totpOk = (secret, code) => [-1, 0, 1].some((d) => totp(secret, Math.floor(Date.now() / 30000) + d) === String(code));

// ---------- sessions ----------
async function userJson(id) {
  const { rows } = await pool.query(`select * from auth.users where id = $1`, [id]);
  const u = rows[0];
  if (!u) return null;
  const f = await pool.query(`select * from auth.mfa_factors where user_id = $1 order by created_at`, [id]);
  return {
    id: u.id, aud: "authenticated", role: "authenticated", email: u.email,
    email_confirmed_at: u.email_confirmed_at, confirmed_at: u.email_confirmed_at, last_sign_in_at: u.last_sign_in_at,
    app_metadata: { provider: "email", providers: ["email"] }, user_metadata: u.raw_user_meta_data, identities: [],
    created_at: u.created_at, updated_at: u.updated_at, is_anonymous: false,
    factors: f.rows.map((x) => ({ id: x.id, friendly_name: x.friendly_name, factor_type: x.factor_type, status: x.status, created_at: x.created_at, updated_at: x.updated_at })),
  };
}

async function issueSession(userId, aal, sessionId = randomUUID(), methods = ["password"]) {
  const user = await userJson(userId);
  const now = Math.floor(Date.now() / 1000);
  const access_token = await new SignJWT({
    role: "authenticated", aud: "authenticated", email: user.email, session_id: sessionId, is_anonymous: false,
    aal, amr: methods.map((m) => ({ method: m, timestamp: now })),
    app_metadata: user.app_metadata, user_metadata: user.user_metadata,
  }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setSubject(userId).setIssuer(ISSUER)
    .setIssuedAt(now).setExpirationTime(now + ACCESS_TTL).sign(key);
  const refresh_token = randomBytes(24).toString("base64url");
  await pool.query(`insert into auth.refresh_tokens (token, user_id, session_id, aal) values ($1, $2, $3, $4)`, [refresh_token, userId, sessionId, aal]);
  await pool.query(`update auth.users set last_sign_in_at = now() where id = $1`, [userId]);
  return { access_token, token_type: "bearer", expires_in: ACCESS_TTL, expires_at: now + ACCESS_TTL, refresh_token, user };
}

async function bearer(req) {
  const h = req.headers.authorization ?? "";
  if (!h.startsWith("Bearer ")) return null;
  try {
    const { payload } = await jwtVerify(h.slice(7), key);
    return payload.sub ? payload : null;
  } catch {
    return null;
  }
}

// ---------- HTTP helpers ----------
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "authorization,apikey,content-type,x-client-info,prefer,accept-profile,content-profile,range,x-supabase-api-version",
  "Access-Control-Expose-Headers": "content-range,x-supabase-api-version",
};
function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json", ...CORS });
  res.end(body === undefined ? "" : JSON.stringify(body));
}
const fail = (res, status, error_code, msg) => send(res, status, { code: status, error_code, msg });
async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const t = Buffer.concat(chunks).toString("utf8");
  try { return t ? JSON.parse(t) : {}; } catch { return {}; }
}

// ---------- auth routes ----------
async function auth(req, res, path, url) {
  const body = ["POST", "PUT"].includes(req.method) ? await readBody(req) : {};

  if (path === "/token" && req.method === "POST") {
    const grant = url.searchParams.get("grant_type");
    if (grant === "password") {
      const { rows } = await pool.query(
        `select id from auth.users where email = lower($1) and encrypted_password = extensions.crypt($2, encrypted_password)`,
        [String(body.email ?? ""), String(body.password ?? "")]);
      if (!rows[0]) return fail(res, 400, "invalid_credentials", "Invalid login credentials");
      return send(res, 200, await issueSession(rows[0].id, "aal1"));
    }
    if (grant === "refresh_token") {
      const { rows } = await pool.query(
        `update auth.refresh_tokens set revoked = true where token = $1 and not revoked returning user_id, session_id, aal`, [String(body.refresh_token ?? "")]);
      if (!rows[0]) return fail(res, 400, "refresh_token_not_found", "Invalid Refresh Token");
      return send(res, 200, await issueSession(rows[0].user_id, rows[0].aal, rows[0].session_id));
    }
    return fail(res, 400, "unsupported_grant_type", "unsupported grant");
  }

  if (path === "/signup" && req.method === "POST") {
    try {
      const { rows } = await pool.query(
        `insert into auth.users (email, encrypted_password) values (lower($1), extensions.crypt($2, extensions.gen_salt('bf'))) returning id`,
        [String(body.email ?? ""), String(body.password ?? "")]);
      return send(res, 200, await issueSession(rows[0].id, "aal1")); // e-mail confirmation is off locally
    } catch (e) {
      if (String(e.message).includes("duplicate")) return fail(res, 422, "user_already_exists", "User already registered");
      return fail(res, 500, "unexpected_failure", "Database error saving new user");
    }
  }

  if (path === "/recover" && req.method === "POST") {
    console.log(`[auth] password-reset requested for ${body.email} (no e-mail is sent locally)`);
    return send(res, 200, {});
  }

  const claims = await bearer(req);
  if (!claims) return fail(res, 401, "no_authorization", "This endpoint requires a valid Bearer token");
  // same answer as GoTrue when the token belongs to a deleted user
  if (!(await pool.query(`select 1 from auth.users where id = $1`, [claims.sub])).rowCount) {
    return fail(res, 403, "user_not_found", "User from sub claim in JWT does not exist");
  }

  if (path === "/user" && req.method === "GET") return send(res, 200, await userJson(claims.sub));
  if (path === "/user" && req.method === "PUT") {
    if (body.password) {
      const hasMfa = (await pool.query(`select 1 from auth.mfa_factors where user_id = $1 and status = 'verified'`, [claims.sub])).rowCount > 0;
      if (hasMfa && claims.aal !== "aal2") return fail(res, 401, "insufficient_aal", "AAL2 session is required to update password");
      await pool.query(`update auth.users set encrypted_password = extensions.crypt($2, extensions.gen_salt('bf')), updated_at = now() where id = $1`, [claims.sub, body.password]);
    }
    return send(res, 200, await userJson(claims.sub));
  }
  if (path === "/logout" && req.method === "POST") {
    await pool.query(`update auth.refresh_tokens set revoked = true where user_id = $1`, [claims.sub]);
    return send(res, 204);
  }

  if (path === "/factors" && req.method === "POST") {
    const secret = base32(randomBytes(20));
    const { rows } = await pool.query(
      `insert into auth.mfa_factors (user_id, friendly_name, secret) values ($1, $2, $3) returning id`, [claims.sub, body.friendly_name ?? null, secret]);
    const uri = `otpauth://totp/${encodeURIComponent("סיירת נחל CRM")}:${encodeURIComponent(String(claims.email))}?secret=${secret}&issuer=${encodeURIComponent("סיירת נחל CRM")}`;
    const svg = await QRCode.toString(uri, { type: "svg", margin: 1 });
    return send(res, 200, { id: rows[0].id, type: "totp", friendly_name: body.friendly_name ?? null,
      totp: { qr_code: `data:image/svg+xml;utf-8,${encodeURIComponent(svg)}`, secret, uri } });
  }
  let m = path.match(/^\/factors\/([0-9a-f-]{36})\/challenge$/);
  if (m && req.method === "POST") {
    const own = await pool.query(`select 1 from auth.mfa_factors where id = $1 and user_id = $2`, [m[1], claims.sub]);
    if (!own.rowCount) return fail(res, 404, "mfa_factor_not_found", "Factor not found");
    const { rows } = await pool.query(`insert into auth.mfa_challenges (factor_id) values ($1) returning id`, [m[1]]);
    return send(res, 200, { id: rows[0].id, type: "totp", expires_at: Math.floor(Date.now() / 1000) + 300 });
  }
  m = path.match(/^\/factors\/([0-9a-f-]{36})\/verify$/);
  if (m && req.method === "POST") {
    const { rows } = await pool.query(
      `select f.secret from auth.mfa_factors f join auth.mfa_challenges c on c.factor_id = f.id
       where f.id = $1 and f.user_id = $2 and c.id = $3 and c.verified_at is null and c.created_at > now() - interval '5 minutes'`,
      [m[1], claims.sub, body.challenge_id]);
    if (!rows[0] || !totpOk(rows[0].secret, body.code)) return fail(res, 422, "mfa_verification_failed", "Invalid TOTP code entered");
    await pool.query(`update auth.mfa_challenges set verified_at = now() where id = $1`, [body.challenge_id]);
    await pool.query(`update auth.mfa_factors set status = 'verified', updated_at = now() where id = $1`, [m[1]]);
    return send(res, 200, await issueSession(claims.sub, "aal2", String(claims.session_id), ["password", "totp"]));
  }
  m = path.match(/^\/factors\/([0-9a-f-]{36})$/);
  if (m && req.method === "DELETE") {
    await pool.query(`delete from auth.mfa_factors where id = $1 and user_id = $2`, [m[1], claims.sub]);
    return send(res, 200, { id: m[1] });
  }
  return fail(res, 404, "not_found", "Not found");
}

// ---------- REST proxy ----------
function proxyRest(req, res, path) {
  const up = http.request({ host: "127.0.0.1", port: REST_PORT, method: req.method, path, headers: { ...req.headers, host: `127.0.0.1:${REST_PORT}` } }, (r) => {
    res.writeHead(r.statusCode ?? 502, { ...r.headers, ...CORS });
    r.pipe(res);
  });
  up.on("error", () => fail(res, 502, "rest_unavailable", "PostgREST is not running"));
  req.pipe(up);
}

export function startGateway() {
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === "OPTIONS") { res.writeHead(204, CORS); return res.end(); }
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${GATEWAY_PORT}`);
      if (url.pathname.startsWith("/auth/v1")) return await auth(req, res, url.pathname.slice(8) || "/", url);
      if (url.pathname.startsWith("/rest/v1")) return proxyRest(req, res, url.pathname.slice(8) + url.search);
      return fail(res, 404, "not_found", "Not found");
    } catch (e) {
      console.error("[gateway]", e);
      return fail(res, 500, "unexpected_failure", "Internal error");
    }
  });
  return new Promise((resolve) => server.listen(GATEWAY_PORT, "127.0.0.1", () => resolve(server)));
}
