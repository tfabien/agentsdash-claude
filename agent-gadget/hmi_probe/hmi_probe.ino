/*
  Sonde UART pour l'écran HMI (sans Wi-Fi, sans rien d'autre).

  Câblage : D16 (RX2) <- TX écran,  D17 (TX2) -> RX écran,  GND commun, 5 V sur VCC écran.
  Moniteur série USB : 115200 bauds.

  Au démarrage : essaie plusieurs vitesses avec des commandes de type Nextion,
  puis reste à l'écoute et affiche tout octet reçu (touchez l'écran pour voir les événements).
  Touches du moniteur :  p = relancer la sonde   1..6 = forcer la vitesse écoute (voir liste)
*/

#define RX_PIN 16
#define TX_PIN 17

const uint32_t BAUDS[] = {9600, 115200, 57600, 38400, 19200, 230400};
const int NB = sizeof(BAUDS) / sizeof(BAUDS[0]);
uint32_t listenBaud = 9600;

void ff3() { Serial2.write(0xFF); Serial2.write(0xFF); Serial2.write(0xFF); }

void dump(const char* tag) {            // affiche les octets en attente (hex + ASCII)
  uint8_t buf[64]; int n = 0;
  uint32_t last = millis();
  while (millis() - last < 30 && n < 64) {
    if (Serial2.available()) { buf[n++] = Serial2.read(); last = millis(); }
  }
  if (!n) return;
  Serial.printf("%s %d octets : ", tag, n);
  for (int i = 0; i < n; i++) Serial.printf("%02X ", buf[i]);
  Serial.print(" | ");
  for (int i = 0; i < n; i++) Serial.print((buf[i] >= 32 && buf[i] < 127) ? (char)buf[i] : '.');
  Serial.println();
}

bool tryCmd(const char* label, const char* cmd, bool withFF) {
  while (Serial2.available()) Serial2.read();
  if (cmd[0]) Serial2.print(cmd);
  if (withFF) ff3();
  uint32_t t0 = millis(); bool got = false;
  while (millis() - t0 < 500) {
    if (Serial2.available()) { got = true; dump(label); t0 = millis(); }
  }
  return got;
}

void probe() {
  Serial.println("=== sonde ===");
  bool any = false;
  for (int i = 0; i < NB; i++) {
    Serial2.updateBaudRate(BAUDS[i]);
    delay(50);
    Serial.printf("-- %u bauds\n", BAUDS[i]);
    bool g = false;
    g |= tryCmd("connect ->", "connect", true);
    g |= tryCmd("sendme  ->", "sendme", true);
    g |= tryCmd("FFx3    ->", "", true);
    if (g) { any = true; listenBaud = BAUDS[i]; Serial.printf("   >>> réponse à %u bauds\n", BAUDS[i]); }
  }
  Serial2.updateBaudRate(listenBaud);
  Serial.println(any ? "=== fin : au moins une réponse (voir ci-dessus) ===" :
                       "=== fin : aucune réponse. Vérifiez RX/TX (essayez de les inverser). ===");
  Serial.printf("Écoute passive à %u bauds : touchez l'écran.\n", listenBaud);
}

void setup() {
  Serial.begin(115200);
  Serial2.begin(9600, SERIAL_8N1, RX_PIN, TX_PIN);
  delay(1500);
  probe();
}

void loop() {
  dump("[hmi]");
  while (Serial.available()) {
    char c = Serial.read();
    if (c == 'p') probe();
    if (c >= '1' && c <= '6') { listenBaud = BAUDS[c - '1']; Serial2.updateBaudRate(listenBaud); Serial.printf("écoute à %u bauds\n", listenBaud); }
  }
}
