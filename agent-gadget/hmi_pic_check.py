#!/usr/bin/env python3
"""Show the 16 sprite pictures (ids 0..15) on the screen through the USB bridge, for a visual check.

Needs hmi_bridge on the ESP32 and the .tft that holds the sprites. Expected: top row = 8 big looks
(lead, general, explore, plan, review, test, code, generic), bottom row = the same 8 small. A reply
other than 01 for an id means that picture is missing in the project.
Usage: python agent-gadget/hmi_pic_check.py [COM3]
"""
import struct
import sys
import time

import serial

PORT = sys.argv[1] if len(sys.argv) > 1 else "COM3"
END = b"\xff\xff\xff"


def send(ser, cmd, wait=0.3):
    ser.write(cmd.encode("ascii") + END)
    time.sleep(wait)
    return ser.read(ser.in_waiting) if ser.in_waiting else b""


def main():
    ser = serial.Serial(PORT, 115200, timeout=0.2)
    time.sleep(2.5)                                   # opening the port resets the ESP32
    ser.reset_input_buffer()
    ser.write(bytes([0x7E, 0x7E, 0x42]) + struct.pack("<I", 9600))   # bridge boots at 115200; a freshly flashed screen runs at 9600
    time.sleep(0.2)
    send(ser, "")                                     # flush a stray byte (first command often returns 1A)
    send(ser, "bkcmd=3")
    send(ser, "cls 0")
    for pic_id in range(16):
        big = pic_id < 8
        x = 12 + 58 * (pic_id % 8)
        y = 40 if big else 140
        reply = send(ser, f"pic {x},{y},{pic_id}")
        print(f"pic id {pic_id:2d} at {x},{y} -> {reply.hex(' ') or '(no reply)'}")
    send(ser, 'xstr 12,4,460,30,1,65535,0,0,1,1,"ids 0-7 big, 8-15 small"')
    ser.close()


if __name__ == "__main__":
    main()
