import os
import numpy as np
import pandas as pd
from scipy.stats import norm
from scipy.optimize import minimize, curve_fit

LOCAL_CSV = os.path.join(os.path.dirname(__file__), "indian_coal_washability_raw.csv")
PARENT_CSV = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "indian_coal_washability_raw.csv"))
DATA_CSV = LOCAL_CSV if os.path.exists(LOCAL_CSV) else PARENT_CSV

def load_indian_samples():
    """Load and summarize all 30 clean Indian coal seams."""
    if not os.path.exists(DATA_CSV):
        return {}
    df = pd.read_csv(DATA_CSV)
    df = df[df["weight_pct"].notna() & df["ash_pct"].notna()].copy()
    df = df[df["sample_id"] != "IND_003"].copy() # isolated sample
    
    samples = {}
    for sid, group in df.groupby("sample_id"):
        grp = group.sort_values("sg_midpoint").reset_index(drop=True)
        wt = grp["weight_pct"].values
        ash = grp["ash_pct"].values
        cum_wt = np.cumsum(wt)
        cum_y = (cum_wt / cum_wt[-1]) * 100.0
        cum_ash = np.cumsum(wt * ash) / np.cumsum(wt)
        feed_ash = float(np.sum(wt * ash) / np.sum(wt))
        
        fractions = []
        for i in range(len(grp)):
            fractions.append({
                "fraction": str(grp.loc[i, "fraction"]),
                "sg_midpoint": round(float(grp.loc[i, "sg_midpoint"]), 3),
                "weight_pct": round(float(grp.loc[i, "weight_pct"]), 2),
                "ash_pct": round(float(grp.loc[i, "ash_pct"]), 2),
                "cum_yield": round(float(cum_y[i]), 2),
                "cum_ash": round(float(cum_ash[i]), 2)
            })
            
        samples[sid] = {
            "sample_id": sid,
            "feed_ash": round(feed_ash, 2),
            "n_fractions": len(grp),
            "sg_range": f"{grp['sg_midpoint'].min():.2f} - {grp['sg_midpoint'].max():.2f}",
            "fractions": fractions
        }
    return samples

def lognormal_yield(rho, mu, sigma):
    return norm.cdf((np.log(rho) - mu) / sigma) * 100.0

def ash_density_model(rho, a, b):
    return a + b / rho

def get_empirical_prior(feed_ash):
    mu = 0.004190 * feed_ash + 0.322305
    sigma = max(0.01, 0.006100 * feed_ash - 0.039091)
    a = 1.835040 * feed_ash + 94.576353
    b = -2.431098 * feed_ash - 120.146879
    return mu, sigma, a, b

def solve_parameters(feed_ash, cut_points):
    """
    Solves (mu, sigma, a, b) based on number of known cut points:
    k = 0: Empirical prior
    k = 1: Bounded L-BFGS-B anchor for mu, analytical b
    k = 2: Exact closed-form analytical solution
    k > 2: Regularized bounded least squares
    """
    mu_prior, sigma_prior, a_prior, b_prior = get_empirical_prior(feed_ash)
    k = len(cut_points) if cut_points else 0
    
    if k == 0:
        return mu_prior, sigma_prior, a_prior, b_prior, "Stage 1 (Empirical Prior, 0 Cuts)"
        
    elif k == 1:
        pt = cut_points[0]
        sg_anc = float(pt["sg"])
        y_anc = float(pt["yield_pct"])
        ash_anc = float(pt["ash_pct"]) if "ash_pct" in pt and pt["ash_pct"] is not None else None
        
        # Re-solve mu
        def loss_mu(m):
            pred = lognormal_yield(sg_anc, m[0], sigma_prior)
            return (pred - y_anc) ** 2
            
        res = minimize(loss_mu, x0=[mu_prior], bounds=[(np.log(1.20), np.log(2.50))], method="L-BFGS-B")
        mu_sol = float(res.x[0])
        sigma_sol = sigma_prior
        a_sol = a_prior
        if ash_anc is not None:
            b_sol = float((ash_anc - a_sol) * sg_anc)
        else:
            b_sol = b_prior
        return mu_sol, sigma_sol, a_sol, b_sol, "Stage 2 (Single-Cut Anchor)"
        
    elif k == 2:
        # Sort by SG
        pts = sorted(cut_points, key=lambda x: float(x["sg"]))
        r1, y1 = float(pts[0]["sg"]), float(pts[0]["yield_pct"])
        r2, y2 = float(pts[1]["sg"]), float(pts[1]["yield_pct"])
        
        # Clamp yields slightly to prevent z -> +/- infinity
        y1_c = np.clip(y1, 0.5, 99.5)
        y2_c = np.clip(y2, y1_c + 0.5, 99.8)
        
        z1 = norm.ppf(y1_c / 100.0)
        z2 = norm.ppf(y2_c / 100.0)
        
        # Exact analytical solution
        sigma_sol = (np.log(r2) - np.log(r1)) / (z2 - z1)
        sigma_sol = float(np.clip(sigma_sol, 0.05, 0.60))
        mu_sol = float(np.log(r1) - z1 * sigma_sol)
        
        # Ash analytical solve if ash provided
        if "ash_pct" in pts[0] and "ash_pct" in pts[1] and pts[0]["ash_pct"] is not None and pts[1]["ash_pct"] is not None:
            a1, a2 = float(pts[0]["ash_pct"]), float(pts[1]["ash_pct"])
            b_sol = float((a2 - a1) / ((1.0 / r2) - (1.0 / r1)))
            a_sol = float(a1 - b_sol / r1)
        else:
            a_sol, b_sol = a_prior, b_prior
            
        return mu_sol, sigma_sol, a_sol, b_sol, "Stage 3 (2-Cut Exact Analytical Inversion)"
        
    else:
        # Multi-cut k > 2: Bounded least squares
        sgs = np.array([float(p["sg"]) for p in cut_points])
        ys = np.array([float(p["yield_pct"]) for p in cut_points])
        
        def loss_multi(params):
            m, s = params
            pred = lognormal_yield(sgs, m, s)
            mse = np.mean((pred - ys) ** 2)
            reg = 0.02 * ((m - mu_prior)**2 + (s - sigma_prior)**2)
            return mse + reg
            
        res = minimize(loss_multi, x0=[mu_prior, sigma_prior], 
                       bounds=[(np.log(1.20), np.log(2.50)), (0.05, 0.60)], method="L-BFGS-B")
        mu_sol, sigma_sol = float(res.x[0]), float(res.x[1])
        
        # Ash fit if points available
        ash_pts = [(float(p["sg"]), float(p["ash_pct"])) for p in cut_points if "ash_pct" in p and p["ash_pct"] is not None]
        if len(ash_pts) >= 2:
            r_ash = np.array([p[0] for p in ash_pts])
            a_val = np.array([p[1] for p in ash_pts])
            try:
                popt, _ = curve_fit(ash_density_model, r_ash, a_val, p0=[a_prior, b_prior], maxfev=2000)
                a_sol, b_sol = float(popt[0]), float(popt[1])
            except Exception:
                a_sol, b_sol = a_prior, b_prior
        else:
            a_sol, b_sol = a_prior, b_prior
            
        return mu_sol, sigma_sol, a_sol, b_sol, f"Multi-Pointer Calibration ({k} Cuts)"

