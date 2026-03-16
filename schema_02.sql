/* ============================================================
RCN Contadores — Schema 02
Histórico de operaciones / productos por telar
Base: ZENTRIK

OBJETIVO
- Guardar qué producto estuvo corriendo en cada telar
- Guardar sus batch / tarjeta / OT
- Permitir que una operación dure varios turnos o días
- Permitir que varias sesiones trabajen la misma operación
- Permitir que una sesión trabaje varias operaciones

FUENTE EXTERNA
USE [Medidores_2023];
GO
EXEC dbo.PA_PRD_SCADA001 '01', '0069';

Campos relevantes del SP:
periodo, fecusucre, ctcod, ctnom, semana, anio, fecha, turno,
otcod, procod, pronom, tejtitulo, tarjeta, batch,
inicio, final, tejfin, opecod, openom

REGLAS CLAVE
- La operación NO se corta porque cambie la sesión
- La operación SÍ se corta cuando:
    1) cambia el conjunto batch/tarjeta/otcod/procod
    2) desaparece del SP
    3) tejfin = 1 (terminó)
- Las sesiones que participaron se guardan aparte
============================================================ */
USE [ZENTRIK];
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO


/* ============================================================
1) ÍNDICE AUXILIAR SOBRE TABLA EXISTENTE
---------------------------------------------------------------
Sirve para encontrar rápido la sesión activa de un telar.
No cambia tu lógica actual; solo ayuda a la futura sincronización.
============================================================ */
IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'IX_RCN_CONT_SESION_TELAR_telar_sescod_activo'
      AND object_id = OBJECT_ID('dbo.RCN_CONT_SESION_TELAR')
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_RCN_CONT_SESION_TELAR_telar_sescod_activo
        ON dbo.RCN_CONT_SESION_TELAR (telcod, sescod, asignado_desde)
        WHERE activo = 1;
END
GO


/* ============================================================
2) CABECERA DE OPERACIÓN
---------------------------------------------------------------
1 fila = 1 operación/producto corriendo en un telar.

Ejemplo:
- Telar 0069
- Producto X
- empieza hoy 10:40
- termina mañana 06:20

Eso será UNA sola operación, aunque haya varias sesiones en medio.
============================================================ */
IF OBJECT_ID('dbo.RCN_CONT_OPERACION', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.RCN_CONT_OPERACION (
        opid BIGINT NOT NULL IDENTITY(1,1),

        /* ====================================================
           COLUMNA CLAVE
           Telar donde corre la operación
        ==================================================== */
        telcod VARCHAR(10) NOT NULL,

        /* ====================================================
           HORAS REALES DEL HISTÓRICO EN ZENTRIK
           Estas son las más importantes de esta tabla.
           
           operacion_inicio:
           - hora en que TU sistema detectó que esta operación empezó

           operacion_fin:
           - hora en que TU sistema detectó que esta operación terminó
           - será NULL mientras siga activa
        ==================================================== */
        operacion_inicio DATETIME2 NOT NULL,
        operacion_fin    DATETIME2 NULL,

        /* ====================================================
           ESTADO DE LA OPERACIÓN
           
           activo = 1 -> sigue corriendo
           activo = 0 -> ya cerró

           estado:
           A = Activa
           F = Finalizada
           X = Anulada / descartada manualmente
        ==================================================== */
        activo           BIT       NOT NULL CONSTRAINT DF_RCN_CONT_OPERACION_activo DEFAULT (1),
        estado           CHAR(1)   NOT NULL CONSTRAINT DF_RCN_CONT_OPERACION_estado DEFAULT ('A'),
        last_seen_ok_at  DATETIME2 NULL,

        /* ====================================================
           METADATA DE ORIGEN (copiada del SP cuando la operación
           se abrió por primera vez).
           
           Estas columnas NO son las que deben usarse para detectar
           cambios de operación. Sirven para trazabilidad y reportes.
        ==================================================== */
        periodo_sp        CHAR(6)      NULL,  -- ej. 202603
        fecusucre_sp      DATETIME2    NULL,  -- timestamp del origen
        ctcod_sp          VARCHAR(10)  NULL,  -- centro de trabajo origen
        ctnom_sp          VARCHAR(80)  NULL,  -- nombre del centro de trabajo
        semana_sp         SMALLINT     NULL,
        anio_sp           SMALLINT     NULL,
        fecha_sp          DATE         NOT NULL, -- fecha productiva que devolvió el SP al inicio
        turno_sp          CHAR(1)      NOT NULL, -- turno que devolvió el SP al inicio

        CONSTRAINT PK_RCN_CONT_OPERACION PRIMARY KEY CLUSTERED (opid),

        CONSTRAINT FK_RCN_CONT_OPERACION_TEL FOREIGN KEY (telcod)
            REFERENCES dbo.RCN_CONT_TELAR(telcod),

        CONSTRAINT FK_RCN_CONT_OPERACION_TURNO FOREIGN KEY (turno_sp)
            REFERENCES dbo.RCN_CONT_TURNO(turno_cod),

        CONSTRAINT CK_RCN_CONT_OPERACION_estado
            CHECK (estado IN ('A','F','X')),

        CONSTRAINT CK_RCN_CONT_OPERACION_fechas
            CHECK (operacion_fin IS NULL OR operacion_fin >= operacion_inicio)
    );
END
GO

/* ------------------------------------------------------------
Solo puede existir 1 operación activa por telar
------------------------------------------------------------ */
IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'UQ_RCN_CONT_OPERACION_telar_activa'
      AND object_id = OBJECT_ID('dbo.RCN_CONT_OPERACION')
)
BEGIN
    CREATE UNIQUE INDEX UQ_RCN_CONT_OPERACION_telar_activa
        ON dbo.RCN_CONT_OPERACION (telcod)
        WHERE activo = 1;
