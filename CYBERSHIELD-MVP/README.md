# CyberShield LATAM — MVP

MVP para el reto de ciberseguridad de ADG. El objetivo no es etiquetar cada fila como ataque/no ataque, sino transformar millones de eventos en un conjunto pequeño de **investigaciones priorizadas, explicables y trazables**.

## Qué hace

1. Lee las 8 fuentes oficiales del reto desde CSV.
2. Construye baseline por identidad con contexto declarado y comportamiento histórico.
3. Genera señales de desviación sin asumir que son ataques.
4. Correlaciona señales por identidad y ventana temporal.
5. Calcula un `Risk Score` explicable de 0 a 100.
6. Muestra casos priorizados y la evidencia que los sustenta.

## Principio contra sesgo

- `anomalía != ataque`
- `alerta != ground truth`
- PowerShell, una IP extranjera o un horario nocturno no se consideran maliciosos por sí solos.
- Cada señal tiene un peso limitado y gana relevancia cuando aparece junto con otras fuentes/contexto.
- El sistema produce **hipótesis de investigación**, no veredictos automáticos.

## Matemática del MVP

### Baseline

Para variables categóricas se usan frecuencias históricas:

`frequency(country | identity) = count(country, identity) / count(identity)`

Para variables de volumen se usan estadísticas robustas:

- mediana
- percentil 95 (P95)

Ejemplo: un burst de archivos se activa cuando la actividad de una hora supera el P95 propio de esa identidad y un umbral mínimo para evitar ruido.

### Risk Score

Cada investigación suma cinco componentes, todos trazables:

- Comportamiento/anomalía: máximo 50 puntos.
- Correlación multifuente: máximo 18 puntos.
- Criticidad del activo: máximo 20 puntos.
- Sensibilidad de datos: máximo 8 puntos.
- Alerta de seguridad auxiliar: máximo 4 puntos.

`risk = min(100, behavior + correlation + asset + data + alert)`

Clasificación:

- 0–44: LOW
- 45–69: MEDIUM
- 70–89: HIGH
- 90–100: CRITICAL

El score NO es CVSS. CVSS puntúa vulnerabilidades; este modelo puntúa prioridad de investigación basada en comportamiento y contexto.

## Señales implementadas

- `AUTH_GEO_DEVIATION`: geografía distinta o poco frecuente.
- `AUTH_TIME_DEVIATION`: autenticación fuera del horario de referencia.
- `AUTH_RARE_ASSET`: activo observado muy pocas veces para la identidad.
- `PRIVILEGE_MISMATCH`: privilegio P0/P1 usado por identidad P2/P3/P4.
- `FILE_BURST`: acceso a archivos por encima del P95 individual.
- `NETWORK_EGRESS_BURST`: bytes enviados por encima del P95 individual y 100 MB.
- `DUAL_USE_TOOL`: PowerShell/SSH/curl/tar/etc.; señal de bajo peso, nunca veredicto.
- `CLOUD_ROLE_DEVIATION`: operación IAM/roles/policies poco alineada con el rol declarado.
- `SECURITY_ALERT_SUPPORT`: alerta HIGH/CRITICAL como evidencia auxiliar.

## Fuentes de datos oficiales

Los CSV no se suben al repo por tamaño. `scripts/download_data.py` usa los IDs del Drive oficial para descargarlos en `data/`:

- identity_context.csv
- asset_inventory.csv
- authentication_logs.csv
- endpoint_events.csv
- file_access.csv
- network_flows.csv
- cloud_activity.csv
- security_alerts.csv

## Demo rápida en Windows

Desde CMD:

```bat
git clone https://github.com/SAEZ1205/PYme.git
cd PYme\CYBERSHIELD-MVP
demo.bat
```

`demo.bat` abre la interfaz. Si todavía no descargaste los CSV, la app muestra un **modo demo sintético claramente marcado** para que puedas ver el producto.

## Ejecutar con datos reales

```bat
cd PYme\CYBERSHIELD-MVP
start_real.bat
```

Ese script:

1. crea `.venv`;
2. instala dependencias;
3. descarga los 8 CSV desde Drive;
4. construye baseline y casos;
5. abre Streamlit.

También puedes hacerlo manualmente:

```bat
py -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python scripts\download_data.py
streamlit run app.py
```

Para ver la salida sin interfaz:

```bat
python run_analysis.py
```

## Arquitectura

```text
Google Drive / CSV
       |
       v
DuckDB views
       |
       +--> Contexto de identidad/activo
       |
       +--> Baseline robusto (frecuencia, mediana, P95)
       |
       v
Signal Engine
       |
       v
Correlation Engine (identity + ventana temporal)
       |
       v
Risk + Confidence
       |
       v
Streamlit SOC Dashboard
```

## Qué mostrar en la demo al jurado

1. Abrir el ranking de investigaciones.
2. Elegir una HIGH/CRITICAL.
3. Mostrar qué fuentes participan.
4. Mostrar la timeline de señales.
5. Mostrar la descomposición matemática del Risk Score.
6. Mostrar baseline de la identidad.
7. Recalcar que los IDs de evidencia se conservan y que la salida es una hipótesis de investigación.

## Limitaciones actuales

Este es un MVP de hackathon, no un SIEM productivo. La correlación inicial usa ventanas horarias por identidad; una siguiente iteración debe incorporar directamente `session_id`, `process_guid` y ventanas deslizantes. Los pesos son heurísticos y deben calibrarse con revisión humana/experimentos. No existe ground truth oficial, por lo que no se afirma Precision/Recall global real sin construir primero un conjunto validado.
