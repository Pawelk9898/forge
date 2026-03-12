# core/toolpath.py
import pandas as pd
from physics.models.segment import Segment


class Toolpath:
    """
    Container for the full list of segments with helper
    methods for filtering, statistics, and export.
    """

    def __init__(self, segments: list):
        self.segments = segments

    @property
    def cutting_segments(self) -> list:
        return [s for s in self.segments if s.is_cutting]

    @property
    def rapid_segments(self) -> list:
        return [s for s in self.segments if s.is_rapid]

    @property
    def warning_segments(self) -> list:
        return [s for s in self.segments if s.force_warning]

    @property
    def critical_segments(self) -> list:
        return [s for s in self.segments if s.force_critical]

    @property
    def total_length(self) -> float:
        return sum(s.length for s in self.segments)

    @property
    def cutting_length(self) -> float:
        return sum(s.length for s in self.cutting_segments)

    @property
    def max_force(self) -> float:
        forces = [s.force_magnitude for s in self.cutting_segments]
        return max(forces) if forces else 0.0

    @property
    def mean_force(self) -> float:
        forces = [s.force_magnitude for s in self.cutting_segments if s.force_magnitude > 0]
        return sum(forces) / len(forces) if forces else 0.0

    def get_segment(self, index: int) -> Segment:
        return self.segments[index]

    def to_dataframe(self) -> pd.DataFrame:
        """Export all segments to a pandas DataFrame."""
        rows = []
        for s in self.segments:
            rows.append({
                'index':              s.segment_index,
                'x_start':            s.x_start,
                'y_start':            s.y_start,
                'z_start':            s.z_start,
                'x_end':              s.x_end,
                'y_end':              s.y_end,
                'z_end':              s.z_end,
                'feed_rate':          s.feed_rate,
                'spindle_rpm':        s.spindle_rpm,
                'is_cutting':         s.is_cutting,
                'ap':                 s.ap,
                'ae':                 s.ae,
                'fz':                 s.fz,
                'fc':                 s.fc,
                'fx':                 s.fx,
                'fy':                 s.fy,
                'fz_force':           s.fz_force,
                'force_magnitude':    s.force_magnitude,
                'torque':             s.torque,
                'power':              s.power,
                'chip_thickness_max': s.chip_thickness_max,
                'force_warning':      s.force_warning,
                'force_critical':     s.force_critical,
                'length':             s.length,
            })
        return pd.DataFrame(rows)

    def summary(self) -> dict:
        return {
            'total_segments':    len(self.segments),
            'cutting_segments':  len(self.cutting_segments),
            'rapid_segments':    len(self.rapid_segments),
            'total_length_mm':   round(self.total_length, 2),
            'cutting_length_mm': round(self.cutting_length, 2),
            'max_force_N':       round(self.max_force, 2),
            'mean_force_N':      round(self.mean_force, 2),
            'warning_segments':  len(self.warning_segments),
            'critical_segments': len(self.critical_segments),
        }

    def __len__(self):
        return len(self.segments)

    def __iter__(self):
        return iter(self.segments)
