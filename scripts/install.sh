#!/usr/bin/env bash
# Установка Amnezia Admin WebUI одной командой (см. README).
set -euo pipefail

GITHUB_REPO="${GITHUB_REPO:-andrey271192/amnezia_web}"
BRANCH="${BRANCH:-main}"
INSTALL_DIR="${INSTALL_DIR:-/opt/amnezia-admin}"
DATA_DIR="${DATA_DIR:-/opt/amnezia-admin-data}"
CONTAINER_NAME="${CONTAINER_NAME:-amnezia-admin}"
HOST_PORT="${HOST_PORT:-8080}"
LANDING_CONTAINER="${LANDING_CONTAINER:-amnezia-web-landing}"
LANDING_IMAGE="${LANDING_IMAGE:-amnezia-web-landing:latest}"
LANDING_PORT="${LANDING_PORT:-80}"

need_root() {
  if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
    echo "Запустите от root: sudo bash или: curl ... | sudo bash"
    exit 1
  fi
}

need_docker() {
  command -v docker >/dev/null 2>&1 || {
    echo "Ошибка: нужен Docker."
    exit 1
  }
  docker info >/dev/null 2>&1 || {
    echo "Ошибка: демон Docker не отвечает."
    exit 1
  }
}

need_root
need_docker

REPO_SLUG="${GITHUB_REPO##*/}"
TMP=""
cleanup() {
  [[ -n "${TMP}" ]] && rm -rf "${TMP}"
}
trap cleanup EXIT

if [[ "${SKIP_DOWNLOAD:-}" != "1" ]]; then
  echo "→ Клонирование релиза ${GITHUB_REPO} (${BRANCH})..."
  echo "→ Скачивание tar.gz с GitHub (вывода может не быть 1–10 мин.; при блокировках задайте зеркало GITHUB_REPO_URL_OVERRIDE или см. CURL_MAX_TIME ниже)."
  TMP=$(mktemp -d)
  CURL_OPTS=(
    -fsSL
    -H 'Cache-Control: no-cache'
    -H 'Pragma: no-cache'
    --connect-timeout "${CURL_CONNECT_TIMEOUT:-30}"
    --max-time "${CURL_MAX_TIME:-900}"
    --retry "${CURL_RETRY:-2}"
    --retry-delay "${CURL_RETRY_DELAY:-5}"
    --retry-connrefused
  )
  if [[ "${INSTALL_SCRIPT_VERBOSE:-}" == "1" ]]; then CURL_OPTS+=(--progress-bar); fi
  GH_AUTH_TOKEN="${GITHUB_TOKEN:-${GH_TOKEN:-}}"
  if [[ -n "${GH_AUTH_TOKEN}" ]]; then
    CURL_OPTS+=(-H "Authorization: Bearer ${GH_AUTH_TOKEN}")
    CURL_OPTS+=(-H "X-GitHub-Api-Version: 2022-11-28")
  fi
  CURL_URL="${GITHUB_REPO_URL_OVERRIDE:-}"
  if [[ -z "${CURL_URL}" ]]; then
    if [[ -n "${GH_AUTH_TOKEN}" ]]; then
      CURL_URL="https://api.github.com/repos/${GITHUB_REPO}/tarball/${BRANCH}"
    else
      CURL_URL="https://github.com/${GITHUB_REPO}/archive/refs/heads/${BRANCH}.tar.gz"
    fi
  fi
  if ! curl "${CURL_OPTS[@]}" "${CURL_URL}" | tar xz -C "${TMP}"; then
    echo "Ошибка: не удалось скачать или распаковать архив (${CURL_URL})."
    echo "Подсказка: проверьте токен (для приватного репо нужен GITHUB_TOKEN/GH_TOKEN с правом Contents:Read), ping/curl до github.com, при необходимости export GITHUB_REPO_URL_OVERRIDE='…' или INSTALL_SCRIPT_VERBOSE=1."
    exit 1
  fi
  echo "→ Перенос распакованного дерева в ${INSTALL_DIR}…"
  __extracted_dir="$(find "${TMP}" -mindepth 1 -maxdepth 1 -type d | head -n1)"
  if [[ -z "${__extracted_dir}" ]]; then
    echo "Ошибка: распакованный архив пуст (${CURL_URL})."
    exit 1
  fi
  rm -rf "${INSTALL_DIR}"
  mkdir -p "$(dirname "${INSTALL_DIR}")"
  mv "${__extracted_dir}" "${INSTALL_DIR}"
  TMP=""
  echo "→ Источники на месте."
fi

mkdir -p "${DATA_DIR}"

