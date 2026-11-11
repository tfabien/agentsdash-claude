#include "net.h"
#include <limits.h>
#include "model.h"
#include "display.h"
#include "ui_state.h"
#include "layout.h"
#include "touch.h"
#include <WiFi.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <ESPmDNS.h>
#include <Preferences.h>
#include <ArduinoOTA.h>
#include <Update.h>

#define FORGET_WIFI_PIN 0
#define WIFI_TIMEOUT_MS 20000UL
#define SELECT_HOLD_MS 30000UL

static WebServer server(80);
static DNSServer dns;
static Preferences prefs;
static bool apMode = false;
static bool isolateMode = false;     // GADGET_DEBUG tests: ignore /event and /reset that lack the X-Gadget-Test header

// ---------- JSON helpers (flat objects only) ----------
static bool jsonGet(const String& body, const char* key, char* out, size_t outSize) {
  String pat = String("\"") + key + "\"";
  int k = body.indexOf(pat);
  if (k < 0) return false;
  int colon = body.indexOf(':', k + pat.length());
  if (colon < 0) return false;
  int q1 = body.indexOf('"', colon + 1);
  if (q1 < 0) return false;
  int q2 = q1 + 1;
  size_t n = 0;
  while (q2 < (int)body.length() && body[q2] != '"' && n < outSize - 1) {
    char c = body[q2++];
    if (c == '\\' && q2 < (int)body.length()) {          // JSON escapes: \" \\ \/ copied, \n \r \t -> space, \uXXXX -> '?'
      char e = body[q2++];
      if (e == 'n' || e == 'r' || e == 't') c = ' ';
      else if (e == 'u') { q2 = min(q2 + 4, (int)body.length()); c = '?'; }
      else c = e;
    }
    out[n++] = c;
  }
  out[n] = 0;
  return true;
}

static int jsonValueStart(const String& body, const char* key) {      // index of the first character after `"key":` and spaces
  String pat = String("\"") + key + "\"";
  int k = body.indexOf(pat);
  if (k < 0) return -1;
  int colon = body.indexOf(':', k + pat.length());
  if (colon < 0) return -1;
  int i = colon + 1;
  while (i < (int)body.length() && body[i] == ' ') i++;
  return i < (int)body.length() ? i : -1;
}

static bool jsonLong(const String& body, const char* key, long& out) {
  int i = jsonValueStart(body, key);
  if (i < 0) return false;
  bool neg = body[i] == '-';
  if (neg) i++;
  if (i >= (int)body.length() || !isDigit(body[i])) return false;
  long v = 0;
  while (i < (int)body.length() && isDigit(body[i])) v = v * 10 + (body[i++] - '0');
  out = neg ? -v : v;
  return true;
}

static bool jsonBool(const String& body, const char* key, bool& out) {
  int i = jsonValueStart(body, key);
  if (i < 0) return false;
  if (body.startsWith("true", i))  { out = true;  return true; }
  if (body.startsWith("false", i)) { out = false; return true; }
  return false;
}

// ---------- HTTP: API ----------
static void cors() { server.sendHeader("Access-Control-Allow-Origin", "*"); }

static bool ignoredByIsolation() { return isolateMode && !server.hasHeader("X-Gadget-Test"); }

