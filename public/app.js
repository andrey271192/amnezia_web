const loginGate = document.querySelector("#login-gate");
const appRoot = document.querySelector("#app-root");
const loginForm = document.querySelector("#login-form");
const loginPassword = document.querySelector("#login-password");
const loginError = document.querySelector("#login-error");

const logoutBtn = document.querySelector("#logout");
const refreshBtn = document.querySelector("#refresh");
const clockServerEl = document.querySelector("#clock-server");
const clockLocalEl = document.querySelector("#clock-local");
const clockZoneDiffEl = document.querySelector("#clock-zone-diff");
const clockSyncBtn = document.querySelector("#clock-sync");
const rowsEl = document.querySelector("#rows");
const statusEl = document.querySelector("#status");
const peerCountEl = document.querySelector("#peer-count");
const wgShowEl = document.querySelector("#wg-show");

const warpPanel = document.querySelector("#warp-panel");
const warpStatusLine = document.querySelector("#warp-status-line");
const warpActionsEl = document.querySelector("#warp-actions");
const warpClientListEl = document.querySelector("#warp-client-list");
const warpWgShowEl = document.querySelector("#warp-wg-show");

const warpCfPanel = document.querySelector("#warp-cf-panel");
const warpCfStatusLine = document.querySelector("#warp-cf-status-line");
const warpCfActionsEl = document.querySelector("#warp-cf-actions");
const warpCfLogEl = document.querySelector("#warp-cf-log");
const warpCfRootPw = document.querySelector("#warp-cf-root-pw");
const warpCfPort = document.querySelector("#warp-cf-port");
const warpCfLicense = document.querySelector("#warp-cf-license");
const warpCfXrayPath = document.querySelector("#warp-cf-xray-path");
const warpCfDomains = document.querySelector("#warp-cf-domains");
const warpCfBanner = document.querySelector("#warp-cf-banner");
const warpCfPresetsEl = document.querySelector("#warp-cf-presets");

const mtprotoPanel = document.querySelector("#mtproto-panel");
const mtprotoStatusLine = document.querySelector("#mtproto-status-line");
const mtprotoActionsEl = document.querySelector("#mtproto-actions");
const mtprotoLogsTailEl = document.querySelector("#mtproto-logs-tail");
const mtprotoBanner = document.querySelector("#mtproto-banner");
const mtprotoHostPortInput = document.querySelector("#mtproto-host-port");
const mtprotoSecretInput = document.querySelector("#mtproto-secret-opt");
const mtprotoCalloutEl = document.querySelector("#mtproto-callout");
const mtprotoLinkCardEl = document.querySelector("#mtproto-link-card");
const mtprotoLinkAnchorEl = document.querySelector("#mtproto-link-anchor");
const mtprotoLinkCopyBtn = document.querySelector("#mtproto-link-copy");
const mtprotoLinkCopyState = document.querySelector("#mtproto-link-copy-state");
const themeSelect = document.querySelector("#theme-select");

const cascadePanel = document.querySelector("#cascade-panel");
const usersPanel = document.querySelector("#users-panel");
const wgRawDetails = document.querySelector("#wg-raw-details");

const protoSwitch = document.querySelector("#proto-switch");
const protoSelect = document.querySelector("#proto-select");
const protoLabel = document.querySelector("#proto-label");

const pwForm = document.querySelector("#pw-form");
const pwCurrent = document.querySelector("#pw-current");
const pwNew = document.querySelector("#pw-new");
const pwNew2 = document.querySelector("#pw-new2");
const pwMsg = document.querySelector("#pw-msg");

const profileHintEl = document.querySelector("#profile-hint");

const dtDialog = document.querySelector("#disconnect-dt-dialog");
const dtTitle = document.querySelector("#dt-dialog-title");
const dtClientEl = document.querySelector("#dt-dialog-client");
const dtInput = document.querySelector("#dt-dialog-input");
const dtCancel = document.querySelector("#dt-dialog-cancel");
const dtOk = document.querySelector("#dt-dialog-ok");
const dtExtra = document.querySelector("#dt-dialog-extra");
const dtHint = document.querySelector("#dt-dialog-hint");
const dtScheduleTunnel = document.querySelector("#dt-dialog-schedule-tunnel");

const warpSshDialog = document.querySelector("#warp-ssh-dialog");
const warpSshTitle = document.querySelector("#warp-ssh-title");
const warpSshLead = document.querySelector("#warp-ssh-lead");
const warpSshPw = document.querySelector("#warp-ssh-pw");
const warpSshCancel = document.querySelector("#warp-ssh-cancel");
const warpSshOk = document.querySelector("#warp-ssh-ok");
const warpSshErr = document.querySelector("#warp-ssh-err");
/** @type {"install" | "uninstall" | null} */
let warpSshPendingCmd = null;

/** Какие панели скрыты настройкой сервера (`UI_HIDE_SECTIONS`). */
let uiHidden = { users: false, warp: false, cascade: false, mtproto: false };

/** Базовые возможности панели (управление клиентами + удаление). */
let editionState = {
  readOnlyClients: false,
  allowDeleteClients: true,
  showDebugWg: false,
  proHostTools: false,
};

function applyEditionPayload(data) {
  const ed = data?.edition;
  if (!ed || typeof ed !== "object") return;
  editionState = {
    readOnlyClients: ed.readOnlyClients !== false,
    allowDeleteClients: ed.allowDeleteClients !== false,
    showDebugWg: Boolean(ed.showDebugWg),
    proHostTools: ed.proHostTools === true,
  };
  const titleEl = document.querySelector(".top h1");
  if (titleEl) titleEl.textContent = "Пользователи AmneziaWG";
  const subEl = document.querySelector(".top .sub");
  if (subEl) {
    subEl.textContent =
      "Просмотр клиентов и статусов, вкл/выкл, переименование, даты отключения, экспорт .conf, удаление, установка Telegram MTProto‑прокси (Docker).";
  }
  document.querySelector(".clock-host-sync")?.classList.toggle("hidden", !editionState.proHostTools);
  if (wgRawDetails) wgRawDetails.hidden = uiHidden.users || !editionState.showDebugWg;
}

/** @param {string} [tgLink] */
function setMtprotoLinkCard(tgLink) {
  const t = typeof tgLink === "string" ? tgLink.trim() : "";
  if (!mtprotoLinkCardEl) return;
  if (!t) {
    mtprotoLinkCardEl.classList.add("hidden");
    delete mtprotoLinkCardEl.dataset.tgLink;
    if (mtprotoLinkAnchorEl) {
      mtprotoLinkAnchorEl.removeAttribute("href");
      mtprotoLinkAnchorEl.textContent = "";
    }
    return;
  }
  mtprotoLinkCardEl.classList.remove("hidden");
  mtprotoLinkCardEl.dataset.tgLink = t;
  if (mtprotoLinkAnchorEl) {
    mtprotoLinkAnchorEl.href = t;
    mtprotoLinkAnchorEl.textContent = t;
  }
  if (mtprotoLinkCopyState) mtprotoLinkCopyState.textContent = "";
}

