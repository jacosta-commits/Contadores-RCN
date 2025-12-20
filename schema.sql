/* ============================================================
RCN Contadores — Modelo normalizado (CALC/PLC)
   Ejecuta esto en la base de datos ZENTRIK
============================================================ */
USE [ZENTRIK];
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

/* ============================================================
   TABLAS
============================================================ */

/* --------- Catálogo de turnos (con columna calculada cruza_dia) --------- */
IF OBJECT_ID('dbo.RCN_CONT_TURNO','U') IS NULL
BEGIN
  CREATE TABLE dbo.RCN_CONT_TURNO (
    turno_cod   CHAR(1)      NOT NULL,     -- '1'..'5'
    hora_ini    TIME         NOT NULL,     -- ej. 06:30
    hora_fin    TIME         NOT NULL,     -- ej. 18:30
    descripcion VARCHAR(60)  NULL,
    activo      BIT          NOT NULL CONSTRAINT DF_RCN_CONT_TURNO_activo DEFAULT (1),

    -- TRUE cuando el fin es <= ini (ej. 22:20 → 06:30 del día siguiente)
    cruza_dia AS (CONVERT(bit, CASE WHEN hora_fin <= hora_ini THEN 1 ELSE 0 END)) PERSISTED,

    CONSTRAINT PK_RCN_CONT_TURNO PRIMARY KEY CLUSTERED (turno_cod)
  );
END
GO

/* --------- Maestro de telares / Modbus --------- */
IF OBJECT_ID('dbo.RCN_CONT_TELAR','U') IS NULL
BEGIN
  CREATE TABLE dbo.RCN_CONT_TELAR (
    telcod              VARCHAR(10)  NOT NULL,  -- ID natural del telar
    telnom              VARCHAR(80)  NULL,
    grupo               VARCHAR(40)  NULL,

    -- Conexión Modbus (común)
    modbus_ip           VARCHAR(64)  NULL,
    modbus_port         INT          NULL CONSTRAINT DF_RCN_CONT_TELAR_modbus_port DEFAULT (502),
    modbus_unit_id      INT          NULL,

    -- Modo: CALC (solo pulso) | PLC (lectura directa)
    modo                VARCHAR(8)   NOT NULL,
    calc_pulse_offset   INT          NULL,  -- para CALC

    -- Offsets relativos (para PLC, desde plc_base_offset)
    plc_base_offset     INT          NULL,
    plc_hil_act_rel     INT          NULL,
    plc_velocidad_rel   INT          NULL,
    plc_hil_turno_rel   INT          NULL,
    plc_set_rel         INT          NULL,
    plc_hil_start_rel   INT          NULL,
    plc_coil_reset      INT          NULL,  -- M100
    plc_coil_fin_turno  INT          NULL,  -- M101

    activo              BIT          NOT NULL CONSTRAINT DF_RCN_CONT_TELAR_activo DEFAULT (1),
    created_at          DATETIME2    NOT NULL CONSTRAINT DF_RCN_CONT_TELAR_created_at DEFAULT (SYSDATETIME()),

    CONSTRAINT PK_RCN_CONT_TELAR PRIMARY KEY CLUSTERED (telcod),
    CONSTRAINT CK_RCN_CONT_TELAR_modo CHECK (modo IN ('CALC','PLC'))
  );
END
GO

/* --------- Sesión (turno) del operario --------- */
IF OBJECT_ID('dbo.RCN_CONT_SESION','U') IS NULL
BEGIN
  CREATE TABLE dbo.RCN_CONT_SESION (
    sescod      BIGINT       NOT NULL IDENTITY(1,1),
    tracod      VARCHAR(15)  NOT NULL,   -- RRHH.tracod (VIEW externa, sin FK)
    traraz      VARCHAR(120) NULL,       -- nombre visible (informativo)
    turno_cod   CHAR(1)      NOT NULL,   -- FK catálogo turnos
    inicio      DATETIME2    NOT NULL,   -- apertura (LOCAL)
    fin         DATETIME2    NULL,       -- cierre (LOCAL)
    activo      BIT          NOT NULL CONSTRAINT DF_RCN_CONT_SESION_activo DEFAULT (1),
    estado      CHAR(1)      NOT NULL CONSTRAINT DF_RCN_CONT_SESION_estado DEFAULT ('A'), -- A/F/X

    -- Control opcional por dispositivo/token
    dev_uuid    CHAR(36)     NULL,
    ip_origen   VARCHAR(45)  NULL,
    user_agent  VARCHAR(200) NULL,
    active_jti  VARCHAR(64)  NULL,

    CONSTRAINT PK_RCN_CONT_SESION PRIMARY KEY CLUSTERED (sescod),
    CONSTRAINT FK_RCN_CONT_SESION_TURNO FOREIGN KEY (turno_cod)
      REFERENCES dbo.RCN_CONT_TURNO(turno_cod),
    CONSTRAINT CK_RCN_CONT_SESION_estado CHECK (estado IN ('A','F','X'))
  );
END
GO

/* --------- Asignación de telares a la sesión (máx 2 activos) --------- */
IF OBJECT_ID('dbo.RCN_CONT_SESION_TELAR','U') IS NULL
BEGIN
  CREATE TABLE dbo.RCN_CONT_SESION_TELAR (
    sescod          BIGINT      NOT NULL,   -- FK a sesión
    telcod          VARCHAR(10) NOT NULL,   -- FK a telar
    asignado_desde  DATETIME2   NOT NULL CONSTRAINT DF_RCN_CONT_SESION_TELAR_desde DEFAULT (SYSDATETIME()),
    asignado_hasta  DATETIME2   NULL,
    activo          BIT         NOT NULL CONSTRAINT DF_RCN_CONT_SESION_TELAR_activo DEFAULT (1),

    CONSTRAINT PK_RCN_CONT_SESION_TELAR PRIMARY KEY CLUSTERED (sescod, telcod, asignado_desde),

    CONSTRAINT FK_RCN_CONT_SESION_TELAR_SES FOREIGN KEY (sescod)
      REFERENCES dbo.RCN_CONT_SESION(sescod),
    CONSTRAINT FK_RCN_CONT_SESION_TELAR_TEL FOREIGN KEY (telcod)
      REFERENCES dbo.RCN_CONT_TELAR(telcod)
  );

  -- Búsqueda rápida por telar activo
  CREATE NONCLUSTERED INDEX IX_RCN_CONT_SESION_TELAR_telar_activo
    ON dbo.RCN_CONT_SESION_TELAR(telcod)
    WHERE activo = 1;
END
GO

