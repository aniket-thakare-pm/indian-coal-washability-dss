import os
import io
import time
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse, StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List, Optional

from engine import (
    load_indian_samples,
    solve_parameters,
    compute_washability_spectrum,
    compute_operational_kpis,
    lognormal_yield
)

app = FastAPI(title="Indian Coal Washability Decision Support System (ICW-DSS)", version="1.2.4")

# Load samples into memory
SAMPLES_CACHE = load_indian_samples()

class CutPoint(BaseModel):
    sg: float
    yield_pct: float
    ash_pct: Optional[float] = None

class CalculateRequest(BaseModel):
    feed_ash: float
    sample_id: Optional[str] = None
    target_clean_ash: Optional[float] = 17.0
    cut_points: Optional[List[CutPoint]] = []

@app.get("/api/samples")
def get_samples():
    """Returns catalog of all 30 verified Indian coal seams."""
    return list(SAMPLES_CACHE.values())

@app.get("/api/sample/{sample_id}")
def get_sample_details(sample_id: str):
    """Returns discrete laboratory float-sink data for a specific sample."""
    if sample_id not in SAMPLES_CACHE:
        raise HTTPException(status_code=404, detail="Sample not found")
    return SAMPLES_CACHE[sample_id]

@app.post("/api/calculate")
def calculate_washability(req: CalculateRequest):
    """Calculates model parameters, full 4-curve spectrum, and operational KPIs."""
    t0 = time.time()
    cuts = [cp.model_dump() for cp in req.cut_points] if req.cut_points else []
    
    # Solve parameters
    mu, sigma, a, b, mode = solve_parameters(req.feed_ash, cuts)
    
    # Generate 4-curve spectrum
    spectrum = compute_washability_spectrum(mu, sigma, a, b, n_points=250)
    
    # Compute Plant KPIs
    kpis = compute_operational_kpis(spectrum, req.target_clean_ash)
    
    # Compute MAE if actual sample provided
    mae_yield = None
    mae_ash = None
    actual_points = []
    
    if req.sample_id and req.sample_id in SAMPLES_CACHE:
        sdata = SAMPLES_CACHE[req.sample_id]
        actual_points = sdata["fractions"]
        
        # Calculate MAE against actual fractions
        sgs = [f["sg_midpoint"] for f in actual_points]
        y_act = [f["cum_yield"] for f in actual_points]
        y_pred = [float(lognormal_yield(s, mu, sigma)) for s in sgs]
        mae_yield = round(float(sum(abs(y - p) for y, p in zip(y_act, y_pred)) / len(y_act)), 2)
        
    calc_time_ms = round((time.time() - t0) * 1000, 2)
    
    return {
        "status": "success",
        "calibration_mode": mode,
        "calculation_time_ms": calc_time_ms,
        "parameters": {
            "mu": round(mu, 4),
            "sigma": round(sigma, 4),
            "a": round(a, 2),
            "b": round(b, 2)
        },
        "kpis": kpis,
        "metrics": {
            "yield_mae": mae_yield,
            "uncertainty_drop_pct": round(((6.98 - mae_yield)/6.98)*100, 1) if mae_yield and mae_yield < 6.98 else None
        },
        "spectrum": spectrum,
        "actual_points": actual_points
    }

@app.post("/api/export/csv")
def export_csv(req: CalculateRequest):
    """Generates a downloadable CSV of the calculated washability table."""
    cuts = [cp.model_dump() for cp in req.cut_points] if req.cut_points else []
    mu, sigma, a, b, _ = solve_parameters(req.feed_ash, cuts)
    spectrum = compute_washability_spectrum(mu, sigma, a, b, n_points=250)
    
    df_out = pd.DataFrame({
        "Specific_Gravity": spectrum["rho"],
        "Cumulative_Float_Yield_pct": spectrum["cum_float_yield"],
        "Elementary_Fractional_Ash_pct": spectrum["frac_ash"],
        "Cumulative_Float_Ash_pct": spectrum["cum_float_ash"],
        "Cumulative_Sink_Yield_pct": spectrum["cum_sink_yield"],
        "Cumulative_Sink_Ash_pct": spectrum["cum_sink_ash"]
    })
    
    stream = io.StringIO()
    df_out.to_csv(stream, index=False)
    stream.seek(0)
    
    filename = f"washability_{req.sample_id or 'custom'}_{int(req.feed_ash)}pct_ash.csv"
    return StreamingResponse(
        io.BytesIO(stream.getvalue().encode('utf-8')),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

# Static files mount
static_dir = os.path.join(os.path.dirname(__file__), "static")
app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
