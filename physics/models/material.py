# models/material.py
from dataclasses import dataclass
import json
import os


@dataclass
class Material:
    """
    Workpiece material with Kienzle force model constants.
    kc1: specific cutting force at chip thickness h=1mm (N/mm²)
    mc:  Kienzle exponent (dimensionless, typically 0.2–0.3)
    """
    name: str
    kc1: float
    mc: float
    density: float = 7.85
    hardness_HB: float = 200.0

    def kienzle_kc(self, h: float) -> float:
        """
        Specific cutting force for chip thickness h (mm).
        kc = kc1 * h^(-mc)
        """
        if h <= 0:
            return 0.0
        return self.kc1 * (h ** (-self.mc))

    def __repr__(self):
        return (
            f"Material({self.name}, "
            f"kc1={self.kc1} N/mm², "
            f"mc={self.mc}, "
            f"HB={self.hardness_HB})"
        )


def load_materials(json_path: str = None) -> dict:
    """Load all materials from the JSON database."""
    if json_path is None:
        json_path = os.path.join(
            os.path.dirname(__file__), '..', 'data', 'materials.json'
        )
    with open(json_path, 'r') as f:
        data = json.load(f)

    materials = {}
    for key, values in data.items():
        materials[key] = Material(
            name=values['name'],
            kc1=values['kc1'],
            mc=values['mc'],
            density=values.get('density', 7.85),
            hardness_HB=values.get('hardness_HB', 200)
        )
    return materials


def get_material(key: str, json_path: str = None) -> Material:
    """Get a single material by key."""
    materials = load_materials(json_path)
    if key not in materials:
        raise ValueError(
            f"Material '{key}' not found. "
            f"Available: {list(materials.keys())}"
        )
    return materials[key]