-- Índice espejo: “mis telares activos” por sesión (rápido para el operario)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_RCN_CONT_SESION_TELAR_sescod_activo' AND object_id = OBJECT_ID('dbo.RCN_CONT_SESION_TELAR'))
BEGIN
  CREATE NONCLUSTERED INDEX IX_RCN_CONT_SESION_TELAR_sescod_activo
  ON dbo.RCN_CONT_SESION_TELAR(sescod)
  WHERE activo = 1;
END
GO

/* --------- Checklist por telar x sesión --------- */
IF OBJECT_ID('dbo.RCN_CONT_CHK','U') IS NULL
BEGIN
  CREATE TABLE dbo.RCN_CONT_CHK (
    chk_id                   BIGINT       NOT NULL IDENTITY(1,1),
    sescod                   BIGINT       NOT NULL,
    telcod                   VARCHAR(10)  NOT NULL,
    tracod                   VARCHAR(15)  NULL,    -- quien lo llenó (VIEW externa)
    realizado_at             DATETIME2    NOT NULL CONSTRAINT DF_RCN_CONT_CHK_realizado DEFAULT (SYSDATETIME()),

    -- Ítems actuales (SI/NO u OK/NO)
    rodillo_principal        VARCHAR(2)   NULL,
    sensores_urdimbre        VARCHAR(2)   NULL,
    hilos_fondo              VARCHAR(2)   NULL,
    hilos_refuerzo           VARCHAR(2)   NULL,
    encarretadora            VARCHAR(2)   NULL,
    manchas_aceite           VARCHAR(2)   NULL,

    CONSTRAINT PK_RCN_CONT_CHK PRIMARY KEY CLUSTERED (chk_id),
    CONSTRAINT UQ_RCN_CONT_CHK_SESION_TELAR UNIQUE (sescod, telcod),

    CONSTRAINT FK_RCN_CONT_CHK_SES FOREIGN KEY (sescod)
      REFERENCES dbo.RCN_CONT_SESION(sescod),
    CONSTRAINT FK_RCN_CONT_CHK_TEL FOREIGN KEY (telcod)
      REFERENCES dbo.RCN_CONT_TELAR(telcod)
  );
  CREATE NONCLUSTERED INDEX IX_RCN_CONT_CHK_CONSULTA
    ON dbo.RCN_CONT_CHK(telcod, realizado_at);
END
GO

/* --------- Snapshots de contador (FIN_TURNO / PERIODIC / MANUAL / INICIO_TURNO) --------- */
IF OBJECT_ID('dbo.RCN_CONT_LECTURA','U') IS NULL
BEGIN
  CREATE TABLE dbo.RCN_CONT_LECTURA (
    id        BIGINT       NOT NULL IDENTITY(1,1),
    sescod    BIGINT       NULL,        -- puede ser NULL si es muestreo fuera de sesión
    telcod    VARCHAR(10)  NOT NULL,
    ts        DATETIME2    NOT NULL,
    tipo      VARCHAR(12)  NOT NULL,    -- FIN_TURNO | PERIODIC | MANUAL | INICIO_TURNO

    hil_act   INT          NULL,
    hil_turno INT          NULL,
    hil_start INT          NULL,
    set_value INT          NULL,

    tracod    VARCHAR(15)  NULL,        -- quien registró (opcional)

    CONSTRAINT PK_RCN_CONT_LECTURA PRIMARY KEY CLUSTERED (id),
    CONSTRAINT FK_RCN_CONT_LECTURA_SES FOREIGN KEY (sescod)
      REFERENCES dbo.RCN_CONT_SESION(sescod),
    CONSTRAINT FK_RCN_CONT_LECTURA_TEL FOREIGN KEY (telcod)
      REFERENCES dbo.RCN_CONT_TELAR(telcod),
    CONSTRAINT CK_RCN_CONT_LECTURA_tipo CHECK (tipo IN ('FIN_TURNO','PERIODIC','MANUAL','INICIO_TURNO'))
  );
  CREATE NONCLUSTERED INDEX IX_RCN_CONT_LECTURA_TELAR_TS
    ON dbo.RCN_CONT_LECTURA(telcod, ts);
  CREATE NONCLUSTERED INDEX IX_RCN_CONT_LECTURA_SES_TIPO
    ON dbo.RCN_CONT_LECTURA(sescod, telcod, tipo);
END
GO

-- DEFAULT de timestamp si no existe
IF NOT EXISTS (SELECT 1 FROM sys.default_constraints WHERE parent_object_id = OBJECT_ID('dbo.RCN_CONT_LECTURA') AND name = 'DF_RCN_CONT_LECTURA_ts')
BEGIN
  ALTER TABLE dbo.RCN_CONT_LECTURA
    ADD CONSTRAINT DF_RCN_CONT_LECTURA_ts DEFAULT (SYSDATETIME()) FOR ts;
END
GO

-- Unicidad: exactamente 1 INICIO_TURNO y 1 FIN_TURNO por (sescod, telcod)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_RCN_CONT_LECTURA_INICIO' AND object_id = OBJECT_ID('dbo.RCN_CONT_LECTURA'))
BEGIN
  CREATE UNIQUE INDEX UQ_RCN_CONT_LECTURA_INICIO
  ON dbo.RCN_CONT_LECTURA(sescod, telcod)
  WHERE tipo = 'INICIO_TURNO';
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_RCN_CONT_LECTURA_FIN' AND object_id = OBJECT_ID('dbo.RCN_CONT_LECTURA'))
BEGIN
  CREATE UNIQUE INDEX UQ_RCN_CONT_LECTURA_FIN
  ON dbo.RCN_CONT_LECTURA(sescod, telcod)
  WHERE tipo = 'FIN_TURNO';
END
GO

-- Reglas: INICIO/FIN requieren sescod (PERIODIC/MANUAL pueden ser NULL)
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_RCN_CONT_LECTURA_sescod_req' AND parent_object_id = OBJECT_ID('dbo.RCN_CONT_LECTURA'))
BEGIN
  ALTER TABLE dbo.RCN_CONT_LECTURA WITH CHECK ADD CONSTRAINT CK_RCN_CONT_LECTURA_sescod_req
  CHECK (
    CASE 
      WHEN tipo IN ('INICIO_TURNO','FIN_TURNO') THEN CASE WHEN sescod IS NOT NULL THEN 1 ELSE 0 END
      ELSE 1
    END = 1
  );
END
GO

