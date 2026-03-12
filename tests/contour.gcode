
; Simple rectangular pocket contour
; Tool: 10mm endmill, 4 flutes
; Stock: 100x100x30mm
; Operation: contour - outside profile of a 60x60mm pocket
; Stepover: 5mm (50% of diameter)
; Depth: 3mm per pass

G21 G17 G90
G0 X20 Y20 Z5
S8000 M3

; Pass 1 - depth 3mm
G0 X20 Y20 Z1
G1 Z-3 F500
G1 X80 Y20 F1200
G1 X80 Y80 F1200
G1 X20 Y80 F1200
G1 X20 Y20 F1200

; Step in 5mm for next contour
G0 Z1
G0 X25 Y25
G1 Z-3 F500
G1 X75 Y25 F1200
G1 X75 Y75 F1200
G1 X25 Y75 F1200
G1 X25 Y25 F1200

; Pass 2 - depth 6mm
G0 Z1
G0 X20 Y20
G1 Z-6 F500
G1 X80 Y20 F1200
G1 X80 Y80 F1200
G1 X20 Y80 F1200
G1 X20 Y20 F1200

G0 Z10
M5
