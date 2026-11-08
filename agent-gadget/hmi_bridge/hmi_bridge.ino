/*
  Pont série transparent : USB (PC) <-> UART2 (écran HMI).
  Sert à envoyer des commandes à l'écran depuis le PC (scripts Python, éditeur USART HMI).
  D16 (RX2) <- TX écran,  D17 (TX2) -> RX écran.

  Côté USB : 115200 bauds fixes. Côté écran : 9600 au démarrage (vitesse du projet blank.tft,
  ce qui permet aussi de télécharger depuis l'éditeur USART HMI), modifiable à chaud par
  la séquence spéciale (jamais présente dans les commandes de l'écran) :
      7E 7E 42 b0 b1 b2 b3     (b0..b3 = vitesse en bauds, little-endian)
*/
uint8_t st = 0, n = 0;
uint32_t baud = 0;

void setup() {
  Serial.begin(115200);
  Serial2.begin(9600, SERIAL_8N1, 16, 17);
}

void loop() {
  while (Serial.available()) {
    uint8_t c = Serial.read();
    switch (st) {
      case 0:
        if (c == 0x7E) st = 1; else Serial2.write(c);
        break;
      case 1:
        if (c == 0x7E) st = 2; else { Serial2.write(0x7E); Serial2.write(c); st = 0; }
        break;
      case 2:
        if (c == 0x42) { n = 0; baud = 0; st = 3; }
        else { Serial2.write(0x7E); Serial2.write(0x7E); Serial2.write(c); st = 0; }
        break;
      case 3:
        baud |= ((uint32_t)c) << (8 * n);
        if (++n == 4) { Serial2.updateBaudRate(baud); st = 0; }
        break;
    }
  }
  while (Serial2.available()) Serial.write(Serial2.read());
}
