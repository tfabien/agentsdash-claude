/*
  Transparent serial bridge: USB (PC) <-> UART2 (HMI screen).
  Sends commands to the screen from the PC (Python scripts, USART HMI editor).
  D16 (RX2) <- TX écran,  D17 (TX2) -> RX écran.

  USB side: fixed 115200 baud. Screen side: SCREEN_BAUD at boot (115200), changeable on the fly with
  the special sequence (never present in screen commands):
      7E 7E 42 b0 b1 b2 b3     (b0..b3 = baud rate, little-endian)

  Why 115200 at boot: the USART HMI editor opens COM3 (which resets the ESP32) and waits only
  1000000/baud + 30 ms (39 ms at 115200) for "comok". A screen at 9600 answers too slowly, so before
  flashing from the editor, put the screen at 115200: bridge to 9600 (7E 7E 42 80 25 00 00), send
  baud=115200, bridge back to 115200 (7E 7E 42 00 C2 01 00). The screen keeps it until power-off. Scripts that talk to a screen at 9600
  must first send 7E 7E 42 80 25 00 00.
*/
#define SCREEN_BAUD 115200
uint8_t st = 0, n = 0;
uint32_t baud = 0;

void setup() {
  Serial.begin(115200);
  Serial2.begin(SCREEN_BAUD, SERIAL_8N1, 16, 17);
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
