# physics/core/voxel_grid.py
import numpy as np
from physics.models.tool import Tool


class VoxelGrid:
    """
    3D voxel grid representing stock material.
    
    Coordinate system matches G-code:
      X: 0 → stock_x
      Y: 0 → stock_y  
      Z: z_min → 0 (z_min is negative, e.g. -30)
    
    Each voxel is 1mm³ at default resolution.
    material[ix, iy, iz] = True  → material present
    material[ix, iy, iz] = False → removed
    """

    def __init__(self, x_max, y_max, z_min, z_max=0, resolution=1.0):
        self.x_max      = x_max
        self.y_max      = y_max
        self.z_min      = z_min
        self.z_max      = z_max
        self.resolution = resolution

        # Grid dimensions
        self.nx = int(np.ceil(x_max      / resolution))
        self.ny = int(np.ceil(y_max      / resolution))
        self.nz = int(np.ceil((z_max - z_min) / resolution))

        # Material array — all True (full stock) at start
        self.material = np.ones((self.nx, self.ny, self.nz), dtype=bool)

        # Force heatmap — stores force value per voxel when removed
        self.force_map = np.zeros((self.nx, self.ny, self.nz), dtype=np.float32)

        # Removal order — which segment removed each voxel
        self.removal_seg = np.full((self.nx, self.ny, self.nz), -1, dtype=np.int32)

    # ── Coordinate helpers ────────────────────────────────

    def _to_indices(self, x, y, z):
        """Convert world coordinates to voxel indices."""
        ix = int(np.clip(x / self.resolution, 0, self.nx - 1))
        iy = int(np.clip(y / self.resolution, 0, self.ny - 1))
        iz = int(np.clip((z - self.z_min) / self.resolution, 0, self.nz - 1))
        return ix, iy, iz

    def _to_world(self, ix, iy, iz):
        """Convert voxel indices to world coordinates (voxel center)."""
        x = (ix + 0.5) * self.resolution
        y = (iy + 0.5) * self.resolution
        z = self.z_min + (iz + 0.5) * self.resolution
        return x, y, z

    # ── Core operation ────────────────────────────────────

    def remove_material(self, seg, tool: Tool, force_magnitude: float = 0.0):
        """
        Simulate material removal for one cutting segment.
        
        Finds all voxels inside the tool cylinder swept along the segment,
        removes them, records force value, returns true ae.
        
        Returns:
            ae_true (float): true radial engagement in mm
            removed_count (int): number of voxels removed
        """
        if not seg.is_cutting:
            return 0.0, 0

        R  = tool.diameter / 2.0
        ap = abs(seg.ap)  # axial depth — always positive

        if ap <= 0:
            return 0.0, 0

        # Tool path direction vector
        dx = seg.x_end - seg.x_start
        dy = seg.y_end - seg.y_start
        seg_len = np.sqrt(dx**2 + dy**2)

        if seg_len < 0.001:
            return 0.0, 0

        # Unit vector along segment (XY plane only)
        ux = dx / seg_len
        uy = dy / seg_len

        # Z range of cut
        z_bottom = seg.z_start - ap
        z_top    = seg.z_start

        # Bounding box of swept cylinder in XY
        # Center moves from (x_start, y_start) to (x_end, y_end)
        x_min_w = min(seg.x_start, seg.x_end) - R
        x_max_w = max(seg.x_start, seg.x_end) + R
        y_min_w = min(seg.y_start, seg.y_end) - R
        y_max_w = max(seg.y_start, seg.y_end) + R

        # Convert to voxel index range
        ix_min = max(0, int(x_min_w / self.resolution))
        ix_max = min(self.nx - 1, int(x_max_w / self.resolution) + 1)
        iy_min = max(0, int(y_min_w / self.resolution))
        iy_max = min(self.ny - 1, int(y_max_w / self.resolution) + 1)
        iz_min = max(0, int((z_bottom - self.z_min) / self.resolution))
        iz_max = min(self.nz - 1, int((z_top - self.z_min) / self.resolution) + 1)

        removed_count = 0
        max_lateral   = 0.0  # track maximum lateral distance for ae

        # Check each voxel in bounding box
        for ix in range(ix_min, ix_max + 1):
            for iy in range(iy_min, iy_max + 1):
                # Voxel center XY
                vx = (ix + 0.5) * self.resolution
                vy = (iy + 0.5) * self.resolution

                # Distance from voxel center to tool path line (XY)
                # Project voxel onto segment direction
                px  = vx - seg.x_start
                py  = vy - seg.y_start
                t   = np.clip(px * ux + py * uy, 0, seg_len)
                # Closest point on segment to voxel
                cx  = seg.x_start + t * ux
                cy  = seg.y_start + t * uy
                # Lateral distance
                dist = np.sqrt((vx - cx)**2 + (vy - cy)**2)

                if dist > R:
                    continue  # outside tool radius

                # Track max lateral offset for ae calculation
                max_lateral = max(max_lateral, dist)

                # Check Z range
                for iz in range(iz_min, iz_max + 1):
                    if not self.material[ix, iy, iz]:
                        continue  # already removed

                    vz = self.z_min + (iz + 0.5) * self.resolution
                    if vz < z_bottom or vz > z_top:
                        continue

                    # Remove voxel
                    self.material[ix, iy, iz]    = False
                    self.force_map[ix, iy, iz]   = force_magnitude
                    self.removal_seg[ix, iy, iz] = seg.segment_index
                    removed_count += 1

        # True ae = diameter - (min distance from tool center to untouched material)
        # Approximated as: 2 * (R - min_lateral_distance_to_remaining_material)
        # Simpler: count removed columns in XY → width of cut
        ae_true = self._calculate_ae(
            seg, R, seg_len, ux, uy,
            ix_min, ix_max, iy_min, iy_max
        )

        return ae_true, removed_count

    def _calculate_ae(self, seg, R, seg_len, ux, uy,
                    ix_min, ix_max, iy_min, iy_max):
        """
        Calculate true radial engagement (ae).
        
        ae = how far into remaining material the tool actually cut.
        Measured as the width of the newly removed material in the
        direction perpendicular to feed.
        """
        # Perpendicular to feed direction (left side of cut)
        perp_x = -uy
        perp_y =  ux

        # Collect signed lateral offsets of voxels removed by THIS segment
        offsets = []

        for ix in range(ix_min, ix_max + 1):
            for iy in range(iy_min, iy_max + 1):
                # Only count voxels removed by this segment
                col = self.removal_seg[ix, iy, :]
                if not np.any(col == seg.segment_index):
                    continue

                vx = (ix + 0.5) * self.resolution
                vy = (iy + 0.5) * self.resolution

                # Project onto perpendicular direction
                px     = vx - seg.x_start
                py     = vy - seg.y_start
                offset = px * perp_x + py * perp_y
                offsets.append(offset)

        if not offsets:
            return 0.0

        # ae = spread of removed material in perpendicular direction
        ae = max(offsets) - min(offsets) + self.resolution
        return float(np.clip(ae, 0, R * 2))

    # ── Query methods ─────────────────────────────────────

    def get_remaining_material(self):
        """Return array of (x, y, z) world coords of remaining voxels."""
        indices = np.argwhere(self.material)
        if len(indices) == 0:
            return np.array([])
        coords = np.column_stack([
            (indices[:, 0] + 0.5) * self.resolution,
            (indices[:, 1] + 0.5) * self.resolution,
            self.z_min + (indices[:, 2] + 0.5) * self.resolution,
        ])
        return coords

    def get_removed_voxels(self):
        """Return (coords, forces) for all removed voxels."""
        indices = np.argwhere(~self.material)
        if len(indices) == 0:
            return np.array([]), np.array([])
        coords = np.column_stack([
            (indices[:, 0] + 0.5) * self.resolution,
            (indices[:, 1] + 0.5) * self.resolution,
            self.z_min + (indices[:, 2] + 0.5) * self.resolution,
        ])
        forces = self.force_map[
            indices[:, 0],
            indices[:, 1],
            indices[:, 2]
        ]
        return coords, forces

    def get_snapshot(self, up_to_segment: int):
        """
        Return voxel state after processing segments 0..up_to_segment.
        Returns (remaining_coords, removed_coords, removed_forces)
        """
        remaining = np.argwhere(self.material)
        removed   = np.argwhere(
            (~self.material) & (self.removal_seg <= up_to_segment)
        )

        def to_world(idx):
            if len(idx) == 0:
                return np.array([]).reshape(0, 3)
            return np.column_stack([
                (idx[:, 0] + 0.5) * self.resolution,
                (idx[:, 1] + 0.5) * self.resolution,
                self.z_min + (idx[:, 2] + 0.5) * self.resolution,
            ])

        rem_coords  = to_world(remaining)
        rem_forces  = np.zeros(len(remaining))

        rmv_coords  = to_world(removed)
        rmv_forces  = self.force_map[
            removed[:, 0], removed[:, 1], removed[:, 2]
        ] if len(removed) > 0 else np.array([])

        return rem_coords, rmv_coords, rmv_forces

    @property
    def total_voxels(self):
        return self.nx * self.ny * self.nz

    @property
    def removed_voxels(self):
        return int(np.sum(~self.material))

    @property
    def material_removed_pct(self):
        return (self.removed_voxels / self.total_voxels) * 100