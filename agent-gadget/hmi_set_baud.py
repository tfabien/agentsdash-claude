#!/usr/bin/env python3
"""
Retrouve la vitesse de l'écran HMI via le pont (hmi_bridge.ino), puis le règle de façon
permanente à 115200 avec `bauds=115200` (la commande `bauds` est mémorisée par l'écran).

Usage : python hmi_set_baud.py [COM3] [vitesse_cible]
"""
import struct
import sys
import time

import serial

PORT = sys.argv[1] if len(sys.argv) > 1 else "COM3"
TARGET = int(sys.argv[2]) if len(sys.argv) > 2 else 9600     # l'écran reste à 9600 : bauds=115200 n'est pas appliqué
END = b"\xff\xff\xff"
CANDIDATES = [9600, 115200, 57600, 38400, 19200, 4800, 2400, 230400]


def bridge_baud(ser, baud):
    ser.write(b"\x7e\x7e\x42" + struct.pack("<I", baud))
    time.sleep(0.15)
    ser.reset_input_buffer()


def ask(ser, cmd, wait=0.5):
    ser.reset_input_buffer()
    ser.write(cmd.encode() + END)
    time.sleep(wait)
    return ser.read(ser.in_waiting) if ser.in_waiting else b""


def main():
    sys.stdout.reconfigure(errors="replace")
    ser = serial.Serial(PORT, 115200, timeout=0.2)
    time.sleep(2.5)                       # l'ouverture du port redémarre l'ESP32
    found = None
    for b in CANDIDATES:
        bridge_baud(ser, b)
        rep = ask(ser, "sendme")
        print(f"{b:>7} bauds : sendme -> {rep.hex(' ') or '(rien)'}", flush=True)
        if rep.endswith(END):                 # toute trame complète prouve que la vitesse est bonne
            found = b
            break
    if not found:
        print("Aucune vitesse n'a répondu à sendme.")
        return
    print(f"==> l'écran répond à {found} bauds")
    if found != TARGET:
        print(f"Réglage permanent : bauds={TARGET}")
        ask(ser, f"bauds={TARGET}", wait=0.4)
        bridge_baud(ser, TARGET)
        rep = ask(ser, "sendme")
        print(f"{TARGET:>7} bauds : sendme -> {rep.hex(' ') or '(rien)'}")
    ser.close()


if __name__ == "__main__":
    main()