static void handleEvent() {            // POST /event: v2 body, or the old {agent,state,task}
  cors();
  if (ignoredByIsolation()) { server.send(200, "text/plain", "ignored"); return; }
  String body = server.arg("plain");
  long version = 0;
  if (jsonLong(body, "v", version) && version == 2) {
    EventV2 e;
    memset(&e, 0, sizeof e);
    e.tok = e.stok = e.ctxPct = e.ctxK = e.planDone = e.planTotal = -1;
    char st[16];
    if (!jsonGet(body, "session", e.session, ID_LEN) || !jsonGet(body, "agent", e.agent, ID_LEN) ||
        !jsonGet(body, "state", st, sizeof st) || !modelParseState(st, e.state)) {
      server.send(400, "text/plain", "session, agent and a valid state are required");
      return;
    }
    jsonGet(body, "project", e.project, PROJECT_LEN);
    jsonGet(body, "role", e.role, ROLE_LEN);
    jsonGet(body, "evt", e.evt, sizeof e.evt);
    jsonGet(body, "cmd", e.cmd, CMD_LEN);
    jsonGet(body, "detail", e.detail, DETAIL_LEN);
    jsonGet(body, "title", e.title, TITLE_LEN);
    jsonLong(body, "tok", e.tok);
    jsonLong(body, "stok", e.stok);
    jsonLong(body, "ctx_pct", e.ctxPct);
    jsonLong(body, "ctx_k", e.ctxK);
    jsonLong(body, "plan_done", e.planDone);
    jsonLong(body, "plan_total", e.planTotal);
    e.hasPlanCur = jsonGet(body, "plan_cur", e.planCur, PLAN_LEN);
    e.hasPlanNext = jsonGet(body, "plan_next", e.planNext, PLAN_LEN);
    modelApplyV2(e, millis());
    server.send(200, "text/plain", "ok");
    return;
  }
  char agent[24], st[12], task[CMD_LEN] = "";
  if (!jsonGet(body, "agent", agent, sizeof agent) || !jsonGet(body, "state", st, sizeof st)) {
    server.send(400, "text/plain", "agent and state are required");
    return;
  }
  jsonGet(body, "task", task, sizeof task);
  if (!modelApplyV1(agent, st, task, millis())) { server.send(400, "text/plain", "invalid state"); return; }
  server.send(200, "text/plain", "ok");
}

static long optLong(const String& body, const char* key) {
  long v;
  return jsonLong(body, key, v) ? v : LONG_MIN;
}

static void handleUsage() {            // POST /usage: context and plan quotas from the status line script
  cors();
  if (ignoredByIsolation()) { server.send(200, "text/plain", "ignored"); return; }
  String body = server.arg("plain");
  long version = 0;
  if (!jsonLong(body, "v", version)) { server.send(400, "text/plain", "v is required"); return; }
  UsageV1 u;
  memset(&u, 0, sizeof u);
  jsonGet(body, "session", u.session, ID_LEN);
  u.ctxPct = optLong(body, "ctx_pct");    u.ctxK = optLong(body, "ctx_k");          u.ctxMaxK = optLong(body, "ctx_max_k");
  u.h5Pct = optLong(body, "h5_pct");      u.h5ResetS = optLong(body, "h5_reset_s"); u.h5Rate10 = optLong(body, "h5_rate10");
  u.h5Proj = optLong(body, "h5_proj");    u.h5EmptyS = optLong(body, "h5_empty_s");
  u.d7Pct = optLong(body, "d7_pct");      u.d7ResetS = optLong(body, "d7_reset_s"); u.d7Rate10 = optLong(body, "d7_rate10");
  u.d7Proj = optLong(body, "d7_proj");    u.d7EmptyS = optLong(body, "d7_empty_s");
  modelApplyUsage(u, millis());
  server.send(200, "text/plain", "ok");
}

static void handleState() {            // GET /state
  cors();
  server.send(200, "application/json", modelToJson(millis()));
}

static void handleReset() {            // POST /reset: remove every agent from the list and the screen
  cors();
  if (ignoredByIsolation()) { server.send(200, "text/plain", "ignored"); return; }
  modelClear();
  server.send(200, "text/plain", "ok");
}