/* --------- Llamadas / tickets --------- */
IF OBJECT_ID('dbo.RCN_CONT_LLAMADA','U') IS NULL
BEGIN
  CREATE TABLE dbo.RCN_CONT_LLAMADA (
    id            BIGINT       NOT NULL IDENTITY(1,1),
    sescod        BIGINT       NOT NULL,
    telcod        VARCHAR(10)  NOT NULL,
    categoria     VARCHAR(30)  NULL,
    mensaje       VARCHAR(300) NULL,   -- “atencion”
    started_at    DATETIME2    NOT NULL CONSTRAINT DF_RCN_CONT_LLAMADA_started DEFAULT (SYSDATETIME()),
    ended_at      DATETIME2    NULL,
    estado        CHAR(1)      NOT NULL CONSTRAINT DF_RCN_CONT_LLAMADA_estado DEFAULT ('A'), -- A/E/C
    supervisor    VARCHAR(60)  NULL,
    completada    BIT          NOT NULL CONSTRAINT DF_RCN_CONT_LLAMADA_completada DEFAULT (0),

    CONSTRAINT PK_RCN_CONT_LLAMADA PRIMARY KEY CLUSTERED (id),

    CONSTRAINT FK_RCN_CONT_LLAMADA_SES FOREIGN KEY (sescod)
      REFERENCES dbo.RCN_CONT_SESION(sescod),
    CONSTRAINT FK_RCN_CONT_LLAMADA_TEL FOREIGN KEY (telcod)
      REFERENCES dbo.RCN_CONT_TELAR(telcod),
    CONSTRAINT CK_RCN_CONT_LLAMADA_estado CHECK (estado IN ('A','E','C'))
  );
END
GO

/* --------- Cache SOLO para recuperación tras reinicios --------- */
IF OBJECT_ID('dbo.RCN_CONT_CACHE','U') IS NULL
BEGIN
  CREATE TABLE dbo.RCN_CONT_CACHE (
    telcod         VARCHAR(10)  NOT NULL,  -- FK -> TELAR

    -- Snapshot de sesión (opcionales, solo para reestablecer)
    sescod         BIGINT       NULL,      -- FK -> SESION
    tracod         VARCHAR(15)  NULL,      -- código RRHH
    traraz         VARCHAR(120) NULL,      -- nombre visible
    turno_cod      CHAR(1)      NULL,      -- '1'..'5'
    session_active BIT          NOT NULL CONSTRAINT DF_RCN_CONT_CACHE_session_active DEFAULT (0),

    -- Estado de contadores
    hil_act        INT          NOT NULL CONSTRAINT DF_RCN_CONT_CACHE_hil_act        DEFAULT (0),
    hil_turno      INT          NOT NULL CONSTRAINT DF_RCN_CONT_CACHE_hil_turno      DEFAULT (0),
    hil_start      INT          NOT NULL CONSTRAINT DF_RCN_CONT_CACHE_hil_start      DEFAULT (0),
    set_value      INT          NOT NULL CONSTRAINT DF_RCN_CONT_CACHE_set_value      DEFAULT (0),
    velocidad      INT          NOT NULL CONSTRAINT DF_RCN_CONT_CACHE_velocidad      DEFAULT (0),

    updated_at     DATETIME2    NOT NULL CONSTRAINT DF_RCN_CONT_CACHE_updated_at     DEFAULT (SYSDATETIME()),
    rv             ROWVERSION,  -- opcional: para optimistic concurrency si lo quieres

    CONSTRAINT PK_RCN_CONT_CACHE PRIMARY KEY CLUSTERED (telcod),
    CONSTRAINT FK_RCN_CONT_CACHE_TEL FOREIGN KEY (telcod)
      REFERENCES dbo.RCN_CONT_TELAR(telcod),
    CONSTRAINT FK_RCN_CONT_CACHE_SES FOREIGN KEY (sescod)
      REFERENCES dbo.RCN_CONT_SESION(sescod)
  );

  CREATE NONCLUSTERED INDEX IX_RCN_CONT_CACHE_SESCOD
    ON dbo.RCN_CONT_CACHE(sescod);

  CREATE NONCLUSTERED INDEX IX_RCN_CONT_CACHE_UPDATED_AT
    ON dbo.RCN_CONT_CACHE(updated_at);
END
ELSE
BEGIN
  -- Asegura que exista columna rv (rowversion) si la tabla era previa
  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.RCN_CONT_CACHE') AND name = 'rv')
  BEGIN
    ALTER TABLE dbo.RCN_CONT_CACHE ADD rv ROWVERSION;
  END
END
GO

/* ============================================================
   ÍNDICES ÚNICOS FILTRADOS (restringen solo cuando ACTIVO = 1)
============================================================ */

-- 1) Solo 1 sesión ACTIVA por usuario (histórico permitido)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_RCN_CONT_SESION_ACTIVA')
BEGIN
  CREATE UNIQUE INDEX UQ_RCN_CONT_SESION_ACTIVA
  ON dbo.RCN_CONT_SESION(tracod)
  WHERE activo = 1;
END
GO

-- 1b) (Opcional) Solo 1 sesión ACTIVA por dispositivo (si dev_uuid se usa)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_RCN_CONT_SESION_ACTIVA_DEV')
BEGIN
  CREATE UNIQUE INDEX UQ_RCN_CONT_SESION_ACTIVA_DEV
  ON dbo.RCN_CONT_SESION(dev_uuid)
  WHERE activo = 1 AND dev_uuid IS NOT NULL;
END
GO

-- 2) Un telar no puede estar en 2 sesiones activas a la vez
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_RCN_CONT_TELAR_OCUPADO')
BEGIN
  CREATE UNIQUE INDEX UQ_RCN_CONT_TELAR_OCUPADO
  ON dbo.RCN_CONT_SESION_TELAR(telcod)
  WHERE activo = 1;
END
GO

-- 3) No duplicar (sescod, telcod) activos dentro de la MISMA sesión
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_RCN_CONT_SESION_TELAR_ACTIVO')
BEGIN
  CREATE UNIQUE INDEX UQ_RCN_CONT_SESION_TELAR_ACTIVO
  ON dbo.RCN_CONT_SESION_TELAR(sescod, telcod)
  WHERE activo = 1;
END
GO

/* ============================================================
   TRIGGER: máximo 2 telares activos por sesión
============================================================ */
IF OBJECT_ID('dbo.TR_RCN_CONT_SESION_TELAR_Limit2','TR') IS NOT NULL
  DROP TRIGGER dbo.TR_RCN_CONT_SESION_TELAR_Limit2;
