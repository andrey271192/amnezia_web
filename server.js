import express from "express";
import { spawn, spawnSync, execFileSync } from "child_process";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Из package.json — для мониторинга и проверки, что VPS подняли свежий образ. */
let PANEL_VERSION = "0.0.0";
try {
  const raw = fs.readFileSync(path.join(__dirname, "package.json"), "utf8");
  const v = JSON.parse(raw)?.version;
  if (typeof v === "string" && v.trim()) PANEL_VERSION = v.trim();
} catch {
  /* оставить PANEL_VERSION по умолчанию */
}

const PORT = Number(process.env.PORT || 3980);
const PROFILE_COOKIE = "amnezia_prof";
const SCHEDULER_MS = Number(process.env.SCHEDULE_DISCONNECT_MS || 60_000);
/** Если задан, разрешает GET /api/clients/export-config?token=…&clientId=… без сессии (храните секрет только для себя). */
const EXPORT_CONFIG_SECRET = process.env.EXPORT_CONFIG_SECRET?.trim();

function envTruthy(v) {
  if (typeof v !== "string") return false;
  const s = v.trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}

/** Какие блоки веб-интерфейса скрыты: `UI_HIDE_SECTIONS=users,warp,cascade` или `UI_HIDE_USERS` и т.д. */
function resolveUiHidden() {
  const raw = process.env.UI_HIDE_SECTIONS?.trim();
  const set = new Set();
  if (raw) {
    for (const part of raw.split(",")) {
      const k = part.trim().toLowerCase();
      if (k) set.add(k);
    }
  }
  return {
    users: set.has("users") || envTruthy(process.env.UI_HIDE_USERS),
    warp: set.has("warp") || envTruthy(process.env.UI_HIDE_WARP),
    cascade: set.has("cascade") || envTruthy(process.env.UI_HIDE_CASCADE),
    mtproto: set.has("mtproto") || envTruthy(process.env.UI_HIDE_MTPROTO),
  };
}

const UI_HIDDEN = resolveUiHidden();

const PANEL_FOOTER_DONATE_DEFAULT = "https://boosty.to/andrey27/donate";

const PANEL_FOOTER_TELEGRAM_DEFAULT = "https://t.me/lot_andrey";
const PANEL_FOOTER_OZON_DEFAULT =
  "https://finance.ozon.ru/apps/sbp/ozonbankpay/019dc200-2a5d-7931-a619-782d285f6798";

function sanitizeHttpsHttpUrl(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  try {
    const u = new URL(s);
    if (u.protocol === "http:" || u.protocol === "https:") return u.href;
  } catch {
    /* ignore */
  }
  return "";
}

/** Донат + Ozon СБП + Telegram‑спонсор: только в админ‑панели (не пользовательские лендинги). Переопределяется через env контейнера. */
function panelPromoFooterPayload() {
  const donateResolved =
    sanitizeHttpsHttpUrl(
      process.env.PANEL_FOOTER_DONATE_URL?.trim() || PANEL_FOOTER_DONATE_DEFAULT,
    ) || "";
  const telegramResolved =
    sanitizeHttpsHttpUrl(
      process.env.PANEL_FOOTER_TELEGRAM_URL?.trim() || PANEL_FOOTER_TELEGRAM_DEFAULT,
    ) || "";
  const ozonResolved =
    sanitizeHttpsHttpUrl(
      process.env.PANEL_FOOTER_OZON_URL?.trim() || PANEL_FOOTER_OZON_DEFAULT,
    ) || "";

  return {
    donateUrl: donateResolved,
    ozonUrl: ozonResolved,
    telegramUrl: telegramResolved,
    donateLabel:
      process.env.PANEL_FOOTER_DONATE_LABEL?.trim() || "Поддержать проект",
    ozonLabel:
      process.env.PANEL_FOOTER_OZON_LABEL?.trim() ||
      "Донат · Ozon СБП",
    telegramLabel:
      process.env.PANEL_FOOTER_TELEGRAM_LABEL?.trim() ||
      "Telegram‑канал спонсора",
    promoSubtitle:
      process.env.PANEL_FOOTER_PROMO_SUBTITLE?.trim() ||
      "Поддержите через Boosty (или вашу ссылку), Ozon СБП и Telegram — те же ссылки внизу панели. На пользовательские лендинги это не выводится.",
  };
}

function editionPayload() {
  return {
    readOnlyClients: false,
    allowDeleteClients: true,
    showDebugWg: false,
    proHostTools: false,
  };
}

function effectiveUiHidden() {
  return {
    users: UI_HIDDEN.users,
    warp: true,
    cascade: true,
    mtproto: UI_HIDDEN.mtproto,
  };
}


function parseProfilesFromEnv() {
  const raw = process.env.AWG_PROFILES?.trim();
  const fallback = () => {
    const warpDir = (process.env.WARP_DIR || "/opt/warp").replace(/\/+$/, "") || "/opt/warp";
    return [
      {
        id: "awg",
        label: process.env.AWG_PROFILE_LABEL || "AmneziaWG",
        container: process.env.AWG_CONTAINER || "amnezia-awg",
        confPath: process.env.AWG_CONF_PATH || "/opt/amnezia/awg/awg0.conf",
        clientsPath: process.env.AWG_CLIENTS_PATH || "/opt/amnezia/awg/clientsTable",
        iface: process.env.AWG_IFACE || "awg0",
        wgBinary: process.env.AWG_BINARY || "awg",
        pskPath: process.env.AWG_PSK_PATH || "/opt/amnezia/awg/wireguard_psk.key",
        warpDir,
        warpConf: process.env.WARP_CONF_PATH || `${warpDir}/warp.conf`,
        warpClientsList: process.env.WARP_CLIENTS_LIST || `${warpDir}/clients.list`,
        startScript: process.env.AMNEZIA_START_SCRIPT || "/opt/amnezia/start.sh",
      },
    ];
  };
  if (!raw) return fallback();
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr) || arr.length === 0) return fallback();
    return arr
      .map((row, i) => {
        const warpDirRaw = row.warpDir ?? "/opt/warp";
        const warpDir = String(warpDirRaw).replace(/\/+$/, "") || "/opt/warp";
        const warpConf = row.warpConf ? String(row.warpConf) : `${warpDir}/warp.conf`;
        const warpClientsList = row.warpClientsList
          ? String(row.warpClientsList)
          : `${warpDir}/clients.list`;
        const startScript = String(row.startScript ?? "/opt/amnezia/start.sh");
        return {
          id: String(row.id ?? `p${i}`),
          label: String(row.label ?? row.id ?? `Профиль ${i + 1}`),
          container: String(row.container ?? ""),
          confPath: String(row.confPath ?? row.conf ?? "/opt/amnezia/awg/awg0.conf"),
          clientsPath: String(row.clientsPath ?? row.clients ?? "/opt/amnezia/awg/clientsTable"),
          iface: String(row.iface ?? row.IFACE ?? "awg0"),
          wgBinary: String(row.wgBinary ?? row.binary ?? "awg"),
          pskPath: String(row.pskPath ?? row.psk ?? "/opt/amnezia/awg/wireguard_psk.key"),
          warpDir,
          warpConf,
          warpClientsList,
          startScript,
        };
      })
      .filter((p) => p.container);
  } catch {
    console.warn("AWG_PROFILES: невалидный JSON, используется профиль по умолчанию.");
    return fallback();
  }
}

const PROFILES = parseProfilesFromEnv();
if (!PROFILES.length) {
  console.error("Нет ни одного профиля AWG: укажите container в AWG_PROFILES или переменные по умолчанию.");
  process.exit(1);
}

const DATA_DIR = process.env.DATA_DIR || "/data";
const PW_FILE = path.join(DATA_DIR, "password.hash");
const SECRET_FILE = path.join(DATA_DIR, "session.secret");

/**
 * Хостовый путь, смонтированный в контейнер панели как DATA_DIR.
 * Нужен для одноразового docker-cli helper-а: контейнер панели монтирует
 * `${HOST_DATA_DIR}:/mnt/data`, и оба контейнера видят один и тот же файл логов.
 * Порядок поиска:
 *   1) env HOST_DATA_DIR (передаётся install.sh при `docker run`);
 *   2) docker inspect собственного контейнера (находим Source для Destination=DATA_DIR);
 *   3) fallback /opt/amnezia-admin-data — типичный путь install.sh.
 */
function resolveHostDataDir() {
  const explicit = process.env.HOST_DATA_DIR?.trim();
  if (explicit) return explicit;
  const selfId = (process.env.HOSTNAME || "").trim();
  if (selfId) {
    try {
      const out = execFileSync(
        "docker",
        [
          "inspect",
          "--format",
          `{{range .Mounts}}{{if eq .Destination "${DATA_DIR}"}}{{.Source}}{{end}}{{end}}`,
          selfId,
        ],
        { stdio: ["ignore", "pipe", "ignore"], timeout: 5000 },
      )
        .toString()
        .trim();
      if (out) return out;
    } catch {
      //
    }
  }
  return "/opt/amnezia-admin-data";
}
const HOST_DATA_DIR = resolveHostDataDir();

const SESSION_COOKIE = "amnezia_sess";
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;

let passwordHashStored = "";
let sessionSecret = "";

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

function verifyPassword(password, stored) {
  const parts = stored.split(":");
  if (parts.length !== 2) return false;
  const salt = Buffer.from(parts[0], "hex");
  const expected = Buffer.from(parts[1], "hex");
  let hash;
  try {
    hash = crypto.scryptSync(password, salt, 64);
  } catch {
    return false;
  }
  if (hash.length !== expected.length) return false;
  return crypto.timingSafeEqual(hash, expected);
}

function loadOrCreateSessionSecret() {
  ensureDataDir();
  if (fs.existsSync(SECRET_FILE)) {
    sessionSecret = fs.readFileSync(SECRET_FILE, "utf8").trim();
    if (sessionSecret.length < 32) {
      throw new Error("session.secret слишком короткий — удалите файл для пересоздания");
    }
    return;
  }
  sessionSecret = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(SECRET_FILE, `${sessionSecret}\n`, { mode: 0o600 });
}

function rotateSessionSecret() {
  sessionSecret = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(SECRET_FILE, `${sessionSecret}\n`, { mode: 0o600 });
}

function bootstrapPassword() {
  ensureDataDir();
  if (fs.existsSync(PW_FILE)) {
    passwordHashStored = fs.readFileSync(PW_FILE, "utf8").trim();
    if (!passwordHashStored) throw new Error("password.hash пуст");
    return;
  }
  const bootstrap = process.env.ADMIN_PASSWORD || "";
  if (bootstrap) {
    passwordHashStored = hashPassword(bootstrap);
    fs.writeFileSync(PW_FILE, `${passwordHashStored}\n`, { mode: 0o600 });
    console.warn(
      "Пароль сохранён в /data/password.hash. Уберите ADMIN_PASSWORD из окружения после первого старта."
    );
    return;
  }
  const legacyToken = process.env.ADMIN_TOKEN || "";
  if (legacyToken) {
    passwordHashStored = hashPassword(legacyToken);
    fs.writeFileSync(PW_FILE, `${passwordHashStored}\n`, { mode: 0o600 });
    console.warn(
      "Миграция: пароль взяли из ADMIN_TOKEN и сохранили в /data/password.hash. Удалите ADMIN_TOKEN из окружения."
    );
    return;
  }
  const defaultPassword = process.env.DEFAULT_ADMIN_PASSWORD || "admin";
  passwordHashStored = hashPassword(defaultPassword);
  fs.writeFileSync(PW_FILE, `${passwordHashStored}\n`, { mode: 0o600 });
  console.warn("Первый вход: admin / admin. Смените пароль сразу после входа.");
}

function signSession(payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", sessionSecret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function readSession(token) {
  if (!token || !sessionSecret) return null;
  const dot = token.indexOf(".");
  if (dot === -1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let expected;
  try {
    expected = crypto.createHmac("sha256", sessionSecret).update(body).digest("base64url");
  } catch {
    return null;
  }
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
  return payload;
}

function getSessionToken(req) {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const p = part.trim();
    if (p.startsWith(`${SESSION_COOKIE}=`)) {
      return decodeURIComponent(p.slice(SESSION_COOKIE.length + 1));
    }
  }
  return null;
}

function getProfileCookie(req) {
  const raw = req.headers.cookie || "";
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const s = part.trim();
    const eq = s.indexOf("=");
    if (eq === -1) continue;
    const k = decodeURIComponent(s.slice(0, eq).trim());
    if (k !== PROFILE_COOKIE) continue;
    return decodeURIComponent(s.slice(eq + 1).trim());
  }
  return null;
}

function cookieSecureFlag() {
  return process.env.COOKIE_SECURE === "1" || process.env.COOKIE_SECURE === "true";
}

function setSessionCookie(res, token, maxAgeSec) {
  const sec = cookieSecureFlag();
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; Max-Age=${maxAgeSec}; Path=/; HttpOnly; SameSite=Lax${sec ? "; Secure" : ""}`
  );
}

function clearSessionCookie(res) {
  const sec = cookieSecureFlag();
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${sec ? "; Secure" : ""}`
  );
}