static void handleSelect() {           // POST /select {"session","agent","hold_ms"?}: what a tap does
  cors();
  String body = server.arg("plain");
  char session[ID_LEN] = "", agent[ID_LEN] = "";
  long hold = SELECT_HOLD_MS;
  if (!jsonGet(body, "session", session, sizeof session) || !jsonGet(body, "agent", agent, sizeof agent)) {
    server.send(400, "text/plain", "session and agent are required");
    return;
  }
  jsonLong(body, "hold_ms", hold);
  if (!modelSelect(session, agent, millis(), (uint32_t)hold)) { server.send(404, "text/plain", "unknown session or agent"); return; }
  server.send(200, "text/plain", "ok");
}

#ifdef GADGET_DEBUG
static void handleDebugConfig() {      // POST /debug/config {"isolate","done_ttl_ms","stale_ttl_ms","standby_ms","detail_ms"}
  cors();
  String body = server.arg("plain");
  bool flag;
  long done = -1, stale = -1;
  if (jsonBool(body, "isolate", flag)) isolateMode = flag;
  bool haveDone = jsonLong(body, "done_ttl_ms", done), haveStale = jsonLong(body, "stale_ttl_ms", stale);
  if (haveDone || haveStale) modelConfigure(haveDone ? (uint32_t)done : DONE_TTL_MS, haveStale ? (uint32_t)stale : STALE_TTL_MS);
  static long standby = STANDBY_MS, detail = DETAIL_MS;                 // screen timings, kept across calls
  bool haveStandby = jsonLong(body, "standby_ms", standby), haveDetail = jsonLong(body, "detail_ms", detail);
  if (haveStandby || haveDetail) uiStateConfigure((uint32_t)standby, (uint32_t)detail);
  server.send(200, "application/json", String("{\"isolate\":") + (isolateMode ? "true" : "false") + "}");
}

static String rectJson(const Rect& r) {
  return String("{\"x\":") + r.x + ",\"y\":" + r.y + ",\"w\":" + r.w + ",\"h\":" + r.h + "}";
}

static int intArg(const char* name, int def) { return server.hasArg(name) ? server.arg(name).toInt() : def; }

static void handleDebugLayout() {      // GET /debug/layout?subs=N&others=K: rectangles of the redesigned screen
  int subs = intArg("subs", 0), others = intArg("others", 2);
  Rect rows[7], labels[2];
  bool arrows;
  int nRows = layoutRows(subs, rows), nLabels = layoutLabels(others, labels, arrows);
  String j = "{\"top_bar\":" + rectJson(layoutTopBar()) + ",\"selected_tab\":" + rectJson(layoutSelectedTab()) +
             ",\"frame\":" + rectJson(layoutFrame()) + ",\"lead_panel\":" + rectJson(layoutLeadPanel()) +
             ",\"team_panel\":" + rectJson(layoutTeamPanel()) + ",\"team_header\":" + rectJson(layoutTeamHeader()) +
             ",\"bottom_bar\":" + rectJson(layoutBottomBar()) + ",\"clock\":" + rectJson(layoutClock()) +
             ",\"badge\":" + rectJson(layoutBadge()) + ",\"arrows\":" + (arrows ? "true" : "false") +
             ",\"arrow_left\":" + rectJson(layoutArrow(false)) + ",\"arrow_right\":" + rectJson(layoutArrow(true)) + ",\"labels\":[";
  for (int i = 0; i < nLabels; i++) j += (i ? "," : "") + rectJson(labels[i]);
  j += "],\"rows\":[";
  for (int i = 0; i < nRows; i++) j += (i ? "," : "") + rectJson(rows[i]);
  j += "]}";
  server.send(200, "application/json", j);
}

static void handleDebugTap() {         // POST /debug/tap {"x","y","hold_ms"?}: same path as a touch press
  cors();
  String body = server.arg("plain");
  long x = -1, y = -1, hold = UI_HOLD_MS;
  if (!jsonLong(body, "x", x) || !jsonLong(body, "y", y)) { server.send(400, "text/plain", "x and y required"); return; }
  jsonLong(body, "hold_ms", hold);
  uiTap((int)x, (int)y, (uint32_t)hold);
  server.send(200, "application/json", "{\"ok\":true}");
}

