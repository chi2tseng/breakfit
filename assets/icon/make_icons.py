"""BreakFit icon generator. One geometry source -> SVG master + supersampled PIL renders.

py assets/icon/make_icons.py            -> final assets for CHOSEN concept
py assets/icon/make_icons.py concepts   -> assets/icon/concepts.png comparison sheet
Coordinates are on a 1024 grid. Sizes <= 32 px use the thicker 'small' glyph (tray + small ICO frames).
"""
import math
import os
import sys

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
CHOSEN = 'A'

ORANGE = ((255, 156, 64), (247, 126, 22))    # HIG orange (255,141,40) sits mid-gradient
GREEN = ((70, 222, 108), (40, 196, 78))      # HIG green dark (48,209,88)
DARK = ((46, 46, 48), (28, 28, 30))          # #1c1c1e
GREY = ((156, 156, 161), (122, 122, 127))    # paused: systemGray
WHITE = (255, 255, 255)
ORANGE_GLYPH = (255, 146, 48)
GREY_GLYPH = (142, 142, 147)


# ---------- geometry helpers ----------
def cap(x1, y1, x2, y2, w):
    return ('line', x1, y1, x2, y2, w)


def centre(shapes, cx=512, cy=512):
    """Translate shapes so their bounding box is centred on (cx, cy)."""
    xs, ys = [], []
    for s in shapes:
        if s[0] == 'circle':
            _, x, y, r = s; xs += [x - r, x + r]; ys += [y - r, y + r]
        elif s[0] == 'ring':
            _, x, y, r, w = s; xs += [x - r - w / 2, x + r + w / 2]; ys += [y - r - w / 2, y + r + w / 2]
        else:
            _, x1, y1, x2, y2, w = s; xs += [x1 - w / 2, x2 - w / 2, x1 + w / 2, x2 + w / 2]; ys += [y1 - w / 2, y2 - w / 2, y1 + w / 2, y2 + w / 2]
    dx = cx - (min(xs) + max(xs)) / 2
    dy = cy - (min(ys) + max(ys)) / 2
    out = []
    for s in shapes:
        if s[0] == 'circle':
            out.append(('circle', s[1] + dx, s[2] + dy, s[3]))
        elif s[0] == 'ring':
            out.append(('ring', s[1] + dx, s[2] + dy, s[3], s[4]))
        else:
            out.append(('line', s[1] + dx, s[2] + dy, s[3] + dx, s[4] + dy, s[5]))
    return out


def stopwatch(r, w, hand_w, hand_len, dot, crown_w, crown_gap, cap_len, motion):
    cx, cy = 600, 560
    outer = r + w / 2
    s = [('ring', cx, cy, r, w)]
    stem_top = cy - outer - crown_gap
    s.append(cap(cx, cy - outer + 4, cx, stem_top, crown_w))
    if cap_len:
        s.append(cap(cx - cap_len / 2, stem_top, cx + cap_len / 2, stem_top, crown_w))
    a = math.radians(50)
    s.append(cap(cx, cy, cx + hand_len * math.cos(a), cy - hand_len * math.sin(a), hand_w))
    s.append(('circle', cx, cy, dot))
    for dy, length, lw in motion:  # speed lines hugging the left of the ring
        y = cy + dy
        edge = cx - math.sqrt(max(outer ** 2 - dy ** 2, 0))
        end = edge - 46 - lw / 2
        s.append(cap(end - length, y, end, y, lw))
    return centre(s)


def stopwatch_small(r=256, w=128, hand_w=100, hand_len=150):
    """Pixel-aligned for 16 px (64 units = 1 px): ring x 3..13 / y 4..14, 2 px stroke, crown on top."""
    cx, cy = 512, 576
    a = math.radians(50)
    return [('ring', cx, cy, r, w),
            cap(cx, cy - r, cx, 200, 104),          # stem
            cap(448, 160, 576, 160, 96),            # crown bar
            cap(cx, cy, cx + hand_len * math.cos(a), cy - hand_len * math.sin(a), hand_w)]


def pushup(head_r, body_w, arm_w):
    S = (360, 520); F = (840, 700)
    d = (S[0] - F[0], S[1] - F[1]); L = math.hypot(*d); u = (d[0] / L, d[1] / L)
    gap = head_r + body_w * 0.5 + 18
    H = (S[0] + u[0] * gap, S[1] + u[1] * gap)
    return centre([
        ('circle', H[0], H[1], head_r),
        cap(S[0], S[1], F[0], F[1], body_w),
        cap(S[0], S[1], S[0] + 14, F[1], arm_w),
    ])


def pausefig(head_r, bar_w, bar_dx, bar_top, bar_bot, head_gap):
    return centre([
        ('circle', 512, bar_top - bar_w / 2 - head_gap - head_r, head_r),
        cap(512 - bar_dx, bar_top, 512 - bar_dx, bar_bot, bar_w),
        cap(512 + bar_dx, bar_top, 512 + bar_dx, bar_bot, bar_w),
    ])


