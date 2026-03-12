# core/force_model.py
import math
from physics.models.segment import Segment
from physics.models.tool import Tool
from physics.models.material import Material

DEFAULT_WARNING_FORCE = 200.0
DEFAULT_CRITICAL_FORCE = 400.0


class KienzleForceModel:
    """
    Mechanistic cutting force model based on Kienzle's equation.

    Fc = kc1 * b * h^(1 - mc)

    Where:
        kc1 = specific cutting force constant (N/mm²)
        mc  = Kienzle exponent
        b   = chip width = ap (mm)
        h   = mean chip thickness (mm)
    """

    def __init__(
        self,
        tool: Tool,
        material: Material,
        warning_force: float = DEFAULT_WARNING_FORCE,
        critical_force: float = DEFAULT_CRITICAL_FORCE
    ):
        self.tool = tool
        self.material = material
        self.warning_force = warning_force
        self.critical_force = critical_force

    def calculate(self, segments: list) -> list:
        """Calculate forces for all cutting segments."""
        for seg in segments:
            if not seg.is_cutting or seg.ap <= 0:
                continue
            self._calculate_forces(seg)
        return segments

    def _calculate_forces(self, seg: Segment):
        """Calculate and assign all force components for one segment."""

        # --- Mean chip thickness ---
        h = self._mean_chip_thickness(seg)
        if h <= 0:
            return

        b = seg.ap  # chip width = axial depth of cut

        # --- Kienzle cutting force ---
        seg.fc = self.material.kc1 * b * (h ** (1 - self.material.mc))

        # --- Resolve Fc into Fx and Fy ---
        # Based on tool path direction
        dx = seg.x_end - seg.x_start
        dy = seg.y_end - seg.y_start
        xy_len = math.sqrt(dx ** 2 + dy ** 2)

        engagement_ratio = (
            seg.ae / self.tool.diameter
            if self.tool.diameter > 0 else 0.5
        )

        if xy_len > 1e-6:
            seg.fx = seg.fc * (-dy / xy_len) * engagement_ratio
            seg.fy = seg.fc * (dx / xy_len) * engagement_ratio
        else:
            seg.fx = 0.0
            seg.fy = 0.0

        # --- Axial force Fz ---
        # Approximately 30% of Fc scaled by helix angle
        helix_factor = math.tan(self.tool.helix_angle_rad)
        seg.fz_force = seg.fc * helix_factor * 0.3

        # --- Resultant force ---
        seg.force_magnitude = math.sqrt(
            seg.fc ** 2 + seg.fz_force ** 2
        )

        # --- Torque and Power ---
        seg.torque = seg.fc * self.tool.radius / 1000   # Nm
        omega = (2 * math.pi * seg.spindle_rpm) / 60    # rad/s
        seg.power = seg.torque * omega                   # W

        # --- Chip geometry ---
        seg.chip_thickness_max = (
            seg.fz * math.sin(seg.engagement_angle)
            if seg.engagement_angle > 0 else seg.fz
        )
        seg.chip_thickness_avg = seg.chip_thickness_max * 0.637
        seg.chip_width = seg.ap
        seg.chip_area = seg.chip_thickness_avg * seg.chip_width

        # --- Risk flags ---
        seg.force_warning  = seg.force_magnitude >= self.warning_force
        seg.force_critical = seg.force_magnitude >= self.critical_force

    def _mean_chip_thickness(self, seg: Segment) -> float:
        """Mean uncut chip thickness over the engagement arc."""
        if seg.fz <= 0 or seg.engagement_angle <= 0:
            return seg.fz * 0.5
        return seg.fz * math.sin(seg.engagement_angle / 2)

    def summary(self, segments: list) -> dict:
        """Force summary statistics across all cutting segments."""
        cutting = [s for s in segments if s.is_cutting and s.fc > 0]
        if not cutting:
            return {}
        forces = [s.force_magnitude for s in cutting]
        return {
            'fc_mean':              round(sum(s.fc for s in cutting) / len(cutting), 2),
            'fc_max':               round(max(s.fc for s in cutting), 2),
            'force_magnitude_max':  round(max(forces), 2),
            'force_magnitude_mean': round(sum(forces) / len(cutting), 2),
            'torque_max_Nm':        round(max(s.torque for s in cutting), 3),
            'power_max_W':          round(max(s.power for s in cutting), 1),
            'power_max_kW':         round(max(s.power for s in cutting) / 1000, 3),
            'warning_segments':     sum(1 for s in cutting if s.force_warning),
            'critical_segments':    sum(1 for s in cutting if s.force_critical),
        }
