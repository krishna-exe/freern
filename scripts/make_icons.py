#!/usr/bin/env python3
"""Draws the app icons into public/icons: a white switch, flipped on, on green."""
import pathlib

from PIL import Image, ImageDraw

GREEN = (15, 127, 58)
WHITE = (255, 255, 255)
SCALE = 4  # Draw large and shrink, for smooth edges.
OUT = pathlib.Path(__file__).resolve().parent.parent / 'public/icons'


def icon(size, track_share, rounded):
    big = size * SCALE
    image = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    corner = big // 5 if rounded else 0
    draw.rounded_rectangle((0, 0, big - 1, big - 1), corner, fill=GREEN)

    track_w = int(big * track_share)
    track_h = int(track_w * 0.56)
    left, top = (big - track_w) // 2, (big - track_h) // 2
    draw.rounded_rectangle((left, top, left + track_w, top + track_h), track_h // 2, fill=WHITE)

    inset = track_h // 8
    knob = track_h - 2 * inset
    knob_left = left + track_w - inset - knob
    draw.ellipse((knob_left, top + inset, knob_left + knob, top + inset + knob), fill=GREEN)
    return image.resize((size, size), Image.LANCZOS)


OUT.mkdir(parents=True, exist_ok=True)
icon(192, 0.68, True).save(OUT / 'icon-192.png')
icon(512, 0.68, True).save(OUT / 'icon-512.png')
# Android crops maskable icons to a shape, so keep the switch well inside.
icon(512, 0.52, False).save(OUT / 'maskable-512.png')
# iOS rounds the corners itself and doesn't allow transparency.
icon(180, 0.68, False).save(OUT / 'apple-touch-icon.png')