def compute_washability_spectrum(mu, sigma, a, b, rho_min=1.28, rho_max=2.40, n_points=250):
    """Computes all 4 continuous washability curves on a uniform density grid."""
    rho_grid = np.linspace(rho_min, rho_max, n_points)
    
    # Cumulative Float Yield
    cum_float_yield = np.clip(lognormal_yield(rho_grid, mu, sigma), 0.0, 100.0)
    
    # Fractional Ash with physical floor
    raw_ash = ash_density_model(rho_grid, a, b)
    frac_ash = np.clip(raw_ash, 2.50, 95.0)
    
    # Discrete Incremental Yields
    diff_yield = np.diff(cum_float_yield, prepend=cum_float_yield[0])
    diff_yield = np.clip(diff_yield, 1e-6, None)
    
    # Cumulative Float Ash (Yield-Ash)
    cum_float_ash = np.cumsum(diff_yield * frac_ash) / np.cumsum(diff_yield)
    
    # Cumulative Sink Curve
    cum_sink_yield = 100.0 - cum_float_yield
    rev_diff = diff_yield[::-1]
    rev_ash = frac_ash[::-1]
    cum_sink_ash = (np.cumsum(rev_diff * rev_ash) / np.cumsum(rev_diff))[::-1]
    
    return {
        "rho": [round(float(x), 4) for x in rho_grid],
        "cum_float_yield": [round(float(x), 2) for x in cum_float_yield],
        "frac_ash": [round(float(x), 2) for x in frac_ash],
        "cum_float_ash": [round(float(x), 2) for x in cum_float_ash],
        "cum_sink_yield": [round(float(x), 2) for x in cum_sink_yield],
        "cum_sink_ash": [round(float(x), 2) for x in cum_sink_ash]
    }

def compute_operational_kpis(spectrum, target_clean_ash=17.0):
    """Calculates cut density d50, achievable yield, rejection ash, and Near-Gravity Material."""
    rho = np.array(spectrum["rho"])
    y_float = np.array(spectrum["cum_float_yield"])
    ash_float = np.array(spectrum["cum_float_ash"])
    ash_sink = np.array(spectrum["cum_sink_ash"])
    
    # Find d50 where cumulative float ash equals target_clean_ash
    if target_clean_ash is not None and np.min(ash_float) <= target_clean_ash <= np.max(ash_float):
        idx = int(np.argmin(np.abs(ash_float - target_clean_ash)))
        d50 = float(rho[idx])
        clean_yield = float(y_float[idx])
        clean_ash = float(ash_float[idx])
        reject_ash = float(ash_sink[idx])
    else:
        # Default cut at SG 1.58
        idx = int(np.argmin(np.abs(rho - 1.58)))
        d50 = float(rho[idx])
        clean_yield = float(y_float[idx])
        clean_ash = float(ash_float[idx])
        reject_ash = float(ash_sink[idx])
        
    # Near Gravity Material: yield within +/- 0.10 SG
    idx_low = int(np.argmin(np.abs(rho - (d50 - 0.10))))
    idx_high = int(np.argmin(np.abs(rho - (d50 + 0.10))))
    ngm = float(y_float[idx_high] - y_float[idx_low])
    ngm_class = "Refractory / Very Difficult" if ngm > 20.0 else ("Difficult" if ngm > 10.0 else "Simple / Easy")
    
    return {
        "cut_density_d50": round(d50, 3),
        "clean_coal_yield": round(clean_yield, 2),
        "clean_coal_ash": round(clean_ash, 2),
        "reject_ash": round(reject_ash, 2),
        "near_gravity_material": round(ngm, 1),
        "ngm_classification": ngm_class
    }