GO
CREATE TRIGGER dbo.TR_RCN_CONT_SESION_TELAR_Limit2
ON dbo.RCN_CONT_SESION_TELAR
AFTER INSERT, UPDATE
AS
BEGIN
  SET NOCOUNT ON;

  IF EXISTS (
    SELECT 1
    FROM inserted i
    CROSS APPLY (
      SELECT COUNT(*) AS activos
      FROM dbo.RCN_CONT_SESION_TELAR st
      WHERE st.sescod = i.sescod AND st.activo = 1
    ) x
    WHERE x.activos > 2
  )
  BEGIN
    RAISERROR('No se permiten más de 2 telares activos por sesión.', 16, 1);
    ROLLBACK TRANSACTION;
    RETURN;
  END
END;
GO

/* ============================================================
   SEMILLA DE TURNOS (1..5)
   - T1: 06:30 → 14:30
   - T2: 14:30 → 22:30
   - T3: 22:20 → 06:30 (cruza día)
   - T4: 06:30 → 18:30
   - T5: 18:30 → 06:30 (cruza día)
============================================================ */
MERGE dbo.RCN_CONT_TURNO AS T
USING (VALUES
  ('1', CAST('06:30' AS time), CAST('14:30' AS time), N'Turno 1 (06:30–14:30)', 1),
  ('2', CAST('14:30' AS time), CAST('22:30' AS time), N'Turno 2 (14:30–22:30)', 1),
  ('3', CAST('22:20' AS time), CAST('06:30' AS time), N'Turno 3 (22:20–06:30)', 1),
  ('4', CAST('06:30' AS time), CAST('18:30' AS time), N'Turno 4 (06:30–18:30)', 1),
  ('5', CAST('18:30' AS time), CAST('06:30' AS time), N'Turno 5 (18:30–06:30)', 1)
) AS V(turno_cod, hora_ini, hora_fin, descripcion, activo)
ON T.turno_cod = V.turno_cod
WHEN MATCHED THEN
  UPDATE SET T.hora_ini    = V.hora_ini,
             T.hora_fin    = V.hora_fin,
             T.descripcion = V.descripcion,
             T.activo      = V.activo
WHEN NOT MATCHED THEN
  INSERT (turno_cod, hora_ini, hora_fin, descripcion, activo)
  VALUES (V.turno_cod, V.hora_ini, V.hora_fin, V.descripcion, V.activo);
GO

/* ============================================================
   FUNCIONES
============================================================ */

-- ¿Qué turno (activo) corresponde a una fecha/hora dada?
CREATE OR ALTER FUNCTION dbo.fn_rcn_cont_turno_actual(@dt DATETIME2)
RETURNS CHAR(1)
AS
BEGIN
  DECLARE @h TIME = CAST(@dt AS TIME);

  RETURN (
    SELECT TOP (1) turno_cod
    FROM dbo.RCN_CONT_TURNO
    WHERE activo = 1 AND
          (
            (hora_fin > hora_ini AND @h >= hora_ini AND @h < hora_fin)
            OR
            (hora_fin <= hora_ini AND (@h >= hora_ini OR @h < hora_fin))
          )
    ORDER BY CASE WHEN turno_cod IN ('3','4','5') THEN 0 ELSE 1 END, turno_cod
  );
END
GO

-- Ventana [inicio_dt, fin_dt) anclada a una fecha base para un turno dado
CREATE OR ALTER FUNCTION dbo.fn_rcn_cont_rango_turno(
  @base_date DATE,
  @turno_cod CHAR(1)
) RETURNS TABLE
AS
RETURN
(
  SELECT
    inicio_dt =
      DATEADD(SECOND,
              DATEDIFF(SECOND, CAST('00:00:00' AS TIME), hora_ini),
              CAST(@base_date AS DATETIME2)),
    fin_dt =
      DATEADD(DAY, CASE WHEN hora_fin <= hora_ini THEN 1 ELSE 0 END,
        DATEADD(SECOND,
                DATEDIFF(SECOND, CAST('00:00:00' AS TIME), hora_fin),
                CAST(@base_date AS DATETIME2)))
  FROM dbo.RCN_CONT_TURNO
  WHERE turno_cod = @turno_cod
);
GO

/* ============================================================
   VISTAS ÚTILES
============================================================ */

-- Vista de recuperación: lo que debe leer el worker al arrancar tras caída
CREATE OR ALTER VIEW dbo.VW_RCN_CONT_RECOVERY
AS
SELECT
  c.telcod,
  c.sescod,
  c.tracod,
  c.traraz,
  c.turno_cod,
  c.session_active,
  c.hil_act,
  c.hil_turno,
  c.hil_start,
  c.set_value,
  c.velocidad,
  c.updated_at
FROM dbo.RCN_CONT_CACHE c;
GO

-- Vista de resumen INICIO/FIN por (sescod, telcod) para reportes
CREATE OR ALTER VIEW dbo.VW_RCN_CONT_RESUMEN_SESION_TELAR
AS
WITH I AS (
  SELECT sescod, telcod, ts AS ts_inicio, hil_act AS hil_act_ini, hil_turno AS hil_turno_ini,
         hil_start AS hil_start_ini, set_value AS set_value_ini
  FROM dbo.RCN_CONT_LECTURA
  WHERE tipo = 'INICIO_TURNO'
),
F AS (
  SELECT sescod, telcod, ts AS ts_fin, hil_act AS hil_act_fin, hil_turno AS hil_turno_fin,
         hil_start AS hil_start_fin, set_value AS set_value_fin
  FROM dbo.RCN_CONT_LECTURA
  WHERE tipo = 'FIN_TURNO'
)
SELECT
  s.sescod,
  s.telcod,
  i.ts_inicio,
  f.ts_fin,
  i.hil_act_ini,   f.hil_act_fin,
  i.hil_turno_ini, f.hil_turno_fin,
  i.hil_start_ini, f.hil_start_fin,
  i.set_value_ini, f.set_value_fin,
  -- Métricas típicas:
  (f.hil_turno_fin - i.hil_turno_ini) AS hileras_turno,
  (f.hil_act_fin   - i.hil_act_ini)   AS avance_act,
  f.set_value_fin AS meta_lote
FROM dbo.RCN_CONT_SESION_TELAR s
LEFT JOIN I ON I.sescod = s.sescod AND I.telcod = s.telcod
LEFT JOIN F ON F.sescod = s.sescod AND F.telcod = s.telcod;
GO

/* ============================================================
   STORED PROCEDURES (idempotentes)
============================================================ */

-- Upsert de CACHE (solo para recuperación post-reinicio)
CREATE OR ALTER PROC dbo.sp_rcn_cont_cache_upsert
  @telcod        VARCHAR(10),
  @sescod        BIGINT       = NULL,
  @tracod        VARCHAR(15)  = NULL,
  @traraz        VARCHAR(120) = NULL,
  @turno_cod     CHAR(1)      = NULL,
  @session_active BIT         = 0,
  @hil_act       INT          = 0,
  @hil_turno     INT          = 0,
  @hil_start     INT          = 0,
  @set_value     INT          = 0,
  @velocidad     INT          = 0