async function refreshMtprotoPanel() {
  if (!mtprotoPanel || !mtprotoStatusLine || !mtprotoActionsEl) return;
  if (uiHidden.mtproto) {
    mtprotoPanel.hidden = true;
    if (mtprotoCalloutEl) {
      mtprotoCalloutEl.textContent = "";
      mtprotoCalloutEl.classList.add("hidden");
    }
    setMtprotoLinkCard("");
    return;
  }
  mtprotoPanel.hidden = false;
  mtprotoActionsEl.innerHTML = "";
  if (mtprotoBanner) {
    mtprotoBanner.classList.add("hidden");
    mtprotoBanner.textContent = "";
  }
  try {
    if (mtprotoLogsTailEl) mtprotoLogsTailEl.textContent = "Загрузка логов…";
    const snap = await api("/api/mtproto/status?withLogs=1");
    if (snap.logsFetched !== true && snap.exists === true && snap.running === true) {
      void (async () => {
        try {
          const lg = (await api("/api/mtproto/tail").catch(() =>
            api("/api/mtproto/logs"),
          )) || { logsTail: "" };
          const tail = typeof lg?.logsTail === "string" ? lg.logsTail : "";
          if (mtprotoLogsTailEl) mtprotoLogsTailEl.textContent = tail;
        } catch {
          if (mtprotoLogsTailEl) mtprotoLogsTailEl.textContent = "(лог не загрузился — обновите раздел позже)";
        }
      })();
    } else {
      const tail = typeof snap.logsTail === "string" ? snap.logsTail : "";
      if (mtprotoLogsTailEl) mtprotoLogsTailEl.textContent = tail;
    }

    if (mtprotoCalloutEl) {
      if (snap.exists) {
        const hp =
          snap.hostPort != null && snap.hostPort !== "" ? String(snap.hostPort) : null;
        mtprotoCalloutEl.classList.remove("hidden");
        mtprotoCalloutEl.textContent = hp
          ? `Официальный образ слушает 443/tcp внутри контейнера — это норма. На хост проброшен порт ${hp}: в Telegram указывайте публичный IP/DNS этого VPS и порт ${hp}. В логах ниже официальный прокси сам пишет tg:// и port=443 (внутренний процесс); при таком пробросе в клиенте используйте порт ${hp}, а не 443. Ссылку из синего блока панели (если показана) можно открыть как есть.`
          : `Официальный образ слушает 443/tcp внутри контейнера; снаружи — порт хоста из строки статуса («порт хоста»). Если в логах видно tg:// с port=443, для подключения с интернета подставляйте порт хоста из статуса, не 443.`;
      } else {
        mtprotoCalloutEl.textContent = "";
        mtprotoCalloutEl.classList.add("hidden");
      }
    }

    const parts = [];
    if (snap.exists) parts.push("контейнер есть");
    if (snap.running) parts.push("запущен");
    mtprotoStatusLine.textContent =
      parts.length > 0
        ? parts.join(" · ") +
          (snap.hostPort ? ` · порт хоста :${String(snap.hostPort)}` : "") +
          (snap.secretMasked ? ` · секрет ${snap.secretMasked}` : "")
        : "не установлен";

    if (typeof snap.hint === "string" && snap.hint.trim()) {
      const hintEl = document.createElement("p");
      hintEl.className = "muted warp-muted";
      hintEl.textContent = snap.hint.trim();
      mtprotoActionsEl.appendChild(hintEl);
    } else if (snap.exists && !snap.running && typeof snap.image === "string" && snap.image.trim()) {
      const imgHint = document.createElement("p");
      imgHint.className = "muted warp-muted";
      imgHint.textContent = `После установки образ будет доступен здесь (${snap.image.trim()} при актуальной конфигурации).`;
      mtprotoActionsEl.appendChild(imgHint);
    }

    setMtprotoLinkCard(snap.tgLink);

    const row = document.createElement("div");
    row.className = "warp-actions";

    row.appendChild(
      btn("Установить / пересоздать", "btn small primary", async () => {
        try {
          setStatus("MTProto: docker pull/run…", false);
          const hp = mtprotoHostPortInput?.value?.trim();
          const sec = mtprotoSecretInput?.value?.trim()?.toLowerCase();
          const body = {};
          if (hp !== "" && hp !== undefined) {
            const n = Number.parseInt(String(hp), 10);
            if (Number.isFinite(n)) body.hostPort = n;
          }
          if (/^[a-f0-9]{32}$/.test(sec)) body.secret = sec;
          const j = await api("/api/mtproto/install", { method: "POST", body: JSON.stringify(body) });
          if (typeof j.tgLink === "string" && j.tgLink.trim()) setMtprotoLinkCard(j.tgLink.trim());
          const lines = [];
          if (typeof j.secretHex === "string") lines.push(`Секрет (сохраните): ${j.secretHex}`);
          if (typeof j.tgLink === "string" && j.tgLink) lines.push(`Ссылка: ${j.tgLink}`);
          if (mtprotoBanner) {
            mtprotoBanner.textContent = lines.join("\n");
            mtprotoBanner.classList.remove("hidden");
          }
          if (typeof j.secretHex === "string" && mtprotoSecretInput) mtprotoSecretInput.value = "";
          await refreshMtprotoPanel();
          setStatus("MTProto: готово", false);
        } catch (e) {
          setStatus(String(e?.message || e), true);
        }
      }),
    );

    row.appendChild(
      btn("Перезапустить", "btn small ghost", async () => {
        try {
          setStatus("MTProto: перезапуск…", false);
          await api("/api/mtproto/restart", { method: "POST", body: JSON.stringify({}) });
          await refreshMtprotoPanel();
          setStatus("", false);
        } catch (e) {
          setStatus(String(e?.message || e), true);
        }
      }),
    );

    row.appendChild(
      btn("Удалить прокси", "btn small warn", async () => {
        try {
          if (!confirm("Удалить контейнер MTProto? Секрет в Telegram сохранять не нужно — он пересоздастся заново при установке.")) return;
          setStatus("MTProto: удаление…", false);
          await api("/api/mtproto/remove", { method: "POST", body: JSON.stringify({}) });
          if (mtprotoBanner) {
            mtprotoBanner.classList.add("hidden");
            mtprotoBanner.textContent = "";
          }
          await refreshMtprotoPanel();
          setStatus("", false);
        } catch (e) {
          setStatus(String(e?.message || e), true);
        }
      }),
    );

    row.appendChild(
      btn("Обновить статус", "btn small ghost", async () => {
        try {
          setStatus("", false);
          await refreshMtprotoPanel();
        } catch (e) {
          setStatus(String(e?.message || e), true);
        }
      }),
    );

    mtprotoActionsEl.appendChild(row);
  } catch (e) {
    if (mtprotoCalloutEl) {
      mtprotoCalloutEl.textContent = "";
      mtprotoCalloutEl.classList.add("hidden");
    }
    setMtprotoLinkCard("");
    if (mtprotoLogsTailEl) mtprotoLogsTailEl.textContent = "";
    const err = document.createElement("p");
    err.className = "muted warp-muted err";
    err.textContent = String(e.message || e);
    mtprotoActionsEl.appendChild(err);
  }
}

function applyUiHiddenFromPayload(data) {
  const u = data?.uiHidden;
  if (u && typeof u === "object") {
    uiHidden = {
      users: Boolean(u.users),
      warp: Boolean(u.warp),
      cascade: Boolean(u.cascade),
      mtproto: Boolean(u.mtproto),
    };
  }
  if (usersPanel) usersPanel.hidden = uiHidden.users;
  if (wgRawDetails) wgRawDetails.hidden = uiHidden.users || !editionState.showDebugWg;
  if (cascadePanel) cascadePanel.hidden = uiHidden.cascade;
  if (warpPanel) warpPanel.hidden = uiHidden.warp;
  if (warpCfPanel) warpCfPanel.hidden = !editionState.proHostTools;
  if (mtprotoPanel) mtprotoPanel.hidden = uiHidden.mtproto;
  void refreshMtprotoPanel();
}

let dtMode = "disable";
/** @type {Record<string, unknown> | null} */
let dtClient = null;

