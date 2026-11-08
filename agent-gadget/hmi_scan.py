#!/usr/bin/env python3
"""
Explore l'écran HMI via le pont série : timers (tm0..tm7) et pages existantes.

Usage : python hmi_scan.py [COM3]
Codes de retour utiles : 01 = succès, 03 = page invalide, 1A = variable/composant inconnu.
À la fin, retourne sur la page 1.
"""
import sys
import time

import serial

PORT = sys.argv[1] if len(sys.argv) > 1 else "COM3"
END = b"\xff\xff\xff"


def send(ser, cmd, wait=0.5):
    ser.reset_input_buffer()
    ser.write(cmd.encode() + END)
    time.sleep(wait)
    rep = ser.read(ser.in_waiting) if ser.in_waiting else b""
    print(f"{cmd:<18} -> {rep.hex(' ') or '(rien)'}", flush=True)
    return rep


def main():
    sys.stdout.reconfigure(errors="replace")
    ser = serial.Serial(PORT, 115200, timeout=0.2)
    time.sleep(2.5)                      # l'ouverture du port redémarre l'ESP32
    print("== timers : tmN.en=0 (01 = existe et arrêté) ==")
    for n in range(8):
        send(ser, f"tm{n}.en=0")
    print("== pages : page N (01 = existe, 03 = invalide) ==")
    valid = []
    for n in range(0, 16):
        rep = send(ser, f"page {n}", wait=0.8)
        if rep.startswith(b"\x01"):
            valid.append(n)
    print("pages valides :", valid)
    send(ser, "page 1", wait=0.8)
    ser.close()


if __name__ == "__main__":
    main()
