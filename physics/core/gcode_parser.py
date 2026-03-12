# core/gcode_parser.py
import re
from physics.models.segment import Segment

class GCodeParser:
    """
    Parses a G-code file into a list of Segment objects.
    Handles G0 (rapid), G1 (linear feed), modal state tracking.
    """

    def __init__(self):
        self.reset()

    def reset(self):
        self.x = 0.0
        self.y = 0.0
        self.z = 0.0
        self.feed_rate = 0.0
        self.spindle_rpm = 0.0
        self.current_motion = 'G0'
        self.spindle_on = False
        self.absolute_mode = True

    def parse_file(self, filepath: str) -> list:
        """Parse a G-code file and return list of Segments."""
        with open(filepath, 'r') as f:
            lines = f.readlines()
        return self.parse_lines(lines)

    def parse_string(self, gcode: str) -> list:
        """Parse a G-code string and return list of Segments."""
        lines = gcode.strip().split('\n')
        return self.parse_lines(lines)

    def parse_lines(self, lines: list) -> list:
        """Core parsing logic."""
        self.reset()
        segments = []
        segment_index = 0

        for line_number, raw_line in enumerate(lines, start=1):
            line = self._clean_line(raw_line)
            if not line:
                continue

            codes = self._parse_codes(line)
            self._update_state(codes)

            # Extract target position
            x_new = codes.get('X', self.x)
            y_new = codes.get('Y', self.y)
            z_new = codes.get('Z', self.z)

            # Handle incremental mode
            if not self.absolute_mode:
                x_new = self.x + codes.get('X', 0.0)
                y_new = self.y + codes.get('Y', 0.0)
                z_new = self.z + codes.get('Z', 0.0)

            # Update feed and spindle if on this line
            if 'F' in codes:
                self.feed_rate = codes['F']
            if 'S' in codes:
                self.spindle_rpm = codes['S']

            # Only create segment if there is actual movement
            has_movement = (
                abs(x_new - self.x) > 1e-6 or
                abs(y_new - self.y) > 1e-6 or
                abs(z_new - self.z) > 1e-6
            )

            if has_movement:
                is_cutting = (
                    self.current_motion in ('G1', 'G2', 'G3')
                    and self.spindle_on
                )

                seg = Segment(
                    x_start=self.x,
                    y_start=self.y,
                    z_start=self.z,
                    x_end=x_new,
                    y_end=y_new,
                    z_end=z_new,
                    feed_rate=self.feed_rate,
                    spindle_rpm=self.spindle_rpm,
                    is_cutting=is_cutting,
                    line_number=line_number,
                    segment_index=segment_index
                )
                segments.append(seg)
                segment_index += 1

            # Update machine position
            self.x = x_new
            self.y = y_new
            self.z = z_new

        return segments

    def _clean_line(self, line: str) -> str:
        """Remove comments and whitespace."""
        line = re.sub(r'\(.*?\)', '', line)   # parenthetical comments
        line = re.sub(r';.*', '', line)        # semicolon comments
        line = line.lstrip('/')                # block delete
        return line.strip().upper()

    def _parse_codes(self, line: str) -> dict:
        """
        Extract all letter-number pairs from a line.
        'G1 X10.5 Y-3.2 F500' → {'G': 1.0, 'X': 10.5, 'Y': -3.2, 'F': 500.0}
        """
        codes = {}
        pattern = r'([A-Z])([-+]?\d*\.?\d+)'
        for letter, value in re.findall(pattern, line):
            codes[letter] = float(value)
        return codes

    def _update_state(self, codes: dict):
        """Update modal machine state."""
        g = codes.get('G')
        if g is not None:
            g_int = int(g)
            if g_int in (0, 1, 2, 3):
                self.current_motion = f'G{g_int}'
            elif g_int == 90:
                self.absolute_mode = True
            elif g_int == 91:
                self.absolute_mode = False

        m = codes.get('M')
        if m is not None:
            m_int = int(m)
            if m_int in (3, 4):    # spindle on
                self.spindle_on = True
            elif m_int == 5:       # spindle off
                self.spindle_on = False