extern uint32_t loopMaxUs;
extern const char* loopMaxWhere;

static void handleDebugStats() {       // GET /debug/stats: draw queue and redraw budget (screen layer), uptime, last reset
  String j = displayStats();
  j.remove(j.length() - 1);
  j += ",\"loop_max_ms\":" + String(loopMaxUs / 1000) + ",\"loop_max_in\":\"" + loopMaxWhere + "\"";
  loopMaxUs = 0;
  j += ",\"uptime_ms\":" + String(millis()) + ",\"reset_reason\":" + String((int)esp_reset_reason()) +
       ",\"rssi\":" + String(WiFi.RSSI()) + ",\"channel\":" + String(WiFi.channel()) + ",\"free_heap\":" + String(ESP.getFreeHeap()) + ",\"min_stack\":" + String(uxTaskGetStackHighWaterMark(NULL)) + "}";
  server.send(200, "application/json", j);
}

static void handleDebugTft() {         // GET /debug/tft: state of the last screen firmware download
  server.send(200, "application/json", displayTftStatus());
}

static void handleDebugHmi() {         // POST /debug/hmi {"cmd": "..."} or {"release": true}: raw screen commands
  cors();
  String body = server.arg("plain");
  bool release = false;
  if (jsonBool(body, "release", release) && release) { displayInvalidate(); server.send(200, "application/json", "{\"ok\":true}"); return; }
  static char cmd[256];
  if (!jsonGet(body, "cmd", cmd, sizeof cmd)) { server.send(400, "text/plain", "cmd required"); return; }
  displayRaw(cmd);
  server.send(200, "application/json", "{\"ok\":true}");
}

static void handleDebugHit() {         // GET /debug/hit?x&y&others&subs
  Hit h = hitTest(intArg("x", -1), intArg("y", -1), intArg("others", 0), intArg("subs", 0));
  static const char* const kinds[] = {"none", "selected_tab", "label", "arrow_left", "arrow_right", "lead_panel", "row", "more"};
  const char* kind = kinds[h.kind];
  server.send(200, "application/json", String("{\"kind\":\"") + kind + "\",\"index\":" + h.index + "}");
}
#endif

static void handleOptions() {
  cors();
  server.sendHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
  server.send(204);
}

// ---------- HTTP: Wi-Fi configuration page ----------
static String htmlEscape(const String& s) {
  String r;
  for (size_t i = 0; i < s.length(); i++) {
    char c = s[i];
    if (c == '&') r += "&amp;"; else if (c == '<') r += "&lt;"; else if (c == '>') r += "&gt;";
    else if (c == '"') r += "&quot;"; else r += c;
  }
  return r;
}

static void handleConfigPage() {
  String opts;
  int n = WiFi.scanNetworks();
  for (int i = 0; i < n; i++) opts += "<option value=\"" + htmlEscape(WiFi.SSID(i)) + "\">";
  String state = apMode ? String("Setup mode: no saved Wi-Fi, or it could not be reached.")
                        : String("Connected to <b>") + htmlEscape(WiFi.SSID()) + "</b> (" + WiFi.localIP().toString() + ")";
  String h = F("<!doctype html><html lang=en><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
               "<title>Agent Gadget</title><style>body{font-family:system-ui,sans-serif;max-width:420px;margin:24px auto;padding:0 16px}"
               "input,button{width:100%;padding:10px;margin:6px 0 16px;font-size:16px;box-sizing:border-box}"
               "button{background:#2563eb;color:#fff;border:0;border-radius:6px}.s{color:#555;font-size:14px}</style>"
               "<h2>Agent Gadget</h2><p class=s>");
  h += state;
  h += F("</p><form method=POST action=/save><label>Wi-Fi network</label>"
         "<input name=ssid list=nets autocomplete=off required placeholder='Network name'><datalist id=nets>");
  h += opts;
  h += F("</datalist><label>Password</label><input name=pass type=password placeholder='Leave empty for an open network'>"
         "<button>Save and restart</button></form>"
         "<p class=s>Firmware update: <a href=/update>/update</a> (user admin). "
         "To forget this Wi-Fi: hold the BOOT button for 3 s at power-up.</p>");
  server.send(200, "text/html", h);
}

