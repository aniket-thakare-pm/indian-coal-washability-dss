# Indian Coal Washability Decision Support System (ICW-DSS v1.2)

[![FastAPI](https://img.shields.io/badge/Backend-FastAPI-009688.svg?style=flat&logo=fastapi)](https://fastapi.tiangolo.com/)
[![Plotly](https://img.shields.io/badge/Charts-Plotly.js-3F4F75.svg?style=flat&logo=plotly)](https://plotly.com/javascript/)
[![License](https://img.shields.io/badge/License-Academic%20Research-blue.svg)]()

> **Master's Thesis Research Project**  
> **Author:** Aniket Thakare (Roll No: 22MI31003)  
> **Supervisor:** Prof. Arun Kumar Majumder  
> **Institution:** Department of Mining Engineering, Indian Institute of Technology Kharagpur  

---

## 📌 Overview
The **Indian Coal Washability Decision Support System (ICW-DSS v1.2.4)** is an interactive computational platform designed to predict and reconstruct the canonical **Four-Curve Coal Washability System (IS 9209 / SME Standard)** for high-ash Indian Gondwana coals from minimal operational inputs.

Unlike Northern Hemisphere Carboniferous coals, Indian coals originate from allochthonous drift sedimentation and carry high intimately dispersed mineral matter (35%–50% feed ash) with refractory Near-Gravity Material (NGM). This system implements a physically bounded, continuous parametric model calibrated across **30 domestic Indian coal seams** (Damodar Valley, Raniganj, and Wardha Valley basins).

---

## 🚀 Key Features
- **Continuous Empirical Prior (0 Cuts):** Predicts complete washability curves purely from raw Feed Ash ($A_f$) via continuous regression equations discovered across 30 Indian seams.
- **Single-Cut Anchor (1 Cut):** Pins the lognormal location parameter ($\mu$) and ash slope ($b$) to a single routine plant test density.
- **Exact Analytical Closed-Form Inversion (2 Cuts):** Solves all four parameters $(\mu, \sigma, a, b)$ instantaneously in **$< 2\text{ ms}$** without numerical iteration.
- **Interactive 4-Axis Washability Diagram:** Dual-Y and dual-X standard SME / IS 9209 diagram with inverted recovery scales and ground-truth laboratory overlays.
- **Operational Plant KPIs:** Automated calculation of separation cut density ($d_{50}$), clean coal yield recovery, discard ash, and Near-Gravity Material (NGM $\pm 0.10$ SG) difficulty classification.
- **Data Export:** One-click standardized 250-point washability CSV export.

---

## 🛠 Local Installation & Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/aniket-thakare-pm/indian-coal-washability-dss.git
   cd indian-coal-washability-dss
   ```

2. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

3. **Launch the web application:**
   ```bash
   python -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
   ```

4. **Open in browser:**
   Navigate to [http://127.0.0.1:8000](http://127.0.0.1:8000).

---

## ☁ Cloud Deployment Options

### Option 1: Render.com (Recommended Free Hosting)
1. Sign up at [Render.com](https://render.com) and click **New → Web Service**.
2. Connect your GitHub repository: `indian-coal-washability-dss`.
3. Configure settings:
   - **Environment:** `Python 3`
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `uvicorn main:app --host 0.0.0.0 --port $PORT`
4. Click **Create Web Service**. Your app will be live at `https://<your-app>.onrender.com`.

### Option 2: Vercel
1. Install Vercel CLI: `npm i -g vercel`
2. Run `vercel` in the root directory (uses the pre-configured `vercel.json`).

---

## 📄 Citation & Academic References
If utilizing this methodology, please reference:
- Thakare, A. (2026). *Development of an India-Specific Parametric Model for Predicting Coal Washability Characteristics from Minimal Experimental Data*. Dual Degree Thesis, Department of Mining Engineering, IIT Kharagpur. Supervised by Prof. A. K. Majumder.