# При повторном запуске не менять внешний порт панели, если не указали HOST_PORT явно (по умолчанию 8080).
PREV_HOST_PORT=""
if docker inspect "${CONTAINER_NAME}" >/dev/null 2>&1; then
  # Контейнер может существовать, но быть остановлен: `docker port` тогда код ≠ 0 — при pipefail рвём весь скрипт без сообщения.
  __dock_port_out=""
  __dock_port_out="$(docker port "${CONTAINER_NAME}" 3980/tcp 2>/dev/null)" || :
  if [[ -n "${__dock_port_out}" ]]; then
    PREV_HOST_PORT="$(printf '%s\n' "${__dock_port_out}" | head -n1 | awk -F: '{print $NF}')" || PREV_HOST_PORT=""
  fi
  if [[ -n "${PREV_HOST_PORT}" && "${HOST_PORT}" == "8080" ]]; then
    HOST_PORT="${PREV_HOST_PORT}"
    echo "→ Уже запущен ${CONTAINER_NAME}: сохраняю внешний порт ${HOST_PORT} (укажите HOST_PORT=… чтобы сменить)."
  fi
fi

BOOT_PW=""
PASS_FILE="/root/amnezia-admin.initial-password"
if [[ -n "${ADMIN_PASSWORD:-}" ]]; then
  BOOT_PW="${ADMIN_PASSWORD}"
  if [[ -f "${DATA_DIR}/password.hash" ]]; then
    __pw_backup="${DATA_DIR}/password.hash.bak.$(date -u +%Y%m%dT%H%M%SZ)"
    cp -p "${DATA_DIR}/password.hash" "${__pw_backup}" 2>/dev/null || true
    rm -f "${DATA_DIR}/password.hash"
    rm -f "${DATA_DIR}/session.secret"
    echo "→ ADMIN_PASSWORD задан — сбрасываю старый пароль панели (backup: ${__pw_backup})."
  else
    echo "→ Использую ADMIN_PASSWORD из окружения."
  fi
elif [[ -f "${DATA_DIR}/password.hash" ]]; then
  echo "→ В ${DATA_DIR} уже есть password.hash — контейнер поднимется с прежним паролем."
else
  BOOT_PW="admin"
  umask 077
  printf '%s\n' "${BOOT_PW}" >"${PASS_FILE}"
  echo "→ Первый вход: admin / admin. Смените пароль сразу после входа."
fi

# AWG_PROFILES: не терять при апдейте без переменной (пропадает список «Инстанс»).
AWG_PROFILE_SNAPSHOT="/root/amnezia-admin.awg-profiles.json"
if [[ -n "${AWG_PROFILES:-}" ]]; then
  umask 077
  printf '%s\n' "${AWG_PROFILES}" >"${AWG_PROFILE_SNAPSHOT}" 2>/dev/null || true
elif docker inspect "${CONTAINER_NAME}" >/dev/null 2>&1; then
  PREV_AWG_PROFILES=""
  while IFS= read -r __env_line; do
    if [[ "${__env_line}" == AWG_PROFILES=* ]]; then
      PREV_AWG_PROFILES="${__env_line#AWG_PROFILES=}"
      break
    fi
  done < <(docker inspect "${CONTAINER_NAME}" --format '{{range .Config.Env}}{{println .}}{{end}}')
  if [[ -n "${PREV_AWG_PROFILES}" ]]; then
    AWG_PROFILES="${PREV_AWG_PROFILES}"
    echo "→ AWG_PROFILES восстановлен из предыдущего контейнера ${CONTAINER_NAME}."
    umask 077
    printf '%s\n' "${AWG_PROFILES}" >"${AWG_PROFILE_SNAPSHOT}" 2>/dev/null || true
  fi
fi
if [[ -z "${AWG_PROFILES:-}" ]] && [[ -f "${AWG_PROFILE_SNAPSHOT}" ]]; then
  AWG_PROFILES="$(tr -d '\r\n' <"${AWG_PROFILE_SNAPSHOT}" || true)"
  if [[ -n "${AWG_PROFILES}" ]]; then
    echo "→ AWG_PROFILES восстановлен из ${AWG_PROFILE_SNAPSHOT}."
  fi
fi

if [[ -z "${AWG_PROFILES:-}" ]]; then
  __awg_multi_count="$(
    docker ps --format '{{.Names}}' 2>/dev/null | awk '/^amnezia-awg/ { c++ } END { print c + 0 }' | tr -d '[:space:]'
  )"
  if [[ "${__awg_multi_count:-0}" =~ ^[0-9]+$ ]] && [[ "${__awg_multi_count}" -gt 1 ]]; then
    echo "⚠ Запущено ${__awg_multi_count} контейнеров с именами amnezia-awg*, но AWG_PROFILES не задан."
    echo "  Переключатель «Инстанс» в панели не появится: см. README, раздел «Несколько инстансов» и «Переменные окружения и sudo»."
    echo "  Без sudo -E: запишите JSON одной строкой в ${AWG_PROFILE_SNAPSHOT} и снова запустите этот установщик."
  fi
