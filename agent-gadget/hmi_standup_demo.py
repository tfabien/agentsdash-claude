#!/usr/bin/env python3
"""
Maquette « agent standup » dessinée sur l'écran HMI en PAYSAGE (480 x 272),
via le pont série (hmi_bridge.ino) et le projet blank.tft (page vide + polices).

Polices du projet : font 0 = f24 (24 px), font 1 = f16 (16 px), ASCII seulement.

Usage : python hmi_standup_demo.py [COM3] [secondes_de_maintien]
"""
import struct
import sys
import time

import serial

_args = [a for a in sys.argv[1:] if not a.startswith("--")]
PORT = _args[0] if len(_args) > 0 else "COM3"
HOLD = float(_args[1]) if len(_args) > 1 else 20
BAUD = next((int(a.split("=")[1]) for a in sys.argv[1:] if a.startswith("--baud=")), 0)   # ex. --baud=9600
END = b"\xff\xff\xff"
W, H = 480, 272
F24, F16 = 0, 1

WHITE, GREEN, ORANGE, RED, GREY, BLACK, DARK = 65535, 2016, 64512, 63488, 33808, 0, 4226

AGENTS = [
    ("refacto-api", "working", "Edit src/api/routes.py", "12s", GREEN),
    ("doc-writer", "waiting", "Valider: Edit .env", "1m04", ORANGE),
    ("bug-hunter", "working", "Grep 'TODO|FIXME'", "34s", GREEN),
    ("migration-db", "error", "Echec: exit code 1", "8s", RED),
    ("code-review", "done", "Termine", "2m10", GREY),
]

ROW_H, TOP = 47, 36


def commands():
    yield f"cls {BLACK}"
    yield f"fill 0,0,{W},32,{DARK}"
    yield f'xstr 10,3,200,26,{F24},{WHITE},{DARK},0,1,1,"AGENTS"'
    yield f'xstr 250,3,220,26,{F24},{GREEN},{DARK},2,1,1,"2 working  1 wait"'
    for i, (name, state, task, age, col) in enumerate(AGENTS):
        y = TOP + i * ROW_H
        yield f"fill 0,{y + ROW_H - 1},{W},1,{DARK}"
        yield f"cirs 16,{y + 16},7,{col}"
        yield f'xstr 32,{y + 1},300,26,{F24},{WHITE},{BLACK},0,1,1,"{name}"'
        yield f'xstr 370,{y + 6},100,18,{F16},{GREY},{BLACK},2,1,1,"{age}"'
        yield f'xstr 32,{y + 27},438,18,{F16},{col},{BLACK},0,1,1,"{task}"'


def main():
    sys.stdout.reconfigure(errors="replace")
    ser = serial.Serial(PORT, 115200, timeout=0.2)
    time.sleep(2.5)                      # l'ouverture du port redémarre l'ESP32
    if BAUD:                             # vitesse côté écran (commande spéciale du pont)
        ser.write(b"\x7e\x7e\x42" + struct.pack("<I", BAUD))
        time.sleep(0.2)
    ser.reset_input_buffer()
    ser.write(END)                       # purge d'un éventuel octet parasite côté écran
    time.sleep(0.2)
    ser.reset_input_buffer()
    t0 = time.time()
    for cmd in commands():
        ser.write(cmd.encode("utf-8") + END)
        time.sleep(0.15)
        rep = ser.read(ser.in_waiting) if ser.in_waiting else b""
        print(f"t+{time.time() - t0:5.1f}s  {cmd[:56]:<56} -> {rep.hex(' ') or '(rien)'}", flush=True)
    print(f"--- maintien {HOLD:.0f} s : page courante et événements tactiles ---", flush=True)
    end = time.time() + HOLD
    while time.time() < end:
        ser.write(b"sendme" + END)
        time.sleep(1.0)
        rep = ser.read(ser.in_waiting) if ser.in_waiting else b""
        print(f"t+{time.time() - t0:5.1f}s  sendme -> {rep.hex(' ') or '(rien)'}", flush=True)
    ser.close()


if __name__ == "__main__":
    main()
