#!/usr/bin/env python3
"""Render docs/games/bass-drop/wireframes/*.svg from docs/games/bass-drop/layout.json.

Usage: python3 docs/games/bass-drop/wireframes/render.py   (stdlib only; re-run after editing layout.json)
"""
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
L = json.loads((ROOT / 'layout.json').read_text())
MG = L['meterGeometry']
OUT = ROOT / 'wireframes'
OUT.mkdir(exist_ok=True)

COL = {
    'bg': '#0a0420', 'grid': '#1f2e4d', 'gridLine': '#35f2e0', 'panel': '#0c3149', 'frame': '#b8742f',
    'logo': '#ffc629', 'meter': '#35f2e0', 'notchMajor': '#ff3fa8', 'notchBonus': '#ffc629', 'cab': '#4b283d',
    'chip': '#f8d828', 'mascot': '#3f9d3a', 'croak': '#8fbf3a', 'booth': '#ff5fa2', 'hud': '#8a8a8a',
    'spin': '#ffffff', 'buy': '#f828c8', 'text': '#e8e8e8', 'arc': '#ffffff', 'orb': '#35f2e0', 'plate': '#ffd54a',
}


def rect(r, stroke, fill='none', sw=3, dash=None, op=1.0, rx=0):
    d = f' stroke-dasharray="{dash}"' if dash else ''
    return (f'<rect x="{r["x"]}" y="{r["y"]}" width="{r["w"]}" height="{r["h"]}" rx="{rx}" '
            f'fill="{fill}" fill-opacity="{op}" stroke="{stroke}" stroke-width="{sw}"{d}/>')


def label(x, y, text, size=22, color=None, anchor='middle', weight='600'):
    color = color or COL['text']
    return (f'<text x="{x}" y="{y}" font-family="Inter,Arial,sans-serif" font-size="{size}" font-weight="{weight}" '
            f'fill="{color}" text-anchor="{anchor}" dominant-baseline="middle">{text}</text>')


# Visual HUD hex radii per space, mirrored from src/ui/hud/hudLayout.ts (None = derived:
# small = smallButton / 2, spin = size * 0.56). Keep in step with that file.
HUD_VISUAL = {
    'landscape': {'small': None, 'buy': 88, 'spin': None},
    'tablet': {'small': None, 'buy': 88, 'spin': None},
    'portrait': {'small': 58, 'buy': 76, 'spin': None},
    'compact': {'small': 30, 'buy': 33, 'spin': 80},
}


def hexagon(cx, cy, d, stroke, fill='none', sw=3, tilt=0):
    r = d / 2
    pts = []
    for i in range(6):
        a = math.radians(60 * i + 30 + tilt)
        pts.append(f'{cx + r * math.cos(a):.1f},{cy + r * math.sin(a):.1f}')
    return f'<polygon points="{" ".join(pts)}" fill="{fill}" fill-opacity="0.35" stroke="{stroke}" stroke-width="{sw}"/>'


def polar(cx, cy, r, deg):
    a = math.radians(deg)
    return cx + r * math.sin(a), cy - r * math.cos(a)


def arc_path(cx, cy, r, a0, a1):
    x0, y0 = polar(cx, cy, r, a0)
    x1, y1 = polar(cx, cy, r, a1)
    large = 1 if (a1 - a0) > 180 else 0
    return f'M{x0:.1f},{y0:.1f} A{r:.1f},{r:.1f} 0 {large} 1 {x1:.1f},{y1:.1f}'