AS
BEGIN
  SET NOCOUNT ON;

  MERGE dbo.RCN_CONT_CACHE AS T
  USING (SELECT @telcod AS telcod) AS S
  ON (T.telcod = S.telcod)
  WHEN MATCHED THEN
    UPDATE SET
      sescod        = @sescod,
      tracod        = @tracod,
      traraz        = @traraz,
      turno_cod     = @turno_cod,
      session_active= @session_active,
      hil_act       = @hil_act,
      hil_turno     = @hil_turno,
      hil_start     = @hil_start,
      set_value     = @set_value,
      velocidad     = @velocidad,
      updated_at    = SYSDATETIME()
  WHEN NOT MATCHED THEN
    INSERT (telcod, sescod, tracod, traraz, turno_cod, session_active, hil_act, hil_turno, hil_start, set_value, velocidad, updated_at)
    VALUES (@telcod, @sescod, @tracod, @traraz, @turno_cod, @session_active, @hil_act, @hil_turno, @hil_start, @set_value, @velocidad, SYSDATETIME());
END
GO

-- Registrar (o reintentar) INICIO_TURNO (idempotente por índice único)
CREATE OR ALTER PROC dbo.sp_rcn_cont_registrar_inicio
  @sescod   BIGINT,
  @telcod   VARCHAR(10),
  @ts       DATETIME2 = NULL,
  @hil_act  INT = NULL,
  @hil_turno INT = NULL,
  @hil_start INT = NULL,
  @set_value INT = NULL,
  @tracod    VARCHAR(15) = NULL
AS
BEGIN
  SET NOCOUNT ON;
  IF @ts IS NULL SET @ts = SYSDATETIME();

  MERGE dbo.RCN_CONT_LECTURA AS T
  USING (SELECT @sescod AS sescod, @telcod AS telcod) AS S
  ON (T.sescod = S.sescod AND T.telcod = S.telcod AND T.tipo = 'INICIO_TURNO')
  WHEN MATCHED THEN
    UPDATE SET ts=@ts, hil_act=@hil_act, hil_turno=@hil_turno, hil_start=@hil_start, set_value=@set_value, tracod=@tracod
  WHEN NOT MATCHED THEN
    INSERT (sescod, telcod, ts, tipo, hil_act, hil_turno, hil_start, set_value, tracod)
    VALUES (@sescod, @telcod, @ts, 'INICIO_TURNO', @hil_act, @hil_turno, @hil_start, @set_value, @tracod);
END
GO

-- Registrar (o reintentar) FIN_TURNO (idempotente por índice único)
CREATE OR ALTER PROC dbo.sp_rcn_cont_registrar_fin
  @sescod   BIGINT,
  @telcod   VARCHAR(10),
  @ts       DATETIME2 = NULL,
  @hil_act  INT = NULL,
  @hil_turno INT = NULL,
  @hil_start INT = NULL,
  @set_value INT = NULL,
  @tracod    VARCHAR(15) = NULL
AS
BEGIN
  SET NOCOUNT ON;
  IF @ts IS NULL SET @ts = SYSDATETIME();

  MERGE dbo.RCN_CONT_LECTURA AS T
  USING (SELECT @sescod AS sescod, @telcod AS telcod) AS S
  ON (T.sescod = S.sescod AND T.telcod = S.telcod AND T.tipo = 'FIN_TURNO')
  WHEN MATCHED THEN
    UPDATE SET ts=@ts, hil_act=@hil_act, hil_turno=@hil_turno, hil_start=@hil_start, set_value=@set_value, tracod=@tracod
  WHEN NOT MATCHED THEN
    INSERT (sescod, telcod, ts, tipo, hil_act, hil_turno, hil_start, set_value, tracod)
    VALUES (@sescod, @telcod, @ts, 'FIN_TURNO', @hil_act, @hil_turno, @hil_start, @set_value, @tracod);
END
GO

/* ============================================================
   NOTAS OPERATIVAS (resumen rápido)
   - CACHE es SOLO para recuperación post-reinicio:
     · Al arrancar worker: SELECT * FROM VW_RCN_CONT_RECOVERY.
     · Luego ya no lo lees; solo haces upserts periódicos (cada ~10–30 s)
       o al cambiar valores relevantes, por resiliencia.
   - INICIO/FIN por (sescod,telcod) quedan garantizados por índices únicos.
   - Vista de resumen te da métricas listas sin tablas extra.
============================================================ */


/* ============================================================
   UPSERT telarMap -> dbo.RCN_CONT_TELAR
   - CALC: calc_pulse_offset = holdingOffset; PLC* = NULL
   - PLC : plc_base_offset   = holdingOffset; relativos 0/4/6/7/10; coils 100/101
   - Grupo desde main-supervisor.js:
       * Consumo:   (lista explícita)
       * Rashell:   rasch1..rasch6
       * Muketsu:   shogun1,3,4,5,6,7,8,9,10,11,12
       * Anchoveteros: el resto de numéricos
============================================================ */

