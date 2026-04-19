const axios = require("axios");
const { wrapper } = require("axios-cookiejar-support");
const { CookieJar } = require("tough-cookie");
const mqtt = require("mqtt");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { v4: uuidv4 } = require("uuid");
const { execFile } = require("child_process");
const os = require("os");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

const PHONE_NUMBER = process.env.ZOMATO_PHONE || "YOUR_PHONE_NUMBER";
const OTP_PREFERENCE = "sms"; // sms | whatsapp | call
const NTFY_TOPIC = process.env.NTFY_TOPIC || "your-ntfy-topic";
const NTFY_TITLE = process.env.NTFY_TITLE || ""; // e.g. "Umesh Order Cancel hoya Check Kar"
const NTFY_MESSAGE = process.env.NTFY_MESSAGE || ""; // custom body; if empty, default body is used
const NTFY_BASE_URL = "https://ntfy.sh";
const NTFY_ACCESS_TOKEN = ""; // optional for protected topics
const NTFY_SERVER_LABEL = process.env.NTFY_SERVER_LABEL || os.hostname();

const COUNTRY_ID = "1";
const CLIENT_ID = "5276d7f1-910b-4243-92ea-d27e758ad02b";
const API_KEY = "7749b19667964b87a3efc739e254ada2";
const ZOMATO_UUID = "b2691abb-5aac-48a5-9f0e-750349080dcb";

const MESSAGE_STALE_MS = 120_000;
const DEDUP_TTL_MS = 10 * 60 * 60 * 1000;
const ALERT_MODE = "smart"; // smart | legacy
const CLAIM_SUPPRESSION_WINDOW_MS = 2500;
const RECENT_CLAIM_TTL_MS = 10 * 60 * 1000;

const STATE_DIR = path.resolve(__dirname, process.env.STATE_DIR || "state");
const SETTINGS_FILE = path.join(STATE_DIR, "settings.json");
const DEDUP_FILE = path.join(STATE_DIR, "dedup.json");

function ensureStateDir() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
}

function nowIso() {
  return new Date().toISOString();
}

function log(message) {
  console.log(`[${nowIso()}] ${message}`);
}

function toFormBody(payload) {
  return new URLSearchParams(payload).toString();
}

function getFinalUrl(response) {
  return response?.request?.res?.responseUrl || response?.config?.url || "";
}

function buildCommonHeaders(host) {
  return {
    Accept: "image/webp",
    "Accept-Encoding": "br, gzip",
    Connection: "keep-alive",
    Host: host,
    "User-Agent":
      "&source=android_market&version=10&device_manufacturer=Google&device_brand=google&device_model=Android+SDK+built+for+x86_64&api_version=931&app_version=v19.3.1",
    "X-Android-Id": "29435aa6a6755a97",
    "X-Zomato-API-Key": API_KEY,
    "X-Zomato-App-Version": "931",
    "X-Zomato-App-Version-Code": "1710019310",
    "X-Zomato-Client-Id": CLIENT_ID,
    "X-Zomato-UUID": ZOMATO_UUID,
    "is-akamai-video-optimisation-enabled": "0",
    pragma: "akamai-x-get-request-id,akamai-x-cache-on, akamai-x-check-cacheable",
    "USER-BUCKET": "0",
    "USER-HIGH-PRIORITY": "0",
    "X-Access-UUID": "71783d00-13fc-4e81-9ba6-9428f2c6c75c",
    "X-Accessibility-Dynamic-Text-Scale-Factor": "1.0",
    "X-Accessibility-Voice-Over-Enabled": "0",
    "X-APP-APPEARANCE": "LIGHT",
    "X-App-Language": "&lang=en&android_language=en&android_country=",
    "X-App-Session-Id": "b287175a-035e-4346-b8fb-0b19c4892cea",
    "X-APP-THEME": "default",
    "X-Appsflyer-UID": "1770210645057-4891034784193940182",
    "X-BLINKIT-INSTALLED": "false",
    "X-Bluetooth-On": "false",
    "X-City-Id": "-1",
    "X-Client-Id": "zomato_android_v2",
    "X-Device-Height": "2208",
    "X-Device-Language": "en",
    "X-Device-Pixel-Ratio": "2.75",
    "X-Device-Width": "1080",
    "X-DISTRICT-INSTALLED": "false",
    "X-FIREBASE-INSTANCE-ID": "3bc79ef61af45c349bef251f2de8d858",
    "X-Installer-Package-Name": "cm.aptoide.pt",
    "X-Jumbo-Session-Id": `e26bfcdb-8b7f-462d-a388-d49f6652c0e${Date.now()}`,
    "X-Network-Type": "mobile_UNKNOWN",
    "X-O2-City-Id": "-1",
    "x-perf-class": "PERFORMANCE_AVERAGE",
    "X-Present-Horizontal-Accuracy": "-1",
    "X-Present-Lat": "0.0",
    "X-Present-Long": "0.0",
    "X-Request-Id": uuidv4(),
    "X-RIDER-INSTALLED": "false",
    "X-SYSTEM-APPEARANCE": "UNSPECIFIED",
    "X-User-Defined-Lat": "0.0",
    "X-User-Defined-Long": "0.0",
    "X-VPN-Active": "1",
  };
}

