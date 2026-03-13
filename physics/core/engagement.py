# core/engagement.py
import math
from physics.models.segment import Segment
from physics.models.tool import Tool
from physics.core.stock import Stock


class EngagementCalculator:
    """
    Calculates axial depth (ap) and radial depth (ae) of cut
    for each segment using stock geometry and tool position.
    """

    def __init__(self, tool: Tool, stock: Stock, default_ae_ratio: float = 0.5):
        """
        tool             : Tool object
        stock            : Stock object
        default_ae_ratio : ae as fraction of tool diameter (0.5 = 50% stepover)
        """
        self.tool = tool
        self.stock = stock
        self.default_ae_ratio = default_ae_ratio

    def calculate(self, segments: list) -> list:
        """
        Enrich all cutting segments with ap, ae, fz, engagement_angle.
        Returns the same list with values filled in.
        """
        for seg in segments:
            if not seg.is_cutting:
                continue
            self._calculate_segment(seg)
        return segments

    def _calculate_segment(self, seg: Segment):
        """Calculate engagement parameters for a single cutting segment."""

        # --- Check if tool is actually inside stock XY bounds ---
        tool_r = self.tool.diameter / 2

        # Tool center path — check if any part of tool overlaps stock
        x_mid = (seg.x_start + seg.x_end) / 2
        y_mid = (seg.y_start + seg.y_end) / 2

        in_stock_x = (x_mid + tool_r) > self.stock.x_min and (x_mid - tool_r) < self.stock.x_max
        in_stock_y = (y_mid + tool_r) > self.stock.y_min and (y_mid - tool_r) < self.stock.y_max
        in_stock_z = seg.z_end < self.stock.z_max and seg.z_end >= self.stock.z_min

        if not (in_stock_x and in_stock_y and in_stock_z):
            # Tool is outside stock — no engagement
            seg.ap = 0.0
            seg.ae = 0.0
            seg.fz = 0.0
            seg.engagement_angle = 0.0
            return

        # --- Axial depth of cut (ap) ---
        z_mid = (seg.z_start + seg.z_end) / 2
        seg.ap = self.stock.axial_depth_at(z_mid)

        # For plunge moves use Z travel
        if seg.is_plunge:
            seg.ap = abs(seg.delta_z)
            seg.ae = 0.0  # plunge has no radial engagement
            seg.fz = self.tool.feed_per_tooth(seg.feed_rate, seg.spindle_rpm)
            seg.engagement_angle = 0.0
            return

        # --- Radial depth of cut (ae) ---
        # How much of tool is inside stock on each side
        ae_x_entry = min(x_mid + tool_r, self.stock.x_max) - max(x_mid - tool_r, self.stock.x_min)
        ae_y_entry = min(y_mid + tool_r, self.stock.y_max) - max(y_mid - tool_r, self.stock.y_min)

        # ae is the smaller overlap (limiting engagement direction)
        raw_ae = min(ae_x_entry, ae_y_entry)
        seg.ae = max(0.0, min(raw_ae, self.tool.diameter))

        # --- Feed per tooth ---
        seg.fz = self.tool.feed_per_tooth(seg.feed_rate, seg.spindle_rpm)

        # --- Engagement angle ---
        if self.tool.diameter > 0 and seg.ae > 0:
            ratio = max(-1.0, min(1.0, 1.0 - (2 * seg.ae / self.tool.diameter)))
            seg.engagement_angle = math.acos(ratio)
        else:
            seg.engagement_angle = 0.0

    def summary(self, segments: list) -> dict:
        """Summary statistics of engagement across all cutting segments."""
        cutting = [s for s in segments if s.is_cutting and s.ap > 0]
        if not cutting:
            return {}
        return {
            'ap_mean': sum(s.ap for s in cutting) / len(cutting),
            'ap_max': max(s.ap for s in cutting),
            'ae_mean': sum(s.ae for s in cutting) / len(cutting),
            'ae_max': max(s.ae for s in cutting),
            'fz_mean': sum(s.fz for s in cutting) / len(cutting),
            'cutting_segments': len(cutting),
            'total_segments': len(segments)
        }