END
GO

/* ------------------------------------------------------------
Índice para revisar histórico de un telar
------------------------------------------------------------ */
IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'IX_RCN_CONT_OPERACION_telar_inicio'
      AND object_id = OBJECT_ID('dbo.RCN_CONT_OPERACION')
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_RCN_CONT_OPERACION_telar_inicio
        ON dbo.RCN_CONT_OPERACION (telcod, operacion_inicio DESC);
END
GO

/* ------------------------------------------------------------
Índice para reportes por fecha/turno/telar
------------------------------------------------------------ */
IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'IX_RCN_CONT_OPERACION_reporte'
      AND object_id = OBJECT_ID('dbo.RCN_CONT_OPERACION')
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_RCN_CONT_OPERACION_reporte
        ON dbo.RCN_CONT_OPERACION (fecha_sp, turno_sp, telcod, operacion_inicio);
END
GO


/* ============================================================
3) DETALLE DE OPERACIÓN
---------------------------------------------------------------
1 fila = 1 item/batch dentro de la operación

Si el SP devuelve:
- batch 1
- batch 2
- batch 3

entonces habrá:
- 1 fila en RCN_CONT_OPERACION
- 3 filas en RCN_CONT_OPERACION_ITEM
============================================================ */
IF OBJECT_ID('dbo.RCN_CONT_OPERACION_ITEM', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.RCN_CONT_OPERACION_ITEM (
        op_item_id BIGINT NOT NULL IDENTITY(1,1),

        /* ====================================================
           A qué operación pertenece este item
        ==================================================== */
        opid BIGINT NOT NULL,

        /* ====================================================
           CAMPOS DE NEGOCIO MÁS IMPORTANTES
           
           batch:
           - número de batch dentro del telar/operación

           tarjeta:
           - tarjeta asignada

           otcod:
           - OT asignada

           procod:
           - código de producto

           pronom:
           - nombre del producto
        ==================================================== */
        batch    INT          NOT NULL,
        tarjeta  VARCHAR(40)  NULL,
        otcod    VARCHAR(30)  NULL,
        procod   VARCHAR(60)  NULL,
        pronom   VARCHAR(250) NULL,
        tejtitulo VARCHAR(50) NULL,

        /* ====================================================
           FLAGS DEL SP
           
           sp_inicio_flag:
           - copia de la columna [inicio] del SP
           
           sp_final_flag:
           - copia de la columna [final] del SP

           sp_tejfin_flag:
           - copia de la columna [tejfin] del SP
           - ESTA ES MUY IMPORTANTE:
               0 = sigue en proceso
               1 = ya terminó
           
           OJO:
           estos campos NO son horas
        ==================================================== */
        sp_inicio_flag TINYINT NULL,
        sp_final_flag  TINYINT NULL,
        sp_tejfin_flag TINYINT NULL,

        /* ====================================================
           OPERARIO SEGÚN EL SP EXTERNO
           
           Esto no reemplaza a tus sesiones internas.
           Solo conserva el operario que vino del sistema externo.
        ==================================================== */
        opecod VARCHAR(15)  NULL,
        openom VARCHAR(150) NULL,

        CONSTRAINT PK_RCN_CONT_OPERACION_ITEM PRIMARY KEY CLUSTERED (op_item_id),

        CONSTRAINT FK_RCN_CONT_OPERACION_ITEM_OP FOREIGN KEY (opid)
            REFERENCES dbo.RCN_CONT_OPERACION(opid),

        CONSTRAINT CK_RCN_CONT_OPERACION_ITEM_batch
            CHECK (batch > 0),

        CONSTRAINT CK_RCN_CONT_OPERACION_ITEM_sp_tejfin_flag
            CHECK (sp_tejfin_flag IS NULL OR sp_tejfin_flag IN (0,1))
    );
END
GO

/* ------------------------------------------------------------
En una misma operación, un batch no debe repetirse
------------------------------------------------------------ */
IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'UQ_RCN_CONT_OPERACION_ITEM_opid_batch'
      AND object_id = OBJECT_ID('dbo.RCN_CONT_OPERACION_ITEM')
)
BEGIN
    CREATE UNIQUE INDEX UQ_RCN_CONT_OPERACION_ITEM_opid_batch
        ON dbo.RCN_CONT_OPERACION_ITEM (opid, batch);