function isoToDatetimeLocal(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function datetimeLocalToIso(localVal) {
  if (!localVal || !String(localVal).trim()) {
    throw new Error("Укажите дату и время");
  }
  const d = new Date(localVal);
  if (Number.isNaN(d.getTime())) {
    throw new Error("Некорректная дата");
  }
  return d.toISOString();
}

function openDisableDialog(c) {
  dtMode = "disable";
  dtClient = c;
  dtTitle.textContent = "Выключить клиента";
  dtClientEl.textContent = c.name;
  dtOk.textContent = "Выключить";
  dtInput.value = isoToDatetimeLocal(new Date().toISOString());
  dtExtra.classList.add("hidden");
  dtScheduleTunnel.checked = false;
  dtDialog.showModal();
}

function openEditDisconnectDialog(c) {
  dtMode = "edit";
  dtClient = c;
  dtTitle.textContent = "Дата последнего отключения";
  dtClientEl.textContent = c.name;
  dtOk.textContent = "Сохранить";
  const iso =
    (c.activeInConf && c.scheduledTunnelDisconnectAt) ||
    c.lastDisconnectedAt ||
    (!c.activeInConf && c.disabledAt) ||
    new Date().toISOString();
  dtInput.value = isoToDatetimeLocal(iso);
  if (c.activeInConf) {
    dtExtra.classList.remove("hidden");
    dtHint.textContent =
      "Без галочки — только запись даты в таблице, клиент остаётся в туннеле. С галочкой ключ будет убран из туннеля автоматически в выбранный момент (проверка на сервере каждые ~60 с).";
    dtScheduleTunnel.checked = Boolean(c.scheduledTunnelDisconnectAt);
  } else {
    dtExtra.classList.add("hidden");
    dtScheduleTunnel.checked = false;
  }
  dtDialog.showModal();
}

dtCancel.addEventListener("click", () => {
  dtDialog.close();
  dtClient = null;
});

dtOk.addEventListener("click", async () => {
  if (!dtClient) return;
  let iso;
  try {
    iso = datetimeLocalToIso(dtInput.value);
  } catch (e) {
    setStatus(String(e.message || e), true);
    return;
  }
  try {
    if (dtMode === "disable") {
      setStatus("Выполняю…", false);
      await api("/api/clients/disable", {
        method: "POST",
        body: JSON.stringify({ clientId: dtClient.clientId, disconnectedAt: iso }),
      });
    } else {
      const scheduleTunnel = Boolean(dtScheduleTunnel.checked && dtClient.activeInConf);
      setStatus(scheduleTunnel ? "Сохраняю расписание отключения…" : "Сохраняю дату…", false);
      await api("/api/clients/disconnect-date", {
        method: "POST",
        body: JSON.stringify({
          clientId: dtClient.clientId,
          disconnectedAt: iso,
          scheduleTunnelDisconnect: scheduleTunnel,
        }),
      });
    }
    dtDialog.close();
    dtClient = null;
    setStatus("Готово.", false);
    await loadClients();
  } catch (e) {
    setStatus(String(e.message || e), true);
  }
});

function openWarpHostSetup(cmd) {
  if (!warpSshDialog || !warpSshTitle || !warpSshLead || !warpSshPw || !warpSshOk || !warpSshErr) return;
  warpSshPendingCmd = cmd;
  warpSshErr.textContent = "";
  warpSshPw.value = "";
  if (cmd === "install") {
    warpSshTitle.textContent = "Установить Cloudflare WARP";
    warpSshLead.textContent =
      "На хосте VPS выполнится scripts/warp-amnezia.sh install для контейнера текущего инстанса. SSH так же, как у блока синхронизации времени (TIME_SYNC_SSH_HOST, часто 172.17.0.1). Пароль root не сохраняется.";
    warpSshOk.textContent = "Установить";
  } else {
    warpSshTitle.textContent = "Удалить Cloudflare WARP";
    warpSshLead.textContent =
      "На хосте выполнится scripts/warp-amnezia.sh uninstall (интерфейс warp, правила, автозапуск в start.sh; контейнер AWG перезапустится).";
    warpSshOk.textContent = "Удалить";
  }
  warpSshDialog.showModal();
}

if (warpSshCancel && warpSshDialog) {
  warpSshCancel.addEventListener("click", () => {
    warpSshDialog.close();
    warpSshPendingCmd = null;
  });
}

if (warpSshOk && warpSshDialog && warpSshPw) {
  warpSshOk.addEventListener("click", async () => {
    const cmd = warpSshPendingCmd;
    if (!cmd) return;
    const pw = warpSshPw.value;
    if (!String(pw).trim()) {
      warpSshErr.textContent = "Введите пароль root.";
      return;
    }
    warpSshErr.textContent = "";
    try {
      setStatus(cmd === "install" ? "Устанавливаю WARP на хосте VPS…" : "Удаляю WARP на хосте VPS…", false);
      await api("/api/warp/host-setup", {
        method: "POST",
        body: JSON.stringify({ rootPassword: pw, cmd }),
      });
      warpSshDialog.close();
      warpSshPendingCmd = null;
      warpSshPw.value = "";
      setStatus("Готово.", false);
      await loadClients();
    } catch (e) {
      const msg = String(e.message || e);
      warpSshErr.textContent = msg;
      setStatus(msg, true);
    }
  });
}

function showLogin() {
  stopClocks();
  loginGate.classList.remove("hidden");
  loginGate.setAttribute("aria-hidden", "false");
  appRoot.classList.add("hidden");
}

function showApp() {
  loginGate.classList.add("hidden");
  loginGate.setAttribute("aria-hidden", "true");
  appRoot.classList.remove("hidden");
  startClocks();
}

function setStatus(text, isErr) {
  statusEl.textContent = text || "";
  statusEl.classList.toggle("err", Boolean(isErr));
}

function setPwMsg(text, isErr) {
  pwMsg.textContent = text || "";
  pwMsg.classList.toggle("err", Boolean(isErr));
}

async function api(path, opts = {}) {
  const pathOnly =
    typeof path === "string" ? path.trim().replace(/\?.*$/, "") || String(path).trim() : "";
  const res = await fetch(path, {
    ...opts,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...opts.headers,
    },
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    let msg = typeof data.error === "string" ? data.error : "";
    if (!msg) msg = typeof data.raw === "string" ? data.raw : "";
    if (!msg) msg = res.statusText;
    const hint = typeof data.hint === "string" && data.hint.trim() ? data.hint.trim() : "";
    if (hint) {
      msg = msg ? `${msg} — ${hint}` : hint;
    } else if (
      res.status === 404 &&
      /^\/api\/mtproto\b/.test(pathOnly) &&
      /^not\s*found\s*$/i.test(String(msg).trim())
    ) {
      msg = `${msg.trim()} — нет эндпоинта GET /api/mtproto/* на этом HTTP-ответчике (часто: старый образ панели, другой контейнер на вашем домене, или nginx с белым списком location вместо location /api/). Проверьте на том же хосту:порту, что панель, GET /health (поле version) и пересоберите образ amnezia-admin.`;
    }
    throw new Error(msg);
  }
  return data;
}

async function checkSession() {
  try {
    await api("/api/session");
    return true;
  } catch {
    return false;
  }
}

async function loadProtocols() {
  try {
    const data = await api("/api/protocols");
    applyEditionPayload(data);
    applyUiHiddenFromPayload(data);
    protoLabel.textContent = `Протокол: ${data.currentLabel || "AmneziaWG"}`;
    if (profileHintEl) {
      if (data.singleProfile && typeof data.profilesPersistHint === "string" && data.profilesPersistHint) {
        profileHintEl.textContent = data.profilesPersistHint;
        profileHintEl.classList.remove("hidden");
      } else {
        profileHintEl.textContent = "";
        profileHintEl.classList.add("hidden");
      }
    }
    if (!data.profiles || data.profiles.length < 2) {
      protoSwitch.classList.add("hidden");
      return;
    }
    protoSwitch.classList.remove("hidden");
    protoSelect.innerHTML = "";
    for (const p of data.profiles) {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = `${p.label} (${p.container})`;
      if (p.id === data.currentId) opt.selected = true;
      protoSelect.appendChild(opt);
    }
  } catch {
    protoSwitch.classList.add("hidden");
  }
}

loginForm.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  loginError.textContent = "";
  try {
    await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ password: loginPassword.value }),
    });
    loginPassword.value = "";
    showApp();
    await loadProtocols();
    await loadTimeSyncCaps();
    await loadClients();
  } catch (e) {
    loginError.textContent = String(e.message || e);
  }
});

