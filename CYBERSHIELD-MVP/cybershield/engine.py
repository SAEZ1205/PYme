from __future__ import annotations

from pathlib import Path
import duckdb
import pandas as pd

REQUIRED = [
    "identity_context.csv",
    "asset_inventory.csv",
    "authentication_logs.csv",
    "endpoint_events.csv",
    "file_access.csv",
    "network_flows.csv",
    "cloud_activity.csv",
    "security_alerts.csv",
]


def _q(path: Path) -> str:
    return str(path).replace("'", "''")


class CyberShieldEngine:
    """Motor explicable de baseline, señales y correlación para el reto ADG."""

    def __init__(self, data_dir: str | Path = "data") -> None:
        self.data_dir = Path(data_dir)
        self.con = duckdb.connect(database=":memory:")
        self._loaded = False

    def missing_files(self) -> list[str]:
        return [name for name in REQUIRED if not (self.data_dir / name).exists()]

    def load(self) -> None:
        missing = self.missing_files()
        if missing:
            raise FileNotFoundError("Faltan datasets: " + ", ".join(missing))

        files = {
            "identities": "identity_context.csv",
            "assets": "asset_inventory.csv",
            "auth": "authentication_logs.csv",
            "endpoint": "endpoint_events.csv",
            "files": "file_access.csv",
            "network": "network_flows.csv",
            "cloud": "cloud_activity.csv",
            "alerts": "security_alerts.csv",
        }
        for view, filename in files.items():
            path = _q(self.data_dir / filename)
            self.con.execute(
                f"CREATE OR REPLACE VIEW {view} AS SELECT * FROM read_csv_auto('{path}', header=true, sample_size=100000)"
            )

        self._build_baselines()
        self._build_signals()
        self._build_cases()
        self._loaded = True

    def _build_baselines(self) -> None:
        # Baseline aprendido: no define 'malicioso'; describe frecuencia/volumen habitual.
        self.con.execute("""
        CREATE OR REPLACE TEMP TABLE auth_asset_profile AS
        SELECT identity_id, source_asset_id, count(*) AS seen_count
        FROM auth
        WHERE identity_id IS NOT NULL AND source_asset_id IS NOT NULL
        GROUP BY 1,2;
        """)

        self.con.execute("""
        CREATE OR REPLACE TEMP TABLE auth_country_profile AS
        SELECT identity_id, source_country, count(*) AS seen_count,
               count(*) * 1.0 / sum(count(*)) OVER (PARTITION BY identity_id) AS frequency
        FROM auth
        WHERE identity_id IS NOT NULL AND source_country IS NOT NULL
        GROUP BY 1,2;
        """)

        self.con.execute("""
        CREATE OR REPLACE TEMP TABLE file_hourly AS
        SELECT identity_id,
               date_trunc('hour', try_cast(timestamp AS TIMESTAMP)) AS hour_bucket,
               count(*) AS file_events,
               sum(coalesce(try_cast(bytes_affected AS DOUBLE),0)) AS bytes_affected,
               sum(CASE WHEN upper(coalesce(data_classification,'')) IN ('CONFIDENTIAL','RESTRICTED') THEN 1 ELSE 0 END) AS sensitive_events
        FROM files
        WHERE identity_id IS NOT NULL
        GROUP BY 1,2;
        """)

        self.con.execute("""
        CREATE OR REPLACE TEMP TABLE file_baseline AS
        SELECT identity_id,
               median(file_events) AS median_files_hour,
               quantile_cont(file_events, 0.95) AS p95_files_hour,
               median(bytes_affected) AS median_file_bytes_hour,
               quantile_cont(bytes_affected, 0.95) AS p95_file_bytes_hour
        FROM file_hourly
        GROUP BY 1;
        """)

        self.con.execute("""
        CREATE OR REPLACE TEMP TABLE network_hourly AS
        SELECT identity_id,
               date_trunc('hour', try_cast(timestamp AS TIMESTAMP)) AS hour_bucket,
               sum(coalesce(try_cast(bytes_sent AS DOUBLE),0)) AS bytes_sent,
               count(*) AS flow_count
        FROM network
        WHERE identity_id IS NOT NULL
        GROUP BY 1,2;
        """)

        self.con.execute("""
        CREATE OR REPLACE TEMP TABLE network_baseline AS
        SELECT identity_id,
               median(bytes_sent) AS median_bytes_sent_hour,
               quantile_cont(bytes_sent, 0.95) AS p95_bytes_sent_hour,
               quantile_cont(flow_count, 0.95) AS p95_flows_hour
        FROM network_hourly
        GROUP BY 1;
        """)

    def _build_signals(self) -> None:
        self.con.execute("""
        CREATE OR REPLACE TEMP TABLE signals AS

        -- 1) Geografía poco habitual: usa contexto declarado + frecuencia histórica.
        SELECT
          CAST(a.event_id AS VARCHAR) AS event_id,
          try_cast(a.timestamp AS TIMESTAMP) AS ts,
          CAST(a.identity_id AS VARCHAR) AS identity_id,
          CAST(a.source_asset_id AS VARCHAR) AS asset_id,
          CAST(a.session_id AS VARCHAR) AS session_id,
          NULL::VARCHAR AS process_guid,
          'authentication' AS source,
          'AUTH_GEO_DEVIATION' AS signal_type,
          CASE WHEN p.frequency IS NULL OR p.frequency < 0.01 THEN 16 ELSE 10 END AS points,
          'País de origen distinto al país primario y/o muy poco frecuente en el histórico' AS reason,
          0 AS sensitive_flag
        FROM auth a
        LEFT JOIN identities i USING(identity_id)
        LEFT JOIN auth_country_profile p
          ON p.identity_id=a.identity_id AND p.source_country=a.source_country
        WHERE a.result='success'
          AND a.source_country IS NOT NULL
          AND i.primary_country IS NOT NULL
          AND a.source_country <> i.primary_country

        UNION ALL

        -- 2) Horario fuera del rango de referencia del usuario. Señal débil, nunca conclusión.
        SELECT
          CAST(a.event_id AS VARCHAR), try_cast(a.timestamp AS TIMESTAMP), CAST(a.identity_id AS VARCHAR),
          CAST(a.source_asset_id AS VARCHAR), CAST(a.session_id AS VARCHAR), NULL::VARCHAR,
          'authentication','AUTH_TIME_DEVIATION',8,
          'Autenticación fuera del horario de referencia declarado para la identidad',0
        FROM auth a
        JOIN identities i USING(identity_id)
        WHERE a.result='success'
          AND i.usual_start_hour IS NOT NULL AND i.usual_end_hour IS NOT NULL
          AND (
             extract('hour' FROM try_cast(a.timestamp AS TIMESTAMP)) < try_cast(i.usual_start_hour AS INTEGER)
             OR extract('hour' FROM try_cast(a.timestamp AS TIMESTAMP)) > try_cast(i.usual_end_hour AS INTEGER)
          )
          AND lower(coalesce(CAST(i.shift_type AS VARCHAR),'')) NOT LIKE '%24%'

        UNION ALL

        -- 3) Activo usado muy pocas veces por la identidad.
        SELECT
          CAST(a.event_id AS VARCHAR), try_cast(a.timestamp AS TIMESTAMP), CAST(a.identity_id AS VARCHAR),
          CAST(a.source_asset_id AS VARCHAR), CAST(a.session_id AS VARCHAR), NULL::VARCHAR,
          'authentication','AUTH_RARE_ASSET',10,
          'Activo de origen con menos de 3 observaciones históricas para esta identidad',0
        FROM auth a
        JOIN auth_asset_profile p
          ON p.identity_id=a.identity_id AND p.source_asset_id=a.source_asset_id
        WHERE a.result='success' AND p.seen_count < 3

        UNION ALL

        -- 4) Uso de privilegio superior al perfil de la identidad.
        SELECT
          CAST(a.event_id AS VARCHAR), try_cast(a.timestamp AS TIMESTAMP), CAST(a.identity_id AS VARCHAR),
          CAST(a.destination_asset_id AS VARCHAR), CAST(a.session_id AS VARCHAR), NULL::VARCHAR,
          'authentication','PRIVILEGE_MISMATCH',18,
          'La autenticación usa P0/P1 mientras la identidad está perfilada como P2/P3/P4',0
        FROM auth a
        JOIN identities i USING(identity_id)
        WHERE upper(coalesce(CAST(a.privilege_used AS VARCHAR),'')) IN ('P0','P1')
          AND upper(coalesce(CAST(i.privilege_level AS VARCHAR),'')) IN ('P2','P3','P4')

        UNION ALL

        -- 5) Burst de acceso a archivos, comparado con P95 propio.
        SELECT
          'FILE-HOUR-' || CAST(f.identity_id AS VARCHAR) || '-' || strftime(f.hour_bucket, '%Y%m%d%H'),
          f.hour_bucket, CAST(f.identity_id AS VARCHAR), NULL::VARCHAR, NULL::VARCHAR, NULL::VARCHAR,
          'file_access','FILE_BURST',
          CASE WHEN f.sensitive_events > 0 THEN 24 ELSE 16 END,
          'Volumen de accesos a archivos por encima del P95 individual' ||
             CASE WHEN f.sensitive_events > 0 THEN '; incluye información CONFIDENTIAL/RESTRICTED' ELSE '' END,
          CASE WHEN f.sensitive_events > 0 THEN 1 ELSE 0 END
        FROM file_hourly f
        JOIN file_baseline b USING(identity_id)
        WHERE f.file_events > greatest(coalesce(b.p95_files_hour,0), 20)

        UNION ALL

        -- 6) Egreso de red por encima del P95 individual.
        SELECT
          'NET-HOUR-' || CAST(n.identity_id AS VARCHAR) || '-' || strftime(n.hour_bucket, '%Y%m%d%H'),
          n.hour_bucket, CAST(n.identity_id AS VARCHAR), NULL::VARCHAR, NULL::VARCHAR, NULL::VARCHAR,
          'network','NETWORK_EGRESS_BURST',20,
          'Bytes enviados en la hora por encima del P95 histórico individual y sobre umbral mínimo de 100 MB',0
        FROM network_hourly n
        JOIN network_baseline b USING(identity_id)
        WHERE n.bytes_sent > greatest(coalesce(b.p95_bytes_sent_hour,0), 100000000)

        UNION ALL

        -- 7) Herramientas de administración/transferencia: solo una señal de bajo peso.
        SELECT
          CAST(e.event_id AS VARCHAR), try_cast(e.timestamp AS TIMESTAMP), CAST(e.identity_id AS VARCHAR),
          CAST(e.asset_id AS VARCHAR), CAST(e.session_id AS VARCHAR), CAST(e.process_guid AS VARCHAR),
          'endpoint','DUAL_USE_TOOL',7,
          'Ejecución de herramienta de doble uso; requiere correlación con otras fuentes',0
        FROM endpoint e
        WHERE lower(coalesce(CAST(e.process_name AS VARCHAR),'')) IN
          ('powershell.exe','pwsh.exe','winrs.exe','ssh.exe','scp.exe','curl.exe','wget.exe','tar.exe','7z.exe')

        UNION ALL

        -- 8) Operación cloud administrativa realizada por un rol sin indicios obvios de función cloud.
        SELECT
          CAST(c.event_id AS VARCHAR), try_cast(c.timestamp AS TIMESTAMP), CAST(c.identity_id AS VARCHAR),
          CAST(c.source_asset_id AS VARCHAR), CAST(c.session_id AS VARCHAR), NULL::VARCHAR,
          'cloud','CLOUD_ROLE_DEVIATION',18,
          'Operación cloud sensible/administrativa no alineada de forma evidente con el rol declarado',
          CASE WHEN upper(coalesce(CAST(c.data_classification AS VARCHAR),'')) IN ('CONFIDENTIAL','RESTRICTED') THEN 1 ELSE 0 END
        FROM cloud c
        JOIN identities i USING(identity_id)
        WHERE (
            lower(coalesce(CAST(c.operation AS VARCHAR),'')) LIKE '%iam%'
            OR lower(coalesce(CAST(c.operation AS VARCHAR),'')) LIKE '%role%'
            OR lower(coalesce(CAST(c.operation AS VARCHAR),'')) LIKE '%permission%'
            OR lower(coalesce(CAST(c.operation AS VARCHAR),'')) LIKE '%policy%'
            OR lower(coalesce(CAST(c.api_name AS VARCHAR),'')) LIKE '%iam%'
          )
          AND lower(coalesce(CAST(i.job_role AS VARCHAR),'')) NOT LIKE '%cloud%'
          AND lower(coalesce(CAST(i.job_role AS VARCHAR),'')) NOT LIKE '%devops%'
          AND lower(coalesce(CAST(i.job_role AS VARCHAR),'')) NOT LIKE '%platform%'
          AND lower(coalesce(CAST(i.job_role AS VARCHAR),'')) NOT LIKE '%security%'

        UNION ALL

        -- 9) Alertas: evidencia auxiliar, no ground truth.
        SELECT
          CAST(s.alert_id AS VARCHAR), try_cast(s.timestamp AS TIMESTAMP), CAST(s.identity_id AS VARCHAR),
          CAST(s.asset_id AS VARCHAR), CAST(s.session_id AS VARCHAR), CAST(s.process_guid AS VARCHAR),
          'security_alerts','SECURITY_ALERT_SUPPORT',8,
          'Existe una alerta HIGH/CRITICAL asociada; se usa solo como evidencia auxiliar',0
        FROM alerts s
        WHERE lower(coalesce(CAST(s.severity AS VARCHAR),'')) IN ('high','critical')
          AND s.identity_id IS NOT NULL;
        """)

    def _build_cases(self) -> None:
        self.con.execute("""
        CREATE OR REPLACE TEMP TABLE cases AS
        WITH enriched AS (
          SELECT s.*,
                 coalesce(try_cast(a.criticality AS DOUBLE),0) AS asset_criticality
          FROM signals s
          LEFT JOIN assets a ON a.asset_id=s.asset_id
          WHERE s.ts IS NOT NULL AND s.identity_id IS NOT NULL
        ), grouped AS (
          SELECT
            identity_id,
            date_trunc('hour', ts) AS case_hour,
            min(ts) AS first_seen,
            max(ts) AS last_seen,
            count(*) AS signal_count,
            count(DISTINCT source) AS source_count,
            least(50, sum(points)) AS behavior_component,
            least(18, greatest(0, count(DISTINCT source)-1) * 6) AS correlation_component,
            least(20, max(asset_criticality) * 4) AS asset_component,
            CASE WHEN max(sensitive_flag)=1 THEN 8 ELSE 0 END AS data_component,
            CASE WHEN sum(CASE WHEN source='security_alerts' THEN 1 ELSE 0 END)>0 THEN 4 ELSE 0 END AS alert_component,
            string_agg(DISTINCT source, ', ' ORDER BY source) AS sources,
            string_agg(DISTINCT signal_type, ', ' ORDER BY signal_type) AS signal_types,
            string_agg(DISTINCT event_id, ', ' ORDER BY event_id) AS evidence_ids
          FROM enriched
          GROUP BY 1,2
        )
        SELECT
          row_number() OVER (ORDER BY
            least(100, behavior_component+correlation_component+asset_component+data_component+alert_component) DESC,
            first_seen) AS case_id,
          g.*,
          least(100, behavior_component+correlation_component+asset_component+data_component+alert_component)::INTEGER AS risk_score,
          CASE
            WHEN least(100, behavior_component+correlation_component+asset_component+data_component+alert_component) >= 90 THEN 'CRITICAL'
            WHEN least(100, behavior_component+correlation_component+asset_component+data_component+alert_component) >= 70 THEN 'HIGH'
            WHEN least(100, behavior_component+correlation_component+asset_component+data_component+alert_component) >= 45 THEN 'MEDIUM'
            ELSE 'LOW'
          END AS risk_level,
          least(100, 35 + source_count*15 + least(signal_count,10)*3)::INTEGER AS confidence_score,
          i.username, i.job_role, i.privilege_level, i.primary_country
        FROM grouped g
        LEFT JOIN identities i USING(identity_id)
        WHERE source_count >= 2 OR behavior_component >= 30
        ORDER BY risk_score DESC, first_seen;
        """)

    def summary(self) -> dict:
        self._ensure()
        row = self.con.execute("""
        SELECT
          (SELECT count(*) FROM auth) + (SELECT count(*) FROM endpoint) +
          (SELECT count(*) FROM files) + (SELECT count(*) FROM network) +
          (SELECT count(*) FROM cloud) + (SELECT count(*) FROM alerts) AS total_events,
          (SELECT count(*) FROM signals) AS total_signals,
          (SELECT count(*) FROM cases) AS total_cases,
          (SELECT count(*) FROM cases WHERE risk_level='CRITICAL') AS critical_cases,
          (SELECT count(*) FROM cases WHERE risk_level='HIGH') AS high_cases
        """).fetchone()
        keys = ["total_events","total_signals","total_cases","critical_cases","high_cases"]
        return dict(zip(keys, row))

    def cases(self, limit: int = 100) -> pd.DataFrame:
        self._ensure()
        return self.con.execute("SELECT * FROM cases ORDER BY risk_score DESC, first_seen LIMIT ?", [limit]).df()

    def case_signals(self, identity_id: str, case_hour) -> pd.DataFrame:
        self._ensure()
        return self.con.execute("""
          SELECT ts, source, signal_type, points, reason, event_id, asset_id, session_id, process_guid
          FROM signals
          WHERE identity_id=? AND date_trunc('hour', ts)=?
          ORDER BY ts, source
        """, [identity_id, case_hour]).df()

    def baseline_for_identity(self, identity_id: str) -> dict:
        self._ensure()
        identity = self.con.execute("SELECT * FROM identities WHERE identity_id=? LIMIT 1", [identity_id]).df()
        file_b = self.con.execute("SELECT * FROM file_baseline WHERE identity_id=?", [identity_id]).df()
        net_b = self.con.execute("SELECT * FROM network_baseline WHERE identity_id=?", [identity_id]).df()
        countries = self.con.execute("""
            SELECT source_country, seen_count, round(frequency*100,2) AS pct
            FROM auth_country_profile WHERE identity_id=? ORDER BY seen_count DESC LIMIT 5
        """, [identity_id]).df()
        return {
            "identity": identity.to_dict("records")[0] if not identity.empty else {},
            "file_baseline": file_b.to_dict("records")[0] if not file_b.empty else {},
            "network_baseline": net_b.to_dict("records")[0] if not net_b.empty else {},
            "countries": countries.to_dict("records"),
        }

    def _ensure(self) -> None:
        if not self._loaded:
            raise RuntimeError("Ejecuta load() antes de consultar el motor")