static void handleSave() {
  String ssid = server.arg("ssid");
  String pass = server.arg("pass");
  if (ssid.length() == 0) { server.send(400, "text/plain", "SSID required"); return; }
  prefs.putString("ssid", ssid);
  prefs.putString("pass", pass);
  server.send(200, "text/html", F("<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
                                  "<body style='font-family:system-ui;max-width:420px;margin:24px auto;padding:0 16px'>"
                                  "<h2>Saved</h2><p>Restarting&hellip; Reconnect to your usual Wi-Fi. "
                                  "The gadget's address is shown on its screen.</p>"));
  delay(1500);
  ESP.restart();
}

// ---------- HTTP: firmware update from a browser (http://<ip>/update) ----------
// ---------- HTTP: screen firmware (.tft) ----------
static int tftHttpStatus = 0;              // 0 = fine so far, else the HTTP status to answer
static String tftHttpMsg;

static long tftSizeArg() {                 // ?size=<bytes>, digits only, > 0; -1 when missing or invalid
  String s = server.arg("size");
  if (s.length() == 0 || s.length() > 9) return -1;
  for (size_t i = 0; i < s.length(); i++) if (!isDigit(s[i])) return -1;
  long v = s.toInt();
  return v > 0 ? v : -1;
}

static void handleTftForm() {
  if (!server.authenticate("admin", OTA_PASSWORD)) return server.requestAuthentication();
  server.send(200, "text/html", F("<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
    "<body style='font-family:system-ui;max-width:420px;margin:24px auto;padding:0 16px'>"
    "<h2>Screen update (.tft)</h2><p>Export the .tft from the USART HMI editor, then upload it here (about 1 minute).</p>"
    "<input type=file id=f accept=.tft><br><br><button id=b>Upload</button><p id=s></p>"
    "<script>b.onclick=async()=>{const x=f.files[0];if(!x)return;b.disabled=1;s.textContent='Uploading, do not unplug...';"
    "const d=new FormData();d.append('tft',x);"
    "const r=await fetch('/tft?size='+x.size,{method:'POST',body:d});s.textContent=r.status+': '+await r.text();b.disabled=0}</script>"));
}

static void handleTftDone() {
  if (!server.authenticate("admin", OTA_PASSWORD)) return server.requestAuthentication();
  if (tftSizeArg() < 0) { server.send(400, "text/plain", "size missing or invalid (?size=<bytes>)"); return; }
  if (tftHttpStatus) { server.send(tftHttpStatus, "text/plain", tftHttpMsg); return; }
  server.send(200, "text/plain", "OK, screen updated");
}

static void handleTftUpload() {
  if (!server.authenticate("admin", OTA_PASSWORD)) return;
  HTTPUpload& up = server.upload();
  if (up.status == UPLOAD_FILE_START) {
    tftHttpStatus = 0;
    tftHttpMsg = "";
    long size = tftSizeArg();
    if (size < 0) { tftHttpStatus = 400; tftHttpMsg = "size missing or invalid"; return; }
    if (!displayTftBegin((uint32_t)size, tftHttpMsg)) tftHttpStatus = 500;
  } else if (up.status == UPLOAD_FILE_WRITE) {
    if (!tftHttpStatus && !displayTftWrite(up.buf, up.currentSize, tftHttpMsg)) tftHttpStatus = 500;
  } else if (up.status == UPLOAD_FILE_END) {
    if (!tftHttpStatus) { if (!displayTftEnd(tftHttpMsg)) tftHttpStatus = 500; }
    else if (tftHttpStatus == 500) displayTftEnd(tftHttpMsg);      // failed midway: still try to get the screen back
  } else if (up.status == UPLOAD_FILE_ABORTED) {
    displayTftAbort();
    tftHttpStatus = 500;
    tftHttpMsg = "upload aborted";
  }
}