function setProfileCookie(res, profileId) {
  const sec = cookieSecureFlag();
  res.setHeader(
    "Set-Cookie",
    `${PROFILE_COOKIE}=${encodeURIComponent(profileId)}; Max-Age=${31536000}; Path=/; SameSite=Lax${sec ? "; Secure" : ""}`
  );
}

function requireAuth(req, res, next) {
  const sess = readSession(getSessionToken(req));
  if (!sess) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

function verifyExportQueryToken(token) {
  if (!EXPORT_CONFIG_SECRET || typeof token !== "string" || !token) return false;
  const a = Buffer.from(token, "utf8");
  const b = Buffer.from(EXPORT_CONFIG_SECRET, "utf8");
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function requireAuthOrExportToken(req, res, next) {
  if (req.method === "GET" && verifyExportQueryToken(typeof req.query.token === "string" ? req.query.token : "")) {
    next();
    return;
  }
  requireAuth(req, res, next);
}

function rejectUnavailableFeature(res) {
  res.status(403).json({
    error:
      "Эта функция недоступна в базовой версии панели: каскад, Cloudflare WARP и синхронизация времени хоста.",
  });
}

function requireProTier(_req, res, next) {
  rejectUnavailableFeature(res);
}

function runtimeFromExportRequest(req) {
  const qPid = typeof req.query.profileId === "string" ? req.query.profileId.trim() : "";
  const bodyPid =
    req.method === "POST" && typeof req.body?.profileId === "string" ? req.body.profileId.trim() : "";
  const pid = qPid || bodyPid;
  if (pid) {
    const p = PROFILES.find((x) => x.id === pid);
    if (p) return createRuntime(p);
  }
  return runtimeForRequest(req);
}

function execDocker(args, stdin = null) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err += c));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout: out, stderr: err });
      else reject(new Error(err.trim() || out.trim() || `exit ${code}`));
    });
    if (stdin != null) {
      child.stdin.write(stdin);
      child.stdin.end();
    } else {
      child.stdin.end();
    }
  });
}

/** Запуск `sh -s` внутри контейнера со скриптом по stdin (многострочный shell без экранирования). */
function dockerExecStdin(container, script) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", ["exec", "-i", container, "sh", "-s"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err += c));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout: out, stderr: err });
      else reject(new Error(err.trim() || out.trim() || `exit ${code}`));
    });
    child.stdin.write(script);
    child.stdin.end();
  });
}

function assertSafeUnixPath(p) {
  const s = String(p).trim();
  if (!/^\/[a-zA-Z0-9_/.-]+$/.test(s)) {
    throw new Error(`Недопустимый путь: ${p}`);
  }
  return s;
}

/** Разрешённые адреса клиента AmneziaWG для правил WARP (обычно одно значение с /32). */
function assertAllowedIpCidr(token) {
  const s = String(token).trim();
  if (!/^(\d{1,3}\.){3}\d{1,3}\/\d{1,3}$/.test(s)) {
    throw new Error(`Недопустимый AllowedIPs для WARP: ${token}`);
  }
  return s;
}

