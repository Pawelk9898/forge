# models/tool.py
from dataclasses import dataclass
import math


@dataclass
class Tool:
    """
    Cutting tool geometry and parameters.
    """
    diameter: float
    num_flutes: int
    helix_angle: float = 30.0
    corner_radius: float = 0.0
    tool_id: str = "default"
    material: str = "carbide"

    @property
    def radius(self) -> float:
        return self.diameter / 2

    @property
    def helix_angle_rad(self) -> float:
        return math.radians(self.helix_angle)

    def feed_per_tooth(self, feed_rate: float, rpm: float) -> float:
        """fz = feed_rate / (rpm * num_flutes) → mm/tooth"""
        if rpm <= 0 or self.num_flutes <= 0:
            return 0.0
        return feed_rate / (rpm * self.num_flutes)

    def cutting_speed(self, rpm: float) -> float:
        """Surface speed in m/min"""
        return (math.pi * self.diameter * rpm) / 1000

    def __repr__(self):
        return (
            f"Tool(D={self.diameter}mm, "
            f"{self.num_flutes} flutes, "
            f"helix={self.helix_angle}°, "
            f"{self.material})"
        )