logoutBtn.addEventListener("click", async () => {
  try {
    await api("/api/logout", { method: "POST", body: JSON.stringify({}) });
  } catch {
    /* ignore */
  }
  showLogin();
  loginPassword.focus();
});

refreshBtn.addEventListener("click", () => {
  loadClients();
});

const cascadeForm = document.querySelector("#cascade-form");
if (cascadeForm) {
  cascadeForm.addEventListener("submit", (ev) => void downloadCascadeConf(ev));
}

protoSelect.addEventListener("change", async () => {
  try {
    setStatus("Смена инстанса…", false);
    await api("/api/protocol", {
      method: "POST",
      body: JSON.stringify({ profileId: protoSelect.value }),
    });
    await loadProtocols();
    await loadClients();
    setStatus("", false);
  } catch (e) {
    setStatus(String(e.message || e), true);
    await loadProtocols();
  }
});

clockSyncBtn.addEventListener("click", () => {
  void refreshServerClock();
});

const clockFmt = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "medium",
  timeStyle: "medium",
});

/** Часовой пояс строки «Сервер» (IANA), как в /api/server-time */
let serverDisplayTz = "UTC";
/** @type {Intl.DateTimeFormat | null} */
let serverTzFmtCached = null;

function buildServerTzFmt(tz) {
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      dateStyle: "medium",
      timeStyle: "medium",
      timeZone: tz,
    });
  } catch {
    return null;
  }
}

/** @type {ReturnType<typeof setInterval> | null} */
let clockTickId = null;
/** @type {ReturnType<typeof setInterval> | null} */
let clockServerPollId = null;

/** Метка UTC сервера (мс) по последнему ответу API */
let serverAnchorUtcMs = /** @type {number | null} */ (null);
/** Date.now() в момент установки якоря */
let serverAnchorWallMs = 0;

function browserTimeZoneLabel() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}

function tickServerClockDisplay() {
  if (serverAnchorUtcMs === null) {
    clockServerEl.dateTime = "";
    clockServerEl.textContent = "—";
    return;
  }
  const estimatedUtcMs = serverAnchorUtcMs + (Date.now() - serverAnchorWallMs);
  const d = new Date(estimatedUtcMs);
  clockServerEl.dateTime = d.toISOString();
  const fmt = serverTzFmtCached || clockFmt;
  clockServerEl.textContent = `${fmt.format(d)} · ${serverDisplayTz}`;
}

async function refreshServerClock() {
  try {
    const tz = browserTimeZoneLabel();
    const q = tz ? `?browserTz=${encodeURIComponent(tz)}` : "";
    const t = await api(`/api/server-time${q}`);
    const iso = typeof t.iso === "string" ? t.iso : "";
    const parsed = new Date(iso).getTime();
    if (!iso || Number.isNaN(parsed)) {
      throw new Error("нет времени");
    }
    serverAnchorUtcMs = parsed;
    serverAnchorWallMs = Date.now();
    serverDisplayTz =
      typeof t.timeZone === "string" && t.timeZone.trim() ? t.timeZone.trim() : "UTC";
    serverTzFmtCached = buildServerTzFmt(serverDisplayTz);
    tickServerClockDisplay();
    if (clockZoneDiffEl) {
      const hint = typeof t.zoneCompareHint === "string" ? t.zoneCompareHint.trim() : "";
      if (hint) {
        clockZoneDiffEl.textContent = hint;
        clockZoneDiffEl.classList.remove("hidden");
        clockZoneDiffEl.classList.toggle("clock-zone-diff--accent", t.zoneSame === false);
      } else {
        clockZoneDiffEl.textContent = "";
        clockZoneDiffEl.classList.add("hidden");
        clockZoneDiffEl.classList.remove("clock-zone-diff--accent");
      }
    }
  } catch {
    serverAnchorUtcMs = null;
    serverTzFmtCached = null;
    clockServerEl.dateTime = "";
    clockServerEl.textContent = "—";
    if (clockZoneDiffEl) {
      clockZoneDiffEl.textContent = "";
      clockZoneDiffEl.classList.add("hidden");
      clockZoneDiffEl.classList.remove("clock-zone-diff--accent");
    }
  }
}

function tickLocalClock() {
  const n = new Date();
  clockLocalEl.dateTime = n.toISOString();
  const tz = browserTimeZoneLabel();
  clockLocalEl.textContent = tz ? `${clockFmt.format(n)} · ${tz}` : clockFmt.format(n);
}

function tickClocks() {
  tickLocalClock();
  tickServerClockDisplay();
}

function stopClocks() {
  if (clockTickId !== null) {
    clearInterval(clockTickId);
    clockTickId = null;
  }
  if (clockServerPollId !== null) {
    clearInterval(clockServerPollId);
    clockServerPollId = null;
  }
  serverAnchorUtcMs = null;
  serverAnchorWallMs = 0;
  serverTzFmtCached = null;
  serverDisplayTz = "UTC";
  clockServerEl.dateTime = "";
  clockLocalEl.dateTime = "";
  clockServerEl.textContent = "—";
  clockLocalEl.textContent = "—";
  if (clockZoneDiffEl) {
    clockZoneDiffEl.textContent = "";
    clockZoneDiffEl.classList.add("hidden");
    clockZoneDiffEl.classList.remove("clock-zone-diff--accent");
  }
}

function startClocks() {
  stopClocks();
  tickClocks();
  void refreshServerClock();
  clockTickId = setInterval(tickClocks, 1000);
  clockServerPollId = setInterval(() => void refreshServerClock(), 30_000);
}

async function loadTimeSyncCaps() {
  const hint = document.querySelector("#sync-host-hint");
  const btn = document.querySelector("#sync-host-time");
  try {
    const c = await api("/api/time-sync-capabilities");
    if (!editionState.proHostTools) {
      if (hint) {
        hint.textContent =
          "Синхронизация времени хоста по SSH недоступна в базовой версии панели.";
      }
      if (btn) btn.disabled = true;
      return;
    }
    if (hint) {
      hint.textContent = c.hostTimeSync
        ? `Записывается UTC-момент с этого устройства на хост по SSH (root@${c.sshHost}). Пояс строки «Сервер»: ${c.serverClockTimeZone}. Пароль не сохраняется.`
        : `Авто-синхронизация по SSH недоступна (или TIME_SYNC_DISABLED). Пояс «Сервер»: ${c.serverClockTimeZone}. Задайте TZ контейнера панели при необходимости — см. README.`;
    }
    if (btn) btn.disabled = !c.hostTimeSync;
  } catch {
    if (hint) hint.textContent = "";
    if (btn) btn.disabled = true;
  }
}

document.querySelector("#sync-host-time")?.addEventListener("click", async () => {
  const inp = document.querySelector("#sync-root-pw");
  const pw = inp && typeof inp.value === "string" ? inp.value : "";
  if (!pw.trim()) {
    setStatus("Введите пароль root на хосте.", true);
    return;
  }
  try {
    setStatus("Беру время с этого устройства и отправляю на хост…", false);
    await api("/api/sync-host-time", {
      method: "POST",
      body: JSON.stringify({ rootPassword: pw, unixMs: Date.now() }),
    });
    inp.value = "";
    setStatus("Готово: часы хоста выставлены по вашему устройству (UTC). Проверьте строки времени.", false);
    void refreshServerClock();
  } catch (e) {
    setStatus(String(e.message || e), true);
  }
});

const dtRu = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "short",
  timeStyle: "short",
});

function formatLastDisconnect(c) {
  if (c.scheduledTunnelDisconnectAt && c.activeInConf) {
    const d = new Date(String(c.scheduledTunnelDisconnectAt));
    if (!Number.isNaN(d.getTime())) {
      return `${dtRu.format(d)} · авто`;
    }
  }
  const iso =
    c.lastDisconnectedAt ||
    (!c.activeInConf && c.disabledAt) ||
    null;
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return dtRu.format(d);
}