;WITH src AS (
  SELECT * FROM (VALUES
    /* telcod, telnom       , modbus_ip        , port, unit, modo  , calc_pulse , plc_base , hil_act , vel , hil_turno , set , hil_start , coil_rst, coil_fin , activo */

    -- === PLC (único) ===
    ('0069'  , 'Telar 69'   , '192.168.1.115'  , 502 , 1   , 'PLC' , NULL       , 20000    , 0       , 4   , 6         , 7   , 10        , 100     , 101      , 1),

    -- === CALC (delta) ===
    ('T001'  , 'Telar 01'   , '192.168.1.41'   , 502 , 1   , 'CALC', 18         , NULL     , NULL    , NULL, NULL      , NULL, NULL      , NULL    , NULL     , 1),
    ('T002'  , 'Telar 02'   , '192.168.1.41'   , 502 , 1   , 'CALC', 20         , NULL     , NULL    , NULL, NULL      , NULL, NULL      , NULL    , NULL     , 1),
    ('T003'  , 'Telar 03'   , '192.168.1.42'   , 502 , 1   , 'CALC', 16         , NULL     , NULL    , NULL, NULL      , NULL, NULL      , NULL    , NULL     , 1),
    ('T004'  , 'Telar 04'   , '192.168.1.41'   , 502 , 1   , 'CALC', 2          , NULL     , NULL    , NULL, NULL      , NULL, NULL      , NULL    , NULL     , 1),
    ('T005'  , 'Telar 05'   , '192.168.1.41'   , 502 , 1   , 'CALC', 0          , NULL     , NULL    , NULL, NULL      , NULL, NULL      , NULL    , NULL     , 1),
    ('T006'  , 'Telar 06'   , '192.168.1.51'   , 502 , 1   , 'CALC', 0          , NULL     , NULL    , NULL, NULL      , NULL, NULL      , NULL    , NULL     , 1),
    ('T007'  , 'Telar 07'   , '192.168.1.51'   , 502 , 1   , 'CALC', 2          , NULL     , NULL    , NULL, NULL      , NULL, NULL      , NULL    , NULL     , 1),
    ('T008'  , 'Telar 08'   , '192.168.1.42'   , 502 , 1   , 'CALC', 10         , NULL     , NULL    , NULL, NULL      , NULL, NULL      , NULL    , NULL     , 1),
    ('T009'  , 'Telar 09'   , '192.168.1.51'   , 502 , 1   , 'CALC', 4          , NULL     , NULL    , NULL, NULL      , NULL, NULL      , NULL    , NULL     , 1),
    ('T010'  , 'Telar 10'   , '192.168.1.51'   , 502 , 1   , 'CALC', 6          , NULL     , NULL    , NULL, NULL      , NULL, NULL      , NULL    , NULL     , 1),
    ('T011'  , 'Telar 11'   , '192.168.1.42'   , 502 , 1   , 'CALC', 8          , NULL     , NULL    , NULL, NULL      , NULL, NULL      , NULL    , NULL     , 1),

    ('0059'  , 'Telar 59'   , '192.168.1.47'   , 502 , 1   , 'CALC', 24         , NULL     , NULL    , NULL, NULL      , NULL, NULL      , NULL    , NULL     , 1),
    ('0060'  , 'Telar 60'   , '192.168.1.47'   , 502 , 1   , 'CALC', 26         , NULL     , NULL    , NULL, NULL      , NULL, NULL      , NULL    , NULL     , 1),
    ('0061'  , 'Telar 61'   , '192.168.1.47'   , 502 , 1   , 'CALC', 28         , NULL     , NULL    , NULL, NULL      , NULL, NULL      , NULL    , NULL     , 1),
    ('0062'  , 'Telar 62'   , '192.168.1.47'   , 502 , 1   , 'CALC', 30         , NULL     , NULL    , NULL, NULL      , NULL, NULL      , NULL    , NULL     , 1),

    ('0063'  , 'Telar 63'   , '192.168.1.51'   , 502 , 1   , 'CALC', 8          , NULL     , NULL    , NULL, NULL      , NULL, NULL      , NULL    , NULL     , 1),
    ('0064'  , 'Telar 64'   , '192.168.1.51'   , 502 , 1   , 'CALC', 10         , NULL     , NULL    , NULL, NULL      , NULL, NULL      , NULL    , NULL     , 1),
    ('0065'  , 'Telar 65'   , '192.168.1.51'   , 502 , 1   , 'CALC', 14         , NULL     , NULL    , NULL, NULL      , NULL, NULL      , NULL    , NULL     , 1),
    ('0066'  , 'Telar 66'   , '192.168.1.51'   , 502 , 1   , 'CALC', 16         , NULL     , NULL    , NULL, NULL      , NULL, NULL      , NULL    , NULL     , 1),

    ('0067'  , 'Telar 67'   , '192.168.1.52'   , 502 , 1   , 'CALC', 2          , NULL     , NULL    , NULL, NULL      , NULL, NULL      , NULL    , NULL     , 1),
    ('0068'  , 'Telar 68'   , '192.168.1.52'   , 502 , 1   , 'CALC', 0          , NULL     , NULL    , NULL, NULL      , NULL, NULL      , NULL    , NULL     , 1),

    ('0070'  , 'Telar 70'   , '192.168.1.42'   , 502 , 1   , 'CALC', 4          , NULL     , NULL    , NULL, NULL      , NULL, NULL      , NULL    , NULL     , 1),

    -- Telar 74..79 (mapeado 2130..2135)
    ('2130'  , 'Telar 74'   , '192.168.1.40'   , 502 , 1   , 'CALC', 4          , NULL     , NULL    , NULL, NULL      , NULL, NULL      , NULL    , NULL     , 1),
    ('2131'  , 'Telar 75'   , '192.168.1.40'   , 502 , 1   , 'CALC', 6          , NULL     , NULL    , NULL, NULL      , NULL, NULL      , NULL    , NULL     , 1),
    ('2132'  , 'Telar 76'   , '192.168.1.51'   , 502 , 1   , 'CALC', 20         , NULL     , NULL    , NULL, NULL      , NULL, NULL      , NULL    , NULL     , 1),
    ('2133'  , 'Telar 77'   , '192.168.1.40'   , 502 , 1   , 'CALC', 10         , NULL     , NULL    , NULL, NULL      , NULL, NULL      , NULL    , NULL     , 1),
    ('2134'  , 'Telar 78'   , '192.168.1.40'   , 502 , 1   , 'CALC', 12         , NULL     , NULL    , NULL, NULL      , NULL, NULL      , NULL    , NULL     , 1),
    ('2135'  , 'Telar 79'   , '192.168.1.41'   , 502 , 1   , 'CALC', 6          , NULL     , NULL    , NULL, NULL      , NULL, NULL      , NULL    , NULL     , 1),

    -- Telar 81..89 (mapeado 2333..2341)
    ('2333'  , 'Telar 81'   , '192.168.1.40'   , 502 , 1   , 'CALC', 14         , NULL     , NULL    , NULL, NULL      , NULL, NULL      , NULL    , NULL     , 1),
    ('2334'  , 'Telar 82'   , '192.168.1.43'   , 502 , 1   , 'CALC', 14         , NULL     , NULL    , NULL, NULL      , NULL, NULL      , NULL    , NULL     , 1),
    ('2335'  , 'Telar 83'   , '192.168.1.43'   , 502 , 1   , 'CALC', 16         , NULL     , NULL    , NULL, NULL      , NULL, NULL      , NULL    , NULL     , 1),
    ('2336'  , 'Telar 84'   , '192.168.1.43'   , 502 , 1   , 'CALC', 18         , NULL     , NULL    , NULL, NULL      , NULL, NULL      , NULL    , NULL     , 1),
    ('2337'  , 'Telar 85'   , '192.168.1.43'   , 502 , 1   , 'CALC', 20         , NULL     , NULL    , NULL, NULL      , NULL, NULL      , NULL    , NULL     , 1),
    ('2338'  , 'Telar 86'   , '192.168.1.43'   , 502 , 1   , 'CALC', 22         , NULL     , NULL    , NULL, NULL      , NULL, NULL      , NULL    , NULL     , 1),
    ('2339'  , 'Telar 87'   , '192.168.1.40'   , 502 , 1   , 'CALC', 16         , NULL     , NULL    , NULL, NULL      , NULL, NULL      , NULL    , NULL     , 1),
    ('2340'  , 'Telar 88'   , '192.168.1.40'   , 502 , 1   , 'CALC', 18         , NULL     , NULL    , NULL, NULL      , NULL, NULL      , NULL    , NULL     , 1),
    ('2341'  , 'Telar 89'   , '192.168.1.42'   , 502 , 1   , 'CALC', 2          , NULL     , NULL    , NULL, NULL      , NULL, NULL      , NULL    , NULL     , 1),

    ('0090'  , 'Telar 90'   , '192.168.1.41'   , 502 , 1   , 'CALC', 8          , NULL     , NULL    , NULL, NULL      , NULL, NULL      , NULL    , NULL     , 1),
    ('0091'  , 'Telar 91'   , '192.168.1.41'   , 502 , 1   , 'CALC', 10         , NULL     , NULL    , NULL, NULL      , NULL, NULL      , NULL    , NULL     , 1),
    ('0092'  , 'Telar 92'   , '192.168.1.41'   , 502 , 1   , 'CALC', 12         , NULL     , NULL    , NULL, NULL      , NULL, NULL      , NULL    , NULL     , 1),
    ('0093'  , 'Telar 93'   , '192.168.1.41'   , 502 , 1   , 'CALC', 14         , NULL     , NULL    , NULL, NULL      , NULL, NULL      , NULL    , NULL     , 1),
    ('0094'  , 'Telar 94'   , '192.168.1.41'   , 502 , 1   , 'CALC', 4          , NULL     , NULL    , NULL, NULL      , NULL, NULL      , NULL    , NULL     , 1),

    ('0095'  , 'Telar 95'   , '192.168.1.42'   , 502 , 1   , 'CALC', 6          , NULL     , NULL    , NULL, NULL      , NULL, NULL      , NULL    , NULL     , 1),
    ('0096'  , 'Telar 96'   , '192.168.1.42'   , 502 , 1   , 'CALC', 12         , NULL     , NULL    , NULL, NULL      , NULL, NULL      , NULL    , NULL     , 1),
    ('0097'  , 'Telar 97'   , '192.168.1.42'   , 502 , 1   , 'CALC', 18         , NULL     , NULL    , NULL, NULL      , NULL, NULL      , NULL    , NULL     , 1),

    ('0098'  , 'Telar 98'   , '192.168.1.40'   , 502 , 1   , 'CALC', 20         , NULL     , NULL    , NULL, NULL      , NULL, NULL      , NULL    , NULL     , 1),
    ('0099'  , 'Telar 99'   , '192.168.1.40'   , 502 , 1   , 'CALC', 22         , NULL     , NULL    , NULL, NULL      , NULL, NULL      , NULL    , NULL     , 1),

    ('T100'  , 'Telar 100'  , '192.168.1.41'   , 502 , 1   , 'CALC', 16         , NULL     , NULL    , NULL, NULL      , NULL, NULL      , NULL    , NULL     , 1),
    ('T101'  , 'Telar 101'  , '192.168.1.51'   , 502 , 1   , 'CALC', 12         , NULL     , NULL    , NULL, NULL      , NULL, NULL      , NULL    , NULL     , 1),

    -- Rashell (1..6)
    ('2154'  , 'Rashell 1'  , '192.168.1.43'   , 502 , 1   , 'CALC', 0          , NULL     , NULL    , NULL, NULL      , NULL, NULL      , NULL    , NULL     , 1),
    ('2147'  , 'Rashell 2'  , '192.168.1.43'   , 502 , 1   , 'CALC', 2          , NULL     , NULL    , NULL, NULL      , NULL, NULL      , NULL    , NULL     , 1),
    ('2150'  , 'Rashell 3'  , '192.168.1.43'   , 502 , 1   , 'CALC', 4          , NULL     , NULL    , NULL, NULL      , NULL, NULL      , NULL    , NULL     , 1),
    ('2151'  , 'Rashell 4'  , '192.168.1.43'   , 502 , 1   , 'CALC', 6          , NULL     , NULL    , NULL, NULL      , NULL, NULL      , NULL    , NULL     , 1),
    ('2153'  , 'Rashell 5'  , '192.168.1.43'   , 502 , 1   , 'CALC', 8          , NULL     , NULL    , NULL, NULL      , NULL, NULL      , NULL    , NULL     , 1),
    ('2152'  , 'Rashell 6'  , '192.168.1.43'   , 502 , 1   , 'CALC', 10         , NULL     , NULL    , NULL, NULL      , NULL, NULL      , NULL    , NULL     , 1),

    -- Shogun (Muketsu)
    ('2176'  , 'Shogun 1'   , '192.168.1.44'   , 502 , 1   , 'CALC', 0          , NULL     , NULL    , NULL, NULL      , NULL, NULL      , NULL    , NULL     , 1),
    ('2319'  , 'Shogun 10'  , '192.168.1.44'   , 502 , 1   , 'CALC', 4          , NULL     , NULL    , NULL, NULL      , NULL, NULL      , NULL    , NULL     , 1),
    ('2320'  , 'Shogun 11'  , '192.168.1.44'   , 502 , 1   , 'CALC', 6          , NULL     , NULL    , NULL, NULL      , NULL, NULL      , NULL    , NULL     , 1),
    ('2321'  , 'Shogun 12'  , '192.168.1.44'   , 502 , 1   , 'CALC', 8          , NULL     , NULL    , NULL, NULL      , NULL, NULL      , NULL    , NULL     , 1),
    ('2322'  , 'Shogun 3'   , '192.168.1.44'   , 502 , 1   , 'CALC', 10         , NULL     , NULL    , NULL, NULL      , NULL, NULL      , NULL    , NULL     , 1),
    ('2323'  , 'Shogun 4'   , '192.168.1.44'   , 502 , 1   , 'CALC', 12         , NULL     , NULL    , NULL, NULL      , NULL, NULL      , NULL    , NULL     , 1),
    ('2324'  , 'Shogun 5'   , '192.168.1.44'   , 502 , 1   , 'CALC', 14         , NULL     , NULL    , NULL, NULL      , NULL, NULL      , NULL    , NULL     , 1),
    ('2325'  , 'Shogun 6'   , '192.168.1.44'   , 502 , 1   , 'CALC', 16         , NULL     , NULL    , NULL, NULL      , NULL, NULL      , NULL    , NULL     , 1),
    ('2326'  , 'Shogun 7'   , '192.168.1.44'   , 502 , 1   , 'CALC', 18         , NULL     , NULL    , NULL, NULL      , NULL, NULL      , NULL    , NULL     , 1),
    ('2327'  , 'Shogun 8'   , '192.168.1.44'   , 502 , 1   , 'CALC', 20         , NULL     , NULL    , NULL, NULL      , NULL, NULL      , NULL    , NULL     , 1),
    ('2328'  , 'Shogun 9'   , '192.168.1.44'   , 502 , 1   , 'CALC', 22         , NULL     , NULL    , NULL, NULL      , NULL, NULL      , NULL    , NULL     , 1)
  ) AS v(
     telcod, telnom, modbus_ip, modbus_port, modbus_unit_id, modo, calc_pulse_offset,
     plc_base_offset, plc_hil_act_rel, plc_velocidad_rel, plc_hil_turno_rel, plc_set_rel,
     plc_hil_start_rel, plc_coil_reset, plc_coil_fin_turno, activo
  )
),

