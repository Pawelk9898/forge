; Outside contour — 10mm endmill, 30% engagement (3mm ae)
; Stock: 100x100x30mm
; Tool center path: 3mm inside stock edge

G21 G17 G90
S8000 M3

; ── Pass 1 — Z-3 ─────────────────────────
G0 X-15 Y-15 Z5
G1 Z-3 F500
G1 X103 Y-15 F1200
G1 X103 Y103 F1200
G1 X-15 Y103 F1200
G1 X-15 Y-15 F1200

; ── Pass 2 — Z-6 ─────────────────────────
G0 Z5
G0 X-15 Y-15
G1 Z-6 F500
G1 X103 Y-15 F1200
G1 X103 Y103 F1200
G1 X-15 Y103 F1200
G1 X-15 Y-15 F1200

G0 Z10
M5