function peerAllowedIpTokens(peer) {
  const raw = peer?.allowedIPs || "";
  return raw
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

async function dockerRestartContainer(container) {
  await execDocker(["restart", container]);
  for (let i = 0; i < 24; i++) {
    try {
      await execDocker(["exec", container, "sh", "-c", "true"]);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error("Контейнер не ответил после restart");
}

async function warpFileExists(rt, remotePath) {
  try {
    await execDocker(["exec", rt.profile.container, "test", "-f", remotePath]);
    return true;
  } catch {
    return false;
  }
}

async function warpInterfaceUp(rt) {
  try {
    await execDocker(["exec", rt.profile.container, "ip", "addr", "show", "warp"]);
    return true;
  } catch {
    return false;
  }
}

/** После `docker restart` правила iptables/ip rule живут только в патче start.sh; дублируем применение на «живом» контейнере. */
async function waitForWarpInterface(rt, { timeoutMs = 90000, stepMs = 1500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await warpInterfaceUp(rt)) return true;
    } catch {
      /* контейнер ещё не отвечает на exec */
    }
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return false;
}

async function warpLoadSelectedIps(rt) {
  try {
    const raw = await rt.dockerReadFile(rt.profile.warpClientsList);
    const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
    return lines.map((l) => assertAllowedIpCidr(l));
  } catch {
    return [];
  }
}

async function warpSaveSelectedIps(rt, ips) {
  const uniq = [...new Set(ips.map((x) => assertAllowedIpCidr(x)))];
  const content = uniq.length ? `${uniq.join("\n")}\n` : "";
  await rt.dockerExec(`mkdir -p '${rt.profile.warpDir}'`);
  await rt.dockerWriteFile(rt.profile.warpClientsList, content);
}

async function warpCleanupRules(rt) {
  const sh = `#!/bin/sh
set +e
ip rule | awk '/lookup 100/ {print \$1}' | sed 's/://g' | sort -rn | while read -r pr; do
  ip rule del priority "\$pr" 2>/dev/null || true
done
iptables -t nat -S POSTROUTING 2>/dev/null | grep -- '-o warp -j MASQUERADE' | while read -r line; do
  rule=$(echo "\$line" | sed 's/^-A /-D /')
  iptables -t nat \$rule 2>/dev/null || true
done
ip route flush table 100 2>/dev/null || true
exit 0
`;
  try {
    await dockerExecStdin(rt.profile.container, sh);
  } catch {
    /* ignore */
  }
}

async function warpApplyRouting(rt, ips) {
  await warpCleanupRules(rt);
  const list = ips.map((x) => assertAllowedIpCidr(x));
  if (!list.length) return;
  await rt.dockerExec(
    "ip route add default dev warp table 100 2>/dev/null || ip route replace default dev warp table 100 2>/dev/null || true",
  );
  let prio = 100;
  for (const ip of list) {
    await rt.dockerExec(
      `ip rule add from ${ip} table 100 priority ${prio} 2>/dev/null || true && ` +
        `(iptables -t nat -C POSTROUTING -s ${ip} -o warp -j MASQUERADE 2>/dev/null || ` +
        `iptables -t nat -I POSTROUTING 1 -s ${ip} -o warp -j MASQUERADE)`,
    );
    prio += 1;
  }
}

function buildWarpBootBlock(warpConf, ips) {
  assertSafeUnixPath(warpConf);
  const list = ips.map((x) => assertAllowedIpCidr(x));
  let routing = "";
  if (list.length > 0) {
    routing +=
      "ip route add default dev warp table 100 2>/dev/null || ip route replace default dev warp table 100 2>/dev/null || true\n\n";
    let prio = 100;
    for (const ip of list) {
      routing += `ip rule add from ${ip} table 100 priority ${prio} 2>/dev/null || true\n`;
      routing += `iptables -t nat -C POSTROUTING -s ${ip} -o warp -j MASQUERADE 2>/dev/null || iptables -t nat -I POSTROUTING 1 -s ${ip} -o warp -j MASQUERADE\n`;
      prio += 1;
    }
    routing += "\n";
  }
  return (
    "# --- WARP-MANAGER BEGIN ---\n\n" +
    `if [ -f '${warpConf}' ]; then\n` +
    `  wg-quick up '${warpConf}' || true\n` +
    `  sleep 3\n` +
    `fi\n\n` +
    routing +
    "# --- WARP-MANAGER END ---\n"
  );
}

async function warpPatchStartSh(rt, ips) {
  const startScript = rt.profile.startScript;
  assertSafeUnixPath(startScript);
  const block = buildWarpBootBlock(rt.profile.warpConf, ips);
  const delim = `WARPBLK_${crypto.randomBytes(8).toString("hex")}`;
  if (block.includes(delim)) {
    throw new Error("internal delimiter collision");
  }
  const sq = startScript.replace(/'/g, "'\\''");
  const remote = [
    "#!/bin/sh",
    "set -e",
    `START_SH='${sq}'`,
    `BLOCK=$(cat <<'${delim}'`,
    block.trimEnd(),
    delim,
    ")",
    'if grep -qF \'# --- WARP-MANAGER BEGIN ---\' "$START_SH" 2>/dev/null; then',
    '  sed -i \'/# --- WARP-MANAGER BEGIN ---/,/# --- WARP-MANAGER END ---/d\' "$START_SH"',
    "fi",
    'if grep -qF \'tail -f /dev/null\' "$START_SH"; then',
    "  tmpfile=$(mktemp)",
    "  while IFS= read -r line; do",
    '    if echo "$line" | grep -qF \'tail -f /dev/null\'; then',
    '      printf \'%s\\n\' "$BLOCK"',
    "    fi",
    '    printf \'%s\\n\' "$line"',
    '  done < "$START_SH" > "$tmpfile"',
    '  mv "$tmpfile" "$START_SH"',
    '  chmod +x "$START_SH"',
    "else",
    '  printf \'\\n%s\\n\' "$BLOCK" >> "$START_SH"',
    '  chmod +x "$START_SH"',
    "fi",
    "",
  ].join("\n");
  await dockerExecStdin(rt.profile.container, remote);
}

async function warpPersistAndRestart(rt, selectedIps) {
  await rt.backupRemoteFiles();
  await warpSaveSelectedIps(rt, selectedIps);
  await warpPatchStartSh(rt, selectedIps);
  await dockerRestartContainer(rt.profile.container);
  const needWarpRules = selectedIps.length > 0;
  if (needWarpRules) {
    const up = await waitForWarpInterface(rt);
    if (!up && (await warpFileExists(rt, rt.profile.warpConf))) {
      throw new Error(
        "После перезапуска AWG интерфейс warp не поднялся за отведённое время. Откройте «Вывод wg show warp», нажмите «Поднять WARP», затем «Применить маршрутизацию» снова.",
      );
    }
  }
  await warpApplyRouting(rt, selectedIps);
}

function activePeerAllowedIpSet(conf) {
  const set = new Set();
  for (const p of conf.peers) {
    for (const t of peerAllowedIpTokens(p)) {
      try {
        set.add(assertAllowedIpCidr(t));
      } catch {
        /* только ipv4 /cidr */
      }
    }
  }
  return set;
}

async function warpSummaryForRt(rt) {
  try {
    assertSafeUnixPath(rt.profile.warpConf);
    assertSafeUnixPath(rt.profile.warpClientsList);
    assertSafeUnixPath(rt.profile.warpDir);
    assertSafeUnixPath(rt.profile.startScript);
  } catch {
    return { supported: false };
  }
  let installed = false;
  try {
    installed = await warpFileExists(rt, rt.profile.warpConf);
  } catch {
    installed = false;
  }
  const running = installed ? await warpInterfaceUp(rt) : false;
  let exitIp = null;
  if (running) {
    try {
      const out = await rt.dockerExec(
        "curl -fsS --interface warp --connect-timeout 4 https://ifconfig.me 2>/dev/null || true",
      );
      const t = out.trim();
      exitIp = t || null;
    } catch {
      exitIp = null;
    }
  }
  let selectedAllowedIps = [];
  if (installed) {
    try {
      selectedAllowedIps = await warpLoadSelectedIps(rt);
    } catch {
      selectedAllowedIps = [];
    }
  }
  let wgShowWarp = "";
  if (installed && running) {
    try {
      wgShowWarp = await rt.dockerExec("wg show warp 2>/dev/null || true");
    } catch {
      wgShowWarp = "";
    }
  }
  return {
    supported: true,
    installed,
    running,
    exitIp,
    wgShowWarp,
    selectedAllowedIps,
    paths: {
      warpConf: rt.profile.warpConf,
      clientsList: rt.profile.warpClientsList,
      warpDir: rt.profile.warpDir,
      startScript: rt.profile.startScript,
    },
  };
}

function peerUsesWarp(peer, selectedSet) {
  if (!peer || !selectedSet.size) return false;
  for (const t of peerAllowedIpTokens(peer)) {
    try {
      if (selectedSet.has(assertAllowedIpCidr(t))) return true;
    } catch {
      /* ipv6 и др. */
    }
  }
  return false;
}

function uniqueList(items) {
  return [...new Set(items.filter(Boolean).map(String))];
}

function ifaceFromConfPath(filePath, fallback) {
  const base = path.basename(String(filePath || ""));
  const m = base.match(/^([A-Za-z0-9_.-]+)\.conf$/);
  return m ? m[1] : fallback;
}

async function listRunningContainerNames() {
  try {
    const { stdout } = await execDocker(["ps", "--format", "{{.Names}}"]);
    return stdout.split("\n").map((x) => x.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

async function containerHasFile(name, filePath) {
  try {
    await execDocker(["exec", name, "test", "-f", filePath]);
    return true;
  } catch {
    return false;
  }
}

async function discoverAmneziaContainer(confCandidates, preferredName) {
  const names = await listRunningContainerNames();
  const score = (n) => {
    if (preferredName && n === preferredName) return 0;
    if (/^amnezia-?awg/i.test(n)) return 1;
    if (/^amnezia.*wg/i.test(n)) return 2;
    if (/^amnezia/i.test(n)) return 3;
    if (/awg|wireguard|wg/i.test(n)) return 4;
    return 5;
  };
  const ordered = [...names].sort((a, b) => score(a) - score(b));
  for (const n of ordered) {
    for (const candidate of confCandidates) {
      if (await containerHasFile(n, candidate)) return n;
    }
  }
  return null;
}

function createRuntime(profile) {
  let resolvedContainer = null;
  let resolvedConfPath = null;
  let resolvedClientsPath = null;
  let resolvedWgBinary = null;
  const confPath = profile.confPath;
  const clientsPath = profile.clientsPath;
  const iface = profile.iface;
  const wgBinary = profile.wgBinary;
  const pskPath = profile.pskPath;
  const confCandidates = uniqueList([
    confPath,
    "/opt/amnezia/awg/awg0.conf",
    "/opt/amnezia/awg/wg0.conf",
    "/opt/amnezia/wireguard/wg0.conf",
  ]);
  const clientsCandidates = uniqueList([
    clientsPath,
    "/opt/amnezia/awg/clientsTable",
    "/opt/amnezia/wireguard/clientsTable",
  ]);

  async function resolveContainer() {
    if (resolvedContainer) return resolvedContainer;
    if (profile.container) {
      for (const candidate of confCandidates) {
        if (await containerHasFile(profile.container, candidate)) {
          resolvedContainer = profile.container;
          return resolvedContainer;
        }
      }
    }
    const found = await discoverAmneziaContainer(confCandidates, profile.container);
    if (found) {
      resolvedContainer = found;
      return resolvedContainer;
    }
    const running = (await listRunningContainerNames()).join(", ") || "(нет запущенных)";
    throw new Error(
      `Контейнер AmneziaWG не найден. Профиль указывает «${profile.container}». Запущенные контейнеры: ${running}.`,
    );
  }

  async function resolveConfPath() {
    if (resolvedConfPath) return resolvedConfPath;
    const container = await resolveContainer();
    let best = null;
    for (const candidate of confCandidates) {
      try {
        const { stdout } = await execDocker(["exec", container, "cat", candidate]);
        const parsed = splitAwgConf(stdout);
        const score = parsed.peers.length * 10 + (candidate === confPath ? 1 : 0);
        if (!best || score > best.score) best = { path: candidate, score };
      } catch {
        /* missing */
      }
    }
    if (!best) throw new Error(`Не найден wg/awg config file: ${confCandidates.join(", ")}`);
    resolvedConfPath = best.path;
    return resolvedConfPath;
  }

  async function resolveClientsPath() {
    if (resolvedClientsPath) return resolvedClientsPath;
    const container = await resolveContainer();
    let best = null;
    for (const candidate of clientsCandidates) {
      try {
        const { stdout } = await execDocker(["exec", container, "cat", candidate]);
        let parsed = [];
        try {
          parsed = parseClientsTable(stdout);
        } catch {
          parsed = [];
        }
        const score = parsed.length * 10 + (candidate === clientsPath ? 1 : 0);
        if (!best || score > best.score) best = { path: candidate, score };
      } catch {
        /* missing */
      }
    }
    if (!best) throw new Error(`Не найден clientsTable: ${clientsCandidates.join(", ")}`);
    resolvedClientsPath = best.path;
    return resolvedClientsPath;
  }

  async function resolveWgBinary() {
    if (resolvedWgBinary) return resolvedWgBinary;
    const container = await resolveContainer();
    const activeIface = ifaceFromConfPath(resolvedConfPath || confPath, iface);
    const candidates = uniqueList([wgBinary, activeIface === "wg0" ? "wg" : "", "awg", "wg"]);
    for (const candidate of candidates) {
      try {
        await execDocker(["exec", container, "sh", "-c", `command -v '${candidate}' >/dev/null 2>&1`]);
        resolvedWgBinary = candidate;
        return resolvedWgBinary;
      } catch {
        /* absent */
      }
    }
    throw new Error(`Не найден wg/awg binary в контейнере ${container}: ${candidates.join(", ")}`);
  }

  async function dockerExec(cmd) {
    const container = await resolveContainer();
    const { stdout, stderr } = await execDocker(["exec", container, "sh", "-c", cmd]);
    return stdout + stderr;
  }

  async function dockerReadFile(remotePath) {
    const container = await resolveContainer();
    const { stdout } = await execDocker(["exec", container, "cat", remotePath]);
    return stdout;
  }

  async function dockerWriteFile(remotePath, content) {
    const container = await resolveContainer();
    await execDocker(
      [
        "exec",
        "-i",
        container,
        "sh",
        "-c",
        `cat > '${remotePath}.tmp' && mv '${remotePath}.tmp' '${remotePath}'`,
      ],
      content
    );
  }

  async function backupRemoteFiles() {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const activeConfPath = await resolveConfPath();
    const activeClientsPath = await resolveClientsPath();
    await dockerExec(`cp '${activeConfPath}' '${activeConfPath}.bak-admin-${stamp}' 2>/dev/null || true`);
    await dockerExec(
      `cp '${activeClientsPath}' '${activeClientsPath}.bak-admin-${stamp}' 2>/dev/null || true`
    );
  }

  async function applySyncconf() {
    const activeConfPath = await resolveConfPath();
    const activeIface = ifaceFromConfPath(activeConfPath, iface);
    const activeBinary = await resolveWgBinary();
    await dockerExec(
      `chmod 600 '${activeConfPath}' 2>/dev/null || true` +
        `; wg-quick strip '${activeConfPath}' > /tmp/wg-admin-strip.conf` +
        ` && ${activeBinary} syncconf ${activeIface} /tmp/wg-admin-strip.conf`
    );
  }

  async function loadState() {
    const activeConfPath = await resolveConfPath();
    const activeClientsPath = await resolveClientsPath();
    const [confText, tableText] = await Promise.all([
      dockerReadFile(activeConfPath),
      dockerReadFile(activeClientsPath),
    ]);
    const conf = splitAwgConf(confText);
    const clients = parseClientsTable(tableText);
    const peerByKey = new Map(conf.peers.map((p) => [p.publicKey, p]));
    return { confText, conf, clients, peerByKey, confPath: activeConfPath, clientsPath: activeClientsPath };
  }

  async function inferPskFromConf(conf) {
    if (conf.peers.length) return conf.peers[0].presharedKey;
    try {
      const text = await dockerReadFile(pskPath);
      return text.trim();
    } catch {
      return null;
    }
  }

  return {
    profile,
    resolveContainer,
    resolveConfPath,
    resolveClientsPath,
    resolveWgBinary,
    get tunnelIface() {
      return ifaceFromConfPath(resolvedConfPath || confPath, iface);
    },
    get wgBinary() {
      return resolvedWgBinary || wgBinary;
    },
    dockerExec,
    dockerReadFile,
    dockerWriteFile,
    backupRemoteFiles,
    applySyncconf,
    loadState,
    inferPskFromConf,
    get confPath() {
      return resolvedConfPath || confPath;
    },
    get clientsPath() {
      return resolvedClientsPath || clientsPath;
    },
  };
}

function runtimeForRequest(req) {
  const wanted = getProfileCookie(req);
  const profile = PROFILES.find((p) => p.id === wanted) || PROFILES[0];
  return createRuntime(profile);
}

function splitAwgConf(text) {
  const t = text.replace(/\r\n/g, "\n");
  const parts = t.split(/(?=^\[Peer\])/m);
  const head = parts[0].trimEnd();
  const peers = parts.slice(1).map(parsePeerBlock).filter((p) => p.publicKey);
  return { head, peers };
}

function parsePeerBlock(block) {
  const lineMap = (key) => {
    const m = block.match(new RegExp(`^${key}\\s*=\\s*(.+)$`, "m"));
    return m ? m[1].trim() : null;
  };
  const publicKey = lineMap("PublicKey");
  const presharedKey = lineMap("PresharedKey");
  const allowedIPs = lineMap("AllowedIPs");
  const raw = block.trimEnd();
  return { raw, publicKey, presharedKey, allowedIPs };
}

function serializeAwgConf(head, peers) {
  const body = peers.map((p) => p.raw.trim()).join("\n\n");
  return (body ? `${head}\n\n${body}\n` : `${head}\n`).replace(/\n+$/, "\n");
}

function parseClientsTable(raw) {
  const data = JSON.parse(raw);
  return normalizeClientsTableRows(data);
}

function stringifyClientsTable(rows) {
  return `${JSON.stringify(rows, null, 4)}\n`;
}

function looksLikePublicKey(s) {
  return /^[A-Za-z0-9+/=_-]{32,80}$/.test(String(s || "").trim());
}

function clientRowId(row) {
  return String(
    row?.clientId ??
      row?.id ??
      row?.publicKey ??
      row?.public_key ??
      row?.key ??
      row?.client_id ??
      row?.userData?.clientId ??
      row?.userData?.publicKey ??
      "",
  ).trim();
}

function clientRowUserData(row) {
  return row?.userData && typeof row.userData === "object" ? row.userData : {};
}

function normalizeClientTableRow(row, key = "") {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const id = clientRowId(row) || (looksLikePublicKey(key) ? String(key).trim() : "");
  if (!id) return { ...row };
  const userData = { ...clientRowUserData(row) };
  for (const [from, to] of [
    ["name", "clientName"],
    ["clientName", "clientName"],
    ["allowedIps", "allowedIps"],
    ["allowedIPs", "allowedIps"],
    ["last_config", "last_config"],
    ["lastConfig", "last_config"],
    ["creationDate", "creationDate"],
  ]) {
    if (row[from] != null && userData[to] == null) userData[to] = row[from];
  }
  return { ...row, clientId: id, userData };
}

function normalizeClientsTableRows(data) {
  if (Array.isArray(data)) return data.map((row) => normalizeClientTableRow(row)).filter(Boolean);
  if (!data || typeof data !== "object") throw new Error("clientsTable JSON is not an object/array");
  for (const key of ["clients", "users", "rows", "items", "data", "clientList", "clientsTable"]) {
    if (Array.isArray(data[key])) return data[key].map((row) => normalizeClientTableRow(row)).filter(Boolean);
  }
  const out = [];
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const row = normalizeClientTableRow(value, key);
      if (row) out.push(row);
    }
  }
  if (out.length) return out;
  throw new Error("clientsTable format not recognized");
}

/** Совпадает с defaults Amnezia Desktop (protocolConstants awg, desktop MTU). */
const AWG_EXPORT_DEFAULTS = {
  Jc: "3",
  Jmin: "10",
  Jmax: "30",
  S1: "15",
  S2: "18",
  S3: "20",
  S4: "23",
  H1: "1020325451",
  H2: "3288052141",
  H3: "1766607858",
  H4: "2528465083",
  I1: "<r 2><b 0x858000010001000000000669636c6f756403636f6d0000010001c00c000100010000105a00044d583737>",
  I2: "",
  I3: "",
  I4: "",
  I5: "",
};

function parseLastConfigFromClientRow(row) {
  const ud = row?.userData;
  if (!ud || typeof ud !== "object") return null;
  let raw = ud.last_config ?? ud.lastConfig;
  if (typeof raw === "string") {
    raw = raw.trim();
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (raw && typeof raw === "object") return raw;
  return null;
}

function clientHasExportableLastConfig(row) {
  const lc = parseLastConfigFromClientRow(row);
  if (!lc) return false;
  if (String(lc.config ?? lc.nativeConfig ?? "").trim()) return true;
  const priv = lc.client_priv_key || lc.clientPrivKey;
  return Boolean(priv && typeof priv === "string");
}

function pickLc(lc, ...keys) {
  for (const k of keys) {
    const v = lc[k];
    if (v != null && v !== "") return v;
  }
  return undefined;
}

function parseInterfaceKeyValues(head) {
  const out = {};
  for (const line of String(head).split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim();
    out[k] = v;
  }
  return out;
}

/** Имя файла только из ASCII — иначе Node отклоняет заголовок Content-Disposition. */
function safeExportFilenamePart(name, fallback) {
  const toAsciiToken = (s) =>
    String(s ?? "")
      .normalize("NFKD")
      .replace(/[^\x20-\x7E]/g, "")
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 80);
  return toAsciiToken(name) || toAsciiToken(fallback) || "client";
}

function formatExportAllowedIps(lc, fallback = "0.0.0.0/0, ::/0") {
  const v = lc.allowed_ips ?? lc.allowedIps;
  if (Array.isArray(v)) {
    const joined = v.map(String).join(", ");
    return joined.trim() || fallback;
  }
  if (typeof v === "string" && v.trim()) return v.trim();
  return fallback;
}

async function wgPubkeyFromPrivate(rt, privKeyB64) {
  const key = String(privKeyB64).trim();
  if (!/^[A-Za-z0-9+/=_-]+$/.test(key)) {
    throw new Error("Некорректный формат приватного ключа сервера в awg0.conf");
  }
  const q = key.replace(/'/g, `'\\''`);
  const out = await rt.dockerExec(`printf '%s\\n' '${q}' | ${await rt.resolveWgBinary()} pubkey`);
  const pub = out.trim().split(/\s+/)[0];
  if (!pub) throw new Error("Не удалось получить публичный ключ сервера (wg pubkey).");
  return pub;
}

function tunnelClientIpv4(peer, lc, row) {
  const fromLc = pickLc(lc, "client_ip", "clientIp");
  if (fromLc) return String(fromLc).replace(/\/\d+$/, "").trim();
  if (peer?.allowedIPs) {
    const m = String(peer.allowedIPs).match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
    if (m) return m[1];
  }
  const ud = row?.userData || {};
  const udIp = ud.allowedIps || ud.preservedAllowedIPs;
  if (udIp) {
    const m = String(udIp).match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
    if (m) return m[1];
  }
  throw new Error(
    "Нет client_ip в last_config и не удалось взять IPv4 из AllowedIPs peer или из записи клиента (выключен без сохранённого адреса).",
  );
}

function resolveExportEndpointHost(lc, req) {
  const env = process.env.CLIENT_CONFIG_ENDPOINT?.trim();
  if (env) return env;
  const hn = pickLc(lc, "hostName", "hostname", "host");
  if (hn && String(hn).trim()) return String(hn).trim();
  const h = req.headers.host;
  if (h && typeof h === "string") {
    const hostPart = h.split(":")[0].trim();
    if (hostPart && hostPart !== "localhost") return hostPart;
  }
  throw new Error(
    "Не удалось определить Endpoint. Задайте CLIENT_CONFIG_ENDPOINT для контейнера панели (публичный IP или DNS VPS) или hostName в last_config клиента.",
  );
}

async function buildClientConfExport(rt, lc, ifaceMap, req, row, conf) {
  const native = String(lc.config ?? lc.nativeConfig ?? "").trim();
  if (native) return native;

  const priv = pickLc(lc, "client_priv_key", "clientPrivKey");
  if (!priv || typeof priv !== "string") {
    throw new Error(
      "В last_config нет готового текста (config) и нет client_priv_key — восстановить .conf с сервера нельзя.",
    );
  }

  const peer = conf.peers.find((p) => p.publicKey === row.clientId);
  const tunnelIp = tunnelClientIpv4(peer || {}, lc, row);

  let serverPub = pickLc(lc, "server_pub_key", "serverPubKey");
  if (!serverPub && ifaceMap.PrivateKey) {
    serverPub = await wgPubkeyFromPrivate(rt, ifaceMap.PrivateKey);
  }
  if (!serverPub) {
    throw new Error("Нет server_pub_key в last_config и PrivateKey в секции [Interface] сервера.");
  }

  const psk = pickLc(lc, "psk_key", "pskKey");
  if (!psk || typeof psk !== "string") {
    throw new Error("В last_config нет psk_key (общий ключ с сервером).");
  }

  const endpointHost = resolveExportEndpointHost(lc, req);
  const listenPort = ifaceMap.ListenPort ? Number(ifaceMap.ListenPort) : NaN;
  const portNum = Number(pickLc(lc, "port")) || (Number.isFinite(listenPort) ? listenPort : NaN);
  const activeBinary = await rt.resolveWgBinary();
  const defaultPort = activeBinary === "awg" ? 55424 : 51820;
  const port = Number.isFinite(portNum) && portNum > 0 ? portNum : defaultPort;

  const dns1 = String(pickLc(lc, "dns1") || process.env.CLIENT_EXPORT_DNS1?.trim() || "8.8.8.8");
  const dns2 = String(pickLc(lc, "dns2") || process.env.CLIENT_EXPORT_DNS2?.trim() || "8.8.4.4");
  const peerAllowed = formatExportAllowedIps(lc);
  const keepAlive = String(pickLc(lc, "persistent_keep_alive", "persistentKeepAlive") || "25");
  const mtuVal = pickLc(lc, "mtu", "MTU");
  const mtuLine = mtuVal ? `MTU = ${String(mtuVal).trim()}\n` : "";

  if (activeBinary === "awg") {
    const Jc = String(pickLc(lc, "Jc", "junk_packet_count", "junkPacketCount") ?? AWG_EXPORT_DEFAULTS.Jc);
    const Jmin = String(pickLc(lc, "Jmin", "junk_packet_min_size", "junkPacketMinSize") ?? AWG_EXPORT_DEFAULTS.Jmin);
    const Jmax = String(pickLc(lc, "Jmax", "junk_packet_max_size", "junkPacketMaxSize") ?? AWG_EXPORT_DEFAULTS.Jmax);
    const S1 = String(pickLc(lc, "S1", "init_packet_junk_size", "initPacketJunkSize") ?? AWG_EXPORT_DEFAULTS.S1);
    const S2 = String(pickLc(lc, "S2", "response_packet_junk_size", "responsePacketJunkSize") ?? AWG_EXPORT_DEFAULTS.S2);
    const S3 = String(
      pickLc(lc, "S3", "cookie_reply_packet_junk_size", "cookieReplyPacketJunkSize") ?? AWG_EXPORT_DEFAULTS.S3,
    );
    const S4 = String(
      pickLc(lc, "S4", "transport_packet_junk_size", "transportPacketJunkSize") ?? AWG_EXPORT_DEFAULTS.S4,
    );
    const H1 = String(pickLc(lc, "H1", "init_packet_magic_header", "initPacketMagicHeader") ?? AWG_EXPORT_DEFAULTS.H1);
    const H2 = String(
      pickLc(lc, "H2", "response_packet_magic_header", "responsePacketMagicHeader") ?? AWG_EXPORT_DEFAULTS.H2,
    );
    const H3 = String(
      pickLc(lc, "H3", "underload_packet_magic_header", "underloadPacketMagicHeader") ?? AWG_EXPORT_DEFAULTS.H3,
    );
    const H4 = String(
      pickLc(lc, "H4", "transport_packet_magic_header", "transportPacketMagicHeader") ?? AWG_EXPORT_DEFAULTS.H4,
    );
    const I1 = String(pickLc(lc, "I1", "special_junk_1", "specialJunk1") ?? AWG_EXPORT_DEFAULTS.I1);
    const I2 = String(pickLc(lc, "I2", "special_junk_2", "specialJunk2") ?? AWG_EXPORT_DEFAULTS.I2);
    const I3 = String(pickLc(lc, "I3", "special_junk_3", "specialJunk3") ?? AWG_EXPORT_DEFAULTS.I3);
    const I4 = String(pickLc(lc, "I4", "special_junk_4", "specialJunk4") ?? AWG_EXPORT_DEFAULTS.I4);
    const I5 = String(pickLc(lc, "I5", "special_junk_5", "specialJunk5") ?? AWG_EXPORT_DEFAULTS.I5);

    return `[Interface]
Address = ${tunnelIp}/32
DNS = ${dns1}, ${dns2}
PrivateKey = ${priv.trim()}
Jc = ${Jc}
Jmin = ${Jmin}
Jmax = ${Jmax}
S1 = ${S1}
S2 = ${S2}
S3 = ${S3}
S4 = ${S4}
H1 = ${H1}
H2 = ${H2}
H3 = ${H3}
H4 = ${H4}
I1 = ${I1}
I2 = ${I2}
I3 = ${I3}
I4 = ${I4}
I5 = ${I5}
${mtuLine}[Peer]
PublicKey = ${String(serverPub).trim()}
PresharedKey = ${String(psk).trim()}
AllowedIPs = ${peerAllowed}
Endpoint = ${endpointHost}:${port}
PersistentKeepalive = ${keepAlive}
`;
  }

  return `[Interface]
Address = ${tunnelIp}/32
DNS = ${dns1}, ${dns2}
PrivateKey = ${priv.trim()}
${mtuLine}[Peer]
PublicKey = ${String(serverPub).trim()}
PresharedKey = ${String(psk).trim()}
AllowedIPs = ${peerAllowed}
Endpoint = ${endpointHost}:${port}
PersistentKeepalive = ${keepAlive}
`;
}

function assertCascadeEndpointHost(raw) {
  const s = String(raw ?? "").trim();
  if (!s || s.length > 253) {
    throw new Error("Укажите IP или DNS для Endpoint (куда клиент будет стучаться в каскаде).");
  }
  if (/[\s<>\"']/.test(s)) {
    throw new Error("Недопустимые символы в Endpoint.");
  }
  return s;
}

function parseIpv4ToParts(ip) {
  const m = String(ip).trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const o = [1, 2, 3, 4].map((i) => parseInt(m[i], 10));
  if (o.some((x) => x > 255 || Number.isNaN(x))) return null;
  return o;
}

async function awgGenKeypair(rt) {
  const activeBinary = await rt.resolveWgBinary();
  const privOut = await rt.dockerExec(`${activeBinary} genkey`);
  const priv = privOut.trim().split(/\s+/)[0];
  if (!priv || !/^[A-Za-z0-9+/=_-]+$/.test(priv)) {
    throw new Error("Не удалось сгенерировать ключ клиента (genkey).");
  }
  const q = priv.replace(/'/g, `'\\''`);
  const pubOut = await rt.dockerExec(`printf '%s\\n' '${q}' | ${activeBinary} pubkey`);
  const pub = pubOut.trim().split(/\s+/)[0];
  if (!pub) throw new Error("Не удалось получить публичный ключ клиента.");
  return { priv, pub };
}

function obfuscationFieldsFromServerHead(ifaceMap) {
  const keys = ["Jc", "Jmin", "Jmax", "S1", "S2", "S3", "S4", "H1", "H2", "H3", "H4", "I1", "I2", "I3", "I4", "I5"];
  const out = {};
  for (const k of keys) {
    const v = ifaceMap[k];
    if (v != null && String(v).trim() !== "") {
      out[k] = String(v).trim();
    }
  }
  return out;
}

function collectUsedTunnelIps(conf) {
  const used = new Set();
  for (const p of conf.peers) {
    const raw = p.allowedIPs || "";
    const re = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})(?:\/\d+)?/g;
    let m;
    while ((m = re.exec(raw)) !== null) {
      used.add(m[1]);
    }
  }
  return used;
}

function inferSubnetPrefixFromConf(conf, ifaceMap) {
  const addrRaw = ifaceMap.Address || ifaceMap.address;
  if (addrRaw) {
    const chunk = String(addrRaw).split(",")[0].trim();
    const parts = parseIpv4ToParts(chunk.split("/")[0]);
    if (parts) {
      return `${parts[0]}.${parts[1]}.${parts[2]}`;
    }
  }
  for (const p of conf.peers) {
    const m = String(p.allowedIPs || "").match(/(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}/);
    if (m) return m[1];
  }
  return "10.8.1";
}

function suggestNextTunnelIp(conf, ifaceMap) {
  const prefix = inferSubnetPrefixFromConf(conf, ifaceMap);
  const used = collectUsedTunnelIps(conf);
  let maxLast = 1;
  for (const ip of used) {
    if (!ip.startsWith(`${prefix}.`)) continue;
    const last = parseInt(ip.slice(prefix.length + 1), 10);
    if (!Number.isNaN(last)) maxLast = Math.max(maxLast, last);
  }
  for (let last = Math.max(2, maxLast + 1); last <= 254; last++) {
    const candidate = `${prefix}.${last}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error("Не нашёл свободный IPv4 в подсети VPN для нового клиента.");
}

function normalizeCascadeTunnelIp(conf, ifaceMap, requested) {
  const prefix = inferSubnetPrefixFromConf(conf, ifaceMap);
  if (!requested || !String(requested).trim()) {
    return suggestNextTunnelIp(conf, ifaceMap);
  }
  const stripped = String(requested).trim().replace(/\/32$/i, "");
  const parts = parseIpv4ToParts(stripped);
  if (!parts) {
    throw new Error("Некорректный IP туннеля (ожидается IPv4, например 10.8.1.10).");
  }
  const triple = `${parts[0]}.${parts[1]}.${parts[2]}`;
  if (triple !== prefix) {
    throw new Error(`IP клиента должен быть в подсети ${prefix}.x как у остальных клиентов этого инстанса.`);
  }
  const full = `${parts[0]}.${parts[1]}.${parts[2]}.${parts[3]}`;
  const used = collectUsedTunnelIps(conf);
  if (used.has(full)) {
    throw new Error(`Адрес ${full} уже занят другим клиентом.`);
  }
  return full;
}

async function disableClient(rt, clientId, ts) {
  await rt.backupRemoteFiles();
  const { conf, clients } = await rt.loadState();
  const peer = conf.peers.find((p) => p.publicKey === clientId);
  if (!peer) {
    throw new Error("Peer not in config (already disabled?)");
  }
  const nextPeers = conf.peers.filter((p) => p.publicKey !== clientId);
  const nextConfText = serializeAwgConf(conf.head, nextPeers);
  const idx = clients.findIndex((c) => clientRowId(c) === clientId);
  if (idx === -1) throw new Error("Client not in clientsTable");
  const ud = { ...(clients[idx].userData || {}) };
  ud.disabled = true;
  ud.disabledAt = ts;
  ud.lastDisconnectedAt = ts;
  delete ud.scheduledTunnelDisconnectAt;
  ud.preservedPresharedKey = peer.presharedKey || ud.preservedPresharedKey;
  ud.preservedAllowedIPs = peer.allowedIPs || ud.preservedAllowedIPs;
  clients[idx] = { ...clients[idx], userData: ud };
  await rt.dockerWriteFile(rt.confPath, nextConfText);
  await rt.dockerWriteFile(rt.clientsPath, stringifyClientsTable(clients));
  await rt.applySyncconf();
}

async function processScheduledDisconnects(rt) {
  const now = Date.now();
  const { clients, peerByKey } = await rt.loadState();
  const due = [];
  for (const c of clients) {
    const ud = c.userData || {};
    const iso = ud.scheduledTunnelDisconnectAt;
    const rowId = clientRowId(c);
    if (!iso || !peerByKey.get(rowId)) continue;
    const t = new Date(iso).getTime();
    if (Number.isNaN(t) || t > now) continue;
    due.push({ clientId: rowId, ts: new Date(iso).toISOString() });
  }
  if (!due.length) return;
  await rt.backupRemoteFiles();
  for (const { clientId, ts } of due) {
    try {
      await disableClient(rt, clientId, ts);
    } catch (e) {
      console.error(`scheduled off ${clientId} [${rt.profile.id}]:`, e);
    }
  }
}

async function processAllScheduledDisconnects() {
  for (const profile of PROFILES) {
    await processScheduledDisconnects(createRuntime(profile));
  }
}

/** ISO string; пустое значение → текущий момент */
function normalizeDisconnectedAtOptional(raw) {
  if (raw == null || raw === "") return new Date().toISOString();
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    throw new Error("Некорректная дата disconnectedAt");
  }
  return d.toISOString();
}

function requireDisconnectedAt(raw) {
  if (raw == null || raw === "") {
    throw new Error("Укажите дату отключения");
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    throw new Error("Некорректная дата");
  }
  return d.toISOString();
}

/** Пояс для строки «Сервер»: переменная TZ контейнера или значение из Intl (часто UTC в Docker). Без подмены под пояс браузера. */
function resolveServerClockTimeZone() {
  const tzEnv = process.env.TZ?.trim();
  if (tzEnv) return tzEnv;
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Смещение от UTC в минутах для IANA-пояса в данный момент (через GMT± из Intl). */
function offsetMinutesFromUtc(timeZone, date) {
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "longOffset",
    });
    const parts = dtf.formatToParts(date);
    let raw = parts.find((p) => p.type === "timeZoneName")?.value || "";
    raw = raw.replace(/\u2212/g, "-").trim();
    let m = raw.match(/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/i);
    if (!m) {
      m = raw.match(/^([+-])(\d{2}):(\d{2})$/);
      if (m) {
        const sign = m[1] === "-" ? -1 : 1;
        const h = parseInt(m[2], 10);
        const min = parseInt(m[3], 10);
        return sign * (h * 60 + min);
      }
      return 0;
    }
    const sign = m[1] === "-" ? -1 : 1;
    const h = parseInt(m[2], 10);
    const min = m[3] ? parseInt(m[3], 10) : 0;
    return sign * (h * 60 + min);
  } catch {
    return 0;
  }
}

function buildZoneCompare(serverTz, browserTz, now) {
  if (!browserTz) {
    return { sameZone: null, hint: "", diffMinutes: null };
  }
  if (browserTz === serverTz) {
    return {
      sameZone: true,
      hint: "Пояс браузера совпадает с поясом строки «Сервер» — часы совпадут.",
      diffMinutes: 0,
    };
  }
  const so = offsetMinutesFromUtc(serverTz, now);
  const bo = offsetMinutesFromUtc(browserTz, now);
  const diffMin = bo - so;
  const abs = Math.abs(diffMin);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const ahead = diffMin > 0;
  const hint = ahead
    ? `Ваше место (${browserTz}): на ${h} ч ${m} мин «впереди» строки «Сервер» (${serverTz}) при одном UTC.`
    : `Ваше место (${browserTz}): на ${h} ч ${m} мин «позже» пояса сервера (${serverTz}).`;
  return { sameZone: false, hint, diffMinutes: diffMin };
}

function sshpassBinaryPath() {
  for (const p of ["/usr/bin/sshpass", "/usr/local/bin/sshpass"]) {
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return p;
    } catch {
      /* next */
    }
  }
  return null;
}

function hostTimeSyncConfigured() {
  if (process.env.TIME_SYNC_DISABLED === "1" || process.env.TIME_SYNC_DISABLED === "true") {
    return false;
  }
  return !!sshpassBinaryPath();
}

function sshRootRun(password, host, remoteCmd) {
  const bin = sshpassBinaryPath();
  if (!bin) {
    return Promise.reject(new Error("sshpass не установлен"));
  }
  return new Promise((resolve, reject) => {
    const args = [
      "-p",
      password,
      "ssh",
      "-oStrictHostKeyChecking=no",
      "-oUserKnownHostsFile=/dev/null",
      "-oConnectTimeout=15",
      "-oPreferredAuthentications=password",
      "-oPubkeyAuthentication=no",
      `root@${host}`,
      remoteCmd,
    ];
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err += c));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(out.trim());
      else reject(new Error(err.trim() || out.trim() || `ssh код ${code}`));
    });
  });
}

ensureDataDir();
loadOrCreateSessionSecret();
bootstrapPassword();

/** Сообщение для отключённых через UI_HIDE разделов WARP / каскада. */
const MSG_UI_WARP_OFF = "Раздел Cloudflare WARP отключён на этом сервере (UI_HIDE_SECTIONS / UI_HIDE_WARP).";
const MSG_UI_CASCADE_OFF =
  "Каскад отключён на этом сервере (UI_HIDE_SECTIONS / UI_HIDE_CASCADE).";
const MSG_UI_MTProto_OFF = "Раздел MTProto отключён (UI_HIDE_SECTIONS включает mtproto или задан UI_HIDE_MTPROTO=1).";
const MSG_WARP_CF_HELP =
  "Официальный cloudflare-warp (warp-cli SOCKS5): нужен sshpass в образе панели и вход root по паролю на хосте (TIME_SYNC_SSH_HOST, часто 172.17.0.1). Скрипт: scripts/warp-install-cf.sh";

const MTPRO_CONTAINER = (process.env.MTPRO_PROXY_CONTAINER || "mtproto-proxy").trim();
const MTPRO_IMAGE = (process.env.MTPRO_PROXY_IMAGE || "telegrammessenger/proxy:latest").trim();
const MTPRO_INTERNAL_PORT = Number(process.env.MTPRO_INTERNAL_PORT || 443) || 443;
const MTPRO_PUBLISH_PORT_DEFAULT = (() => {
  const n = Number.parseInt(process.env.MTPRO_PUBLISH_PORT || "8443", 10);
  return Number.isFinite(n) && n > 0 ? n : 8443;
})();
const MTPRO_PUBLISH_BIND = (process.env.MTPRO_PUBLISH_BIND || "0.0.0.0").trim() || "0.0.0.0";

let mtprotoInstallBusy = false;

function dockerSpawnSync(args, timeoutMs = 180_000) {
  const r = spawnSync("docker", args, {
    encoding: "utf8",
    maxBuffer: 5 * 1024 * 1024,
    timeout: timeoutMs,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    code: typeof r.status === "number" ? r.status : 1,
    stdout: String(r.stdout || ""),
    stderr: String(r.stderr || ""),
  };
}

function envArrayToMap(envArr) {
  const out = {};
  if (!Array.isArray(envArr)) return out;
  for (const line of envArr) {
    const i = line.indexOf("=");
    if (i <= 0) continue;
    out[line.slice(0, i)] = line.slice(i + 1);
  }
  return out;
}

function mtprotoParsedInspect() {
  const r = dockerSpawnSync(["inspect", MTPRO_CONTAINER], 20_000);
  if (r.code !== 0) return null;
  try {
    const arr = JSON.parse(r.stdout);
    return arr?.[0] ?? null;
  } catch {
    return null;
  }
}

function mtprotoHostPort(ins) {
  const key = `${MTPRO_INTERNAL_PORT}/tcp`;
  const bind = ins?.HostConfig?.PortBindings?.[key];
  if (Array.isArray(bind) && bind[0]?.HostPort) return String(bind[0].HostPort);
  const ex = ins?.NetworkSettings?.Ports?.[key];
  if (Array.isArray(ex) && ex[0]?.HostPort) return String(ex[0].HostPort);
  return null;
}

function mtprotoAdvertisedHost() {
  const a =
    process.env.MTPRO_PUBLIC_HOST?.trim() ||
    process.env.CLIENT_CONFIG_ENDPOINT?.trim();
  return a || "";
}

/** Хост из заголовка запроса (без :порт) — фоллбек, когда env не заданы и пользователь открыл панель по IP/DNS. */
function hostFromRequest(req) {
  const raw = String(req?.headers?.host || "").trim();
  if (!raw) return "";
  const bare = raw.replace(/^\[/, "").replace(/\]:\d+$/, "]").replace(/:\d+$/, "");
  if (!bare || /^(localhost|127\.|0\.0\.0\.0|::1?$)/i.test(bare)) return "";
  return bare;
}

function mtprotoMaskedSecret(secret) {
  const s = String(secret || "").trim();
  if (s.length < 10) return "········";
  return `········${s.slice(-6)}`;
}

function mtprotoTelegramDeepLink(host, port, secretHex) {
  const h = String(host || "").trim();
  const p = Number(port);
  const sec = String(secretHex || "").trim();
  if (!h || !Number.isFinite(p) || !sec) return "";
  try {
    return `tg://proxy?server=${encodeURIComponent(h)}&port=${encodeURIComponent(String(p))}&secret=${encodeURIComponent(sec)}`;
  } catch {
    return "";
  }
}

function mtprotoNormalizeSecret(hex) {
  const s = String(hex || "").trim().toLowerCase();
  if (/^[0-9a-f]{32}$/.test(s)) return s;
  return "";
}

function mtprotoSnapshot(fallbackHost = "") {
  const ins = mtprotoParsedInspect();
  const advEnv = mtprotoAdvertisedHost();
  const advFallback = String(fallbackHost || "").trim();
  const advEffective = advEnv || advFallback;
  const advSource = advEnv ? "env" : advFallback ? "request" : "";

  if (!ins) {
    return {
      exists: false,
      running: false,
      container: MTPRO_CONTAINER,
      image: MTPRO_IMAGE,
      hostPort: null,
      advertisedHost: advEffective,
      advertisedHostSource: advSource,
      secretMasked: "",
      tgLink: "",
      hint: "Контейнер не найден — нажмите «Установить».",
    };
  }
  const state = String(ins?.State?.Status || "").toLowerCase();
  const running = state === "running";
  const cfg = ins?.Config || {};
  const envMap = envArrayToMap(cfg?.Env);
  const secret = envMap.SECRET || "";
  const hostPort = mtprotoHostPort(ins);
  return {
    exists: true,
    running,
    container: MTPRO_CONTAINER,
    image: String(cfg?.Image || MTPRO_IMAGE),
    hostPort,
    advertisedHost: advEffective,
    advertisedHostSource: advSource,
    secretMasked: secret ? mtprotoMaskedSecret(secret) : "",
    tgLink: mtprotoTelegramDeepLink(advEffective, Number(hostPort || 0), secret),
    restartCount: Number(ins?.RestartCount || 0) || 0,
    hint: advEnv
      ? ""
      : advFallback
        ? `Хост ${advFallback} взят из адреса, по которому открыта эта панель. Чтобы зафиксировать публичный IP/DNS, задайте MTPRO_PUBLIC_HOST или CLIENT_CONFIG_ENDPOINT в контейнере панели.`
        : "Задайте MTPRO_PUBLIC_HOST или CLIENT_CONFIG_ENDPOINT на IP/DNS VPS — тогда появится прямая ссылка tg:// для клиентов.",
  };
}

const app = express();
if (UI_HIDDEN.users || UI_HIDDEN.warp || UI_HIDDEN.cascade || UI_HIDDEN.mtproto) {
  console.warn(
    `UI_HIDDEN: users=${UI_HIDDEN.users} warp=${UI_HIDDEN.warp} cascade=${UI_HIDDEN.cascade} mtproto=${UI_HIDDEN.mtproto}`,
  );
}
app.use(express.json({ limit: "512kb" }));
app.use(express.urlencoded({ extended: false, limit: "512kb" }));
app.use(express.text({ type: "text/plain", limit: "512kb" }));

function normalizeBody(body) {
  if (!body) return {};
  if (typeof body === "string") {
    const raw = body.trim();
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // Old cached clients may post a plain password string.
    }
    return { password: raw };
  }
  if (typeof body === "object") return body;
  return {};
}
app.get("/health", (_req, res) => {
  res.json({ ok: true, version: PANEL_VERSION });
});

/** Публичные ссылки доната / Telegram‑спонсора для интерфейса панели (без авторизации). */
app.get("/api/panel/footer", (_req, res) => {
  res.json(panelPromoFooterPayload());
});

app.get("/api/session", (req, res) => {
  if (!readSession(getSessionToken(req))) {
    res.status(401).json({ ok: false });
    return;
  }
  res.json({ ok: true });
});

app.get("/api/server-time", requireAuth, (req, res) => {
  const now = new Date();
  const timeZone = resolveServerClockTimeZone();
  let formatted;
  try {
    formatted = now.toLocaleString("ru-RU", {
      dateStyle: "medium",
      timeStyle: "medium",
      timeZone,
    });
  } catch {
    formatted = now.toLocaleString("ru-RU", {
      dateStyle: "medium",
      timeStyle: "medium",
    });
  }
  const browserTz =
    typeof req.query.browserTz === "string" ? req.query.browserTz.trim() : "";
  const zoneCompare = buildZoneCompare(timeZone, browserTz, now);
  res.json({
    iso: now.toISOString(),
    formatted,
    timeZone,
    browserTimeZone: browserTz || null,
    zoneSame: zoneCompare.sameZone,
    zoneCompareHint: zoneCompare.hint,
    zoneDiffMinutes: zoneCompare.diffMinutes ?? null,
  });
});

app.get("/api/time-sync-capabilities", requireAuth, (_req, res) => {
  res.json({
    hostTimeSync: false,
    sshHost: process.env.TIME_SYNC_SSH_HOST?.trim() || "172.17.0.1",
    serverClockTimeZone: resolveServerClockTimeZone(),
  });
});

function mtprotoLogsTailPayload(req) {
  const snap = mtprotoSnapshot(hostFromRequest(req));
  if (!snap.exists || !snap.running) return { logsTail: "" };
  const l = dockerSpawnSync(["logs", "--tail", "100", MTPRO_CONTAINER], 12_000);
  let logsTail = "";
  if (l.code === 0) logsTail = l.stdout.trim().slice(-4500);
  return { logsTail };
}

app.get("/api/mtproto/status", requireAuth, (req, res) => {
  if (effectiveUiHidden().mtproto) {
    return res.status(403).json({ error: MSG_UI_MTProto_OFF });
  }
  const snap = mtprotoSnapshot(hostFromRequest(req));
  const withLogs =
    typeof req.query.withLogs === "string" &&
    (req.query.withLogs === "1" || req.query.withLogs === "");
  if (!withLogs) {
    res.json({ ...snap });
    return;
  }
  const { logsTail } = mtprotoLogsTailPayload(req);
  res.json({ ...snap, logsTail, logsFetched: true });
});

app.get("/api/mtproto/logs", requireAuth, (req, res) => {
  if (effectiveUiHidden().mtproto) {
    return res.status(403).json({ error: MSG_UI_MTProto_OFF });
  }
  res.json(mtprotoLogsTailPayload(req));
});

/** Алиас к `/logs` (редко нужен для обхода прокси, где путь содержит `logs` фильтруется). */
app.get("/api/mtproto/tail", requireAuth, (req, res) => {
  if (effectiveUiHidden().mtproto) {
    return res.status(403).json({ error: MSG_UI_MTProto_OFF });
  }
  res.json(mtprotoLogsTailPayload(req));
});

app.post("/api/mtproto/install", requireAuth, (req, res) => {
  if (effectiveUiHidden().mtproto) {
    return res.status(403).json({ error: MSG_UI_MTProto_OFF });
  }
  if (!/^[a-zA-Z][a-zA-Z0-9_.-]*$/.test(MTPRO_CONTAINER)) {
    return res.status(500).json({
      error:
        "Некорректное имя Docker-контейнера MTProto (переменная окружения MTPRO_PROXY_CONTAINER).",
    });
  }
  if (!/^[a-zA-Z0-9_.\-/:@]+$/.test(MTPRO_IMAGE)) {
    return res.status(500).json({
      error: "Некорректное имя образа MTProto (переменная MTPRO_PROXY_IMAGE).",
    });
  }
  if (!/^[0-9.:a-fA-F]+$/.test(MTPRO_PUBLISH_BIND)) {
    return res.status(500).json({
      error: "Некорректный MTPRO_PUBLISH_BIND.",
    });
  }

  let hostPort = MTPRO_PUBLISH_PORT_DEFAULT;
  const hpReq = req.body?.hostPort;
  if (hpReq !== undefined && hpReq !== null && hpReq !== "") {
    const parsed = typeof hpReq === "number" ? hpReq : Number.parseInt(String(hpReq).trim(), 10);
    if (!Number.isFinite(parsed) || parsed < 512 || parsed > 65535) {
      return res.status(400).json({ error: "Порт (hostPort): целое 512 … 65535." });
    }
    hostPort = parsed;
  }

  const userSec = mtprotoNormalizeSecret(typeof req.body?.secret === "string" ? req.body.secret : "");
  const secretFinal = userSec || crypto.randomBytes(16).toString("hex");

  if (mtprotoInstallBusy) return res.status(429).json({ error: "Установка MTProto уже выполняется." });

  mtprotoInstallBusy = true;
  try {
    const rm = dockerSpawnSync(["rm", "-f", MTPRO_CONTAINER], 120_000);
    if (rm.code !== 0 && !/No such container/i.test(`${rm.stderr} ${rm.stdout}`)) {
      return res.status(400).json({
        error: `docker rm завершился с кодом ${rm.code}`,
        stderr: rm.stderr.trim().slice(0, 2000),
      });
    }

    const pull = dockerSpawnSync(["pull", MTPRO_IMAGE], 600_000);
    if (pull.code !== 0) {
      return res.status(400).json({
        error: "Не удалось docker pull образа.",
        stderr: `${pull.stderr || ""}${pull.stdout || ""}`.trim().slice(0, 2000),
      });
    }

    const pub = `${MTPRO_PUBLISH_BIND}:${hostPort}:${MTPRO_INTERNAL_PORT}/tcp`;
    const args = [
      "run",
      "-d",
      "--name",
      MTPRO_CONTAINER,
      "--restart",
      "unless-stopped",
      "-p",
      pub,
      "-e",
      `SECRET=${secretFinal}`,
      MTPRO_IMAGE,
    ];
    const run = dockerSpawnSync(args, 120_000);
    if (run.code !== 0) {
      return res.status(400).json({
        error: `docker run завершился с кодом ${run.code}`,
        stderr: `${run.stderr}${run.stdout}`.trim().slice(0, 4000),
      });
    }

    const fallback = hostFromRequest(req);
    const advEnv = mtprotoAdvertisedHost();
    const advEffective = advEnv || fallback;
    const snap = mtprotoSnapshot(fallback);
    const tgLink = mtprotoTelegramDeepLink(advEffective, hostPort, secretFinal);

    res.json({
      ok: true,
      secretHex: secretFinal,
      hostPort,
      tgLink,
      advertisedHost: advEffective,
      advertisedHostSource: advEnv ? "env" : fallback ? "request" : "",
      snapshot: snap,
    });
  } finally {
    mtprotoInstallBusy = false;
  }
});

app.post("/api/mtproto/remove", requireAuth, (_req, res) => {
  if (effectiveUiHidden().mtproto) {
    return res.status(403).json({ error: MSG_UI_MTProto_OFF });
  }
  const r = dockerSpawnSync(["rm", "-f", MTPRO_CONTAINER], 120_000);
  if (r.code !== 0 && !/No such container/i.test(`${r.stderr} ${r.stdout}`)) {
    return res.status(400).json({
      error: "Не удалось удалить контейнер MTProto.",
      stderr: `${r.stderr}${r.stdout}`.trim().slice(0, 2000),
    });
  }
  res.json({ ok: true });
});

app.post("/api/mtproto/restart", requireAuth, (_req, res) => {
  if (effectiveUiHidden().mtproto) {
    return res.status(403).json({ error: MSG_UI_MTProto_OFF });
  }
  const snap = mtprotoSnapshot();
  if (!snap.exists) return res.status(400).json({ error: "Контейнер MTProto ещё не установлен." });
  const r = dockerSpawnSync(["restart", MTPRO_CONTAINER], 180_000);
  if (r.code !== 0) {
    return res.status(400).json({
      error: `docker restart завершился с кодом ${r.code}`,
      stderr: `${r.stderr}${r.stdout}`.trim().slice(0, 2000),
    });
  }
  res.json({ ok: true });
});

app.post("/api/sync-host-time", requireAuth, requireProTier, async (req, res) => {
  if (!hostTimeSyncConfigured()) {
    return res.status(503).json({
      error:
        "Синхронизация времени хоста недоступна (нет sshpass или TIME_SYNC_DISABLED=1).",
    });
  }
  const pw = req.body?.rootPassword;
  const unixMsRaw = req.body?.unixMs;
  const unixMs =
    typeof unixMsRaw === "number" && Number.isFinite(unixMsRaw) ? unixMsRaw : Date.now();
  if (typeof pw !== "string" || !pw) {
    return res.status(400).json({ error: "Укажите пароль root VPS" });
  }
  const unixSec = Math.floor(unixMs / 1000);
  if (!Number.isFinite(unixSec)) {
    return res.status(400).json({ error: "Некорректное время" });
  }
  const host = process.env.TIME_SYNC_SSH_HOST?.trim() || "172.17.0.1";
  const remoteCmd = `bash -lc 'date -u --set=@${unixSec} 2>/dev/null || date -s @${unixSec}; (command -v hwclock >/dev/null && hwclock -w --utc) || true; date -u +%Y-%m-%dT%H:%M:%SZ'`;
  try {
    const confirmed = await sshRootRun(pw, host, remoteCmd);
    res.json({ ok: true, utc: confirmed });
  } catch {
    console.warn("sync-host-time: ssh не выполнен");
    res.status(400).json({
      error:
        "Не удалось выставить время по SSH. Проверьте пароль root, вход root по паролю на хосте и переменную TIME_SYNC_SSH_HOST (часто 172.17.0.1 с контейнера).",
    });
  }
});

app.post("/api/warp/host-setup", requireAuth, requireProTier, async (req, res) => {
  if (UI_HIDDEN.warp) {
    return res.status(403).json({ error: MSG_UI_WARP_OFF });
  }
  if (!hostTimeSyncConfigured()) {
    return res.status(503).json({
      error:
        "С панели недоступно: в образе панели нет sshpass или задано TIME_SYNC_DISABLED=1. Запустите на хосте VPS вручную: bash /opt/amnezia-admin/scripts/warp-amnezia.sh install",
    });
  }
  const pw = req.body?.rootPassword;
  const cmd = req.body?.cmd;
  if (typeof pw !== "string" || !pw.trim()) {
    return res.status(400).json({ error: "Укажите пароль root VPS" });
  }
  if (cmd !== "install" && cmd !== "uninstall") {
    return res.status(400).json({ error: "Ожидается cmd: install или uninstall" });
  }
  const rt = runtimeForRequest(req);
  const container = String(rt.profile.container || "").trim();
  if (!/^[a-zA-Z0-9_.-]+$/.test(container)) {
    return res.status(400).json({ error: "Некорректное имя контейнера в профиле AWG" });
  }
  let installDir = "/opt/amnezia-admin";
  try {
    installDir = assertSafeUnixPath(process.env.WARP_SSH_INSTALL_DIR?.trim() || "/opt/amnezia-admin");
  } catch {
    return res.status(500).json({ error: "Некорректная переменная WARP_SSH_INSTALL_DIR на сервере панели" });
  }
  const host = process.env.TIME_SYNC_SSH_HOST?.trim() || "172.17.0.1";
  const remoteCmd = `bash -lc 'cd ${installDir} && chmod +x scripts/warp-amnezia.sh 2>/dev/null || true && AWG_CONTAINER=${container} ./scripts/warp-amnezia.sh ${cmd}'`;
  try {
    const out = await sshRootRun(pw.trim(), host, remoteCmd);
    res.json({ ok: true, output: out.slice(0, 8000) });
  } catch (e) {
    console.warn("warp host-setup:", e);
    res.status(400).json({
      error:
        String(e.message || e) ||
        "Не удалось выполнить по SSH. Проверьте пароль root, что вход root по паролю разрешён, переменную TIME_SYNC_SSH_HOST и наличие каталога со скриптом на хосте.",
    });
  }
});

function safeSshInstallDirOrDefault() {
  try {
    return assertSafeUnixPath(process.env.WARP_SSH_INSTALL_DIR?.trim() || "/opt/amnezia-admin");
  } catch {
    return "/opt/amnezia-admin";
  }
}

function assertPort512_65535(raw, fallback = 40000) {
  if (raw == null || raw === "") return fallback;
  const n = typeof raw === "number" ? raw : Number.parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(n) || n < 512 || n > 65535) {
    throw new Error("Порт: целое 512 … 65535.");
  }
  return n;
}

async function sshRunWarpCf(pw, action, { socksPort, licenseKey } = {}) {
  const host = process.env.TIME_SYNC_SSH_HOST?.trim() || "172.17.0.1";
  const installDir = safeSshInstallDirOrDefault();
  const port = socksPort != null ? assertPort512_65535(socksPort, 40000) : 40000;
  const key = typeof licenseKey === "string" ? licenseKey.trim() : "";

  let scriptCall = "";
  if (action === "install") scriptCall = `./scripts/warp-install-cf.sh install ${port}`;
  if (action === "uninstall") scriptCall = `./scripts/warp-install-cf.sh uninstall`;
  if (action === "status") scriptCall = `./scripts/warp-install-cf.sh status`;
  if (action === "license") {
    if (!key) throw new Error("WARP+ ключ обязателен.");
    const q = key.replace(/'/g, "'\\''");
    scriptCall = `./scripts/warp-install-cf.sh license '${q}'`;
  }
  if (!scriptCall) throw new Error("bad action");

  const remoteCmd = `bash -lc 'cd ${installDir} && chmod +x scripts/warp-install-cf.sh 2>/dev/null || true && ${scriptCall}'`;
  return await sshRootRun(pw.trim(), host, remoteCmd);
}

app.post("/api/warp-cf/install", requireAuth, requireProTier, async (req, res) => {
  const pw = req.body?.rootPassword;
  if (typeof pw !== "string" || !pw.trim()) return res.status(400).json({ error: "Укажите пароль root VPS" });
  if (!hostTimeSyncConfigured()) {
    return res.status(503).json({ error: `Недоступно: нет sshpass или TIME_SYNC_DISABLED=1. ${MSG_WARP_CF_HELP}` });
  }
  try {
    const socksPort = assertPort512_65535(req.body?.socksPort, 40000);
    const out = await sshRunWarpCf(pw, "install", { socksPort });
    res.json({ ok: true, output: out.slice(0, 12_000), socksPort });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

app.post("/api/warp-cf/uninstall", requireAuth, requireProTier, async (req, res) => {
  const pw = req.body?.rootPassword;
  if (typeof pw !== "string" || !pw.trim()) return res.status(400).json({ error: "Укажите пароль root VPS" });
  if (!hostTimeSyncConfigured()) {
    return res.status(503).json({ error: `Недоступно: нет sshpass или TIME_SYNC_DISABLED=1. ${MSG_WARP_CF_HELP}` });
  }
  try {
    const out = await sshRunWarpCf(pw, "uninstall");
    res.json({ ok: true, output: out.slice(0, 12_000) });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

app.post("/api/warp-cf/license", requireAuth, requireProTier, async (req, res) => {
  const pw = req.body?.rootPassword;
  const key = req.body?.licenseKey;
  if (typeof pw !== "string" || !pw.trim()) return res.status(400).json({ error: "Укажите пароль root VPS" });
  if (typeof key !== "string" || !key.trim()) return res.status(400).json({ error: "Укажите WARP+ ключ" });
  if (!hostTimeSyncConfigured()) {
    return res.status(503).json({ error: `Недоступно: нет sshpass или TIME_SYNC_DISABLED=1. ${MSG_WARP_CF_HELP}` });
  }
  try {
    const out = await sshRunWarpCf(pw, "license", { licenseKey: key });
    res.json({ ok: true, output: out.slice(0, 12_000) });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

app.post("/api/warp-cf/status", requireAuth, requireProTier, async (req, res) => {
  const pw = req.body?.rootPassword;
  if (typeof pw !== "string" || !pw.trim()) return res.status(400).json({ error: "Укажите пароль root VPS" });
  if (!hostTimeSyncConfigured()) {
    return res.status(503).json({ error: `Недоступно: нет sshpass или TIME_SYNC_DISABLED=1. ${MSG_WARP_CF_HELP}` });
  }
  try {
    const raw = await sshRunWarpCf(pw, "status");
    let parsed = null;
    try {
      parsed = JSON.parse(String(raw || "").trim());
    } catch {
      parsed = null;
    }
    if (!parsed || typeof parsed !== "object") {
      return res.json({
        installed: false,
        running: false,
        mode: "",
        proxyPort: null,
        account: "",
        rawStatus: String(raw || "").slice(0, 12_000),
        rawAccount: "",
      });
    }
    res.json(parsed);
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

app.post("/api/warp-cf/xray-apply", requireAuth, requireProTier, async (req, res) => {
  const pw = req.body?.rootPassword;
  const filePath = req.body?.filePath;
  const socksAddress = req.body?.socksAddress;
  if (typeof pw !== "string" || !pw.trim()) return res.status(400).json({ error: "Укажите пароль root VPS" });
  if (typeof filePath !== "string" || !filePath.trim()) return res.status(400).json({ error: "Укажите filePath" });
  if (typeof socksAddress !== "string" || !socksAddress.trim()) {
    return res.status(400).json({ error: "Укажите socksAddress (127.0.0.1 или 172.17.0.1)" });
  }
  if (!hostTimeSyncConfigured()) {
    return res.status(503).json({ error: `Недоступно: нет sshpass или TIME_SYNC_DISABLED=1. ${MSG_WARP_CF_HELP}` });
  }
  let port;
  try {
    port = assertPort512_65535(req.body?.socksPort, 40000);
  } catch (e) {
    return res.status(400).json({ error: String(e.message || e) });
  }
  const domains = typeof req.body?.domains === "string" ? req.body.domains.trim() : "";
  try {
    const host = process.env.TIME_SYNC_SSH_HOST?.trim() || "172.17.0.1";
    const installDir = safeSshInstallDirOrDefault();
    const f = assertSafeUnixPath(filePath.trim());
    const addr = socksAddress.trim();
    if (!/^(127\.0\.0\.1|172\.17\.0\.1)$/.test(addr)) {
      return res.status(400).json({ error: "socksAddress: разрешено только 127.0.0.1 или 172.17.0.1" });
    }
    const dom = domains.replace(/'/g, "'\\''");
    const remoteCmd =
      `bash -lc 'cd ${installDir} && chmod +x scripts/xray-warp-apply.py 2>/dev/null || true && ` +
      `python3 ./scripts/xray-warp-apply.py --file '${f.replace(/'/g, "'\\''")}' --address '${addr}' --port ${port}` +
      (dom ? ` --domains '${dom}'` : "") +
      `'`;
    const out = await sshRootRun(pw.trim(), host, remoteCmd);
    let parsed = null;
    try {
      parsed = JSON.parse(String(out || "").trim());
    } catch {
      parsed = null;
    }
    res.json(parsed || { ok: true, raw: String(out || "").slice(0, 12_000) });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

app.post("/api/login", (req, res) => {
  const body = normalizeBody(req.body);
  const pw = body.password;
  if (typeof pw !== "string" || !pw) {
    res.status(400).json({
      error: "password required",
      hint: "Обновите страницу без кэша (Ctrl+Shift+R). Сервер теперь также принимает старые text/plain login-запросы.",
    });
    return;
  }
  if (!verifyPassword(pw, passwordHashStored)) {
    res.status(401).json({ error: "Неверный пароль" });
    return;
  }
  const token = signSession({ exp: Date.now() + SESSION_MS });
  setSessionCookie(res, token, Math.floor(SESSION_MS / 1000));
  res.json({ ok: true });
});

app.post("/api/logout", (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.post("/api/change-password", requireAuth, (req, res) => {
  const cur = req.body?.currentPassword;
  const neu = req.body?.newPassword;
  if (typeof cur !== "string" || typeof neu !== "string") {
    res.status(400).json({ error: "currentPassword и newPassword обязательны" });
    return;
  }
  if (neu.length < 8) {
    res.status(400).json({ error: "Новый пароль — не короче 8 символов" });
    return;
  }
  if (!verifyPassword(cur, passwordHashStored)) {
    res.status(401).json({ error: "Текущий пароль неверный" });
    return;
  }
  passwordHashStored = hashPassword(neu);
  fs.writeFileSync(PW_FILE, `${passwordHashStored}\n`, { mode: 0o600 });
  rotateSessionSecret();
  clearSessionCookie(res);
  res.json({ ok: true, message: "Пароль изменён. Войдите снова." });
});

app.get("/api/protocols", requireAuth, (req, res) => {
  const rt = runtimeForRequest(req);
  const hintSingle =
    PROFILES.length < 2
      ? "Сейчас один инстанс: при установке не передали AWG_PROFILES или не восстановился снимок. Задайте JSON профилей и запустите install.sh — он сохранится в /root/amnezia-admin.awg-profiles.json."
      : "";
  res.json({
    currentId: rt.profile.id,
    currentLabel: rt.profile.label,
    profiles: PROFILES.map((p) => ({
      id: p.id,
      label: p.label,
      container: p.container,
    })),
    singleProfile: PROFILES.length < 2,
    profilesPersistHint: hintSingle,
    edition: editionPayload(),
    uiHidden: { ...effectiveUiHidden() },
  });
});

app.post("/api/protocol", requireAuth, (req, res) => {
  const id = req.body?.profileId;
  if (typeof id !== "string" || !PROFILES.some((p) => p.id === id)) {
    res.status(400).json({ error: "Неизвестный profileId" });
    return;
  }
  setProfileCookie(res, id);
  res.json({ ok: true });
});

app.get("/api/clients", requireAuth, async (req, res) => {
  const rt = runtimeForRequest(req);
  try {
    let wgShow = "";
    try {
      wgShow = await rt.dockerExec(`${await rt.resolveWgBinary()} show ${rt.tunnelIface}`);
    } catch {
      wgShow = "";
    }
    const warpMeta = await warpSummaryForRt(rt);
    const warpSelected = new Set(
      warpMeta.supported && warpMeta.installed ? warpMeta.selectedAllowedIps : [],
    );
    const { conf, clients, peerByKey } = await rt.loadState();
    const rows = clients.map((c) => {
      const id = clientRowId(c);
      const peer = peerByKey.get(id);
      const ud = clientRowUserData(c);
      const activeInConf = !!peer;
      return {
        clientId: id,
        name: ud.clientName || `${id.slice(0, 10)}…`,
        allowedIps: peer?.allowedIPs || ud.allowedIps || ud.preservedAllowedIPs || null,
        activeInConf,
        disabled: !activeInConf,
        disabledAt: ud.disabledAt || null,
        lastDisconnectedAt: ud.lastDisconnectedAt || null,
        scheduledTunnelDisconnectAt: ud.scheduledTunnelDisconnectAt || null,
        creationDate: ud.creationDate || null,
        latestHandshake: ud.latestHandshake || null,
        dataReceived: ud.dataReceived || null,
        dataSent: ud.dataSent || null,
        warpEnabled:
          Boolean(warpMeta.supported && warpMeta.installed) &&
          activeInConf &&
          peerUsesWarp(peer, warpSelected),
        exportAvailable: clientHasExportableLastConfig(c),
      };
    });
    const warpOut =
      warpMeta.supported === false
        ? { supported: false }
        : {
            supported: true,
            installed: warpMeta.installed,
            running: warpMeta.running,
            exitIp: warpMeta.exitIp,
            wgShowWarp: warpMeta.wgShowWarp || "",
            selectedAllowedIps: warpMeta.selectedAllowedIps,
            paths: warpMeta.paths,
            hostSshInstall: hostTimeSyncConfigured(),
            sshHost: process.env.TIME_SYNC_SSH_HOST?.trim() || "172.17.0.1",
            installDir: process.env.WARP_SSH_INSTALL_DIR?.trim() || "/opt/amnezia-admin",
          };
    res.json({
      profileId: rt.profile.id,
      profileLabel: rt.profile.label,
      container: rt.profile.container,
      protocol: "AmneziaWG",
      peerCount: conf.peers.length,
      clients: rows,
      wgShow,
      warp: warpOut,
      uiHidden: { ...effectiveUiHidden() },
      edition: editionPayload(),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

async function serveClientConfigExport(req, res) {
  rejectUnavailableFeature(res);
  return;
  const tokenOk =
    req.method === "GET" &&
    verifyExportQueryToken(typeof req.query.token === "string" ? req.query.token : "");

  let rt;
  if (tokenOk) {
    if (PROFILES.length > 1) {
      const pid = typeof req.query.profileId === "string" ? req.query.profileId.trim() : "";
      const p = PROFILES.find((x) => x.id === pid);
      if (!p) {
        res.status(400).json({
          error:
            "При нескольких инстансах укажите в URL параметр profileId (как в списке «Инстанс» в панели).",
        });
        return;
      }
      rt = createRuntime(p);
    } else {
      rt = createRuntime(PROFILES[0]);
    }
  } else {
    rt = runtimeFromExportRequest(req);
  }

  const rawId =
    req.method === "POST"
      ? req.body?.clientId
      : req.query.clientId ?? req.query.id;
  const clientId = typeof rawId === "string" ? decodeURIComponent(rawId.trim()) : "";
  if (!clientId) {
    res.status(400).json({ error: "Укажите clientId (в теле POST или query GET)" });
    return;
  }
  try {
    const { conf, clients } = await rt.loadState();
    const row = clients.find((c) => clientRowId(c) === clientId);
    if (!row) {
      res.status(404).json({ error: "Клиент не найден в clientsTable" });
      return;
    }
    const lc = parseLastConfigFromClientRow(row);
    if (!lc) {
      res.status(404).json({
        error:
          "На сервере нет userData.last_config для этого клиента. Полный конфиг хранится в приложении Amnezia на устройстве, где ключ создавали (или синхронизируйте клиентов с сервером из приложения).",
      });
      return;
    }
    const ifaceMap = parseInterfaceKeyValues(conf.head);
    let text;
    try {
      text = await buildClientConfExport(rt, lc, ifaceMap, req, row, conf);
    } catch (e) {
      res.status(400).json({ error: String(e.message || e) });
      return;
    }
    const ud = row.userData || {};
    const baseName = safeExportFilenamePart(ud.clientName, clientId.slice(0, 12));
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="amnezia-${baseName}.conf"`);
    res.send(text);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
}

app.get("/api/clients/export-config", requireAuthOrExportToken, (req, res) => {
  void serveClientConfigExport(req, res);
});

app.post("/api/clients/export-config", requireAuth, (req, res) => {
  void serveClientConfigExport(req, res);
});

/**
 * Новый клиент для каскада: генерирует ключи, добавляет peer на сервер, сохраняет last_config,
 * отдаёт .conf с Endpoint = endpointHost:endpointPort (ваш промежуточный узел).
 */
app.post("/api/clients/create-cascade", requireAuth, requireProTier, async (req, res) => {
  if (UI_HIDDEN.cascade) {
    return res.status(403).json({ error: MSG_UI_CASCADE_OFF });
  }
  const rt = runtimeFromExportRequest(req);
  let endpointHost;
  try {
    endpointHost = assertCascadeEndpointHost(req.body?.endpointHost);
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
    return;
  }
  let endpointPort;
  const rawPort = req.body?.endpointPort;
  if (rawPort != null && rawPort !== "") {
    endpointPort = Number(rawPort);
    if (!Number.isFinite(endpointPort) || endpointPort < 1 || endpointPort > 65535) {
      res.status(400).json({ error: "Некорректный порт Endpoint (1–65535)." });
      return;
    }
  }
  try {
    await rt.backupRemoteFiles();
    const { conf, clients } = await rt.loadState();
    const ifaceMap = parseInterfaceKeyValues(conf.head);
    if (!ifaceMap.PrivateKey) {
      res.status(400).json({ error: "В wg/awg конфиге сервера нет PrivateKey в [Interface]." });
      return;
    }

    const tunnelIp = normalizeCascadeTunnelIp(conf, ifaceMap, req.body?.tunnelIp);
    const listenPort = ifaceMap.ListenPort ? Number(ifaceMap.ListenPort) : NaN;
    if (endpointPort == null) {
      endpointPort =
        Number.isFinite(listenPort) && listenPort > 0
          ? listenPort
          : (await rt.resolveWgBinary()) === "awg"
            ? 55424
            : 51820;
    }

    const psk = await rt.inferPskFromConf(conf);
    if (!psk || typeof psk !== "string") {
      res.status(400).json({ error: "Не удалось определить PresharedKey (нет peer или файла psk)." });
      return;
    }

    const serverPub = await wgPubkeyFromPrivate(rt, ifaceMap.PrivateKey);
    const { priv, pub } = await awgGenKeypair(rt);
    if (clients.some((c) => clientRowId(c) === pub)) {
      res.status(409).json({ error: "Коллизия ключей — попробуйте ещё раз." });
      return;
    }

    const obf = obfuscationFieldsFromServerHead(ifaceMap);
    const lc = {
      client_priv_key: priv,
      server_pub_key: serverPub,
      psk_key: psk,
      client_ip: tunnelIp,
      hostName: endpointHost,
      port: endpointPort,
      allowed_ips: ["0.0.0.0/0", "::/0"],
      ...obf,
    };

    const peerRaw = `[Peer]
PublicKey = ${pub}
PresharedKey = ${psk}
AllowedIPs = ${tunnelIp}/32
`;
    const peer = parsePeerBlock(`${peerRaw}\n`);
    const nextPeers = [...conf.peers, peer];
    const nextConfText = serializeAwgConf(conf.head, nextPeers);

    const rawName = req.body?.clientName;
    const clientName =
      typeof rawName === "string" && rawName.trim()
        ? rawName.trim().replace(/\s+/g, " ").slice(0, 200)
        : `Каскад ${tunnelIp}`;

    const last_config = JSON.stringify(lc);
    const newRow = {
      clientId: pub,
      userData: {
        clientName,
        creationDate: new Date().toISOString(),
        last_config,
        allowedIps: `${tunnelIp}/32`,
      },
    };
    const nextClients = [...clients, newRow];

    await rt.dockerWriteFile(rt.confPath, nextConfText);
    await rt.dockerWriteFile(rt.clientsPath, stringifyClientsTable(nextClients));
    await rt.applySyncconf();

    const confAfter = { ...conf, peers: nextPeers };
    let text;
    try {
      text = await buildClientConfExport(rt, lc, ifaceMap, req, newRow, confAfter);
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
      return;
    }

    const baseName = safeExportFilenamePart(clientName, pub.slice(0, 12));
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="amnezia-cascade-${baseName}.conf"`);
    res.send(text);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.post("/api/warp/start", requireAuth, requireProTier, async (req, res) => {
  if (UI_HIDDEN.warp) {
    return res.status(403).json({ error: MSG_UI_WARP_OFF });
  }
  const rt = runtimeForRequest(req);
  if (!(await warpFileExists(rt, rt.profile.warpConf))) {
    return res.status(400).json({
      error:
        "WARP не установлен (нет warp.conf). На хосте: scripts/warp-amnezia.sh install — или игнорируйте раздел, если WARP не нужен (см. README).",
    });
  }
  try {
    await rt.dockerExec(`wg-quick down '${rt.profile.warpConf}' 2>/dev/null || true`);
    await rt.dockerExec(`wg-quick up '${rt.profile.warpConf}'`);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.post("/api/warp/stop", requireAuth, requireProTier, async (req, res) => {
  if (UI_HIDDEN.warp) {
    return res.status(403).json({ error: MSG_UI_WARP_OFF });
  }
  const rt = runtimeForRequest(req);
  if (!(await warpFileExists(rt, rt.profile.warpConf))) {
    return res.status(400).json({ error: "WARP не установлен." });
  }
  try {
    await rt.dockerExec(`wg-quick down '${rt.profile.warpConf}' 2>/dev/null || true`);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.post("/api/warp/routing", requireAuth, requireProTier, async (req, res) => {
  if (UI_HIDDEN.warp) {
    return res.status(403).json({ error: MSG_UI_WARP_OFF });
  }
  const rt = runtimeForRequest(req);
  if (!(await warpFileExists(rt, rt.profile.warpConf))) {
    return res.status(400).json({
      error:
        "WARP не установлен. Сначала scripts/warp-amnezia.sh install на хосте VPS (root), либо не используйте этот раздел.",
    });
  }
  const raw = req.body?.selectedAllowedIps;
  if (!Array.isArray(raw)) {
    return res.status(400).json({ error: "Ожидается selectedAllowedIps: массив адресов вида 10.8.1.2/32" });
  }
  let selected;
  try {
    selected = raw.map((x) => assertAllowedIpCidr(String(x).trim()));
  } catch (e) {
    return res.status(400).json({ error: String(e.message || e) });
  }
  try {
    const { conf } = await rt.loadState();
    const allowed = activePeerAllowedIpSet(conf);
    for (const ip of selected) {
      if (!allowed.has(ip)) {
        return res.status(400).json({
          error: `Адрес ${ip} не совпадает ни с одним активным peer (AllowedIPs) в текущем инстансе.`,
        });
      }
    }
    await warpPersistAndRestart(rt, selected);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.post("/api/clients/disable", requireAuth, async (req, res) => {
  const rt = runtimeForRequest(req);
  const clientId = req.body?.clientId;
  if (!clientId) return res.status(400).json({ error: "clientId required" });
  let ts;
  try {
    ts = normalizeDisconnectedAtOptional(req.body?.disconnectedAt);
  } catch (e) {
    return res.status(400).json({ error: String(e.message || e) });
  }
  try {
    await disableClient(rt, clientId, ts);
    res.json({ ok: true });
  } catch (e) {
    const msg = String(e.message || e);
    if (msg.includes("already disabled") || msg.includes("Peer not in config")) {
      return res.status(404).json({ error: msg });
    }
    console.error(e);
    res.status(500).json({ error: msg });
  }
});

app.post("/api/clients/enable", requireAuth, async (req, res) => {
  const rt = runtimeForRequest(req);
  const clientId = req.body?.clientId;
  if (!clientId) return res.status(400).json({ error: "clientId required" });
  try {
    await rt.backupRemoteFiles();
    const { conf, clients } = await rt.loadState();
    const existing = conf.peers.find((p) => p.publicKey === clientId);
    if (existing) {
      return res.status(409).json({ error: "Peer already enabled" });
    }
    const idx = clients.findIndex((c) => clientRowId(c) === clientId);
    if (idx === -1) {
      return res.status(404).json({ error: "Client not in clientsTable" });
    }
    const ud = { ...(clients[idx].userData || {}) };
    const psk =
      ud.preservedPresharedKey ||
      conf.peers[0]?.presharedKey ||
      (await rt.inferPskFromConf(conf));
    const ips = ud.preservedAllowedIPs || ud.allowedIps;
    if (!psk || !ips) {
      return res.status(400).json({
        error:
          "Missing preserved keys — cannot enable (restore from backup or re-import in Amnezia)",
      });
    }
    const raw = `[Peer]
PublicKey = ${clientId}
PresharedKey = ${psk}
AllowedIPs = ${ips}`;
    const peer = parsePeerBlock(`${raw}\n`);
    const nextPeers = [...conf.peers, peer];
    const nextConfText = serializeAwgConf(conf.head, nextPeers);
    delete ud.disabled;
    delete ud.disabledAt;
    delete ud.scheduledTunnelDisconnectAt;
    delete ud.preservedPresharedKey;
    delete ud.preservedAllowedIPs;
    clients[idx] = { ...clients[idx], userData: ud };
    await rt.dockerWriteFile(rt.confPath, nextConfText);
    await rt.dockerWriteFile(rt.clientsPath, stringifyClientsTable(clients));
    await rt.applySyncconf();
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.post("/api/clients/disconnect-date", requireAuth, async (req, res) => {
  const rt = runtimeForRequest(req);
  const clientId = req.body?.clientId;
  if (!clientId) return res.status(400).json({ error: "clientId required" });
  let iso;
  try {
    iso = requireDisconnectedAt(req.body?.disconnectedAt);
  } catch (e) {
    return res.status(400).json({ error: String(e.message || e) });
  }
  const scheduleTunnelDisconnect = Boolean(req.body?.scheduleTunnelDisconnect);
  try {
    const { clients, peerByKey } = await rt.loadState();
    const idx = clients.findIndex((c) => clientRowId(c) === clientId);
    if (idx === -1) return res.status(404).json({ error: "Client not in clientsTable" });
    const peer = peerByKey.get(clientId);
    const ud = { ...(clients[idx].userData || {}) };
    if (scheduleTunnelDisconnect) {
      if (!peer) {
        return res.status(400).json({
          error: "Клиент не в туннеле — отложенное отключение недоступно",
        });
      }
      ud.scheduledTunnelDisconnectAt = iso;
    } else {
      delete ud.scheduledTunnelDisconnectAt;
      ud.lastDisconnectedAt = iso;
      if (!peer) {
        ud.disabledAt = iso;
      }
    }
    clients[idx] = { ...clients[idx], userData: ud };
    await rt.dockerWriteFile(rt.clientsPath, stringifyClientsTable(clients));
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.post("/api/clients/rename", requireAuth, async (req, res) => {
  const rt = runtimeForRequest(req);
  const clientId = req.body?.clientId;
  const rawName = req.body?.name ?? req.body?.clientName;
  if (!clientId) return res.status(400).json({ error: "clientId required" });
  if (typeof rawName !== "string") {
    return res.status(400).json({ error: "name required" });
  }
  const name = rawName.trim().replace(/\s+/g, " ");
  if (!name) return res.status(400).json({ error: "Имя не может быть пустым" });
  if (name.length > 200) {
    return res.status(400).json({ error: "Имя не длиннее 200 символов" });
  }
  try {
    const { clients } = await rt.loadState();
    const idx = clients.findIndex((c) => clientRowId(c) === clientId);
    if (idx === -1) return res.status(404).json({ error: "Client not in clientsTable" });
    const ud = { ...(clients[idx].userData || {}), clientName: name };
    clients[idx] = { ...clients[idx], userData: ud };
    await rt.dockerWriteFile(rt.clientsPath, stringifyClientsTable(clients));
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.post("/api/clients/delete", requireAuth, async (req, res) => {
  const rt = runtimeForRequest(req);
  const clientId = req.body?.clientId;
  if (!clientId) return res.status(400).json({ error: "clientId required" });
  try {
    await rt.backupRemoteFiles();
    const { conf, clients } = await rt.loadState();
    const nextPeers = conf.peers.filter((p) => p.publicKey !== clientId);
    const nextClients = clients.filter((c) => clientRowId(c) !== clientId);
    if (nextClients.length === clients.length) {
      return res.status(404).json({ error: "Client not in clientsTable" });
    }
    const nextConfText = serializeAwgConf(conf.head, nextPeers);
    await rt.dockerWriteFile(rt.confPath, nextConfText);
    await rt.dockerWriteFile(rt.clientsPath, stringifyClientsTable(nextClients));
    await rt.applySyncconf();
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

const pub = path.join(__dirname, "public");
if (fs.existsSync(pub)) {
  app.use(
    express.static(pub, {
      setHeaders(res, filePath) {
        const lower = filePath.toLowerCase();
        if (lower.endsWith(".html") || lower.endsWith(".js") || lower.endsWith(".css")) {
          res.setHeader("Cache-Control", "no-store");
        }
      },
    }),
  );
}

app.use((req, res) => {
  if (typeof req.path === "string" && req.path.startsWith("/api/")) {
    res.status(404).json({
      error: "Not found",
      path: `${req.originalUrl || req.path}`,
      hint:
        "Эндпоинта нет на этом процессе. Проверьте версию приложения через GET /health на том же хосту:порту, что панель, и что HTTP-прокси (если есть) проксирует префикс /api/*. Пересоберите образ amnezia-admin из актуального релиза репозитория.",
    });
    return;
  }
  res.status(404).send("Not found");
});

app.listen(PORT, "0.0.0.0", () => {
  const summary = PROFILES.map((p) => `${p.label}→${p.container}`).join("; ");
  console.log(`amnezia-admin v${PANEL_VERSION} on :${PORT} · ${summary} · data:${DATA_DIR}`);
});

setInterval(() => {
  /* scheduled disconnects not available in basic panel */
}, SCHEDULER_MS);
