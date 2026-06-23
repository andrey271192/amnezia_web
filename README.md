# amnezia_web

Веб‑панель **AmneziaWG** на своём VPS (**Docker**): таблица клиентов, статусы «в туннеле», AllowedIPs, несколько инстансов через **`AWG_PROFILES`**, часы сервера и браузера, смена пароля панели.

**Редакция по умолчанию — FREE (`community`):** смотреть клиентов, **удалять** peer с сервера, поставить **Telegram MTProto‑прокси** из интерфейса. Всё остальное (вкл/выкл, даты, `.conf`, каскад, WARP, синхронизация времени…) — в **[amnezia_web-PRO](https://github.com/andrey271192/amnezia_web-PRO)**; из FREE можно перейти на PRO по GitHub‑токену (жёлтый баннер после входа).

> VPN‑контейнер AmneziaWG вы поднимаете как обычно. Этот репозиторий — только **панель в Docker** поверх уже работающего AWG.

Подробнее по кнопкам и сценариям: **[docs/panel-guide.md](docs/panel-guide.md)**.

---

## Как выглядит панель

В FREE сверху жёлтая плашка «базовая версия» и меньше кнопок, чем в PRO; таблица клиентов та же.

<p align="center">
<img src="docs/screenshots/panel-users-table.png" alt="Таблица клиентов AmneziaWG: инстанс, время, статус в туннеле" width="780"/>
<br/><br/>
<img src="docs/screenshots/panel-overview-password.png" alt="Шапка панели и смена пароля" width="780"/>
</p>


---

## Установка для клиента (маркер в томе + явный ALLOW в контейнере)

Раньше многие полагались на этот режим ради поля PAT — сейчас оно включено по умолчанию. **`INSTALL_FREE_COMMUNITY_ACTIVATION=1`** по-прежнему полезен: создаёт **`/opt/amnezia-admin-data/.install-free-github-pro-opt-in`** и при следующих **`curl … | sudo bash`** снова прокидывает **`ALLOW_COMMUNITY_GITHUB_ACTIVATION=1`** в контейнер (если когда-то задали отключение вручную).

```bash
export INSTALL_FREE_COMMUNITY_ACTIVATION=1
curl -fsSL https://raw.githubusercontent.com/andrey271192/amnezia_web/main/scripts/install.sh | sudo -E bash
```

Другой порт панели (например 8884):

```bash
curl -fsSL https://raw.githubusercontent.com/andrey271192/amnezia_web/main/scripts/install.sh \
  | sudo -E env HOST_PORT=8884 LANDING_PORT=8081 bash
```

Переменная **`INSTALL_FREE_COMMUNITY_ACTIVATION`** сохранится в томе как файл **`.install-free-github-pro-opt-in`**: следующие апдейты через **`sudo bash`** подхватят маркер **без** повторного `export` (или с **`sudo -E`**, если передаёте другие переменные в той же сессии).

---

## Отключить поле GitHub и установку из панели (жёсткий FREE)

Чтобы под баннером **не было** ввода токена и **запретить** **`POST …/run-private-install`**, задайте в контейнере **`ALLOW_COMMUNITY_GITHUB_ACTIVATION=0`** (или **`false`** / **`no`** / **`off`**) и перезапустите панель. Обычная установка **`curl … | sudo bash`** без этой переменной **оставляет поле включённым** в FREE.

Стандартная установка того же образа без отключения:

```bash
curl -fsSL https://raw.githubusercontent.com/andrey271192/amnezia_web/main/scripts/install.sh | sudo bash
```

Форк или ветка (**с тем же режимом маркера по желанию**):

```bash
export GITHUB_REPO="вы/репо"
export BRANCH="main"
export INSTALL_FREE_COMMUNITY_ACTIVATION=1
curl -fsSL "https://raw.githubusercontent.com/${GITHUB_REPO}/${BRANCH}/scripts/install.sh" | sudo -E bash
```

Уже скачали проект:

```bash
cd /opt/amnezia-admin && chmod +x scripts/install.sh && sudo SKIP_DOWNLOAD=1 bash scripts/install.sh
```

### Переменные окружения и `sudo`

Если передаёте **`AWG_PROFILES`** или **`ADMIN_PASSWORD`** в одной строке с `curl`, используйте **`sudo -E bash`**, иначе `sudo` не увидит переменные. Альтернатива — записать JSON профилей в **`/root/amnezia-admin.awg-profiles.json`** и запустить обычный `curl … | sudo bash`. Подробнее см. историю коммитов и зеркальный README в репозитории PRO.

### Важные переменные

| Переменная | По умолчанию | Назначение |
|------------|--------------|------------|
| `INSTALL_FREE_COMMUNITY_ACTIVATION` | _(не задано)_ | `1`: маркер **`.install-free-github-pro-opt-in`** в томе + явно **`ALLOW_COMMUNITY_GITHUB_ACTIVATION=1`** при сборке **`RUN_ENV`** (удобно после ручного `ALLOW=0` или если нужно навсегда фиксировать в томе).
| `GITHUB_REPO` | `andrey271192/amnezia_web` | Архив для установки |
| `HOST_PORT` | `8080` | Порт панели |
| `AWG_CONTAINER` | `amnezia-awg` | Контейнер WG по умолчанию |
| `AWG_PROFILES` | _(нет)_ | Несколько инстансов; см. примеры в репозитории PRO |
| `COMMUNITY_UPGRADE_URL` | Страница подписки PRO на Boosty (зашита в код по умолчанию) | Переопределите, если смените уровень подписки |
| `COMMUNITY_UPGRADE_PITCH` | _(текст по умолчанию в коде)_ | Текст под заголовком базовой версии |
| `PANEL_FOOTER_DONATE_URL` | Как **`COMMUNITY_UPGRADE_URL`** | Ссылка «донат» в **шапке и подвале** веб‑панели (**не** добавляется на nginx‑лендинг пользователей). |
| `PANEL_FOOTER_TELEGRAM_URL` | `https://t.me/lot_andrey` | Ссылка Telegram‑спонсора / канала (там же: только панель). |
| `PANEL_FOOTER_OZON_URL` | Ссылка на **Ozon СБП** автора (дефолт в `server.js`) | Донат через Ozon — **шапка и подвал** панели с остальными ссылками. |
| `PANEL_FOOTER_DONATE_LABEL` | `Поддержать проект` | Текст якоря доната |
| `PANEL_FOOTER_OZON_LABEL` | `Донат · Ozon СБП` | Текст якоря Ozon |
| `PANEL_FOOTER_TELEGRAM_LABEL` | `Telegram‑канал спонсора` | Текст якоря Telegram |
| `PANEL_FOOTER_PROMO_SUBTITLE` | _(строка по умолчанию в коде)_ | Поясняющий текст в верхней полосе панели |
| `SKIP_LANDING` | `0` | `1` — без лендинга на порту 80 |
| `ALLOW_COMMUNITY_GITHUB_ACTIVATION` | _в редакции **`community` поле вкл по умолчанию_ | Явное **`0`** / **`false`** / **`no`** / **`off`** — **скрыть** ввод PAT и заблокировать **`POST /api/community/run-private-install`** (после перезапуска контейнера). **`1`** / **`true`** не обязательны. |
| `COMMUNITY_PRIVATE_INSTALL_SCRIPT_URL` | `https://raw.githubusercontent.com/andrey271192/amnezia_web-pro/main/scripts/install.sh` | Сырой URL `scripts/install.sh` в **вашем** приватном репозитории PRO |
| `COMMUNITY_INSTALL_FETCH_MS` | `60000` | Таймаут HTTP при скачивании установщика из GitHub |
| `PRIVATE_INSTALL_SCRIPT_MAX_BYTES` | `2097152` | Максимальный размер скачанного скрипта (байты) |
| `COMMUNITY_INSTALL_LOG_TAIL_BYTES` | `98304` | Первый ответ **`GET /api/community/install-log`** без `since` отдаёт **хвост** последних N байт (для живого блока в UI при установке PRO). Диапазон 1 KiB … 512 KiB через env. |
| `COMMUNITY_INSTALL_LOG_API_CHUNK_MAX` | `524288` | Максимум байт **за один** запрос «догонять» журнал (~512 KiB; верхний предел через env ограничен). |
| `COMMUNITY_DISABLE_DOCKER_CLI_HELPER` | _(не задано)_ | Если `1`, установка из UI снова только «bash внутри панели» (часто конфликт **:8080** с PRO). По умолчанию используется одноразовый контейнер **docker:cli**, который **снимает FREE** и зависший PRO перед `install.sh`. |
| `COMMUNITY_SKIP_REMOVE_FREE_BEFORE_PRIVATE_PRO` | `0` | `1` — не выполнять `docker rm` FREE/лендинга перед install (если знаете, что делаете). |
| `COMMUNITY_PRO_INSTALL_HELPER_IMAGE` | `docker:26-cli` | Образ с бинарём `docker` для фонового контейнера (нужен доступ к демону по сокету). |
| `COMMUNITY_HELPER_SKIP_PREPARE_TOOLS` | _(не задано)_ | `1` — helper не ставит **`bash`** и **`curl`** в образе Alpine (обычно **не нужно**; без них `#!/usr/bin/env bash` или `curl` в PRO `install.sh` падают). |
| `MTPRO_PROXY_CONTAINER` | `mtproto-proxy` | Имя контейнера MTProto‑прокси Telegram (официальный образ **telegrammessenger/proxy**, см. Dockerfile на Docker Hub). |
| `MTPRO_PROXY_IMAGE` | `telegrammessenger/proxy:latest` | Образ **`docker pull` + `docker run`** при установке из панели (FREE/community). |
| `MTPRO_INTERNAL_PORT` | `443` | Порт процесса **внутри** контейнера (официальный прокси слушает 443/tcp). Мапится на **`MTPRO_PUBLISH_*`**. |
| `MTPRO_PUBLISH_PORT` | `8443` | Порт хоста VPS (**внешний**), проброшенный в контейнер. |
| `MTPRO_PUBLISH_BIND` | `0.0.0.0` | Адрес биндинга на хосте (`-p` в Docker); при нескольких сетевых интерфейсах при необходимости уточняют. |
| `MTPRO_PUBLIC_HOST` | _(нет)_ | Публичный IP или DNS для ссылки **`tg://proxy`** в UI; можно вместо него задать **`CLIENT_CONFIG_ENDPOINT`**. |
| `UI_HIDE_MTPROTO` | _(не задано)_ | `1` или **`UI_HIDE_SECTIONS=...,mtproto`** — скрыть раздел установки MTProto в веб‑интерфейсе (по умолчанию виден даже FREE). |
| `FREE_PANEL_CONTAINER_FOR_PRO_INSTALL` и др. | см. `server.js` | Имена контейнеров для `docker rm` перед install (по умолчанию `amnezia-admin`, `amnezia-web-landing`, `amnezia-admin-pro`). |

**MTProto‑прокси и API панели:** **`GET /api/mtproto/status`** отдаёт состояние контейнера и ссылку **`tg://`** без тяжёлых операций при открытии блока. Опционально **`GET /api/mtproto/status?withLogs=1`** добавляет в ответ хвост **`docker logs`** (поле **`logsFetched`**). Отдельные эндпоинты: **`GET /api/mtproto/logs`** и **`GET /api/mtproto/tail`** (тот же смысл, если обратный прокси режет URI с **`logs`**). За nginx/Caddy перед панелью нужно пробрасывать **весь** префикс **`/api/`** одним правилом — см. блок **«Not found»** в **«Частые проблемы»** ниже.

Поле токена **по умолчанию уже есть**. Чтобы **убрать** его — см. раздел **«Отключить поле GitHub…»** выше. URL приватного `install.sh` задаёт **`COMMUNITY_PRIVATE_INSTALL_SCRIPT_URL`**.

**Важно:** при одноразовом запуске с переменными в одной строке с `curl … | sudo bash` они **пропадают** — нужен **`export`** перед `curl` и **`sudo -E bash`**, см. блок **«Установка для клиента»** выше.

Остальные переменные совместимы с образом панели (см. Dockerfile / `server.js` в этом репозитории).

---

## Обновление

Обычно достаточно:

```bash
curl -fsSL https://raw.githubusercontent.com/andrey271192/amnezia_web/main/scripts/install.sh | sudo bash
```

Если нужен маркер **`.install-free-github-pro-opt-in`** в томе (см. раздел выше) или переменные хоста при **`sudo`**, используйте **`export INSTALL_FREE_COMMUNITY_ACTIVATION=1`** и **`sudo -E bash`**.

После сообщения **`→ Клонирование релиза …`** несколько минут **может ничего не печататься**: идёт `curl … | tar` с GitHub. Для **полосы прогресса**: `sudo INSTALL_SCRIPT_VERBOSE=1 bash` (или передайте переменную в окружение до `|`). Если обрывает по времени или «тишина» часами задайте таймауты: **`CURL_CONNECT_TIMEOUT`** (по умолчанию 30 с к подключению), **`CURL_MAX_TIME`** (по умолчанию до 900 с на загрузку), **`CURL_RETRY`**. Полный URL tar.gz можно подменить: **`GITHUB_REPO_URL_OVERRIDE`** (должен указывать на архив того же вида **`${REPO}-${BRANCH}.tar.gz`**, после распаковки каталог будет **`ИмяРепозитория-${BRANCH}`**).

Принудительная пересборка образа: **`NO_CACHE=1`**.

---

## Удаление

```bash
curl -fsSL https://raw.githubusercontent.com/andrey271192/amnezia_web/main/scripts/uninstall.sh | sudo bash
```

---

## Частые проблемы

### Пропало поле «токен GitHub» под плашкой FREE

Редакция должна быть **`community`**. Чаще всего в **`docker inspect amnezia-admin` → Env** осталось **`ALLOW_COMMUNITY_GITHUB_ACTIVATION=0`** (или **`false`** / **`no`** / **`off`**) — удалите переменную или поставьте **`1`** и снова выполните **`install.sh`**. Установщик при апдейте переносит **`ALLOW_*`** из **предыдущего** контейнера. Маркер **`${DATA_DIR}/.install-free-github-pro-opt-in`** при **`INSTALL_FREE_COMMUNITY_ACTIVATION=1`** снова прокинет **`ALLOW=1`**, если установщику на хосте не задали **`ALLOW_COMMUNITY_GITHUB_ACTIVATION=0`**.

### Журнал установки и docker-helper

После успешной кнопки **«Установить PRO»** в той же панели открывается **живой блок «Журнал установки»** (поллинг каждые 2 с к **`GET /api/community/install-log`**; для запросов нужна сессия в браузере). Пока старый контейнер FREE снят и новый образ ещё не поднял ту же вкладку, поток журнала в браузере **прерывается** — откройте адрес панели снова после старта PRO; файл **`community-install-last.log`** на томе данных тот же. Кнопка **«Пауза»** останавливает опрос журнала.

В режиме **docker-helper** панель пишет в **`community-install-last.log`** финальную строку **`--- helper завершён code=…`** **внутри** одноразового контейнера: её видно даже если процесс FREE-панели убрал **`docker rm`** и Node не успевает добавить строку **`--- завершено …`**. Если в логе после преамбулы одноразового установщика **нет** ни одной финальной строки — обновите образ панели с актуального **`amnezia_web`** и повторите установку.

### `Bind for 0.0.0.0:8080 failed: port is already allocated` у `amnezia-admin-pro`

На **8080** уже слушает **FREE**‑панель (**`amnezia-admin`**). Пока она работает, второй контейнер панели (PRO) на тот же порт не поднимется. **Кнопка «Установить PRO» из UI по умолчанию** использует одноразовый контейнер **`docker:cli`** (пауза → **`docker rm`** FREE / лендинг / **`amnezia-admin-pro` и любые имена вида `_…_…-amnezia-admin-pro`** из docker compose → затем ваш **`install.sh`**). Иначе вручную: **`docker rm -f amnezia-admin`**, затем установщик PRO. Отключить авто-снос: **`COMMUNITY_DISABLE_DOCKER_CLI_HELPER=1`**.

### В `community-install-last.log`: **`curl: command not found`**, **`tar: invalid magic`**, **`code=2` сразу после helper

Образ **`docker:26-cli`** на Alpine обычно **без `bash` и без `curl`**. PRO `install.sh` с **`#!/usr/bin/env bash`** и загрузкой архива через **`curl | tar`** без них не стартуют (**`curl: command not found`**, **`tar: invalid magic`**). Если после строки «одноразовый установщик» почти сразу **`--- завершено … code=2`** — возможны ошибка сборки prelude в **`sh`**, ошибка **`docker run … -e TOKEN=…`** из‑за спецсимволов в PAT, или **apk** не смог добавить **`bash`** (сеть из контейнера). Обновите панель с **`main`**: helper целиком шлёт **stdout/stderr в лог**, токены передаются средой процесса (без интерполяции в аргументе `-e`), prelude разделён **`;`**; перед **`install.sh`** скрипт сообщает если **нет bash/curl** (**выход по коду ~126**). Если **apk недоступен** — свой **`COMMUNITY_PRO_INSTALL_HELPER_IMAGE`** с **`bash` и `curl`**, либо в приватном `install.sh` перейти на **`#!/bin/sh`** и **`wget`**. Отключить подготовку: **`COMMUNITY_HELPER_SKIP_PREPARE_TOOLS=1`**.

### Установка «зависла» на сообщении **`→ Клонирование релиза …`** и долго без вывода

Это этап **скачивания и распаковки** архива с GitHub. Запустите установщик с **`INSTALL_SCRIPT_VERBOSE=1`** (полоска загрузки `curl`). Задайте **`CURL_MAX_TIME`** если нужно усечь ожидание. При блокировках GitHub с хоста — зеркальный полный URL в **`GITHUB_REPO_URL_OVERRIDE`** (см. раздел «Обновление»).

### `SKIP_DOWNLOAD=1 bash scripts/install.sh` завершается сразу без вывода («нифига» не происходит)

В старых версиях под **`set -o pipefail`** подсчёт контейнеров через **`grep`** падал, если **нет ни одного запущенного имени `amnezia-awg…`**; отдельно тот же эффект давал пайплайн **`docker port … | head | awk`** при **остановленном** `amnezia-admin`: `docker inspect` ещё «видит» контейнер, а **`docker port` возвращает ошибку**. Скрипт обрывался до **«Сборка образа»**. Обновите **`scripts/install.sh`** до актуального из `main` или временно выполните **`docker rm -f amnezia-admin`** перед установкой.

### `Error response from daemon: No such container: amnezia-awg`

С версии **1.2.40** панель сама ищет контейнер AmneziaWG, если дефолтный **`amnezia-awg`** отсутствует. Поддержаны имена вроде **`amneziawg`**, **`amnezia-awg2`** и другие контейнеры с **`wg/awg`** в имени, если внутри есть конфиг. Также автоматически выбираются рабочий конфиг (**`awg0.conf` / `wg0.conf`**), `clientsTable` и binary (**`awg` / `wg`**). Если автопоиск не подходит — задайте **`AWG_CONTAINER`** явно.

### Лендинг: порт 80 занят

Если на хосте уже что-то слушает **TCP 80**, установщик сообщит об этом и, при дефолтном **`LANDING_PORT=80`**, сам попробует другой свободный порт (обычно начиная с **8081**). Либо явно: **`LANDING_PORT=8083`**, либо **`SKIP_LANDING=1`**.

### Раздел MTProto или вся панель: ошибка «Not found», API не отвечает

Чаще всего браузер бьётся не в **Node**‑процесс панели, а в **прокси** (nginx и т.п.) с неполным маппингом: **`/api/mtproto/*`**, **`/api/clients`** и остальное должны уходить на тот же upstream, что и **`/`** панели. Должен проксироваться **любой** путь под **`/api/`**, а не только отдельные location. На самой VPS **`curl -fsS http://127.0.0.1:ПОРТ_ПАНЕЛИ/health`** должен вернуть JSON с **`version`**. Если с localhost работает, а через домен — **404**, смотрите конфигурацию обратного прокси и TLS.

### AmneziaWG Legacy: удаление клиента не срабатывает (`wg0.conf is world accessible` / `No such device`)

Панель синхронизирует живой интерфейс через **`wg-quick strip` + `syncconf`**. У Legacy конфиг часто **`/opt/amnezia/awg/wg0.conf`**, интерфейс — **`wg0`**, не **`awg0`**. В актуальном коде интерфейс выводится из **имени файла** (**`wg0.conf` → `wg0`**). Если путь другой — задайте в профиле **`AWG_IFACE`** / в **`AWG_PROFILES`** поле **`iface`**. Предупреждение про world-accessible: перед применением конфига файл на стороне контейнера выставляется в **`chmod 600`**.

---

## Лицензия

MIT — см. [LICENSE](LICENSE).

---

## Поддержка проекта

---

- ⭐ **GitHub:** [andrey271192/amnezia_web](https://github.com/andrey271192/amnezia_web)
- 💖 **Boosty:** [boosty.to/andrey27/donate](https://boosty.to/andrey27/donate)
- 💳 **Ozon Bank (СБП):** [ссылка](https://finance.ozon.ru/apps/sbp/ozonbankpay/019dc200-2a5d-7931-a619-782d285f6798)
- ✉️ **Telegram:** [@lot_andrey](https://t.me/lot_andrey)