def meter(m, k):
    cx, cy, D = m['cx'], m['cy'], m['ringOuterD']
    R = D / 2
    s = []
    s.append(f'<circle cx="{cx}" cy="{cy}" r="{R}" fill="#15102a" stroke="{COL["meter"]}" stroke-width="{3*k}"/>')
    s.append(f'<circle cx="{cx}" cy="{cy}" r="{R*MG["rimInner"]:.1f}" fill="none" stroke="#4b3bff" stroke-width="{2*k}"/>')
    a0, sweep = MG['startDeg'], MG['sweepDeg']
    # LED band: unlit full sweep + example fill to 23/60
    rl = R * (MG['ledOuter'] + MG['ledInner']) / 2
    wl = R * (MG['ledOuter'] - MG['ledInner'])
    s.append(f'<path d="{arc_path(cx, cy, rl, a0, a0 + sweep)}" fill="none" stroke="#243056" stroke-width="{wl:.1f}"/>')
    s.append(f'<path d="{arc_path(cx, cy, rl, a0, a0 + sweep * 23 / 60)}" fill="none" stroke="{COL["meter"]}" stroke-opacity="0.85" stroke-width="{wl:.1f}"/>')
    for i in range(MG['ticks'] + 1):
        ang = a0 + sweep * i / MG['ticks']
        x0, y0 = polar(cx, cy, R * MG['ledInner'], ang)
        x1, y1 = polar(cx, cy, R * MG['ledOuter'], ang)
        s.append(f'<line x1="{x0:.1f}" y1="{y0:.1f}" x2="{x1:.1f}" y2="{y1:.1f}" stroke="#0a0420" stroke-width="{1.2*k:.1f}"/>')
    s.append(f'<circle cx="{cx}" cy="{cy}" r="{R*MG["counterR"]:.1f}" fill="#241a44" stroke="#ffc629" stroke-width="{2*k}"/>')
    s.append(label(cx, cy, '23/60', size=max(12, round(R * 0.26)), color='#ffffff', weight='800'))
    for v in MG['notches']:
        ang = a0 + sweep * v / 60
        x, y = polar(cx, cy, R * MG['notchRadius'], ang)
        col = COL['notchBonus'] if v == 40 else COL['notchMajor'] if v == 60 else COL['meter']
        rr = R * MG['notchR']
        s.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{rr:.1f}" fill="#0a0420" stroke="{col}" stroke-width="{2.5*k}"/>')
        s.append(label(x, y, 'JJ' if v == 40 else 'MM' if v == 60 else 'W', size=max(8, round(rr * 0.9)), color=col, weight='800'))
    return '\n'.join(s)