CONCEPTS = {
    'A': dict(name='A  stopwatch + motion', bg=ORANGE, glyph=WHITE, paused_bg=GREY, paused_glyph=WHITE,
              big=stopwatch(r=214, w=82, hand_w=66, hand_len=128, dot=50, crown_w=66, crown_gap=44, cap_len=112,
                            motion=[(-100, 70, 54), (0, 124, 54), (100, 70, 54)]),
              small=stopwatch_small()),
    'B': dict(name='B  push-up figure', bg=DARK, glyph=ORANGE_GLYPH, paused_bg=DARK, paused_glyph=GREY_GLYPH,
              big=pushup(head_r=86, body_w=108, arm_w=96),
              small=pushup(head_r=120, body_w=150, arm_w=136)),
    'C': dict(name='C  pause = figure', bg=GREEN, glyph=WHITE, paused_bg=GREY, paused_glyph=WHITE,
              big=pausefig(head_r=96, bar_w=122, bar_dx=92, bar_top=520, bar_bot=780, head_gap=46),
              small=pausefig(head_r=128, bar_w=150, bar_dx=118, bar_top=540, bar_bot=800, head_gap=60)),
}


def squircle(a, cx=512, cy=512, n=5.0, N=720):
    pts = []
    for i in range(N):
        t = 2 * math.pi * i / N
        c, s = math.cos(t), math.sin(t)
        pts.append((cx + a * math.copysign(abs(c) ** (2 / n), c), cy + a * math.copysign(abs(s) ** (2 / n), s)))
    return pts


# ---------- raster ----------
def render(size, concept, paused=False, tile_a=None):
    c = CONCEPTS[concept]
    small = size <= 32
    shapes = c['small'] if small else c['big']
    bg = c['paused_bg'] if paused else c['bg']
    glyph = c['paused_glyph'] if paused else c['glyph']
    if tile_a is None:
        tile_a = 510 if small else 500
    ss = max(4, math.ceil(2048 / size))
    W = size * ss
    k = W / 1024

    mask = Image.new('L', (W, W), 0)
    ImageDraw.Draw(mask).polygon([(x * k, y * k) for x, y in squircle(tile_a)], fill=255)
    grad = Image.new('RGB', (1, 256))
    for y in range(256):
        t = y / 255
        grad.putpixel((0, y), tuple(round(bg[0][i] + (bg[1][i] - bg[0][i]) * t) for i in range(3)))
    img = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    img.paste(grad.resize((W, W)), (0, 0), mask)

    gm = Image.new('L', (W, W), 0)
    d = ImageDraw.Draw(gm)
    for s in shapes:
        if s[0] == 'circle':
            _, x, y, r = s
            d.ellipse([(x - r) * k, (y - r) * k, (x + r) * k, (y + r) * k], fill=255)
        elif s[0] == 'ring':
            _, x, y, r, w = s
            ro, ri = (r + w / 2) * k, (r - w / 2) * k
            ring = Image.new('L', (W, W), 0)
            rd = ImageDraw.Draw(ring)
            rd.ellipse([x * k - ro, y * k - ro, x * k + ro, y * k + ro], fill=255)
            rd.ellipse([x * k - ri, y * k - ri, x * k + ri, y * k + ri], fill=0)
            gm.paste(255, (0, 0), ring)
        else:
            _, x1, y1, x2, y2, w = s
            h = w / 2 * k
            L = math.hypot(x2 - x1, y2 - y1) or 1
            nx, ny = -(y2 - y1) / L * h, (x2 - x1) / L * h
            d.polygon([(x1 * k + nx, y1 * k + ny), (x2 * k + nx, y2 * k + ny), (x2 * k - nx, y2 * k - ny), (x1 * k - nx, y1 * k - ny)], fill=255)
            for x, y in ((x1, y1), (x2, y2)):
                d.ellipse([x * k - h, y * k - h, x * k + h, y * k + h], fill=255)
    layer = Image.new('RGBA', (W, W), glyph + (255,))
    img.paste(layer, (0, 0), Image.composite(gm, Image.new('L', (W, W), 0), mask))
    return img.resize((size, size), Image.LANCZOS if size >= 64 else Image.BOX)