function buildApiHeaders(accessToken = null) {
  const headers = {
    Accept: "image/webp",
    Connection: "keep-alive",
    "X-Zomato-API-Key": API_KEY,
    "X-Zomato-App-Version": "931",
    "X-Zomato-App-Version-Code": "1710019310",
    "X-Zomato-Client-Id": CLIENT_ID,
    "X-Zomato-UUID": ZOMATO_UUID,
  };

  if (accessToken) {
    headers["X-Zomato-Access-Token"] = accessToken;
  }
  return headers;
}

function createHttpClient(jar) {
  return wrapper(
    axios.create({
      jar,
      withCredentials: true,
      maxRedirects: 10,
      timeout: 30000,
      validateStatus: () => true,
    }),
  );
}

function generatePkce() {
  const verifier = crypto
    .randomBytes(32)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  const challenge = crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return { verifier, challenge };
}

function generateStateString(length = 32) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

async function setAuthCookies(jar, codeVerifier) {
  const base = "https://accounts.zomato.com";
  await jar.setCookie(`zxcv=${codeVerifier}; Domain=.zomato.com; Path=/`, base);
  await jar.setCookie(`cid=${CLIENT_ID}; Domain=.zomato.com; Path=/`, base);
  await jar.setCookie(
    "rurl=https://accounts.zomato.com/zoauth/callback; Domain=.zomato.com; Path=/",
    base,
  );
}

