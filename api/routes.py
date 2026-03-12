# api/routes.py
import sys
import os
from physics.core.toolpath import Toolpath
from physics.core.voxel_grid import VoxelGrid
import numpy as np
from fastapi import APIRouter, UploadFile, File, HTTPException

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from fastapi import APIRouter, UploadFile, File, HTTPException
from api.schemas import (
    SimulationRequest, SimulationResponse,
    SegmentResponse, SimulationSummary, ChipResponse
)
from physics.core.gcode_parser import GCodeParser
from physics.core.stock import Stock
from physics.core.engagement import EngagementCalculator
from physics.core.force_model import KienzleForceModel
from physics.core.chip_geometry import ChipGeometry
from physics.core.toolpath import Toolpath
from physics.models.tool import Tool
from physics.models.material import load_materials

router = APIRouter()

# In-memory simulation state
# In v2 this becomes a proper session/cache
_simulation_state = {
    "segments": [],
    "tool": None,
    "material": None,
}


def _seg_to_response(seg) -> SegmentResponse:
    """Convert a Segment object to API response."""
    return SegmentResponse(
        segment_index=seg.segment_index,
        x_start=seg.x_start,
        y_start=seg.y_start,
        z_start=seg.z_start,
        x_end=seg.x_end,
        y_end=seg.y_end,
        z_end=seg.z_end,
        feed_rate=seg.feed_rate,
        spindle_rpm=seg.spindle_rpm,
        is_cutting=seg.is_cutting,
        ap=seg.ap,
        ae=seg.ae,
        fz=seg.fz,
        fc=seg.fc,
        fx=seg.fx,
        fy=seg.fy,
        fz_force=seg.fz_force,
        force_magnitude=seg.force_magnitude,
        torque=seg.torque,
        power=seg.power,
        chip_thickness_max=seg.chip_thickness_max,
        force_warning=seg.force_warning,
        force_critical=seg.force_critical,
        length=seg.length,
    )


@router.get("/")
def health_check():
    """API health check."""
    return {"status": "ok", "name": "FORGE API", "version": "0.1.0"}


@router.get("/materials")
def get_materials():
    """Return all available materials."""
    materials = load_materials(
        os.path.join(os.path.dirname(__file__), '..', 'physics', 'data', 'materials.json')
    )
    return {
        key: {
            "name": mat.name,
            "kc1": mat.kc1,
            "mc": mat.mc,
            "hardness_HB": mat.hardness_HB
        }
        for key, mat in materials.items()
    }


@router.post("/simulate")
async def simulate(
    file: UploadFile = File(...),
    diameter: float = 10.0,
    num_flutes: int = 4,
    helix_angle: float = 30.0,
    stock_x: float = 100.0,
    stock_y: float = 100.0,
    stock_z: float = 30.0,
    material_key: str = "aluminum_6061",
    warning_force: float = 200.0,
    critical_force: float = 400.0,
):
    """
    Main simulation endpoint.
    Accepts a G-code file + parameters, returns full simulation results.
    """
    # Read uploaded file
    contents = await file.read()
    gcode_str = contents.decode('utf-8', errors='ignore')

    # Build objects
    tool     = Tool(diameter=diameter, num_flutes=num_flutes, helix_angle=helix_angle)
    stock    = Stock(x_max=stock_x, y_max=stock_y, z_min=-stock_z, z_max=0)

    # Load material
    materials = load_materials(
        os.path.join(os.path.dirname(__file__), '..', 'physics', 'data', 'materials.json')
    )
    if material_key not in materials:
        raise HTTPException(status_code=400, detail=f"Unknown material: {material_key}")
    material = materials[material_key]

    # Run pipeline
    segs = GCodeParser().parse_string(gcode_str)
    segs = EngagementCalculator(tool, stock).calculate(segs)

    # Pass 1 — initial force estimate (assumed ae)
    segs = KienzleForceModel(tool, material, warning_force, critical_force).calculate(segs)

    # Pass 2 — voxel grid for true ae
    grid = VoxelGrid(
        x_max=stock_x, y_max=stock_y,
        z_min=-stock_z, z_max=0,
        resolution=1.0
    )

    for seg in segs:
        ae_true, _ = grid.remove_material(seg, tool, seg.force_magnitude)
        if seg.is_cutting and ae_true > 0:
            seg.ae = ae_true

    # Pass 3 — recalculate forces with true ae
    segs = KienzleForceModel(tool, material, warning_force, critical_force).calculate(segs)

    # Store voxel grid state for visualization
    _simulation_state["grid"] = grid

    # Store state for chip endpoint
    _simulation_state["segments"] = segs
    _simulation_state["tool"]     = tool
    _simulation_state["material"] = material

    # Build response
    tp      = Toolpath(segs)
    summary = tp.summary()

    return SimulationResponse(
        summary=SimulationSummary(**summary),
        segments=[_seg_to_response(s) for s in segs]
    )


@router.get("/segments")
def get_segments():
    """Return all segments from last simulation."""
    segs = _simulation_state.get("segments", [])
    if not segs:
        raise HTTPException(status_code=404, detail="No simulation run yet")
    return [_seg_to_response(s) for s in segs]


@router.get("/segment/{index}")
def get_segment(index: int):
    """Return a single segment by index."""
    segs = _simulation_state.get("segments", [])
    if not segs:
        raise HTTPException(status_code=404, detail="No simulation run yet")
    if index >= len(segs):
        raise HTTPException(status_code=404, detail=f"Segment {index} not found")
    return _seg_to_response(segs[index])


@router.get("/chip/{segment_index}")
def get_chip(segment_index: int):
    """Return chip geometry for a specific segment."""
    segs = _simulation_state.get("segments", [])
    tool = _simulation_state.get("tool")

    if not segs or not tool:
        raise HTTPException(status_code=404, detail="No simulation run yet")

    # Find segment
    matching = [s for s in segs if s.segment_index == segment_index]
    if not matching:
        raise HTTPException(status_code=404, detail=f"Segment {segment_index} not found")

    seg  = matching[0]
    chip = ChipGeometry(tool).compute(seg)

    return ChipResponse(**chip)


@router.get("/voxels/{up_to_segment}")
def get_voxels(up_to_segment: int):
    """
    Return voxel state up to a given segment.
    Used by Three.js to render material removal.
    """
    grid = _simulation_state.get("grid")
    if not grid:
        raise HTTPException(status_code=404, detail="No simulation run yet")

    rem_coords, rmv_coords, rmv_forces = grid.get_snapshot(up_to_segment)

    # Downsample if too many voxels for JSON transfer
    # Cap at 5000 points each for performance
    def sample(arr, n=5000):
        if len(arr) == 0:
            return []
        if len(arr) <= n:
            return arr.tolist()
        idx = np.linspace(0, len(arr) - 1, n, dtype=int)
        return arr[idx].tolist()

    return {
        "remaining":      sample(rem_coords),
        "removed":        sample(rmv_coords),
        "removed_forces": sample(rmv_forces) if len(rmv_forces) > 0 else [],
        "removed_pct":    grid.material_removed_pct,
        "total_voxels":   grid.total_voxels,
        "removed_count":  grid.removed_voxels,
    }