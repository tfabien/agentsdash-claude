#!/usr/bin/env python3
"""
Démo de dessin sur l'écran HMI en PORTRAIT (272 x 480), via le pont série (hmi_bridge.ino).

Étapes : masquer tous les composants de la page courante (vis 255,0), désactiver le tactile
des composants (tsw 255,0), effacer, puis dessiner un cadre et une maquette d'agents.

Usage : python hmi_draw_demo.py [COM3] [secondes_de_maintien]
"""
import sys
import time

import serial

ARGS = [a for a in sys.argv[1:] if not a.startswith("--")]
PORT = ARGS[0] if len(ARGS) > 0 else "COM3"
HOLD = float(ARGS[1]) if len(ARGS) > 1 else 30
END = b"\xff\xff\xff"
W, H = 272, 480

WHITE, GREEN, ORANGE, RED, GREY, BLACK, DARK = 65535, 2016, 64512, 63488, 33808, 0, 4226

AGENTS = [
    ("refacto-api", "working", "Edit src/api/routes.py", "12s", GREEN),
    ("doc-writer", "waiting", "Valider: Edit .env", "1m04", ORANGE),
    ("bug-hunter", "working", "Grep 'TODO|FIXME'", "34s", GREEN),
    ("migration-db", "error", "Echec: exit code 1", "8s", RED),
    ("code-review", "done", "Termine", "2m10", GREY),
]


NO_HIDE = "--no-hide" in sys.argv        # saute vis/tsw (déjà appliqués lors d'un essai précédent)


def commands():
    if not NO_HIDE:
        yield "vis 255,0"
        yield "tsw 255,0"
    yield f"cls {BLACK}"
    yield f"draw 0,0,{W - 1},{H - 1},{RED}"                       # cadre portrait (vérifie les limites)
    yield f"fill 0,0,{W},34,{DARK}"
    yield f'xstr 10,4,150,26,0,{WHITE},{DARK},0,1,1,"AGENTS"'
    yield f'xstr 150,4,116,26,0,{GREEN},{DARK},2,1,1,"2 actifs"'
    for i, (name, state, task, age, col) in enumerate(AGENTS):
        y = 42 + i * 84
        yield f"fill 0,{y + 80},{W},1,{DARK}"
        yield f"cirs 16,{y + 20},8,{col}"
        yield f'xstr 34,{y + 6},150,28,0,{WHITE},{BLACK},0,1,1,"{name}"'
        yield f'xstr 188,{y + 6},78,28,0,{GREY},{BLACK},2,1,1,"{age}"'
        yield f'xstr 34,{y + 38},232,24,0,{col},{BLACK},0,1,1,"{task}"'


def main():
    sys.stdout.reconfigure(errors="replace")
    ser = serial.Serial(PORT, 115200, timeout=0.2)
    time.sleep(2.5)                      # l'ouverture du port redémarre l'ESP32
    ser.reset_input_buffer()
    t0 = time.time()
    for cmd in commands():
        ser.write(cmd.encode("utf-8") + END)
        time.sleep(0.35)
        rep = ser.read(ser.in_waiting) if ser.in_waiting else b""
        print(f"t+{time.time() - t0:5.1f}s  {cmd[:60]:<60} -> {rep.hex(' ') or '(rien)'}", flush=True)
    print(f"--- maintien {HOLD:.0f} s : surveillance de la page et du tactile ---", flush=True)
    end = time.time() + HOLD
    while time.time() < end:
        ser.write(b"sendme" + END)
        time.sleep(1.0)
        rep = ser.read(ser.in_waiting) if ser.in_waiting else b""
        print(f"t+{time.time() - t0:5.1f}s  sendme -> {rep.hex(' ') or '(rien)'}", flush=True)
    ser.close()


if __name__ == "__main__":
    main()