fi

PREV_CONTAINER_ENV=""
if docker inspect "${CONTAINER_NAME}" >/dev/null 2>&1; then
  PREV_CONTAINER_ENV="$(docker inspect "${CONTAINER_NAME}" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null || true)"
fi
for __reuse_var in UI_HIDE_SECTIONS UI_HIDE_USERS UI_HIDE_WARP UI_HIDE_CASCADE WARP_SSH_INSTALL_DIR \
  EXPORT_CONFIG_SECRET CLIENT_CONFIG_ENDPOINT CLIENT_EXPORT_DNS1 CLIENT_EXPORT_DNS2; do
  if [[ -z "${!__reuse_var:-}" ]] && [[ -n "${PREV_CONTAINER_ENV}" ]]; then
    PREV_VAL=""
    while IFS= read -r __line; do
      if [[ "${__line}" == "${__reuse_var}="* ]]; then
        PREV_VAL="${__line#*=}"
        break
      fi
    done <<<"${PREV_CONTAINER_ENV}"
    if [[ -n "${PREV_VAL}" ]]; then
      printf -v "${__reuse_var}" '%s' "${PREV_VAL}"
      echo "→ ${__reuse_var} восстановлен из предыдущего контейнера ${CONTAINER_NAME}."
    fi
  fi
done


DOCKER_BUILD_EXTRA=()
if [[ "${NO_CACHE:-}" == "1" ]]; then
  DOCKER_BUILD_EXTRA+=(--no-cache)
  echo "→ NO_CACHE=1 — сборка без слоя кэша Docker."
fi

echo "→ Сборка образа amnezia-admin:latest ..."
docker build "${DOCKER_BUILD_EXTRA[@]}" -t amnezia-admin:latest "${INSTALL_DIR}"

docker rm -f "${CONTAINER_NAME}" 2>/dev/null || true

RUN_ENV=(
  -e AWG_CONTAINER="${AWG_CONTAINER:-amnezia-awg2}"
)

if [[ -n "${AWG_PROFILES:-}" ]]; then
  RUN_ENV+=( -e "AWG_PROFILES=${AWG_PROFILES}" )
fi

if [[ -n "${TIME_SYNC_SSH_HOST:-}" ]]; then
  RUN_ENV+=( -e "TIME_SYNC_SSH_HOST=${TIME_SYNC_SSH_HOST}" )
fi

if [[ -n "${TIME_SYNC_DISABLED:-}" ]]; then
  RUN_ENV+=( -e "TIME_SYNC_DISABLED=${TIME_SYNC_DISABLED}" )
fi

if [[ -n "${TZ:-}" ]]; then
  RUN_ENV+=( -e "TZ=${TZ}" )
fi

for __warp_var in WARP_DIR WARP_CONF_PATH WARP_CLIENTS_LIST AMNEZIA_START_SCRIPT WARP_SSH_INSTALL_DIR; do
  if [[ -n "${!__warp_var:-}" ]]; then
    RUN_ENV+=( -e "${__warp_var}=${!__warp_var}" )
  fi
done

for __panel_env_var in UI_HIDE_SECTIONS UI_HIDE_USERS UI_HIDE_WARP UI_HIDE_CASCADE UI_HIDE_MTPROTO \
  EXPORT_CONFIG_SECRET CLIENT_CONFIG_ENDPOINT CLIENT_EXPORT_DNS1 CLIENT_EXPORT_DNS2; do
  if [[ -n "${!__panel_env_var:-}" ]]; then
    RUN_ENV+=( -e "${__panel_env_var}=${!__panel_env_var}" )
  fi
done

for __mt_vars in MTPRO_PROXY_CONTAINER MTPRO_PROXY_IMAGE MTPRO_INTERNAL_PORT MTPRO_PUBLISH_PORT \
  MTPRO_PUBLISH_BIND MTPRO_PUBLIC_HOST; do
  if [[ -n "${!__mt_vars:-}" ]]; then
    RUN_ENV+=( -e "${__mt_vars}=${!__mt_vars}" )
  fi
done

if [[ -n "${BOOT_PW}" ]]; then
  RUN_ENV+=( -e "ADMIN_PASSWORD=${BOOT_PW}" )
elif [[ "${ALLOW_DEFAULT_PASSWORD:-}" == "1" ]] || [[ "${ALLOW_DEFAULT_PASSWORD:-}" == "true" ]]; then
  RUN_ENV+=( -e "ALLOW_DEFAULT_PASSWORD=1" )
fi