-- Clasificación de grupo (NO tocar telnom)
src_grouped AS (
  SELECT
    -- columnas que pasan tal cual desde src
    v.telcod,
    v.telnom,  -- ← ya viene seteado en src (Telar 01, Rashell 1, Shogun 10, etc.)
    v.modbus_ip, v.modbus_port, v.modbus_unit_id,
    v.modo, v.calc_pulse_offset,
    v.plc_base_offset, v.plc_hil_act_rel, v.plc_velocidad_rel, v.plc_hil_turno_rel,
    v.plc_set_rel, v.plc_hil_start_rel, v.plc_coil_reset, v.plc_coil_fin_turno,
    v.activo,

    /* Solo el grupo por listas explícitas */
    CASE
      -- Rashell (antes: rasch1..rasch6)
      WHEN v.telcod IN ('2154','2147','2150','2151','2153','2152') THEN 'Rashell'
      -- Shogun / Muketsu (antes: shogun1,3,4..12)
      WHEN v.telcod IN ('2176','2319','2320','2321','2322','2323','2324','2325','2326','2327','2328') THEN 'Muketsu'
      -- Consumo (equivalente a: 01..11, 78,79,81,88,89,98,99,100,101)
      WHEN v.telcod IN ('T001','T002','T003','T004','T005','T006','T007','T008','T009','T010','T011',
                        '2134','2135','2333','2340','2341','0098','0099','T100','T101') THEN 'Consumo'
      ELSE 'Anchoveteros'
    END AS grupo
  FROM src v
)


