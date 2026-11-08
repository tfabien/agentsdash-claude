#!/usr/bin/env python3
"""
Envoie des commandes de dessin (style Nextion) à l'écran HMI via le pont série de l'ESP32.
Prérequis : hmi_bridge.ino téléversé sur l'ESP32, écran branché.

Usage : python hmi_test.py [COM3]
"""
import sys
import time

import serial

PORT = sys.argv[1] if len(sys.argv) > 1 else "COM3"
END = b"\xff\xff\xff"

# (description, commande) -- couleurs en RGB565 : 65535 blanc, 2016 vert, 64512 orange, 33808 gris
TESTS = [
    ("retour sur toutes les commandes", "bkcmd=3"),
    ("page courante", "sendme"),
    ("effacer en noir", "cls 0"),
    ("bandeau vert", "fill 0,0,480,40,2016"),
    ("texte dans le bandeau", 'xstr 10,4,300,32,0,65535,2016,0,1,1,"AGENTS"'),
    ("trait gris", "fill 0,46,480,2,33808"),
    ("point vert", "cirs 20,80,8,2016"),
    ("texte 1", 'xstr 40,64,400,32,0,65535,0,0,1,1,"refacto-api   working"'),
    ("point orange", "cirs 20,120,8,64512"),
    ("texte 2", 'xstr 40,104,400,32,0,64512,0,0,1,1,"doc-writer   waiting"'),
]


STEP = float(sys.argv[2]) if len(sys.argv) > 2 else 0.6     # pause (s) après chaque commande


def read_reply(ser, wait):
    time.sleep(wait)
    return ser.read(ser.in_waiting) if ser.in_waiting else b""


def main():
    sys.stdout.reconfigure(errors="replace")
    ser = serial.Serial(PORT, 115200, timeout=0.2)
    time.sleep(2.5)                 # l'ouverture du port redémarre l'ESP32
    ser.reset_input_buffer()
    t0 = time.time()
    for desc, cmd in TESTS:
        ser.write(cmd.encode("utf-8") + END)
        rep = read_reply(ser, STEP)
        print(f"t+{time.time() - t0:5.1f}s  {desc:<28} -> {rep.hex(' ') or '(rien)'}", flush=True)
    # maintien : on surveille la page courante et les événements pendant 12 s
    print("--- maintien 12 s (photographiez maintenant) ---", flush=True)
    end = time.time() + 12
    while time.time() < end:
        ser.write(b"sendme" + END)
        rep = read_reply(ser, 1.0)
        print(f"t+{time.time() - t0:5.1f}s  sendme -> {rep.hex(' ') or '(rien)'}", flush=True)
    ser.close()


if __name__ == "__main__":
    main()