pwForm.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  setPwMsg("", false);
  if (pwNew.value !== pwNew2.value) {
    setPwMsg("Новый пароль и повтор не совпадают.", true);
    return;
  }
  try {
    const data = await api("/api/change-password", {
      method: "POST",
      body: JSON.stringify({
        currentPassword: pwCurrent.value,
        newPassword: pwNew.value,
      }),
    });
    pwCurrent.value = "";
    pwNew.value = "";
    pwNew2.value = "";
    setPwMsg(data.message || "Готово.", false);
    showLogin();
    loginPassword.focus();
  } catch (e) {
    setPwMsg(String(e.message || e), true);
  }
});

function renderRows(clients) {
  rowsEl.innerHTML = "";
  if (uiHidden.users) return;
  clients.forEach((c) => {
    const tr = document.createElement("tr");

    const nameTd = document.createElement("td");
    const nameWrap = document.createElement("div");
    nameWrap.className = "name-cell";
    const strong = document.createElement("strong");
    strong.textContent = c.name;
    if (!editionState.readOnlyClients) {
      const renameWrap = document.createElement("div");
      renameWrap.className = "rename-inline";
      renameWrap.appendChild(
        btn("Переименовать", "btn small ghost", () => void renameClient(c))
      );
      nameWrap.append(strong, renameWrap);
      if (!c.exportAvailable) {
        const hintFold = document.createElement("details");
        hintFold.className = "hint-mini";
        const sum = document.createElement("summary");
        sum.textContent = "Нет готового .conf на сервере (last_config)";
        hintFold.appendChild(sum);
        const exHint = document.createElement("p");
        exHint.className = "muted export-missing-hint";
        exHint.textContent =
          "Конфиг с сервера недоступен (нет last_config). Создайте клиента с нужным Endpoint в блоке «Новый клиент под каскад» ниже или возьмите ключ из приложения Amnezia.";
        hintFold.appendChild(exHint);
        nameWrap.appendChild(hintFold);
      }
    } else {
      nameWrap.appendChild(strong);
      const roHint = document.createElement("p");
      roHint.className = "muted hint-mini";
      roHint.style.margin = "0.35rem 0 0";
      roHint.textContent = c.exportAvailable
        ? "На сервере есть данные для .conf — экспорт недоступен в базовой версии."
        : "Нет last_config на сервере — полный конфиг в приложении Amnezia.";
      nameWrap.appendChild(roHint);
    }
    nameTd.appendChild(nameWrap);

    const ipTd = document.createElement("td");
    ipTd.innerHTML = `<span class="ip">${escapeHtml(c.allowedIps || "—")}</span>`;

    const stTd = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = `badge ${c.activeInConf ? "on" : "off"}`;
    if (c.activeInConf && c.warpEnabled) {
      badge.textContent = "В туннеле · WARP";
    } else {
      badge.textContent = c.activeInConf ? "В туннеле" : "Выключен";
    }
    stTd.appendChild(badge);

    const offTd = document.createElement("td");
    offTd.className = "date-cell";
    const dateLine = document.createElement("div");
    dateLine.textContent = formatLastDisconnect(c);
    offTd.appendChild(dateLine);
    if (!editionState.readOnlyClients) {
      const dtWrap = document.createElement("div");
      dtWrap.className = "rename-inline";
      dtWrap.appendChild(
        btn("Задать дату", "btn small ghost", () => openEditDisconnectDialog(c))
      );
      offTd.appendChild(dtWrap);
    }

    const actTd = document.createElement("td");
    actTd.className = "actions";

    if (editionState.readOnlyClients) {
      if (editionState.allowDeleteClients) {
        const note = document.createElement("div");
        note.className = "muted";
        note.style.fontSize = "0.85rem";
        note.style.marginBottom = "0.35rem";
        note.textContent = "Вкл/выкл, даты, переименование, экспорт недоступны";
        actTd.appendChild(note);
        actTd.appendChild(btn("Удалить", "btn small warn", () => confirmDelete(c.name, c.clientId)));
      } else {
        const lock = document.createElement("span");
        lock.className = "muted";
        lock.textContent = "Недоступно";
        actTd.appendChild(lock);
      }
    } else {
      if (c.activeInConf) {
        actTd.appendChild(btn("Выключить", "btn small ghost", () => openDisableDialog(c)));
      } else {
        actTd.appendChild(
          btn("Включить", "btn small primary", () => mutate("/api/clients/enable", c.clientId))
        );
      }
      if (c.exportAvailable) {
        const direct = document.createElement("a");
        direct.className = "btn small ghost";
        direct.href = clientExportGetUrl(c.clientId);
        direct.textContent = "Прямая ссылка";
        direct.rel = "noopener";
        direct.title =
          "Открыть в новой вкладке — скачается .conf, если вы авторизованы в этой панели (cookies).";

        actTd.appendChild(btn("Скачать .conf", "btn small ghost", () => void downloadClientConfig(c)));
        actTd.appendChild(direct);
        actTd.appendChild(
          btn("Копировать URL", "btn small ghost", async () => {
            const ok = await copyTextToClipboard(clientExportGetUrl(c.clientId));
            setStatus(ok ? "Ссылка скопирована (вставьте в браузер, будучи залогиненным)." : "Не удалось скопировать.", !ok);
          }),
        );
      }
      actTd.appendChild(btn("Удалить", "btn small warn", () => confirmDelete(c.name, c.clientId)));
    }

    tr.append(nameTd, ipTd, stTd, offTd, actTd);
    rowsEl.appendChild(tr);
  });
}