static void handleUpdateForm() {
  if (!server.authenticate("admin", OTA_PASSWORD)) return server.requestAuthentication();
  server.send(200, "text/html", F("<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
                                  "<body style='font-family:system-ui;max-width:420px;margin:24px auto;padding:0 16px'>"
                                  "<h2>Firmware update</h2><form method=POST action=/update enctype=multipart/form-data>"
                                  "<input type=file name=firmware accept=.bin required><br><br><button>Upload</button></form>"
                                  "<p>File: <code>.pio/build/esp32dev/firmware.bin</code></p>"));
}

static void handleUpdateDone() {
  if (!server.authenticate("admin", OTA_PASSWORD)) return server.requestAuthentication();
  bool ok = !Update.hasError();
  server.send(200, "text/plain", ok ? "OK, restarting" : "Update FAILED");
  delay(500);
  if (ok) ESP.restart();
}

static void handleUpdateUpload() {
  if (!server.authenticate("admin", OTA_PASSWORD)) return;
  HTTPUpload& up = server.upload();
  if (up.status == UPLOAD_FILE_START) {
    Serial.printf("Web update: %s\n", up.filename.c_str());
    displayMessage("Updating...", "Do not unplug", "", "", Tone::Warn);
    Update.begin(UPDATE_SIZE_UNKNOWN);
  } else if (up.status == UPLOAD_FILE_WRITE) {
    Update.write(up.buf, up.currentSize);
  } else if (up.status == UPLOAD_FILE_END) {
    Update.end(true);
  }
}

static void handleNotFound() {
  if (apMode) {                        // captive portal: everything is redirected to /config
    server.sendHeader("Location", "http://192.168.4.1/config");
    server.send(302, "text/plain", "");
  } else {
    server.send(404, "text/plain", "not found");
  }
}

// ---------- Wi-Fi ----------
static void startPortal() {
  uint64_t mac = ESP.getEfuseMac();
  char buf[24];
  snprintf(buf, sizeof buf, "AgentGadget-%02X%02X", (uint8_t)(mac >> 32), (uint8_t)(mac >> 40));
  deviceInfo.apName = buf;
  deviceInfo.apMode = true;
  WiFi.mode(WIFI_AP_STA);
  WiFi.softAP(buf);
  dns.start(53, "*", WiFi.softAPIP());
  apMode = true;
  Serial.printf("Setup portal: network %s, http://%s/config\n", buf, WiFi.softAPIP().toString().c_str());
}

static bool connectSaved() {
  String ssid = prefs.getString("ssid", "");
  if (ssid.length() == 0) return false;
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);              // modem sleep drops packets: HTTP requests stalled up to 5.6 s (TCP retries)
  WiFi.setHostname("agent-gadget");
  WiFi.begin(ssid.c_str(), prefs.getString("pass", "").c_str());
  Serial.printf("Connecting to %s", ssid.c_str());
  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < WIFI_TIMEOUT_MS) { delay(400); Serial.print("."); }
  Serial.println();
  return WiFi.status() == WL_CONNECTED;
}

void netClearWifiConfig() {
  prefs.clear();
  Serial.println(F("Saved Wi-Fi cleared"));
}