async function preOtpFlow(http, jar, phone) {
  const { verifier, challenge } = generatePkce();
  await setAuthCookies(jar, verifier);

  const authUrl = new URL("https://accounts.zomato.com/oauth2/auth");
  authUrl.searchParams.set("approval_prompt", "auto");
  authUrl.searchParams.set("scope", "offline openid");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("redirect_uri", "https://accounts.zomato.com/zoauth/callback");
  authUrl.searchParams.set("state", generateStateString());
  authUrl.searchParams.set("client_id", CLIENT_ID);
  authUrl.searchParams.set("code_challenge", challenge);

  const authResp = await http.get(authUrl.toString(), {
    headers: buildCommonHeaders("accounts.zomato.com"),
  });
  if (authResp.status < 200 || authResp.status >= 300) {
    throw new Error(`Auth init failed with HTTP ${authResp.status}`);
  }

  const authFinalUrl = new URL(getFinalUrl(authResp));
  const loginChallenge = authFinalUrl.searchParams.get("login_challenge");
  if (!loginChallenge) {
    throw new Error("Failed to extract login_challenge");
  }

  const payload = toFormBody({
    number: phone,
    country_id: COUNTRY_ID,
    lc: loginChallenge,
    type: "initiate",
    verification_type: OTP_PREFERENCE,
    package_name: "com.application.zomato",
    message_uuid: "",
  });

  const sendOtpResp = await http.post("https://accounts.zomato.com/login/phone", payload, {
    headers: {
      ...buildCommonHeaders("accounts.zomato.com"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  if (sendOtpResp.status < 200 || sendOtpResp.status >= 300) {
    throw new Error(`Send OTP failed with HTTP ${sendOtpResp.status}`);
  }

  const body = sendOtpResp.data || {};
  if (!body.status) {
    throw new Error(`Send OTP rejected: ${body.message || "unknown error"}`);
  }

  return { codeVerifier: verifier, loginChallenge };
}

async function postOtpFlow(http, phone, otp, loginChallenge, codeVerifier) {
  const submitPayload = toFormBody({
    number: phone,
    otp,
    country_id: COUNTRY_ID,
    lc: loginChallenge,
    type: "verify",
    trust_this_device: "true",
    device_token: "",
  });

  const submitResp = await http.post("https://accounts.zomato.com/login/phone", submitPayload, {
    headers: {
      ...buildCommonHeaders("accounts.zomato.com"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  if (submitResp.status < 200 || submitResp.status >= 300) {
    throw new Error(`OTP verify failed with HTTP ${submitResp.status}`);
  }
  if (!submitResp.data?.status) {
    throw new Error(`OTP verify rejected: ${submitResp.data?.message || "invalid otp"}`);
  }

  const redirect1 = submitResp.data.redirect_to;
  if (!redirect1) {
    throw new Error("Missing redirect_to after OTP verification");
  }

  const consentPageResp = await http.get(redirect1, {
    headers: buildCommonHeaders("accounts.zomato.com"),
  });
  const consentPageFinal = new URL(getFinalUrl(consentPageResp));
  const consentChallenge = consentPageFinal.searchParams.get("consent_challenge");
  if (!consentChallenge) {
    throw new Error("Failed to extract consent_challenge");
  }

  const consentResp = await http.post(
    "https://accounts.zomato.com/consent",
    toFormBody({ cc: consentChallenge }),
    {
      headers: {
        ...buildCommonHeaders("accounts.zomato.com"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
    },
  );
  if (consentResp.status < 200 || consentResp.status >= 300) {
    throw new Error(`Consent failed with HTTP ${consentResp.status}`);
  }
  if (!consentResp.data?.status) {
    throw new Error(`Consent rejected: ${consentResp.data?.message || "unknown"}`);
  }

  const redirect2 = consentResp.data.redirect_to;
  if (!redirect2) {
    throw new Error("Missing redirect_to after consent");
  }

  const finalResp = await http.get(redirect2, {
    headers: buildCommonHeaders("accounts.zomato.com"),
  });
  const finalUrl = new URL(getFinalUrl(finalResp));
  const code = finalUrl.searchParams.get("code");
  const state = finalUrl.searchParams.get("state");
  const scope = finalUrl.searchParams.get("scope");
  if (!code || !state) {
    throw new Error("Missing code/state in OAuth final redirect");
  }

  const tokenPayload = {
    grant_type: "authorization_code",
    code,
    state,
    code_verifier: codeVerifier,
    client_id: CLIENT_ID,
    redirect_uri: "https://accounts.zomato.com/zoauth/callback",
  };
  if (scope) tokenPayload.scope = scope;

  const tokenResp = await http.post("https://accounts.zomato.com/token", toFormBody(tokenPayload), {
    headers: {
      ...buildCommonHeaders("accounts.zomato.com"),
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  if (tokenResp.status < 200 || tokenResp.status >= 300) {
    throw new Error(`Token exchange failed with HTTP ${tokenResp.status}`);
  }
  if (!tokenResp.data?.status) {
    throw new Error(`Token exchange rejected: ${tokenResp.data?.message || "unknown"}`);
  }

  const token = tokenResp.data.token || {};
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token || "",
  };
}

async function getUserInfo(http, accessToken) {
  const resp = await http.get("https://api.zomato.com/gw/user/info", {
    headers: buildApiHeaders(accessToken),
  });
  if (resp.status < 200 || resp.status >= 300) {
    throw new Error(`User info failed with HTTP ${resp.status}`);
  }
  return resp.data;
}

function findSnippets(element, targetType, output = []) {
  if (Array.isArray(element)) {
    for (const item of element) {
      findSnippets(item, targetType, output);
    }
    return output;
  }
  if (element && typeof element === "object") {
    const snippetType = element.layout_config?.snippet_type;
    if (snippetType === targetType && element[targetType]) {
      output.push(element[targetType]);
    }
    for (const value of Object.values(element)) {
      findSnippets(value, targetType, output);
    }
  }
  return output;
}

async function getUserLocations(http, accessToken) {
  const payload = {
    android_country: "",
    location_permissions: {
      device_location_on: false,
      location_permission_available: false,
      precise_location_permission_available: false,
    },
    current_app_address_id: null,
    incremental_call: false,
    source: "delivery_home",
    lang: "en",
    android_language: "en",
    postback_params: "{}",
    recent_locations: [],
    city_id: "1",
  };

  const resp = await http.post("https://api.zomato.com/gw/user/location/selection", payload, {
    headers: {
      ...buildApiHeaders(accessToken),
      "Content-Type": "application/json; charset=UTF-8",
    },
  });
  if (resp.status < 200 || resp.status >= 300) {
    throw new Error(`Locations fetch failed with HTTP ${resp.status}`);
  }

  const snippets = findSnippets(resp.data, "location_address_snippet");
  const parsed = [];
  for (const snippet of snippets) {
    const updateResult = snippet?.click_action?.update_location_result;
    const address = updateResult?.address;
    const place = address?.place;
    if (!address?.id) continue;
    parsed.push({
      name: snippet?.title?.text || address?.alias || "Unknown",
      fullAddress: snippet?.subtitle?.text || address?.display_subtitle || "",
      addressId: Number(address.id),
      cellId: place?.cell_id || "",
      entityId: address?.subzone_id ? Number(address.subzone_id) : null,
      placeId: address?.delivery_subzone_id || place?.place_id || null,
      lat: place?.latitude ? Number(place.latitude) : null,
      lng: place?.longitude ? Number(place.longitude) : null,
    });
  }

  return parsed;
}

async function getTabbedHomeEssentials(http, accessToken, cellId, addressId) {
  const url = new URL("https://api.zomato.com/gw/tabbed-home");
  url.searchParams.set("cell_id", String(cellId));
  url.searchParams.set("address_id", String(addressId));

  const resp = await http.get(url.toString(), {
    headers: buildApiHeaders(accessToken),
  });
  if (resp.status < 200 || resp.status >= 300) {
    throw new Error(`Tabbed home failed with HTTP ${resp.status}`);
  }

  const root = resp.data || {};
  const cityId = Number(root?.location?.city?.id || 0);
  const channels = Array.isArray(root.subscription_channels) ? root.subscription_channels : [];
  const channel = channels.find((ch) => ch?.type === "food_rescue");
  if (!channel) {
    throw new Error("food_rescue subscription channel not found");
  }

  return {
    cityId,
    foodRescue: {
      channelName: Array.isArray(channel.name) ? channel.name[0] : "",
      qos: Number(channel.qos || 0),
      validUntil: Number(channel.time || 0),
      client: {
        username: channel?.client?.username || "",
        password: channel?.client?.password || "",
        keepalive: Number(channel?.client?.keepalive || 30),
      },
    },
  };
}

function loadSettings() {
  ensureStateDir();
  if (!fs.existsSync(SETTINGS_FILE)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveSettings(next) {
  ensureStateDir();
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2), "utf8");
}

function isFoodRescueConfigValid(foodRescue) {
  if (!foodRescue || !foodRescue.channelName || !foodRescue.client?.username) {
    return false;
  }
  return true;
}

function loadDedupMap() {
  ensureStateDir();
  if (!fs.existsSync(DEDUP_FILE)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(DEDUP_FILE, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveDedupMap(map) {
  ensureStateDir();
  fs.writeFileSync(DEDUP_FILE, JSON.stringify(map), "utf8");
}

function cleanupDedupMap(map) {
  const cutoff = Date.now() - DEDUP_TTL_MS;
  for (const [key, ts] of Object.entries(map)) {
    if (!Number.isFinite(ts) || ts < cutoff) {
      delete map[key];
    }
  }
}

async function ask(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function pickLocation(locations, settings) {
  if (!locations.length) {
    throw new Error("No saved addresses found in this account");
  }

  const savedAddressId = Number(settings.selectedAddressId || 0);
  if (savedAddressId) {
    const existing = locations.find((loc) => loc.addressId === savedAddressId);
    if (existing) {
      log(`Using saved address: ${existing.name} (${existing.addressId})`);
      return existing;
    }
  }

  log("Select one address for monitoring:");
  locations.forEach((loc, idx) => {
    console.log(`  [${idx + 1}] ${loc.name} | ${loc.fullAddress} | address_id=${loc.addressId}`);
  });

  while (true) {
    const input = await ask("Enter choice number: ");
    const n = Number(input);
    if (Number.isInteger(n) && n >= 1 && n <= locations.length) {
      const picked = locations[n - 1];
      saveSettings({
        ...settings,
        selectedAddressId: picked.addressId,
        selectedAddressName: picked.name,
      });
      log(`Saved selected address: ${picked.name} (${picked.addressId})`);
      return picked;
    }
    console.log("Invalid choice. Try again.");
  }
}

function printAlert(payload) {
  process.stdout.write("\u0007");
  log("ALERT: order_cancelled detected");
  if (payload?.data?.order_id) {
    log(`order_id=${payload.data.order_id}`);
  }
}

function normalizeOrderValue(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = String(value).trim();
  if (!normalized) {
    return null;
  }
  const lowered = normalized.toLowerCase();
  if (lowered === "unknown" || lowered === "null" || lowered === "undefined" || lowered === "na" || lowered === "n/a") {
    return null;
  }
  return normalized;
}

function extractOrderKey(payload) {
  const data = payload?.data || {};
  const candidates = [
    data.order_id,
    data.orderId,
    data.parent_order_id,
    data.parentOrderId,
    data.cart_id,
    data.cartId,
    data.request_id,
    data.requestId,
    payload?.order_id,
    payload?.orderId,
  ];
  for (const value of candidates) {
    const orderKey = normalizeOrderValue(value);
    if (orderKey) {
      return orderKey;
    }
  }
  return null;
}

async function sendNtfyAlert(payload, selectedLocationName) {
  if (!NTFY_TOPIC || NTFY_TOPIC === "REPLACE_WITH_NTFY_TOPIC") {
    return;
  }

  const extractedOrderId = extractOrderKey(payload);
  const hasOrderPayload = Boolean(extractedOrderId);
  const orderId = extractedOrderId ?? "unknown";
  const defaultTitle = hasOrderPayload
    ? `Chomato (${NTFY_SERVER_LABEL}): Order Cancelled [ACTION]`
    : `Chomato (${NTFY_SERVER_LABEL}): Order Cancelled [NO_ORDER_ID]`;
  const title = hasOrderPayload
    ? "CHOMATO CANCELLED - REAL ORDER (CHECK NOW)"
    : "CHOMATO CANCELLED - NO ORDER ID (LIKELY IGNORE)";
  const body = NTFY_MESSAGE || `Cancelled order detected for ${selectedLocationName}. order_id=${orderId}`;
  const url = `${NTFY_BASE_URL.replace(/\/+$/g, "")}/${encodeURIComponent(NTFY_TOPIC)}`;

  try {
    const args = [
      "-sS",
      "-m",
      "4",
      "-X",
      "POST",
      url,
      "-H",
      `Title: ${title}`,
      "-H",
      "Priority: urgent",
      "-H",
      "Tags: rotating_light,iphone,food",
      "-H",
      "Click: zomato://",
    ];
    if (NTFY_ACCESS_TOKEN) {
      args.push("-H", `Authorization: Bearer ${NTFY_ACCESS_TOKEN}`);
    }
    args.push("-d", body);
    const { stdout } = await execFileAsync("curl", args, { timeout: 5000 });
    log(`ntfy push sent via curl ${stdout ? `(response=${stdout.trim()})` : ""}`);
  } catch (err) {
    log(`ntfy push failed via curl: ${err?.message || "unknown error"}`);
  }
}

function startMonitor(foodRescue, selectedLocationName) {
  let cancelledCount = 0;
  let claimedCount = 0;
  let reconnectCount = 0;
  const dedupMap = loadDedupMap();
  const pendingCancelledAlerts = new Map();
  const recentClaimByOrder = new Map();
  cleanupDedupMap(dedupMap);
  saveDedupMap(dedupMap);

  const mqttUrl = "mqtts://hedwig.zomato.com:443";
  const client = mqtt.connect(mqttUrl, {
    clientId: `chomato_server_${Date.now()}`,
    clean: true,
    keepalive: foodRescue.client.keepalive || 30,
    reconnectPeriod: 5000,
    connectTimeout: 30000,
    username: foodRescue.client.username,
    password: foodRescue.client.password,
    rejectUnauthorized: false,
  });

  client.on("connect", () => {
    log("MQTT connected");
    client.subscribe(foodRescue.channelName, { qos: foodRescue.qos || 0 }, (err) => {
      if (err) {
        log(`Subscribe error: ${err.message}`);
        return;
      }
      log(`Subscribed to ${foodRescue.channelName}`);
    });
  });

  client.on("reconnect", () => {
    reconnectCount += 1;
    log(`MQTT reconnect attempt #${reconnectCount}`);
  });

  client.on("error", (err) => {
    log(`MQTT error: ${err.message}`);
  });

  client.on("message", (_topic, buffer) => {
    let payload;
    try {
      payload = JSON.parse(buffer.toString("utf8"));
    } catch (err) {
      log(`Invalid MQTT JSON: ${err.message}`);
      return;
    }

    const msgId = payload?.id ? String(payload.id) : null;
    const eventType = payload?.data?.event_type;
    const orderKey = extractOrderKey(payload);
    const timestamp = Number(payload?.timestamp || 0);
    if (timestamp) {
      const eventTimeMs = timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp;
      const age = Date.now() - eventTimeMs;
      if (age > MESSAGE_STALE_MS) {
        log(`Ignored stale message id=${msgId || "unknown"} age_s=${Math.floor(age / 1000)}`);
        return;
      }
    }

    if (msgId) {
      if (dedupMap[msgId]) {
        return;
      }
      dedupMap[msgId] = Date.now();
      cleanupDedupMap(dedupMap);
      saveDedupMap(dedupMap);
    }

    if (eventType === "order_cancelled") {
      cancelledCount += 1;
      log(`Event order_cancelled received (msg_id=${msgId || "unknown"} order_key=${orderKey || "unknown"})`);
    } else if (eventType === "order_claimed") {
      claimedCount += 1;
      log(`Event order_claimed received (msg_id=${msgId || "unknown"} order_key=${orderKey || "unknown"})`);
      if (orderKey) {
        recentClaimByOrder.set(orderKey, Date.now());
        const pending = pendingCancelledAlerts.get(orderKey);
        if (pending) {
          clearTimeout(pending.timeout);
          pendingCancelledAlerts.delete(orderKey);
          log(`Suppressed pending cancel alert because it was quickly claimed (order_key=${orderKey})`);
        }
      }
      return;
    } else {
      return;
    }

    if (ALERT_MODE === "legacy") {
      printAlert(payload);
      void sendNtfyAlert(payload, selectedLocationName);
      return;
    }

    const now = Date.now();
    if (orderKey) {
      const lastClaimAt = recentClaimByOrder.get(orderKey) || 0;
      if (lastClaimAt && now - lastClaimAt <= CLAIM_SUPPRESSION_WINDOW_MS) {
        log(`Ignored cancel event due to immediate claim race (order_key=${orderKey})`);
        return;
      }
    }

    const pendingKey = orderKey || msgId || `no_key_${Date.now()}`;
    if (pendingCancelledAlerts.has(pendingKey)) {
      return;
    }

    const timeout = setTimeout(() => {
      pendingCancelledAlerts.delete(pendingKey);
      if (orderKey) {
        const lastClaimAt = recentClaimByOrder.get(orderKey) || 0;
        if (lastClaimAt && Date.now() - lastClaimAt <= CLAIM_SUPPRESSION_WINDOW_MS) {
          log(`Dropped cancel alert after delay because claim arrived (order_key=${orderKey})`);
          return;
        }
      }
      printAlert(payload);
      void sendNtfyAlert(payload, selectedLocationName);
    }, CLAIM_SUPPRESSION_WINDOW_MS);

    pendingCancelledAlerts.set(pendingKey, {
      createdAt: now,
      timeout,
    });
  });

  setInterval(() => {
    cleanupDedupMap(dedupMap);
    saveDedupMap(dedupMap);
    const cutoff = Date.now() - RECENT_CLAIM_TTL_MS;
    for (const [key, ts] of recentClaimByOrder.entries()) {
      if (ts < cutoff) {
        recentClaimByOrder.delete(key);
      }
    }
    log(
      `Heartbeat | connected=${client.connected} | cancelled=${cancelledCount} | claimed=${claimedCount} | reconnects=${reconnectCount}`,
    );
  }, 30000);

  const shutdown = () => {
    log("Shutting down monitor...");
    try {
      client.end(true);
    } catch {
      // no-op
    }
    saveDedupMap(dedupMap);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function main() {
  if (!PHONE_NUMBER || PHONE_NUMBER === "REPLACE_WITH_YOUR_NUMBER") {
    throw new Error("Set PHONE_NUMBER in index.js before running.");
  }

  const settings = loadSettings();
  if (
    isFoodRescueConfigValid(settings.foodRescue) &&
    settings.selectedAddressName
  ) {
    log(
      `Using cached monitor config for address="${settings.selectedAddressName}" channel="${settings.foodRescue.channelName}"`,
    );
    if (!NTFY_TOPIC || NTFY_TOPIC === "REPLACE_WITH_NTFY_TOPIC") {
      log("ntfy disabled (set NTFY_TOPIC in index.js to enable iPhone push)");
    } else {
      log(`ntfy enabled for topic="${NTFY_TOPIC}"`);
    }
    startMonitor(settings.foodRescue, settings.selectedAddressName);
    return;
  }

  const jar = new CookieJar();
  const http = createHttpClient(jar);

  log(`Sending OTP to ${PHONE_NUMBER} via ${OTP_PREFERENCE}...`);
  const pre = await preOtpFlow(http, jar, PHONE_NUMBER);

  const otp = await ask("Enter OTP: ");
  if (!otp) {
    throw new Error("OTP is required.");
  }

  const auth = await postOtpFlow(http, PHONE_NUMBER, otp, pre.loginChallenge, pre.codeVerifier);
  if (!auth.accessToken) {
    throw new Error("No access token received.");
  }
  log("Authenticated.");

  const me = await getUserInfo(http, auth.accessToken);
  log(`Logged in as: ${me?.name || "unknown"} (id=${me?.id || "n/a"})`);

  const locations = await getUserLocations(http, auth.accessToken);
  const selectedLocation = await pickLocation(locations, settings);
  const essentials = await getTabbedHomeEssentials(
    http,
    auth.accessToken,
    selectedLocation.cellId,
    selectedLocation.addressId,
  );

  if (!essentials.foodRescue?.channelName || !essentials.foodRescue?.client?.username) {
    throw new Error("Food rescue subscription channel/credentials missing");
  }

  saveSettings({
    ...settings,
    selectedAddressId: selectedLocation.addressId,
    selectedAddressName: selectedLocation.name,
    foodRescue: essentials.foodRescue,
    lastLoginAt: Date.now(),
  });

  log(
    `Starting monitor for address="${selectedLocation.name}" channel="${essentials.foodRescue.channelName}"`,
  );
  if (!NTFY_TOPIC || NTFY_TOPIC === "REPLACE_WITH_NTFY_TOPIC") {
    log("ntfy disabled (set NTFY_TOPIC in index.js to enable iPhone push)");
  } else {
    log(`ntfy enabled for topic="${NTFY_TOPIC}"`);
  }

  startMonitor(essentials.foodRescue, selectedLocation.name);
}

main().catch((err) => {
  console.error(`[${nowIso()}] Fatal: ${err.message}`);
  process.exit(1);
});
