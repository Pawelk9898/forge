# api/schemas.py
from pydantic import BaseModel
from typing import Optional


class ToolParams(BaseModel):
    diameter: float = 10.0
    num_flutes: int = 4
    helix_angle: float = 30.0


class StockParams(BaseModel):
    x_max: float = 100.0
    y_max: float = 100.0
    z_min: float = -30.0
    z_max: float = 0.0


class SimulationRequest(BaseModel):
    tool: ToolParams
    stock: StockParams
    material_key: str = "aluminum_6061"
    warning_force: float = 200.0
    critical_force: float = 400.0


class SegmentResponse(BaseModel):
    segment_index: int
    x_start: float
    y_start: float
    z_start: float
    x_end: float
    y_end: float
    z_end: float
    feed_rate: float
    spindle_rpm: float
    is_cutting: bool
    ap: float
    ae: float
    fz: float
    fc: float
    fx: float
    fy: float
    fz_force: float
    force_magnitude: float
    torque: float
    power: float
    chip_thickness_max: float
    force_warning: bool
    force_critical: bool
    length: float


class ChipResponse(BaseModel):
    x_crescent: list
    y_crescent: list
    theta_deg: list
    h_theta: list
    h_max: float
    h_avg: float
    chip_width: float
    chip_area: float
    engagement_start_deg: float
    engagement_end_deg: float
    engagement_arc_deg: float
    tool_circle_x: list
    tool_circle_y: list


class SimulationSummary(BaseModel):
    total_segments: int
    cutting_segments: int
    rapid_segments: int
    total_length_mm: float
    cutting_length_mm: float
    max_force_N: float
    mean_force_N: float
    warning_segments: int
    critical_segments: int


class SimulationResponse(BaseModel):
    summary: SimulationSummary
    segments: list[SegmentResponse]