for __ce_var in PANEL_FOOTER_DONATE_URL PANEL_FOOTER_OZON_URL PANEL_FOOTER_TELEGRAM_URL \
  PANEL_FOOTER_DONATE_LABEL PANEL_FOOTER_OZON_LABEL PANEL_FOOTER_TELEGRAM_LABEL PANEL_FOOTER_PROMO_SUBTITLE; do
  if [[ -n "${!__ce_var:-}" ]]; then
    RUN_ENV+=( -e "${__ce_var}=${!__ce_var}" )
  fi
done

host_tcp_port_in_use() {
  local port="$1"
  command -v ss >/dev/null 2>&1 || return 1
  ss -tln 2>/dev/null | grep -qE ":${port}([^0-9]|$)"
}

if [[ "${SKIP_LANDING:-}" != "1" ]] && [[ -d "${INSTALL_DIR}/landing" ]]; then
  if [[ "${LANDING_PORT:-80}" == "80" ]] && host_tcp_port_in_use 80; then
    echo "⚠ На хосте занят TCP-порт 80 — лендинг нельзя привязать к :80 без конфликта."
    LP=8081
    while host_tcp_port_in_use "${LP}" && [[ "${LP}" -lt 8100 ]]; do
      LP=$((LP + 1))
    done
    LANDING_PORT="${LP}"
    echo "→ Использую LANDING_PORT=${LANDING_PORT} (или задайте LANDING_PORT=… явно)."
  fi
fi

IP="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"

docker run -d --name "${CONTAINER_NAME}" --restart unless-stopped \
  -p "${HOST_PORT}:3980" \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "${DATA_DIR}:/data" \
  -e "HOST_DATA_DIR=${DATA_DIR}" \
  "${RUN_ENV[@]}" \
  amnezia-admin:latest

if [[ "${SKIP_LANDING:-}" != "1" ]] && [[ -d "${INSTALL_DIR}/landing" ]]; then
  printf "window.__AMNEZIA_ADMIN_PORT__='%s';\n" "${HOST_PORT}" >"${INSTALL_DIR}/landing/admin-port.js"
  echo "→ Сборка образа ${LANDING_IMAGE} (страница на порту ${LANDING_PORT})..."
  docker build "${DOCKER_BUILD_EXTRA[@]}" -t "${LANDING_IMAGE}" "${INSTALL_DIR}/landing"
  docker rm -f "${LANDING_CONTAINER}" 2>/dev/null || true
  if docker run -d --name "${LANDING_CONTAINER}" --restart unless-stopped \
    -p "${LANDING_PORT}:80" \
    "${LANDING_IMAGE}"; then
    echo "→ Публичная страница (лендинг): http://${IP:-SERVER_IP}:${LANDING_PORT}/"
  else
    echo "⚠ Не удалось запустить лендинг (часто порт ${LANDING_PORT} занят). Поставьте LANDING_PORT=8081 или SKIP_LANDING=1."
  fi
else
  echo "→ Лендинг пропущен (SKIP_LANDING=1 или нет каталога landing)."
fi

echo ""
echo "=== Готово ==="
echo "Админ-панель: http://${IP:-SERVER_IP}:${HOST_PORT}"
if [[ "${SKIP_LANDING:-}" != "1" ]]; then
  echo "Лендинг для пользователей: http://${IP:-SERVER_IP}:${LANDING_PORT}/ (ссылки доната автора — только в админ-панели)"
fi

# Выводим пароль в stdout по запросу пользователя.
# 1) Первый запуск: пароль генерится/приходит через ADMIN_PASSWORD.
# 2) Переустановка/апгрейд: если есть только password.hash — пароль восстановить нельзя.
if [[ -f "${PASS_FILE}" ]]; then
  __pw="$(tr -d '\r\n' <"${PASS_FILE}" || true)"
  if [[ -n "${__pw}" ]]; then
    echo "Первый пароль: ${__pw}"
  fi
elif [[ -n "${BOOT_PW}" ]]; then
  echo "Первый пароль: ${BOOT_PW}"
elif [[ -f "${DATA_DIR}/password.hash" ]]; then
  echo "Пароль уже задан ранее (обнаружен ${DATA_DIR}/password.hash) — текущий пароль восстановить нельзя."
  echo "Чтобы задать новый пароль: остановите контейнер, удалите ${DATA_DIR}/password.hash и запустите установку с переменной окружения ADMIN_PASSWORD=…"
fi
if [[ "${ALLOW_DEFAULT_PASSWORD:-}" == "1" ]] || [[ "${ALLOW_DEFAULT_PASSWORD:-}" == "true" ]]; then
  echo "Пароль по умолчанию (смените в панели): AmneziaAdmin!ChangeMe"
fi
echo ""
echo "Удаление: curl -fsSL https://raw.githubusercontent.com/${GITHUB_REPO}/${BRANCH}/scripts/uninstall.sh | sudo bash"
