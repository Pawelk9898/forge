# models/segment.py
from dataclasses import dataclass
import math


@dataclass
class Segment:
    """
    Represents a single G-code toolpath segment.
    Populated progressively: parser → engagement → force model → chip geometry.
    """

    # --- Toolpath geometry ---
    x_start: float = 0.0
    y_start: float = 0.0
    z_start: float = 0.0
    x_end: float = 0.0
    y_end: float = 0.0
    z_end: float = 0.0

    # --- Cutting conditions (from G-code) ---
    feed_rate: float = 0.0
    spindle_rpm: float = 0.0
    is_cutting: bool = False        # False = rapid G0, True = cutting G1/G2/G3

    # --- Engagement ---
    ap: float = 0.0                 # axial depth of cut (mm)
    ae: float = 0.0                 # radial depth of cut (mm)
    fz: float = 0.0                 # feed per tooth (mm/tooth)
    engagement_angle: float = 0.0   # radians

    # --- Forces ---
    fc: float = 0.0                 # tangential cutting force (N)
    fx: float = 0.0                 # force X (N)
    fy: float = 0.0                 # force Y (N)
    fz_force: float = 0.0           # force Z / axial (N)
    force_magnitude: float = 0.0    # resultant force (N)
    torque: float = 0.0             # spindle torque (Nm)
    power: float = 0.0              # cutting power (W)

    # --- Risk flags ---
    force_warning: bool = False
    force_critical: bool = False

    # --- Chip geometry ---
    chip_thickness_max: float = 0.0
    chip_thickness_avg: float = 0.0
    chip_width: float = 0.0
    chip_area: float = 0.0

    # --- Metadata ---
    line_number: int = 0
    segment_index: int = 0

    @property
    def length(self) -> float:
        return math.sqrt(
            (self.x_end - self.x_start) ** 2 +
            (self.y_end - self.y_start) ** 2 +
            (self.z_end - self.z_start) ** 2
        )

    @property
    def is_rapid(self) -> bool:
        return not self.is_cutting

    @property
    def delta_z(self) -> float:
        return self.z_end - self.z_start

    @property
    def is_plunge(self) -> bool:
        return self.delta_z < -0.001

    def __repr__(self):
        return (
            f"Segment({self.segment_index}) "
            f"[{self.x_start:.2f},{self.y_start:.2f},{self.z_start:.2f}] → "
            f"[{self.x_end:.2f},{self.y_end:.2f},{self.z_end:.2f}] "
            f"F={self.feed_rate:.0f} S={self.spindle_rpm:.0f} "
            f"Fc={self.fc:.1f}N"
        )