function btn(label, cls, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = cls;
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

/** Для политики WARP на сервере нужны IPv4 вида 10.8.x.x/32 */
function parseIpv4Cidrs(allowedIps) {
  if (!allowedIps) return [];
  return String(allowedIps)
    .split(",")
    .map((x) => x.trim())
    .filter((x) => /^(\d{1,3}\.){3}\d{1,3}\/\d{1,3}$/.test(x));
}

/** @param {{ warp?: Record<string, unknown>; clients: Record<string, unknown>[] }} data */
function renderWarpPanel(data) {
  if (!warpPanel || !warpStatusLine || !warpActionsEl || !warpClientListEl || !warpWgShowEl) return;
  if (uiHidden.warp) {
    warpPanel.hidden = true;
    return;
  }
  const w = data.warp;
  if (!w || w.supported === false) {
    warpPanel.hidden = true;
    return;
  }
  warpPanel.hidden = false;
  warpActionsEl.innerHTML = "";
  warpClientListEl.innerHTML = "";
  warpWgShowEl.textContent = typeof w.wgShowWarp === "string" ? w.wgShowWarp : "";

  if (!w.installed) {
    warpStatusLine.textContent = "Не установлен";
    const explain = document.createElement("p");
    explain.className = "muted warp-muted";
    explain.textContent =
      "Так и должно быть, пока на VPS не создан файл warp.conf внутри контейнера AWG. После установки статус сменится; без WARP обычный AmneziaWG уже работает.";
    warpActionsEl.appendChild(explain);

    if (w.hostSshInstall) {
      warpActionsEl.appendChild(
        btn("Установить WARP на VPS", "btn small primary", () => openWarpHostSetup("install")),
      );
      const sshHint = document.createElement("p");
      sshHint.className = "muted warp-muted";
      sshHint.textContent =
        "Кнопка запускает на хосте тот же скрипт, что в README; понадобится пароль root по SSH (не сохраняется). Альтернатива — команда вручную по SSH.";
      warpActionsEl.appendChild(sshHint);
    }

    const hint = document.createElement("p");
    hint.className = "muted warp-muted";
    hint.innerHTML =
      "Вручную на хосте (root), из каталога репозитория: <code class=\"inline\">bash scripts/warp-amnezia.sh install</code> или с именем контейнера: <code class=\"inline\">bash scripts/warp-amnezia.sh install amnezia-awg</code>.";
    warpActionsEl.appendChild(hint);

    if (!w.hostSshInstall) {
      const noBtn = document.createElement("p");
      noBtn.className = "muted warp-muted";
      noBtn.textContent =
        "Кнопка установки с панели недоступна: нет sshpass в образе панели или включено TIME_SYNC_DISABLED=1 — используйте SSH вручную.";
      warpActionsEl.appendChild(noBtn);
    }

    const skip = document.createElement("p");
    skip.className = "muted warp-muted";
    skip.textContent = "Если выход через Cloudflare не нужен, ничего не нажимайте — VPN уже работает без этого блока.";
    warpActionsEl.appendChild(skip);
    return;
  }

  const parts = [];
  parts.push(w.running ? "Интерфейс warp поднят" : "Интерфейс warp опущен");
  if (w.exitIp) parts.push(`выход ${w.exitIp}`);
  warpStatusLine.textContent = parts.join(" · ");

  const selection = new Set((w.selectedAllowedIps || []).map(String));
  /** Адреса из старого clients.list без соответствующего peer (смена IP, другой инстанс) — иначе «Применить» шлёт мусор вроде 10.x.1/32 интерфейса сервера. */
  const validWarpPeerIps = new Set();
  for (const c of data.clients) {
    if (!c.activeInConf) continue;
    parseIpv4Cidrs(c.allowedIps).forEach((ip) => validWarpPeerIps.add(ip));
  }
  for (const ip of [...selection]) {
    if (!validWarpPeerIps.has(ip)) selection.delete(ip);
  }

  function redrawChecks() {
    warpClientListEl.innerHTML = "";
    const frag = document.createDocumentFragment();
    let any = false;
    for (const c of data.clients) {
      if (!c.activeInConf) continue;
      const ips = parseIpv4Cidrs(c.allowedIps);
      if (!ips.length) continue;
      any = true;
      const ip = ips[0];
      const label = document.createElement("label");
      label.className = "warp-check-row";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = selection.has(ip);
      cb.addEventListener("change", () => {
        if (cb.checked) selection.add(ip);
        else selection.delete(ip);
      });
      const span = document.createElement("span");
      span.textContent = `${c.name} · ${ip}`;
      label.append(cb, span);
      frag.appendChild(label);
    }
    warpClientListEl.appendChild(frag);
    if (!any) {
      const p = document.createElement("p");
      p.className = "muted warp-muted";
      p.textContent =
        "Нет активных клиентов с IPv4 AllowedIPs (/32) — WARP-политика в вебе работает только для таких адресов.";
      warpClientListEl.appendChild(p);
    }
  }

  redrawChecks();

  warpActionsEl.appendChild(
    btn("Поднять WARP", "btn small primary", async () => {
      try {
        setStatus("Поднимаю WARP…", false);
        await api("/api/warp/start", { method: "POST", body: JSON.stringify({}) });
        setStatus("Готово.", false);
        await loadClients();
      } catch (e) {
        setStatus(String(e.message || e), true);
      }
    }),
  );
  warpActionsEl.appendChild(
    btn("Остановить WARP", "btn small ghost", async () => {
      try {
        setStatus("Останавливаю WARP…", false);
        await api("/api/warp/stop", { method: "POST", body: JSON.stringify({}) });
        setStatus("Готово.", false);
        await loadClients();
      } catch (e) {
        setStatus(String(e.message || e), true);
      }
    }),
  );
  warpActionsEl.appendChild(
    btn("Все в WARP", "btn small ghost", () => {
      for (const c of data.clients) {
        if (!c.activeInConf) continue;
        parseIpv4Cidrs(c.allowedIps).forEach((ip) => selection.add(ip));
      }
      redrawChecks();
    }),
  );
  warpActionsEl.appendChild(
    btn("Никого", "btn small ghost", () => {
      selection.clear();
      redrawChecks();
    }),
  );
  warpActionsEl.appendChild(
    btn("Применить маршрутизацию", "btn small primary", async () => {
      try {
        setStatus("Сохраняю WARP и перезапускаю контейнер AWG…", false);
        await api("/api/warp/routing", {
          method: "POST",
          body: JSON.stringify({ selectedAllowedIps: [...selection] }),
        });
        setStatus("Готово.", false);
        await loadClients();
      } catch (e) {
        setStatus(String(e.message || e), true);
      }
    }),
  );
  warpActionsEl.appendChild(
    btn("Удалить WARP с VPS", "btn small warn", () => openWarpHostSetup("uninstall")),
  );
}

function normalizeWarpCfPort() {
  const raw = warpCfPort?.value?.trim();
  const n = raw ? Number.parseInt(raw, 10) : 40000;
  if (!Number.isFinite(n) || n < 512 || n > 65535) return 40000;
  return n;
}

function warpCfPresetText(port) {
  const p = Number(port) || 40000;
  return (
    "### 3x-ui / Xray (на хосте)\n" +
    "SOCKS5 адрес: 127.0.0.1:" + p + "\n\n" +
    "Outbound (пример):\n" +
    "{\n" +
    '  \"tag\": \"warp-socks\",\n' +
    '  \"protocol\": \"socks\",\n' +
    '  \"settings\": {\"servers\": [{\"address\": \"127.0.0.1\", \"port\": ' + p + '}]}\n' +
    "}\n\n" +
    "Routing rule (пример):\n" +
    "{\n" +
    '  \"type\": \"field\",\n' +
    '  \"outboundTag\": \"warp-socks\",\n' +
    '  \"domain\": [\"geosite:google\", \"geosite:openai\"]\n' +
    "}\n\n" +
    "### Amnezia (xray в Docker)\n" +
    "SOCKS5 адрес: 172.17.0.1:" + p + "  (из контейнера до хоста)\n\n" +
    "Outbound (пример):\n" +
    "{\n" +
    '  \"tag\": \"warp-socks\",\n' +
    '  \"protocol\": \"socks\",\n' +
    '  \"settings\": {\"servers\": [{\"address\": \"172.17.0.1\", \"port\": ' + p + '}]}\n' +
    "}\n"
  );
}

function redrawWarpCfPresets() {
  if (!warpCfPresetsEl) return;
  warpCfPresetsEl.textContent = warpCfPresetText(normalizeWarpCfPort());
}

async function refreshWarpCfPanel() {
  if (!warpCfPanel || !warpCfStatusLine || !warpCfActionsEl || !warpCfLogEl) return;
  if (!editionState.proHostTools) {
    warpCfPanel.hidden = true;
    return;
  }
  warpCfPanel.hidden = false;
  redrawWarpCfPresets();

  warpCfActionsEl.innerHTML = "";
  if (warpCfBanner) {
    warpCfBanner.classList.add("hidden");
    warpCfBanner.textContent = "";
  }

  const pw = String(warpCfRootPw?.value || "").trim();
  const port = normalizeWarpCfPort();

  const explain = document.createElement("p");
  explain.className = "muted warp-muted";
  explain.textContent =
    "Для статуса/установки/удаления нужен пароль root по SSH на хост VPS. Пароль не сохраняется — вводите при каждом действии.";
  warpCfActionsEl.appendChild(explain);

  warpCfActionsEl.appendChild(
    btn("Статус", "btn small ghost", async () => {
      try {
        if (!pw) throw new Error("Введите пароль root.");
        setStatus("WARP (официальный): статус…", false);
        warpCfLogEl.textContent = "Запрос статуса…";
        const j = await api("/api/warp-cf/status", {
          method: "POST",
          body: JSON.stringify({ rootPassword: pw }),
        });
        warpCfStatusLine.textContent =
          j.installed
            ? `${j.running ? "подключён" : "не подключён"} · mode ${j.mode || "?"}` +
              (j.proxyPort ? ` · SOCKS :${j.proxyPort}` : "") +
              (j.account ? ` · ${j.account}` : "")
            : "не установлен";
        warpCfLogEl.textContent = (j.rawStatus || "") + (j.rawAccount ? "\n\n--- account ---\n" + j.rawAccount : "");
        setStatus("", false);
      } catch (e) {
        setStatus(String(e?.message || e), true);
      }
    }),
  );

  warpCfActionsEl.appendChild(
    btn("Установить (proxy mode)", "btn small primary", async () => {
      try {
        if (!pw) throw new Error("Введите пароль root.");
        if (!confirm(`Установить официальный Cloudflare WARP на хост VPS и поднять SOCKS5 на 127.0.0.1:${port}?`)) {
          return;
        }
        setStatus("WARP (официальный): установка…", false);
        warpCfLogEl.textContent = "Установка…";
        const j = await api("/api/warp-cf/install", {
          method: "POST",
          body: JSON.stringify({ rootPassword: pw, socksPort: port }),
        });
        warpCfLogEl.textContent = j.output || "Готово.";
        if (warpCfBanner) {
          warpCfBanner.textContent = `Готово: SOCKS5 на 127.0.0.1:${port}`;
          warpCfBanner.classList.remove("hidden");
        }
        setStatus("", false);
      } catch (e) {
        setStatus(String(e?.message || e), true);
      }
    }),
  );

  warpCfActionsEl.appendChild(
    btn("Применить WARP+ ключ", "btn small ghost", async () => {
      try {
        if (!pw) throw new Error("Введите пароль root.");
        const key = String(warpCfLicense?.value || "").trim();
        if (!key) throw new Error("Вставьте WARP+ ключ.");
        setStatus("WARP (официальный): применяю ключ…", false);
        warpCfLogEl.textContent = "Применение ключа…";
        const j = await api("/api/warp-cf/license", {
          method: "POST",
          body: JSON.stringify({ rootPassword: pw, licenseKey: key }),
        });
        warpCfLogEl.textContent = j.output || "Ключ применён.";
        if (warpCfLicense) warpCfLicense.value = "";
        setStatus("", false);
      } catch (e) {
        setStatus(String(e?.message || e), true);
      }
    }),
  );

  warpCfActionsEl.appendChild(
    btn("Удалить", "btn small warn", async () => {
      try {
        if (!pw) throw new Error("Введите пароль root.");
        if (!confirm("Удалить официальный Cloudflare WARP с хоста VPS (apt remove cloudflare-warp)?")) return;
        setStatus("WARP (официальный): удаление…", false);
        warpCfLogEl.textContent = "Удаление…";
        const j = await api("/api/warp-cf/uninstall", {
          method: "POST",
          body: JSON.stringify({ rootPassword: pw }),
        });
        warpCfLogEl.textContent = j.output || "Удалено.";
        warpCfStatusLine.textContent = "не установлен";
        setStatus("", false);
      } catch (e) {
        setStatus(String(e?.message || e), true);
      }
    }),
  );

  warpCfActionsEl.appendChild(
    btn("Применить пресет в Xray (3x‑ui: 127.0.0.1)", "btn small ghost", async () => {
      try {
        if (!pw) throw new Error("Введите пароль root.");
        const filePath = String(warpCfXrayPath?.value || "").trim();
        if (!filePath) throw new Error("Укажите путь к JSON конфигу Xray.");
        const domains = String(warpCfDomains?.value || "").trim();
        if (!confirm(`Внести изменения в ${filePath} (создадим .bak* рядом)?`)) return;
        setStatus("Xray preset: применяю…", false);
        warpCfLogEl.textContent = "Применение…";
        const j = await api("/api/warp-cf/xray-apply", {
          method: "POST",
          body: JSON.stringify({
            rootPassword: pw,
            filePath,
            socksAddress: "127.0.0.1",
            socksPort: port,
            domains,
          }),
        });
        warpCfLogEl.textContent = JSON.stringify(j, null, 2);
        setStatus("Готово (проверьте и перезапустите Xray/x-ui).", false);
      } catch (e) {
        setStatus(String(e?.message || e), true);
      }
    }),
  );

  warpCfActionsEl.appendChild(
    btn("Применить пресет в Xray (Docker: 172.17.0.1)", "btn small ghost", async () => {
      try {
        if (!pw) throw new Error("Введите пароль root.");
        const filePath = String(warpCfXrayPath?.value || "").trim();
        if (!filePath) throw new Error("Укажите путь к JSON конфигу Xray.");
        const domains = String(warpCfDomains?.value || "").trim();
        if (!confirm(`Внести изменения в ${filePath} (создадим .bak* рядом)?`)) return;
        setStatus("Xray preset: применяю…", false);
        warpCfLogEl.textContent = "Применение…";
        const j = await api("/api/warp-cf/xray-apply", {
          method: "POST",
          body: JSON.stringify({
            rootPassword: pw,
            filePath,
            socksAddress: "172.17.0.1",
            socksPort: port,
            domains,
          }),
        });
        warpCfLogEl.textContent = JSON.stringify(j, null, 2);
        setStatus("Готово (проверьте и перезапустите Xray/контейнер).", false);
      } catch (e) {
        setStatus(String(e?.message || e), true);
      }
    }),
  );
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function currentProfileIdValue() {
  if (!protoSelect || !protoSwitch || protoSwitch.classList.contains("hidden")) return "";
  return String(protoSelect.value || "").trim();
}

/** Query для нужного инстанса при нескольких профилях AWG_PROFILES */
function currentProfileQuerySuffix() {
  const pid = currentProfileIdValue();
  return pid ? `&profileId=${encodeURIComponent(pid)}` : "";
}

/** Прямая GET-ссылка на скачивание (работает в браузере с активной сессией панели). */
function clientExportGetUrl(clientId) {
  const q = `clientId=${encodeURIComponent(clientId)}${currentProfileQuerySuffix()}`;
  return `${window.location.origin}/api/clients/export-config?${q}`;
}

async function copyTextToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      return true;
    } catch {
      return false;
    }
  }
}

