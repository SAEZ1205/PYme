from __future__ import annotations

from pathlib import Path
import pandas as pd
import streamlit as st

from cybershield import CyberShieldEngine

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"

st.set_page_config(page_title="CyberShield LATAM MVP", page_icon="🛡️", layout="wide")


@st.cache_resource(show_spinner=False)
def get_engine() -> CyberShieldEngine:
    engine = CyberShieldEngine(DATA_DIR)
    engine.load()
    return engine


def demo_cases() -> pd.DataFrame:
    return pd.DataFrame([
        {
            "case_id": 1,
            "identity_id": "IDN-DEMO-001",
            "username": "demo.user",
            "job_role": "Business User",
            "risk_score": 94,
            "risk_level": "CRITICAL",
            "confidence_score": 88,
            "sources": "authentication, endpoint, file_access, network",
            "signal_types": "AUTH_GEO_DEVIATION, FILE_BURST, DUAL_USE_TOOL, NETWORK_EGRESS_BURST",
            "first_seen": "2026-08-10 14:02:00",
            "last_seen": "2026-08-10 14:41:00",
            "signal_count": 7,
            "source_count": 4,
            "behavior_component": 50,
            "correlation_component": 18,
            "asset_component": 18,
            "data_component": 8,
            "alert_component": 0,
        },
        {
            "case_id": 2,
            "identity_id": "IDN-DEMO-002",
            "username": "demo.admin",
            "job_role": "Support Specialist",
            "risk_score": 82,
            "risk_level": "HIGH",
            "confidence_score": 79,
            "sources": "authentication, endpoint, network",
            "signal_types": "AUTH_RARE_ASSET, DUAL_USE_TOOL, NETWORK_EGRESS_BURST",
            "first_seen": "2026-08-11 03:05:00",
            "last_seen": "2026-08-11 03:37:00",
            "signal_count": 5,
            "source_count": 3,
            "behavior_component": 44,
            "correlation_component": 12,
            "asset_component": 20,
            "data_component": 0,
            "alert_component": 6,
        },
    ])


st.title("🛡️ CyberShield LATAM — MVP")
st.caption("Detección contextual + correlación multifuente + priorización explicable para un SOC")

probe = CyberShieldEngine(DATA_DIR)
missing = probe.missing_files()

if missing:
    st.warning("No están los datasets locales. La interfaz está mostrando un MODO DEMO claramente identificado.")
    st.code("python scripts\\download_data.py", language="bat")
    st.write("Archivos pendientes:", ", ".join(missing))
    cases = demo_cases()
    summary = {
        "total_events": 2_844_175,
        "total_signals": 412,
        "total_cases": len(cases),
        "critical_cases": int((cases.risk_level == "CRITICAL").sum()),
        "high_cases": int((cases.risk_level == "HIGH").sum()),
    }
    demo_mode = True
else:
    with st.spinner("Construyendo baseline y correlacionando eventos..."):
        engine = get_engine()
        summary = engine.summary()
        cases = engine.cases(200)
    demo_mode = False

c1, c2, c3, c4, c5 = st.columns(5)
c1.metric("Eventos analizados", f"{summary['total_events']:,}")
c2.metric("Señales", f"{summary['total_signals']:,}")
c3.metric("Investigaciones", f"{summary['total_cases']:,}")
c4.metric("Críticas", f"{summary['critical_cases']:,}")
c5.metric("Altas", f"{summary['high_cases']:,}")

st.subheader("Investigaciones priorizadas")
if cases.empty:
    st.info("No se generaron investigaciones con los criterios actuales.")
    st.stop()

view_cols = [
    "case_id", "risk_level", "risk_score", "confidence_score", "identity_id",
    "username", "job_role", "source_count", "signal_count", "sources", "signal_types"
]
st.dataframe(cases[[c for c in view_cols if c in cases.columns]], use_container_width=True, hide_index=True)

case_ids = cases["case_id"].tolist()
selected_id = st.selectbox("Abrir investigación", case_ids, format_func=lambda x: f"CASE-{int(x):04d}")
case = cases[cases.case_id == selected_id].iloc[0]

st.divider()
left, right = st.columns([2, 1])
with left:
    st.subheader(f"CASE-{int(case['case_id']):04d} · {case['risk_level']} · {int(case['risk_score'])}/100")
    st.write(f"**Identidad:** `{case['identity_id']}` · {case.get('username', '')} · {case.get('job_role', '')}")
    st.write(f"**Ventana:** {case['first_seen']} → {case['last_seen']}")
    st.write(f"**Fuentes:** {case['sources']}")
    st.write(f"**Señales:** {case['signal_types']}")

with right:
    st.metric("Riesgo", f"{int(case['risk_score'])}/100")
    st.metric("Confianza", f"{int(case['confidence_score'])}/100")

st.subheader("¿Por qué obtuvo este riesgo?")
components = pd.DataFrame([
    ["Comportamiento / anomalía", int(case.get("behavior_component", 0)), 50],
    ["Correlación multifuente", int(case.get("correlation_component", 0)), 18],
    ["Criticidad del activo", int(case.get("asset_component", 0)), 20],
    ["Sensibilidad de datos", int(case.get("data_component", 0)), 8],
    ["Alerta auxiliar", int(case.get("alert_component", 0)), 4],
], columns=["Componente", "Puntos", "Máximo"])
st.dataframe(components, use_container_width=True, hide_index=True)

if demo_mode:
    st.subheader("Timeline (demo sintética)")
    st.dataframe(pd.DataFrame([
        ["14:02", "authentication", "AUTH_GEO_DEVIATION", "Login desde ubicación poco habitual"],
        ["14:09", "endpoint", "DUAL_USE_TOOL", "PowerShell; señal débil aislada"],
        ["14:21", "file_access", "FILE_BURST", "Acceso por encima del P95; datos sensibles"],
        ["14:41", "network", "NETWORK_EGRESS_BURST", "Egreso por encima del P95 individual"],
    ], columns=["Hora", "Fuente", "Señal", "Evidencia interpretada"]), use_container_width=True, hide_index=True)
    st.info("Esta timeline es sintética y solo enseña la interfaz. Descarga los CSV para ejecutar el análisis real.")
else:
    st.subheader("Timeline de señales y evidencia")
    signals = engine.case_signals(str(case["identity_id"]), case["case_hour"])
    st.dataframe(signals, use_container_width=True, hide_index=True)

    with st.expander("Ver baseline de esta identidad"):
        baseline = engine.baseline_for_identity(str(case["identity_id"]))
        st.json(baseline)

st.divider()
st.caption(
    "Principio metodológico: una anomalía o alerta NO equivale a ataque confirmado. "
    "El MVP genera hipótesis priorizadas y conserva los IDs de evidencia para investigación humana."
)