def render(name, S):
    W, H = S['size']
    k = W / 1920 if name != 'portrait' else 1080 / 1920 * 1.0 + 0.45
    k = max(0.5, min(1.0, S['cell'] / 124))
    s = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">',
         f'<rect width="{W}" height="{H}" fill="{COL["bg"]}"/>']
    # frame + panel + grid
    s.append(rect(S['frame'], COL['frame'], fill=COL['frame'], sw=2, op=0.18))
    fp = S['frameParts']
    F = S['frame']
    s.append(rect({'x': F['x'], 'y': F['y'], 'w': F['w'], 'h': fp['beam']}, COL['frame'], fill=COL['frame'], sw=0, op=0.45))
    s.append(rect({'x': F['x'], 'y': F['y'] + F['h'] - fp['sill'], 'w': F['w'], 'h': fp['sill']}, COL['frame'], fill=COL['frame'], sw=0, op=0.45))
    s.append(rect(S['panel'], COL['gridLine'], fill=COL['panel'], sw=1.5, op=0.9))
    G = S['grid']
    pitch = S['cell'] + S['gap']
    for c in range(6):
        for r in range(6):
            s.append(rect({'x': G['x'] + c * pitch, 'y': G['y'] + r * pitch, 'w': S['cell'], 'h': S['cell']}, '#2c4270', fill=COL['grid'], sw=1, op=1, rx=6 * k))
    s.append(label(G['x'] + G['w'] / 2, G['y'] - 14 * k if name != 'compact' else G['y'] + 12, f'grid 6x6  cell {S["cell"]} gap {S["gap"]}  ({G["x"]},{G["y"]},{G["w"]}x{G["h"]})', size=round(18 * k), color='#9fb3d9'))
    # sticky + target example cells
    tc, tr = 4, 3
    t = {'x': G['x'] + tc * pitch, 'y': G['y'] + tr * pitch, 'w': S['cell'], 'h': S['cell']}
    s.append(rect(t, '#ffffff', sw=3 * k, dash=f'{8*k},{6*k}', rx=6 * k))
    s.append(label(t['x'] + t['w'] / 2, t['y'] + t['h'] / 2, 'target', size=round(18 * k), color='#ffffff'))
    # horns
    for hr in S.get('frameHorns') or []:
        s.append(rect(hr, COL['cab'], fill=COL['cab'], sw=2, op=0.8, rx=10))
        s.append(label(hr['x'] + hr['w'] / 2, hr['y'] + hr['h'] / 2, 'horn', size=round(16 * k)))
    # logo
    s.append(rect(S['logo'], COL['logo'], sw=2.5, dash='10,6', rx=8))
    s.append(label(S['logo']['x'] + S['logo']['w'] / 2, S['logo']['y'] + S['logo']['h'] / 2, 'LOGO', size=round(26 * k), color=COL['logo']))
    # cabinets
    if S.get('cabinet'):
        s.append(rect(S['cabinet'], COL['cab'], fill=COL['cab'], sw=2, op=0.55, rx=12))
    if S.get('lowerCabinet'):
        s.append(rect(S['lowerCabinet'], COL['cab'], fill=COL['cab'], sw=2, op=0.4, rx=12))
        lc = S['lowerCabinet']
        s.append(label(lc['x'] + lc['w'] / 2, lc['y'] + 26, 'lower cabinet', size=round(16 * k)))
    # mascots
    if S.get('mascots'):
        M = S['mascots']
        for key, col in (('gumbo', COL['mascot']), ('croak', COL['croak'])):
            m = M[key]
            s.append(rect(m, col, sw=3, dash='14,8', rx=4))
            s.append(label(m['x'] + m['w'] / 2, m['y'] + 30, key.upper(), size=round(24 * k), color=col))
            f = m['feet']
            s.append(f'<circle cx="{f["x"]}" cy="{f["y"]}" r="7" fill="{col}"/>')
        b = M.get('booth')
        if b:
            s.append(rect(b, COL['booth'], sw=2.5, dash='6,5', rx=6))
            s.append(label(b['x'] + b['w'] / 2, b['y'] + b['h'] - 22, 'DJ booth', size=round(18 * k), color=COL['booth']))
    # meter
    s.append(meter(S['meter'], k))
    ch = S['meterChip']
    s.append(rect(ch, COL['chip'], fill='#0a0420', sw=2, op=0.9, rx=ch['h'] / 2))
    s.append(label(ch['x'] + ch['w'] / 2, ch['y'] + ch['h'] / 2, 'NEXT DROP 30 · W W' if name != 'compact' else 'NEXT 30 · WW', size=round(ch['h'] * 0.4), color=COL['chip']))
    if isinstance(S.get('fsPlate'), dict):
        fpR = S['fsPlate']
        s.append(rect(fpR, '#35f2e0', fill='#0a0420', sw=2, op=0.8, rx=16))
        s.append(label(fpR['x'] + fpR['w'] / 2, fpR['y'] + fpR['h'] / 2, 'FS PLATE: JUKE JAM 3/8', size=round(20 * k), color='#35f2e0'))
    # sample wild arc and orb path
    m = S['meter']
    ox, oy = m['cx'], m['cy']
    txc, tyc = t['x'] + t['w'] / 2, t['y'] + t['h'] / 2
    apexY = max(S['wildApexMinY'], min(oy, G['y']) - 1.2 * pitch)
    cxp = (ox + txc) / 2
    # quadratic control whose curve peaks exactly at apexY (DESIGN.md section 8.2):
    # y(t) peaks at (y0*y2 - c^2) / (y0 - 2c + y2)  =>  c = apex - sqrt((y0 - apex) * (y2 - apex))
    cyp = apexY - math.sqrt(max(0.0, (oy - apexY) * (tyc - apexY)))
    s.append(f'<path d="M{ox},{oy} Q{cxp:.1f},{cyp:.1f} {txc:.1f},{tyc:.1f}" fill="none" stroke="{COL["arc"]}" stroke-width="{3*k}" stroke-dasharray="{12*k},{8*k}"/>')
    s.append(label(cxp, apexY - 14 * k if apexY > 30 else apexY + 18 * k, 'wild arc (apex y %d, min %d)' % (round(apexY), S['wildApexMinY']), size=round(18 * k), color='#ffffff'))
    # orb path from a far cell
    sx, sy = G['x'] + 5 * pitch + S['cell'] / 2, G['y'] + 5 * pitch + S['cell'] / 2
    mx, my = (sx + ox) / 2, (sy + oy) / 2
    dx, dy = ox - sx, oy - sy
    ln = math.hypot(dx, dy)
    nx, ny = -dy / ln, dx / ln
    lift = 220 * k
    if ny > 0:
        nx, ny = -nx, -ny
    qx, qy = mx + nx * lift, my + ny * lift
    s.append(f'<path d="M{sx:.1f},{sy:.1f} Q{qx:.1f},{qy:.1f} {ox},{oy}" fill="none" stroke="{COL["orb"]}" stroke-width="{2.5*k}" stroke-dasharray="{4*k},{6*k}"/>')
    s.append(f'<circle cx="{sx:.1f}" cy="{sy:.1f}" r="{9*k:.1f}" fill="{COL["orb"]}"/>')
    s.append(label(qx, qy + 20 * k, 'orb path', size=round(18 * k), color=COL['orb']))
    # tumble plate
    tp = S['tumblePlate']
    pw, ph = 300 * tp['scale'] * k, 50 * tp['scale'] * k
    s.append(rect({'x': tp['x'] - pw / 2, 'y': tp['y'] - ph / 2, 'w': pw, 'h': ph}, COL['plate'], fill='#0a0420', sw=2, op=0.8, rx=ph / 2))
    s.append(label(tp['x'], tp['y'], 'tumble win', size=round(18 * k), color=COL['plate']))
    # HUD
    hud = S['hud']
    # visual hex radii as drawn by src/ui/hud/hudLayout.ts (smallButton is the touch target)
    vis = HUD_VISUAL.get(name, HUD_VISUAL['landscape'])
    small_r = vis['small'] if vis['small'] is not None else hud['smallButton'] / 2
    for key in ('autoplay', 'turbo', 'menu', 'betMinus', 'betPlus'):
        p = hud[key]
        s.append(hexagon(p['x'], p['y'], 2 * small_r, COL['hud'], fill='#000000'))
    bb = hud['bonusBuy']
    s.append(hexagon(bb['x'], bb['y'], 2 * vis['buy'], COL['buy'], fill=COL['buy']))
    s.append(label(bb['x'], bb['y'], 'BUY', size=round(18 * k), color='#ffffff'))
    sp = hud['spin']
    spin_r = vis['spin'] if vis['spin'] is not None else sp['size'] * 0.56
    s.append(hexagon(sp['x'], sp['y'], 2 * spin_r, COL['spin'], fill='#000000', tilt=sp['tilt']))
    s.append(label(sp['x'], sp['y'], 'SPIN', size=round(26 * k), color='#ffffff'))
    for key, txt in (('balance', 'BALANCE'), ('betValue', 'BET'), ('win', 'WIN')):
        p = hud[key]
        s.append(label(p['x'], p['y'], txt, size=round(22 * k), color='#f8d828', anchor='start' if key == 'balance' else 'middle'))
    c = S['center']
    s.append(f'<circle cx="{c["x"]}" cy="{c["y"]}" r="6" fill="none" stroke="#ffffff" stroke-width="2"/>')
    s.append(label(12, H - 14, f'Bass Drop · {name} {W}x{H} · generated from layout.json', size=round(16 * max(k, 0.7)), color='#6b6b8a', anchor='start', weight='500'))
    s.append('</svg>')
    (OUT / f'{name}.svg').write_text('\n'.join(s))


