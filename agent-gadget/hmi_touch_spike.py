#!/usr/bin/env python3
"""Touch spike (plan Task 5): does the blank page report raw touch coordinates?

Needs hmi_bridge on the ESP32 (screen side 9600 baud). Sends sendxy=1, then prints every frame the
screen sends for 30 s. Tap the four corners, then the center, slowly. Expected with raw coordinates:
frames like 67 xh xl yh yl state FF FF FF (68 for sleep mode). Nothing at all means option (a): touch
zones (hotspot components) are needed in the screen project.
Usage: python agent-gadget/hmi_touch_spike.py [COM3] [seconds]
"""
import sys
import time

import serial

PORT = sys.argv[1] if len(sys.argv) > 1 else "COM3"
SECONDS = float(sys.argv[2]) if len(sys.argv) > 2 else 30
END = b"\xff\xff\xff"


def decode(frame):
    if len(frame) == 6 and frame[0] in (0x67, 0x68):
        x, y = frame[1] << 8 | frame[2], frame[3] << 8 | frame[4]
        return f"touch x={x} y={y} {'press' if frame[5] else 'release'}"
    if len(frame) == 4 and frame[0] == 0x65:
        return f"component page={frame[1]} id={frame[2]} {'press' if frame[3] else 'release'}"
    return ""


def main():
    ser = serial.Serial(PORT, 115200, timeout=0.1)
    time.sleep(2.5)                                   # opening the port resets the ESP32
    ser.reset_input_buffer()
    for cmd in (b"", b"bkcmd=3", b"sendxy=1"):
        ser.write(cmd + END)
        time.sleep(0.3)
    print("setup replies:", ser.read(ser.in_waiting).hex(" ") or "(none)")
    print(f"Tap the corners, then the center ({SECONDS:.0f} s)...", flush=True)
    buf, t0 = b"", time.time()
    while time.time() - t0 < SECONDS:
        buf += ser.read(64)
        while END in buf:
            frame, buf = buf.split(END, 1)
            print(f"t+{time.time() - t0:5.1f}s  {frame.hex(' '):<24} {decode(frame)}", flush=True)
    if buf:
        print("unterminated bytes:", buf.hex(" "))
    ser.close()


if __name__ == "__main__":
    main()