END
GO

/* ------------------------------------------------------------
Búsqueda por OT / tarjeta / batch
------------------------------------------------------------ */
IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'IX_RCN_CONT_OPERACION_ITEM_busqueda'
      AND object_id = OBJECT_ID('dbo.RCN_CONT_OPERACION_ITEM')
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_RCN_CONT_OPERACION_ITEM_busqueda
        ON dbo.RCN_CONT_OPERACION_ITEM (otcod, tarjeta, batch);
END
GO

/* ------------------------------------------------------------
Búsqueda por producto
------------------------------------------------------------ */
IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'IX_RCN_CONT_OPERACION_ITEM_producto'
      AND object_id = OBJECT_ID('dbo.RCN_CONT_OPERACION_ITEM')
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_RCN_CONT_OPERACION_ITEM_producto
        ON dbo.RCN_CONT_OPERACION_ITEM (procod, otcod);
END
GO


/* ============================================================
4) PUENTE OPERACIÓN <-> SESIÓN
---------------------------------------------------------------
Esta tabla resuelve el caso real de planta:

- una operación puede tener varias sesiones
- una sesión puede tener varias operaciones

Ejemplo:
Producto A dura 2 días.
Lo trabaja sesión 101, luego 115, luego 132.
Todo eso queda aquí.
============================================================ */
IF OBJECT_ID('dbo.RCN_CONT_OPERACION_SESION', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.RCN_CONT_OPERACION_SESION (
        op_ses_id BIGINT NOT NULL IDENTITY(1,1),

        /* ====================================================
           A qué operación y a qué sesión pertenece este tramo
        ==================================================== */
        opid   BIGINT NOT NULL,
        sescod BIGINT NOT NULL,

        /* ====================================================
           HORAS DE PARTICIPACIÓN DE ESA SESIÓN EN ESA OPERACIÓN
           
           participa_desde:
           - desde cuándo esa sesión trabajó esta operación
           
           participa_hasta:
           - hasta cuándo la trabajó
           - puede ser NULL mientras siga activa
        ==================================================== */
        participa_desde DATETIME2 NOT NULL,
        participa_hasta DATETIME2 NULL,

        /* ====================================================
           activo = 1 mientras esa sesión siga ligada a la operación
        ==================================================== */
        activo BIT NOT NULL CONSTRAINT DF_RCN_CONT_OPERACION_SESION_activo DEFAULT (1),

        CONSTRAINT PK_RCN_CONT_OPERACION_SESION PRIMARY KEY CLUSTERED (op_ses_id),

        CONSTRAINT FK_RCN_CONT_OPERACION_SESION_OP FOREIGN KEY (opid)
            REFERENCES dbo.RCN_CONT_OPERACION(opid),

        CONSTRAINT FK_RCN_CONT_OPERACION_SESION_SES FOREIGN KEY (sescod)
            REFERENCES dbo.RCN_CONT_SESION(sescod),

        CONSTRAINT CK_RCN_CONT_OPERACION_SESION_fechas
            CHECK (participa_hasta IS NULL OR participa_hasta >= participa_desde)
    );
END
GO

/* ------------------------------------------------------------
Solo una sesión activa a la vez por operación
(esto cuadra con tu modelo actual donde un telar no debería
tener dos sesiones activas al mismo tiempo en la app)
------------------------------------------------------------ */
IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'UQ_RCN_CONT_OPERACION_SESION_opid_activa'
      AND object_id = OBJECT_ID('dbo.RCN_CONT_OPERACION_SESION')
)
BEGIN
    CREATE UNIQUE INDEX UQ_RCN_CONT_OPERACION_SESION_opid_activa
        ON dbo.RCN_CONT_OPERACION_SESION (opid)
        WHERE activo = 1;
END
GO

