// api.js — talks to the FastAPI backend

const API_BASE = 'http://localhost:8000/api';

const Api = {

  async simulate(file, params) {
    const form = new FormData();
    form.append('file', file);

    const url = new URL(`${API_BASE}/simulate`);
    url.searchParams.set('diameter',      params.diameter);
    url.searchParams.set('num_flutes',    params.num_flutes);
    url.searchParams.set('helix_angle',   params.helix_angle);
    url.searchParams.set('stock_x',       params.stock_x);
    url.searchParams.set('stock_y',       params.stock_y);
    url.searchParams.set('stock_z',       params.stock_z);
    url.searchParams.set('material_key',  params.material_key);
    url.searchParams.set('warning_force', params.warning_force);
    url.searchParams.set('critical_force',params.critical_force);

    const res = await fetch(url.toString(), { method: 'POST', body: form });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Simulation failed');
    }
    return res.json();
  },

  async getChip(segmentIndex) {
    const res = await fetch(`${API_BASE}/chip/${segmentIndex}`);
    if (!res.ok) return null;
    return res.json();
  },

  async getMaterials() {
    const res = await fetch(`${API_BASE}/materials`);
    return res.json();
  }

};