// ---------- Public ----------
void netBegin() {
  modelViewJsonExtra = uiStateJson;
  prefs.begin("gadget", false);
  pinMode(FORGET_WIFI_PIN, INPUT_PULLUP);

  if (digitalRead(FORGET_WIFI_PIN) == LOW) {                   // BOOT held at power-up: forget the Wi-Fi
    displayMessage("Hold BOOT for 3 s...", "to forget the saved Wi-Fi", "", "", Tone::Warn);
    uint32_t t0 = millis();
    while (digitalRead(FORGET_WIFI_PIN) == LOW && millis() - t0 < 3000) delay(50);
    if (digitalRead(FORGET_WIFI_PIN) == LOW) {
      netClearWifiConfig();
      displayMessage("Wi-Fi forgotten", "", "", "", Tone::Ok);
      delay(1500);
    }
  }

  displayMessage("Connecting to Wi-Fi...");
  if (connectSaved()) {
    deviceInfo.ip = WiFi.localIP().toString();
    Serial.printf("IP: %s\n", deviceInfo.ip.c_str());
    if (MDNS.begin("agent-gadget")) MDNS.addService("http", "tcp", 80);
  } else {
    startPortal();
  }

  static const char* headerKeys[] = {"X-Gadget-Test"};
  server.collectHeaders(headerKeys, 1);
  server.on("/event", HTTP_POST, handleEvent);
  server.on("/event", HTTP_OPTIONS, handleOptions);
  server.on("/usage", HTTP_POST, handleUsage);
  server.on("/usage", HTTP_OPTIONS, handleOptions);
  server.on("/state", HTTP_GET, handleState);
  server.on("/select", HTTP_POST, handleSelect);
  server.on("/reset", HTTP_POST, handleReset);
#ifdef GADGET_DEBUG
  server.on("/debug/config", HTTP_POST, handleDebugConfig);
server.on("/debug/layout", HTTP_GET, handleDebugLayout);
server.on("/debug/hit", HTTP_GET, handleDebugHit);
server.on("/debug/hmi", HTTP_POST, handleDebugHmi);
server.on("/debug/tap", HTTP_POST, handleDebugTap);
server.on("/debug/stats", HTTP_GET, handleDebugStats);
server.on("/debug/tft", HTTP_GET, handleDebugTft);
#endif
  server.on("/config", HTTP_GET, handleConfigPage);
  server.on("/save", HTTP_POST, handleSave);
  server.on("/update", HTTP_GET, handleUpdateForm);
  server.on("/tft", HTTP_GET, handleTftForm);
  server.on("/tft", HTTP_POST, handleTftDone, handleTftUpload);
  server.on("/update", HTTP_POST, handleUpdateDone, handleUpdateUpload);
  server.on("/", HTTP_GET, []() {
    if (apMode) { server.sendHeader("Location", "http://192.168.4.1/config"); server.send(302, "text/plain", ""); }
    else { cors(); server.send(200, "text/plain", "agent-gadget ok"); }
  });
  server.onNotFound(handleNotFound);
  server.begin();

  ArduinoOTA.setHostname("agent-gadget");               // PlatformIO: upload_protocol = espota
  ArduinoOTA.setPassword(OTA_PASSWORD);
  ArduinoOTA.onStart([]() { displayMessage("Updating...", "Do not unplug", "", "", Tone::Warn); });
  ArduinoOTA.onProgress([](unsigned int p, unsigned int t) {
    static int last = -1;
    int pct = p * 100 / t;
    if (pct / 10 != last) { last = pct / 10; displayProgress(pct); }
  });
  ArduinoOTA.onEnd([]() { displayMessage("Update done", "Restarting...", "", "", Tone::Ok); });
  ArduinoOTA.onError([](ota_error_t) { displayMessage("Update failed", "", "", "", Tone::Error); });
  ArduinoOTA.begin();
}

void netLoop() {
  ArduinoOTA.handle();
  server.handleClient();
  if (apMode) dns.processNextRequest();
  static uint32_t lastWifiCheck = 0;
  if (!apMode && WiFi.status() != WL_CONNECTED && millis() - lastWifiCheck > 10000) {
    lastWifiCheck = millis();
    WiFi.reconnect();
  }
}