async function downloadClientConfig(c) {
  try {
    setStatus("Готовлю конфиг…", false);
    const res = await fetch(clientExportGetUrl(c.clientId), {
      method: "GET",
      credentials: "same-origin",
    });
    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try {
        const j = JSON.parse(text);
        msg = typeof j.error === "string" ? j.error : msg;
      } catch {
        /* сырой текст */
      }
      throw new Error(msg);
    }
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safe = String(c.name || "client")
      .replace(/[^\w\u0400-\u04FF\-]+/g, "_")
      .slice(0, 60);
    a.href = url;
    a.download = `amnezia-${safe}.conf`;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setStatus("Конфиг скачан.", false);
  } catch (e) {
    setStatus(String(e.message || e), true);
  }
}

async function downloadCascadeConf(ev) {
  ev.preventDefault();
  const endpointEl = document.querySelector("#cascade-endpoint");
  const portEl = document.querySelector("#cascade-port");
  const tunnelEl = document.querySelector("#cascade-tunnel-ip");
  const nameEl = document.querySelector("#cascade-name");
  const endpointHost = endpointEl?.value.trim() || "";
  if (!endpointHost) {
    setStatus("Укажите Endpoint (IP или DNS для клиента в каскаде).", true);
    return;
  }
  const body = { endpointHost };
  const praw = portEl?.value.trim() ?? "";
  if (praw) {
    const n = Number(praw);
    if (!Number.isFinite(n) || n < 1 || n > 65535) {
      setStatus("Некорректный порт Endpoint (1–65535).", true);
      return;
    }
    body.endpointPort = n;
  }
  const tip = tunnelEl?.value.trim();
  if (tip) body.tunnelIp = tip;
  const nm = nameEl?.value.trim();
  if (nm) body.clientName = nm;
  const pid = currentProfileIdValue();
  if (pid) body.profileId = pid;
  try {
    setStatus("Создаю клиента на сервере и собираю .conf…", false);
    const res = await fetch("/api/clients/create-cascade", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try {
        const j = JSON.parse(text);
        msg = typeof j.error === "string" ? j.error : msg;
      } catch {
        /* raw */
      }
      throw new Error(msg);
    }
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safe = (nm || "cascade")
      .replace(/[^\w\u0400-\u04FF\-]+/g, "_")
      .slice(0, 60);
    a.href = url;
    a.download = `amnezia-cascade-${safe}.conf`;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setStatus("Клиент добавлен на сервер, .conf скачан. Обновите таблицу.", false);
    await loadClients();
  } catch (e) {
    setStatus(String(e.message || e), true);
  }
}

