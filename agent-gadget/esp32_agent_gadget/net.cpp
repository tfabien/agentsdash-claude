#include "net.h"
#include "model.h"
#include "display.h"
#include <WiFi.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <ESPmDNS.h>
#include <Preferences.h>
#include <ArduinoOTA.h>
#include <Update.h>

#define BOOT_PIN 0
#define WIFI_TIMEOUT_MS 20000UL

static WebServer server(80);
static DNSServer dns;
static Preferences prefs;
static bool apMode = false;

// ---------- JSON helper (flat objects only) ----------
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
    if (body[q2] == '\\' && q2 + 1 < (int)body.length()) q2++;
    out[n++] = body[q2++];
  }
  out[n] = 0;
  return true;
}

// ---------- HTTP: API ----------
static void cors() { server.sendHeader("Access-Control-Allow-Origin", "*"); }

static void handleEvent() {            // POST /event {"agent":"x","state":"working","task":"..."}
  cors();
  String body = server.arg("plain");
  char name[NAME_LEN], st[12], task[TASK_LEN] = "";
  if (!jsonGet(body, "agent", name, sizeof name) || !jsonGet(body, "state", st, sizeof st)) {
    server.send(400, "text/plain", "agent and state are required");
    return;
  }
  AgentState s;
  if (!modelParseState(st, s)) { server.send(400, "text/plain", "invalid state"); return; }
  jsonGet(body, "task", task, sizeof task);
  modelUpdate(name, s, task);
  server.send(200, "text/plain", "ok");
}

static void handleState() {            // GET /state
  cors();
  server.send(200, "application/json", modelToJson());
}

static void handleReset() {            // POST /reset: remove every agent from the list and the screen
  cors();
  modelClear();
  server.send(200, "text/plain", "ok");
}

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
  prefs.begin("gadget", false);
  pinMode(BOOT_PIN, INPUT_PULLUP);

  if (digitalRead(BOOT_PIN) == LOW) {                   // BOOT held at power-up: forget the Wi-Fi
    displayMessage("Hold BOOT for 3 s...", "to forget the saved Wi-Fi", "", "", Tone::Warn);
    uint32_t t0 = millis();
    while (digitalRead(BOOT_PIN) == LOW && millis() - t0 < 3000) delay(50);
    if (digitalRead(BOOT_PIN) == LOW) {
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

  server.on("/event", HTTP_POST, handleEvent);
  server.on("/event", HTTP_OPTIONS, handleOptions);
  server.on("/state", HTTP_GET, handleState);
  server.on("/reset", HTTP_POST, handleReset);
  server.on("/config", HTTP_GET, handleConfigPage);
  server.on("/save", HTTP_POST, handleSave);
  server.on("/update", HTTP_GET, handleUpdateForm);
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