# ---------- svg ----------
def svg(concept, paused=False, small=False):
    c = CONCEPTS[concept]
    bg = c['paused_bg'] if paused else c['bg']
    glyph = c['paused_glyph'] if paused else c['glyph']
    hexc = lambda t: '#%02x%02x%02x' % t
    pts = squircle(510 if small else 500, N=240)
    path = 'M' + ' L'.join('%.1f %.1f' % p for p in pts) + ' Z'
    out = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">',
           '<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">'
           '<stop offset="0" stop-color="%s"/><stop offset="1" stop-color="%s"/></linearGradient></defs>' % (hexc(bg[0]), hexc(bg[1])),
           '<path d="%s" fill="url(#bg)"/>' % path,
           '<g fill="%s" stroke="%s" stroke-linecap="round">' % (hexc(glyph), hexc(glyph))]
    for s in c['small' if small else 'big']:
        if s[0] == 'circle':
            out.append('<circle cx="%.1f" cy="%.1f" r="%.1f" stroke="none"/>' % s[1:])
        elif s[0] == 'ring':
            out.append('<circle cx="%.1f" cy="%.1f" r="%.1f" fill="none" stroke-width="%.1f"/>' % s[1:])
        else:
            out.append('<line x1="%.1f" y1="%.1f" x2="%.1f" y2="%.1f" stroke-width="%.1f"/>' % s[1:])
    out.append('</g></svg>')
    return '\n'.join(out) + '\n'


# ---------- outputs ----------
def sheet():
    font = ImageFont.truetype('segoeui.ttf', 20)
    fs = ImageFont.truetype('segoeui.ttf', 15)
    PANEL = {'dark taskbar #202020': (32, 32, 32), 'light taskbar #f3f3f3': (243, 243, 243)}
    rowh, W = 600, 560 + 2 * 720 + 40
    out = Image.new('RGB', (W, rowh * 3 + 20), (120, 120, 124))
    d = ImageDraw.Draw(out)
    for ri, key in enumerate('ABC'):
        y0 = 10 + ri * rowh
        d.text((20, y0 + 5), CONCEPTS[key]['name'], font=font, fill=(255, 255, 255))
        big = render(512, key)
        out.paste(big, (20, y0 + 40), big)
        for pi, (pname, pc) in enumerate(PANEL.items()):
            x0 = 560 + pi * 730
            d.rectangle([x0, y0 + 40, x0 + 710, y0 + 552], fill=pc)
            tc = (220, 220, 220) if pc[0] < 128 else (40, 40, 40)
            d.text((x0 + 12, y0 + 46), pname, font=fs, fill=tc)
            x = x0 + 12
            for s in (64, 32, 16):  # app icon
                im = render(s, key); out.paste(im, (x, y0 + 80), im); x += s + 20
            d.text((x0 + 12, y0 + 150), 'app 64/32/16  |  tray 16/20/24/32 normal, paused', font=fs, fill=tc)
            x = x0 + 12
            for paused, yy in ((False, 185), (True, 225)):
                x = x0 + 12
                for s in (16, 20, 24, 32):
                    im = render(s, key, paused); out.paste(im, (x, y0 + yy), im); x += s + 18
            d.text((x0 + 12, y0 + 270), 'tray 16px x8 (nearest)', font=fs, fill=tc)
            for i, paused in enumerate((False, True)):
                im = render(16, key, paused).resize((128, 128), Image.NEAREST)
                bgp = Image.new('RGBA', im.size, pc + (255,)); bgp.alpha_composite(im)
                out.paste(bgp, (x0 + 12 + i * 150, y0 + 300))
            im = render(32, key).resize((128, 128), Image.NEAREST)
            bgp = Image.new('RGBA', im.size, pc + (255,)); bgp.alpha_composite(im)
            out.paste(bgp, (x0 + 312, y0 + 300))
            d.text((x0 + 312, y0 + 432), '32px x4', font=fs, fill=tc)
    path = os.path.join(HERE, 'concepts.png')
    out.save(path)
    print('wrote', path)


def final(concept=CHOSEN):
    with open(os.path.join(HERE, 'icon.svg'), 'w', encoding='utf-8') as f:
        f.write(svg(concept))
    with open(os.path.join(HERE, 'icon-small.svg'), 'w', encoding='utf-8') as f:
        f.write(svg(concept, small=True))
    render(1024, concept).save(os.path.join(HERE, 'icon-1024.png'))
    render(256, concept).save(os.path.join(HERE, 'icon-256.png'))
    sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256]
    frames = [render(s, concept) for s in sizes]
    frames[-1].save(os.path.join(HERE, 'icon.ico'), format='ICO', sizes=[(s, s) for s in sizes], append_images=frames[:-1])
    # Electron nativeImage picks up @<scale>x siblings automatically (tray.png = 16 px @100%).
    for paused, base in ((False, 'tray'), (True, 'tray-paused')):
        for s, suffix in ((16, ''), (20, '@1.25x'), (24, '@1.5x'), (32, '@2x')):
            render(s, concept, paused).save(os.path.join(HERE, '%s%s.png' % (base, suffix)))
        # Windows tray: ICO lets the shell pick the exact 16/20/24/32 frame for the DPI (no 1x upscaling).
        tf = [render(s, concept, paused) for s in (16, 20, 24, 32)]
        tf[-1].save(os.path.join(HERE, base + '.ico'), format='ICO', sizes=[(s, s) for s in (16, 20, 24, 32)], append_images=tf[:-1])
    print('wrote final assets for concept', concept)


if __name__ == '__main__':
    sheet() if 'concepts' in sys.argv[1:] else final()
