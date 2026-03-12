# core/chip_geometry.py
import math
import numpy as np
from physics.models.segment import Segment
from physics.models.tool import Tool


class ChipGeometry:
    """
    Calculates the cross-sectional geometry of the chip
    for a given toolpath segment.

    The chip cross section is a crescent shape defined by:
    - Chip thickness h(θ) = fz * sin(θ) varying across engagement arc
    - Chip width b = ap (axial depth of cut)
    - Engagement arc from θ_start to θ_end
    """

    def __init__(self, tool: Tool):
        self.tool = tool

    def compute(self, seg: Segment, n_points: int = 100) -> dict:
        """
        Compute chip geometry for a segment.
        Returns a dict with all arrays needed for visualization.
        """
        if not seg.is_cutting or seg.ae <= 0 or seg.fz <= 0:
            return self._empty_result()

        R  = self.tool.radius
        D  = self.tool.diameter
        ae = seg.ae
        fz = seg.fz
        ap = seg.ap

        # --- Engagement arc ---
        ratio       = max(-1.0, min(1.0, 1.0 - (2 * ae / D)))
        theta_start = math.acos(ratio)
        theta_end   = math.pi      # up-milling assumption

        thetas = np.linspace(theta_start, theta_end, n_points)

        # --- Chip thickness at each angle ---
        h = fz * np.sin(thetas)
        h = np.clip(h, 0, None)

        # --- Crescent cross section coordinates ---
        x_inner = R * np.cos(thetas)
        y_inner = R * np.sin(thetas)
        x_outer = (R + h) * np.cos(thetas)
        y_outer = (R + h) * np.sin(thetas)

        # Close the crescent shape
        x_crescent = np.concatenate([x_outer, x_inner[::-1]])
        y_crescent = np.concatenate([y_outer, y_inner[::-1]])

        # --- Tool circle for reference ---
        circle_angles = np.linspace(0, 2 * math.pi, 100)

        return {
            # Crescent shape
            'x_crescent':           x_crescent.tolist(),
            'y_crescent':           y_crescent.tolist(),

            # Polar thickness profile
            'theta_deg':            np.degrees(thetas).tolist(),
            'h_theta':              h.tolist(),

            # Key values
            'h_max':                float(np.max(h)),
            'h_avg':                float(np.mean(h)),
            'chip_width':           ap,
            'chip_area':            float(np.trapezoid(h, thetas) * ap),

            # Engagement info
            'engagement_start_deg': math.degrees(theta_start),
            'engagement_end_deg':   math.degrees(theta_end),
            'engagement_arc_deg':   math.degrees(theta_end - theta_start),

            # Tool circle
            'tool_circle_x':        (R * np.cos(circle_angles)).tolist(),
            'tool_circle_y':        (R * np.sin(circle_angles)).tolist(),
        }

    def _empty_result(self) -> dict:
        return {
            'x_crescent': [],        'y_crescent': [],
            'theta_deg': [],         'h_theta': [],
            'h_max': 0.0,            'h_avg': 0.0,
            'chip_width': 0.0,       'chip_area': 0.0,
            'engagement_start_deg': 0.0,
            'engagement_end_deg': 0.0,
            'engagement_arc_deg': 0.0,
            'tool_circle_x': [],     'tool_circle_y': []
        }