/* ------------------------------------------------------------
Consulta: qué operaciones trabajó una sesión
------------------------------------------------------------ */
IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'IX_RCN_CONT_OPERACION_SESION_sescod'
      AND object_id = OBJECT_ID('dbo.RCN_CONT_OPERACION_SESION')
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_RCN_CONT_OPERACION_SESION_sescod
        ON dbo.RCN_CONT_OPERACION_SESION (sescod, participa_desde DESC);
END
GO

/* ------------------------------------------------------------
Consulta: qué sesiones participaron en una operación
------------------------------------------------------------ */
IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'IX_RCN_CONT_OPERACION_SESION_opid'
      AND object_id = OBJECT_ID('dbo.RCN_CONT_OPERACION_SESION')
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_RCN_CONT_OPERACION_SESION_opid
        ON dbo.RCN_CONT_OPERACION_SESION (opid, participa_desde);
END
GO


/* ============================================================
5) VISTAS ÚTILES
============================================================ */

-- ------------------------------------------------------------
-- Resumen de operaciones
-- ------------------------------------------------------------
CREATE OR ALTER VIEW dbo.VW_RCN_CONT_OPERACION_RESUMEN
AS
SELECT
    o.opid,
    o.telcod,
    o.operacion_inicio,
    o.operacion_fin,
    o.activo,
    o.estado,

    -- metadata de origen
    o.periodo_sp,
    o.fecusucre_sp,
    o.ctcod_sp,
    o.ctnom_sp,
    o.semana_sp,
    o.anio_sp,
    o.fecha_sp,
    o.turno_sp,

    -- contadores útiles
    ISNULL(x.batch_count, 0)  AS batch_count,
    ISNULL(y.sesion_count, 0) AS sesion_count
FROM dbo.RCN_CONT_OPERACION o
OUTER APPLY (
    SELECT COUNT(*) AS batch_count
    FROM dbo.RCN_CONT_OPERACION_ITEM i
    WHERE i.opid = o.opid
) x
OUTER APPLY (
    SELECT COUNT(*) AS sesion_count
    FROM dbo.RCN_CONT_OPERACION_SESION s
    WHERE s.opid = o.opid
) y;
GO

-- ------------------------------------------------------------
-- Detalle completo de operación + items
-- ------------------------------------------------------------
CREATE OR ALTER VIEW dbo.VW_RCN_CONT_OPERACION_DETALLE
AS
SELECT
    o.opid,
    o.telcod,
    o.operacion_inicio,
    o.operacion_fin,
    o.activo,
    o.estado,
    o.fecha_sp,
    o.turno_sp,

    i.op_item_id,
    i.batch,
    i.tarjeta,
    i.otcod,
    i.procod,
    i.pronom,
    i.tejtitulo,
    i.sp_inicio_flag,
    i.sp_final_flag,
    i.sp_tejfin_flag,
    i.opecod,
    i.openom
FROM dbo.RCN_CONT_OPERACION o
JOIN dbo.RCN_CONT_OPERACION_ITEM i
    ON i.opid = o.opid;
GO

-- ------------------------------------------------------------
-- Participación de sesiones por operación
-- ------------------------------------------------------------
CREATE OR ALTER VIEW dbo.VW_RCN_CONT_OPERACION_X_SESION
AS
SELECT
    os.op_ses_id,
    os.opid,
    o.telcod,
    o.operacion_inicio,
    o.operacion_fin,

    os.sescod,
    s.tracod,
    s.traraz,
    s.turno_cod,
    s.inicio AS sesion_inicio_real,
    s.fin    AS sesion_fin_real,

    os.participa_desde,
    os.participa_hasta,
    os.activo
FROM dbo.RCN_CONT_OPERACION_SESION os
JOIN dbo.RCN_CONT_OPERACION o
    ON o.opid = os.opid
JOIN dbo.RCN_CONT_SESION s
    ON s.sescod = os.sescod;
GO


/* ============================================================
GUÍA DE INTERPRETACIÓN RÁPIDA
---------------------------------------------------------------
RCN_CONT_OPERACION
- Qué operación/producto corrió en un telar
- Desde cuándo hasta cuándo corrió

RCN_CONT_OPERACION_ITEM
- Qué batch/tarjeta/OT/producto pertenecen a esa operación
- Guarda también el tejfin del SP

RCN_CONT_OPERACION_SESION
- Qué sesiones trabajaron esa operación
- En qué tramo de tiempo la trabajaron

COLUMNA MÁS IMPORTANTE DEL SP PARA FIN DE OPERACIÓN
- sp_tejfin_flag:
    0 = sigue en proceso
    1 = terminó
============================================================ */