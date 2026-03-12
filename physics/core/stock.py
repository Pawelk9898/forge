# core/stock.py
from dataclasses import dataclass


@dataclass
class Stock:
    """
    Rectangular stock block definition.
    Origin is at bottom-left corner.
    Z=0 is the top surface of the stock.
    """
    x_min: float = 0.0
    x_max: float = 100.0
    y_min: float = 0.0
    y_max: float = 100.0
    z_min: float = -50.0        # bottom of stock
    z_max: float = 0.0          # top surface = Z zero

    @property
    def width(self) -> float:
        return self.x_max - self.x_min

    @property
    def depth(self) -> float:
        return self.y_max - self.y_min

    @property
    def height(self) -> float:
        return self.z_max - self.z_min

    def is_inside(self, x: float, y: float, z: float) -> bool:
        """Check if a point is inside the stock block."""
        return (
            self.x_min <= x <= self.x_max and
            self.y_min <= y <= self.y_max and
            self.z_min <= z <= self.z_max
        )

    def axial_depth_at(self, z: float) -> float:
        """
        How deep the tool is below the stock top surface.
        Returns 0 if tool is above stock.
        """
        return max(0.0, self.z_max - z)

    def __repr__(self):
        return (
            f"Stock("
            f"X:{self.x_min}→{self.x_max}, "
            f"Y:{self.y_min}→{self.y_max}, "
            f"Z:{self.z_min}→{self.z_max}, "
            f"{self.width}x{self.depth}x{self.height}mm)"
        )