def render_screens(name, S):
    """intro + buy wireframes (landscape / portrait only)."""
    if 'intro' not in S:
        return
    W, H = S['size']
    s = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H*2+40}" width="{W}" height="{H*2+40}">',
         f'<rect width="{W}" height="{H*2+40}" fill="#050210"/>']
    # intro
    s.append(f'<rect width="{W}" height="{H}" fill="{COL["bg"]}"/>')
    I = S['intro']
    s.append(rect(I['logo'], COL['logo'], sw=2.5, dash='10,6', rx=8))
    s.append(label(I['logo']['x'] + I['logo']['w'] / 2, I['logo']['y'] + I['logo']['h'] / 2, 'LOGO', size=30, color=COL['logo']))
    titles = [('GROOVE METER', 'Every 10 connections', 'drops a Wild'), ('JUKE JAM', 'Connect 40 symbols', '8 free spins'), ('MEGA MIX', 'Connect 60 symbols', '10 free spins')]
    for card, (t1, t2, t3) in zip(I['cards'], titles):
        s.append(rect(card, '#35f2e0', fill='#120a30', sw=4, op=0.95, rx=22))
        art = {'x': card['x'] + card['w'] * 0.15, 'y': card['y'] + 30, 'w': card['w'] * 0.7, 'h': card['h'] * 0.45}
        if card['w'] > card['h']:
            art = {'x': card['x'] + 30, 'y': card['y'] + 30, 'w': card['w'] * 0.4, 'h': card['h'] - 60}
            tx, ty = card['x'] + card['w'] * 0.72, card['y'] + card['h'] * 0.35
        else:
            tx, ty = card['x'] + card['w'] / 2, card['y'] + card['h'] * 0.62
        s.append(rect(art, '#4b3bff', fill='#1f1650', sw=2, op=1, rx=12))
        s.append(label(art['x'] + art['w'] / 2, art['y'] + art['h'] / 2, 'art slot', size=22, color='#8f86ff'))
        s.append(label(tx, ty, t1, size=40, color='#ffc629', weight='900'))
        s.append(label(tx, ty + 56, t2, size=26))
        s.append(label(tx, ty + 92, t3, size=26))
    p = I['press']
    s.append(label(p['x'], p['y'], 'PRESS TO CONTINUE', size=30, color='#ffffff', weight='800'))
    s.append(label(12, H - 14, f'Intro cards · {name}', size=16, color='#6b6b8a', anchor='start'))
    # buy
    oy = H + 40
    s.append(f'<g transform="translate(0,{oy})">')
    s.append(f'<rect width="{W}" height="{H}" fill="{COL["bg"]}"/>')
    B = S['buy']
    s.append(label(B['title']['x'], B['title']['y'], 'BONUS BUY', size=46, color='#f828c8', weight='900'))
    for card, (t1, t2, t3) in zip(B['cards'], [('JUKE JAM', '8 FREE SPINS', '100x · $100.00'), ('MEGA MIX', '10 FREE SPINS', '300x · $300.00')]):
        s.append(rect(card, '#f828c8', fill='#120a30', sw=4, op=0.95, rx=22))
        art = {'x': card['x'] + card['w'] * 0.12, 'y': card['y'] + 30, 'w': card['w'] * 0.76, 'h': card['h'] * 0.42}
        s.append(rect(art, '#4b3bff', fill='#1f1650', sw=2, op=1, rx=12))
        s.append(label(art['x'] + art['w'] / 2, art['y'] + art['h'] / 2, 'art slot', size=22, color='#8f86ff'))
        cx = card['x'] + card['w'] / 2
        s.append(label(cx, card['y'] + card['h'] * 0.56, t1, size=44, color='#ffc629', weight='900'))
        s.append(label(cx, card['y'] + card['h'] * 0.66, t2, size=28))
        s.append(label(cx, card['y'] + card['h'] * 0.75, t3, size=28, color='#f8d828'))
        btn = {'x': cx - 120, 'y': card['y'] + card['h'] - 100, 'w': 240, 'h': 70}
        s.append(rect(btn, '#ffffff', fill='#f828c8', sw=3, op=1, rx=35))
        s.append(label(cx, btn['y'] + 35, 'BUY', size=30, color='#ffffff', weight='900'))
    cl = B['close']
    s.append(hexagon(cl['x'], cl['y'], 72 if W > 1100 else 120, COL['hud'], fill='#000000'))
    s.append(label(cl['x'], cl['y'], 'X', size=28, color='#ffffff'))
    s.append(label(12, H - 14, f'Bonus buy · {name} (confirm state: chosen card → confirmCard rect, buttons at confirmButtons)', size=16, color='#6b6b8a', anchor='start'))
    s.append('</g>')
    s.append('</svg>')
    (OUT / f'{name}_screens.svg').write_text('\n'.join(s))


for name, S in L['spaces'].items():
    render(name, S)
    render_screens(name, S)
print('ok', sorted(p.name for p in OUT.iterdir()))