async function renameClient(c) {
  const next = prompt(`Новое имя для «${c.name}»:`, c.name);
  if (next === null) return;
  const trimmed = next.trim().replace(/\s+/g, " ");
  if (!trimmed) {
    setStatus("Имя не может быть пустым", true);
    return;
  }
  try {
    setStatus("Сохраняю имя…", false);
    await api("/api/clients/rename", {
      method: "POST",
      body: JSON.stringify({ clientId: c.clientId, name: trimmed }),
    });
    setStatus("Готово.", false);
    await loadClients();
  } catch (e) {
    setStatus(String(e.message || e), true);
  }
}

async function mutate(path, clientId) {
  try {
    setStatus("Выполняю…", false);
    await api(path, { method: "POST", body: JSON.stringify({ clientId }) });
    setStatus("Готово.", false);
    await loadClients();
  } catch (e) {
    setStatus(String(e.message || e), true);
  }
}

async function confirmDelete(name, clientId) {
  const ok = confirm(
    `Удалить клиента «${name}»? Конфиг из приложения Amnezia перестанет совпадать с сервером.`
  );
  if (!ok) return;
  await mutate("/api/clients/delete", clientId);
}

async function loadClients() {
  try {
    setStatus("Загрузка…", false);
    const data = await api("/api/clients");
    applyEditionPayload(data);
    applyUiHiddenFromPayload(data);
    const pref = data.profileLabel ? `${data.profileLabel} · ` : "";
    if (uiHidden.users) {
      peerCountEl.textContent = "";
      wgShowEl.textContent = "";
    } else {
      peerCountEl.textContent = `${pref}${data.clients.length} в таблице · ${data.peerCount} peer`;
      wgShowEl.textContent = data.wgShow || "";
    }
    renderWarpPanel(data);
    void refreshWarpCfPanel();
    renderRows(data.clients);
    setStatus("", false);
    void refreshServerClock();
  } catch (e) {
    const msg = String(e.message || e);
    if (msg.includes("Unauthorized")) {
      showLogin();
      setStatus("", false);
      loginError.textContent = "Сессия истекла — войдите снова.";
      return;
    }
    setStatus(msg, true);
    rowsEl.innerHTML = "";
    wgShowEl.textContent = "";
    peerCountEl.textContent = "";
    if (warpPanel) warpPanel.hidden = true;
    if (warpCfPanel) warpCfPanel.hidden = true;
    if (mtprotoPanel) mtprotoPanel.hidden = true;
  }
}

async function boot() {
  const ok = await checkSession();
  if (ok) {
    showApp();
    await loadProtocols();
    await loadTimeSyncCaps();
    await loadClients();
  } else {
    showLogin();
    loginPassword.focus();
  }
}

function applyThemePref(pref) {
  const root = document.documentElement;
  const p = pref === "light" || pref === "dark" ? pref : "auto";
  const resolved =
    p === "auto"
      ? window.matchMedia?.("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : p;
  root.setAttribute("data-theme-pref", p);
  root.setAttribute("data-theme", resolved);
  try {
    localStorage.setItem("amnezia.theme", p);
  } catch {
    /* приватный режим — не критично */
  }
}

function initThemeSwitch() {
  let saved = "auto";
  try {
    const v = localStorage.getItem("amnezia.theme");
    if (v === "light" || v === "dark" || v === "auto") saved = v;
  } catch {
    /* приватный режим — не критично */
  }
  applyThemePref(saved);
  if (themeSelect) {
    themeSelect.value = saved;
    themeSelect.addEventListener("change", () => applyThemePref(themeSelect.value));
  }
  const mql = window.matchMedia?.("(prefers-color-scheme: dark)");
  if (mql) {
    const handler = () => {
      const pref = document.documentElement.getAttribute("data-theme-pref") || "auto";
      if (pref === "auto") applyThemePref("auto");
    };
    if (typeof mql.addEventListener === "function") mql.addEventListener("change", handler);
    else if (typeof mql.addListener === "function") mql.addListener(handler);
  }
}

/** Ссылки доната в подвале панели (`GET /api/panel/footer`). */
function wirePanelPromoAnchor(el, url, label) {
  const u = typeof url === "string" ? url.trim() : "";
  const lb = typeof label === "string" ? label.trim() : "";
  if (!el || !u || !lb) {
    if (el) {
      el.classList.add("hidden");
      el.removeAttribute("href");
      el.textContent = "";
    }
    return false;
  }
  el.href = u;
  el.textContent = lb;
  el.classList.remove("hidden");
  return true;
}

async function hydratePanelPromoFooter() {
  const gap1 = document.getElementById("footer-promo-gap1");
  const aDonF = document.getElementById("footer-promo-donate");
  const fSepDO = document.getElementById("footer-promo-sep-donate-ozon");
  const aOzonF = document.getElementById("footer-promo-ozon");
  const fSepOT = document.getElementById("footer-promo-sep-ozon-tg");
  const aTgF = document.getElementById("footer-promo-telegram");

  try {
    const r = await fetch("/api/panel/footer", { credentials: "same-origin" });
    if (!r.ok) return;
    const j = await r.json().catch(() => null);
    if (!j || typeof j !== "object") return;

    wirePanelPromoAnchor(aDonF, j.donateUrl, j.donateLabel);
    wirePanelPromoAnchor(aOzonF, j.ozonUrl, j.ozonLabel);
    wirePanelPromoAnchor(aTgF, j.telegramUrl, j.telegramLabel);

    const footerD = aDonF && !aDonF.classList.contains("hidden");
    const footerO = aOzonF && !aOzonF.classList.contains("hidden");
    const footerT = aTgF && !aTgF.classList.contains("hidden");

    if (gap1) gap1.classList.toggle("hidden", !(footerD || footerO || footerT));
    if (fSepDO) fSepDO.classList.toggle("hidden", !(footerD && (footerO || footerT)));
    if (fSepOT) fSepOT.classList.toggle("hidden", !(footerO && footerT));
  } catch {
    /* офлайн или сбой — в HTML уже дефолтные ссылки подвала */
  }
}

function initMtprotoLinkCopy() {
  if (!mtprotoLinkCopyBtn) return;
  mtprotoLinkCopyBtn.addEventListener("click", async () => {
    const link =
      mtprotoLinkCardEl?.dataset?.tgLink ||
      mtprotoLinkAnchorEl?.href ||
      "";
    if (!link) return;
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(link);
      else {
        const ta = document.createElement("textarea");
        ta.value = link;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
      if (mtprotoLinkCopyState) {
        mtprotoLinkCopyState.textContent = "Скопировано";
        setTimeout(() => {
          if (mtprotoLinkCopyState) mtprotoLinkCopyState.textContent = "";
        }, 2000);
      }
    } catch (e) {
      if (mtprotoLinkCopyState) {
        mtprotoLinkCopyState.textContent = "Не удалось скопировать — выделите вручную.";
      }
    }
  });
}

initThemeSwitch();
initMtprotoLinkCopy();
void hydratePanelPromoFooter();
if (warpCfPort) warpCfPort.addEventListener("input", () => redrawWarpCfPresets());
boot();