MERGE dbo.RCN_CONT_TELAR AS T
USING src_grouped AS S
  ON T.telcod = S.telcod
WHEN MATCHED THEN
  UPDATE SET
    T.telnom              = S.telnom,
    T.grupo               = S.grupo,
    T.modbus_ip           = S.modbus_ip,
    T.modbus_port         = S.modbus_port,
    T.modbus_unit_id      = S.modbus_unit_id,
    T.modo                = S.modo,
    T.calc_pulse_offset   = CASE WHEN S.modo='CALC' THEN S.calc_pulse_offset ELSE NULL END,
    T.plc_base_offset     = CASE WHEN S.modo='PLC'  THEN S.plc_base_offset   ELSE NULL END,
    T.plc_hil_act_rel     = CASE WHEN S.modo='PLC'  THEN S.plc_hil_act_rel   ELSE NULL END,
    T.plc_velocidad_rel   = CASE WHEN S.modo='PLC'  THEN S.plc_velocidad_rel ELSE NULL END,
    T.plc_hil_turno_rel   = CASE WHEN S.modo='PLC'  THEN S.plc_hil_turno_rel ELSE NULL END,
    T.plc_set_rel         = CASE WHEN S.modo='PLC'  THEN S.plc_set_rel       ELSE NULL END,
    T.plc_hil_start_rel   = CASE WHEN S.modo='PLC'  THEN S.plc_hil_start_rel ELSE NULL END,
    T.plc_coil_reset      = CASE WHEN S.modo='PLC'  THEN S.plc_coil_reset    ELSE NULL END,
    T.plc_coil_fin_turno  = CASE WHEN S.modo='PLC'  THEN S.plc_coil_fin_turno ELSE NULL END,
    T.activo              = S.activo
WHEN NOT MATCHED THEN
  INSERT (telcod, telnom, grupo, modbus_ip, modbus_port, modbus_unit_id, modo,
          calc_pulse_offset, plc_base_offset, plc_hil_act_rel, plc_velocidad_rel,
          plc_hil_turno_rel, plc_set_rel, plc_hil_start_rel, plc_coil_reset,
          plc_coil_fin_turno, activo)
  VALUES (S.telcod, S.telnom, S.grupo, S.modbus_ip, S.modbus_port, S.modbus_unit_id, S.modo,
          CASE WHEN S.modo='CALC' THEN S.calc_pulse_offset ELSE NULL END,
          CASE WHEN S.modo='PLC'  THEN S.plc_base_offset   ELSE NULL END,
          CASE WHEN S.modo='PLC'  THEN S.plc_hil_act_rel   ELSE NULL END,
          CASE WHEN S.modo='PLC'  THEN S.plc_velocidad_rel ELSE NULL END,
          CASE WHEN S.modo='PLC'  THEN S.plc_hil_turno_rel ELSE NULL END,
          CASE WHEN S.modo='PLC'  THEN S.plc_set_rel       ELSE NULL END,
          CASE WHEN S.modo='PLC'  THEN S.plc_hil_start_rel ELSE NULL END,
          CASE WHEN S.modo='PLC'  THEN S.plc_coil_reset    ELSE NULL END,
          CASE WHEN S.modo='PLC'  THEN S.plc_coil_fin_turno ELSE NULL END,
          S.activo);
GO

/* Vista opcional con alias "front-friendly" (holdingOffset según modo) */
CREATE OR ALTER VIEW dbo.VW_RCN_CONT_TELAR_MAP
AS
SELECT
  telcod                              AS telarKey,
  telcod                              AS sqlTelar,
  telnom,
  grupo,
  modbus_ip                           AS modbusIP,
  modbus_port                         AS modbusPort,
  modbus_unit_id                      AS modbusID,
  CASE WHEN modo = 'PLC' THEN plc_base_offset ELSE calc_pulse_offset END AS holdingOffset,
  modo                                AS [mode],
  plc_coil_reset                      AS coilReset,
  plc_coil_fin_turno                  AS coilFinTurno,
  activo
FROM dbo.RCN_CONT_TELAR
WHERE activo = 1;
GO
