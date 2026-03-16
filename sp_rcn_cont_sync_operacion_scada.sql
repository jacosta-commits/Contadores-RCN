USE [ZENTRIK];
GO

SET ANSI_NULLS ON;
GO
SET QUOTED_IDENTIFIER ON;
GO

/* ==========================================================================================
   PROCEDURE: sp_rcn_cont_sync_operacion_scada
   DESCRIPTION: Sincroniza el estado actual de producción de un telar desde la BD SCADA
                (Medidores_2023) hacia las tablas históricas operacionales de ZENTRIK.
                Mantiene la integridad de operaciones a lo largo del tiempo, tolerante a 
                vacíos temporales (setup) y desacoplado de los cierres de sesión del operario.
   ========================================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_rcn_cont_sync_operacion_scada
    @telcod VARCHAR(20),
    @jsonData NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON; 

    -- ==========================================
    -- 1. CARGAR DATOS DESDE JSON
    -- ==========================================
    CREATE TABLE #TMP_SCADA (
        periodo    VARCHAR(6),
        fecusucre  DATETIME2,
        ctcod      VARCHAR(10),
        ctnom      VARCHAR(100),
        semana     INT,
        anio       INT,
        fecha      DATE,
        turno      VARCHAR(10),
        otcod      VARCHAR(30),
        procod     VARCHAR(60),
        pronom     VARCHAR(250),
        tejtitulo  VARCHAR(50),
        tarjeta    VARCHAR(40),
        batch      INT,
        inicio     INT,
        final      INT,
        tejfin     INT,
        opecod     VARCHAR(15),
        openom     VARCHAR(150)
    );

    DECLARE @RAW_JSON TABLE (
        periodo    VARCHAR(6),
        fecusucre  DATETIME2,
        ctcod      VARCHAR(10),
        ctnom      VARCHAR(100),
        semana     INT,
        anio       INT,
        fecha      DATE,
        turno      VARCHAR(10),
        otcod      VARCHAR(30),
        procod     VARCHAR(60),
        pronom     VARCHAR(250),
        tejtitulo  VARCHAR(50),
        tarjeta    VARCHAR(40),
        batch      INT,
        inicio     INT,
        final      INT,
        tejfin     INT,
        opecod     VARCHAR(15),
        openom     VARCHAR(150)
    );

    IF @jsonData IS NOT NULL AND @jsonData <> '' AND @jsonData <> '[]'
    BEGIN
        -- 1.1 Extraer JSON a tabla temporal raw
        INSERT INTO @RAW_JSON (
            periodo, fecusucre, ctcod, ctnom, semana, anio, fecha, turno, 
            otcod, procod, pronom, tejtitulo, tarjeta, batch, 
            inicio, final, tejfin, opecod, openom
        )
        SELECT 
            periodo, fecusucre, ctcod, ctnom, semana, anio, fecha, turno,
            otcod, procod, pronom, tejtitulo, tarjeta, batch,
            inicio, final, tejfin, opecod, openom
        FROM OPENJSON(@jsonData)
        WITH (
            periodo    VARCHAR(6),
            fecusucre  DATETIME2,
            ctcod      VARCHAR(10),
            ctnom      VARCHAR(100),
            semana     INT,
            anio       INT,
            fecha      DATE,
            turno      VARCHAR(10),
            otcod      VARCHAR(30),
            procod     VARCHAR(60),
            pronom     VARCHAR(250),
            tejtitulo  VARCHAR(50),
            tarjeta    VARCHAR(40),
            batch      INT,
            inicio     INT,
            final      INT,
            tejfin     INT,
            opecod     VARCHAR(15),
            openom     VARCHAR(150)
        );

        -- 1.2 Expandir filas si batch > 1 (Tarjetas consecutivas)
        ;WITH CTE_Numbers AS (
            SELECT 1 AS n
            UNION ALL
            SELECT n + 1 FROM CTE_Numbers WHERE n < 500 -- Límite de expansión
        )
        INSERT INTO #TMP_SCADA (
            periodo, fecusucre, ctcod, ctnom, semana, anio, fecha, turno, 
            otcod, procod, pronom, tejtitulo, tarjeta, batch, 
            inicio, final, tejfin, opecod, openom
        )
        SELECT 
            r.periodo, r.fecusucre, r.ctcod, r.ctnom, r.semana, r.anio, r.fecha, r.turno,
            r.otcod, r.procod, r.pronom, r.tejtitulo,
            -- Lógica de Tarjeta: Incrementar parte numérica
            CASE 
                WHEN ISNULL(r.batch, 1) <= 1 OR PATINDEX('%[0-9]%', r.tarjeta) = 0 THEN r.tarjeta
                ELSE 
                    SUBSTRING(r.tarjeta, 1, PATINDEX('%[0-9]%', r.tarjeta) - 1) + 
                    CAST(CAST(SUBSTRING(r.tarjeta, PATINDEX('%[0-9]%', r.tarjeta), LEN(r.tarjeta)) AS BIGINT) + (n.n - 1) AS VARCHAR(40))
            END,
            n.n, -- El número de batch secuencial
            r.inicio, r.final, r.tejfin, r.opecod, r.openom
        FROM @RAW_JSON r
        JOIN CTE_Numbers n ON n.n <= ISNULL(r.batch, 1)
        OPTION (MAXRECURSION 500);
    END

    -- 2. TRANSACCIÓN PRINCIPAL Y BLOQUEO
    -- ==========================================
    BEGIN TRY
        BEGIN TRAN;

        DECLARE @opid BIGINT = NULL;
        DECLARE @last_seen_ok_at DATETIME2;
        DECLARE @op_inicio DATETIME2;
        DECLARE @sesact_id BIGINT = NULL;
        DECLARE @now DATETIME2 = SYSDATETIME();
        DECLARE @grace_minutes INT = 3; -- Tolerancia temporal
        
        -- A) Buscar operación activa usando UPDLOCK y HOLDLOCK para concurrencia estricta
        SELECT 
            @opid = opid,
            @last_seen_ok_at = last_seen_ok_at,
            @op_inicio = operacion_inicio
        FROM dbo.RCN_CONT_OPERACION WITH (UPDLOCK, HOLDLOCK)
        WHERE telcod = @telcod AND activo = 1;

        -- B) Buscar sesión activa actual del telar (DENTRO de la transacción, por sescod)
        SELECT TOP 1 @sesact_id = sescod
        FROM dbo.RCN_CONT_SESION_TELAR
        WHERE telcod = @telcod AND activo = 1
        ORDER BY asignado_desde DESC;

        -- ==========================================
        -- 3. EVALUACIÓN Y FILTRADO LÓGICO
        -- ==========================================
        DECLARE @cambio BIT = 0;
        -- Contamos cuántos elementos del SCADA están VIVOS (tejfin = 0)
        DECLARE @scada_vivos INT = (SELECT COUNT(*) FROM #TMP_SCADA WHERE tejfin = 0 OR tejfin IS NULL);
        -- Contamos cuántos elementos totales devolvió SCADA
        DECLARE @scada_total INT = (SELECT COUNT(*) FROM #TMP_SCADA);

        IF @scada_vivos > 0
        BEGIN
            IF @opid IS NOT NULL
            BEGIN
                -- 1. ¿SCADA trae algún ítem (vivo o muerto) que NO esté en nuestra operación actual local? 
                -- (Si esto pasa, significa que empezó a tejer un batch totalmente nuevo -> CAMBIÓ LA OPERACIÓN)
                IF EXISTS (
                    SELECT batch, ISNULL(tarjeta,''), ISNULL(otcod,''), ISNULL(procod,'') FROM #TMP_SCADA
                    EXCEPT
                    SELECT batch, ISNULL(tarjeta,''), ISNULL(otcod,''), ISNULL(procod,'') FROM dbo.RCN_CONT_OPERACION_ITEM WHERE opid = @opid
                )
                BEGIN
                    SET @cambio = 1;
                END
                -- 2. ¿Nuestra operación local tiene ítems ACTIVOS (tejfin=0) que SCADA ya no manda?
                -- (Si SCADA deja de enviar un ítem finalizado, es normal. Pero si deja de enviar uno vivo súbitamente al cambiar conjunto, entonces la operación cambió).
                ELSE IF EXISTS (
                    SELECT batch, ISNULL(tarjeta,''), ISNULL(otcod,''), ISNULL(procod,'') 
                    FROM dbo.RCN_CONT_OPERACION_ITEM 
                    WHERE opid = @opid AND (sp_tejfin_flag = 0 OR sp_tejfin_flag IS NULL)
                    EXCEPT
                    SELECT batch, ISNULL(tarjeta,''), ISNULL(otcod,''), ISNULL(procod,'') FROM #TMP_SCADA
                )
                BEGIN
                    SET @cambio = 1;
                END
            END
            ELSE
            BEGIN
                -- No había operación local y SCADA trae algo vivo -> Nueva operación
                SET @cambio = 1;
            END
        END

        -- ==========================================
        -- 4. APLICACIÓN DE REGLAS DE NEGOCIO
        -- ==========================================

        -- CASO A: CONJUNTO VIVO VACÍO (SCADA no devolvió nada o todos traían tejfin=1)
        IF @scada_vivos = 0
        BEGIN
            IF @opid IS NOT NULL
            BEGIN
                -- Actualizar las banderas de los ítems existentes en ZENTRIK para que guarden histórico del SCADA (ej. tejfin=1)
                IF @scada_total > 0
                BEGIN
                    UPDATE i
                    SET sp_tejfin_flag = s.tejfin, sp_inicio_flag = s.inicio, sp_final_flag = s.final
                    FROM dbo.RCN_CONT_OPERACION_ITEM i
                    JOIN #TMP_SCADA s 
                      ON i.batch = s.batch 
                      AND ISNULL(i.tarjeta,'') = ISNULL(s.tarjeta,'') 
                      AND ISNULL(i.otcod,'') = ISNULL(s.otcod,'') 
                      AND ISNULL(i.procod,'') = ISNULL(s.procod,'')
                    WHERE i.opid = @opid;
                END

                -- Evaluamos ventana de gracia (si es nulo el ok_at, usamos el inicio como fallback)
                DECLARE @ts_comparacion DATETIME2 = COALESCE(@last_seen_ok_at, @op_inicio);

                IF @ts_comparacion IS NOT NULL AND DATEDIFF(MINUTE, @ts_comparacion, @now) >= @grace_minutes
                BEGIN
                    -- Cierre de gracia alcanzado
                    UPDATE dbo.RCN_CONT_OPERACION
                    SET activo = 0, estado = 'F', operacion_fin = @now
                    WHERE opid = @opid;

                    UPDATE dbo.RCN_CONT_OPERACION_SESION
                    SET activo = 0, participa_hasta = @now
                    WHERE opid = @opid AND activo = 1;
                END
            END
        END
        
        -- CASO B: CONJUNTO SCADA ES DIFERENTE (Cambió la operación a algo nuevo)
        ELSE IF @cambio = 1
        BEGIN
            -- 1. Cerrar operación anterior
            IF @opid IS NOT NULL
            BEGIN
                -- 1a. Actualizar las banderas de los ítems salientes para no perder su historia (ej. tejfin=1)
                IF @scada_total > 0
                BEGIN
                    UPDATE i
                    SET sp_tejfin_flag = s.tejfin, sp_inicio_flag = s.inicio, sp_final_flag = s.final
                    FROM dbo.RCN_CONT_OPERACION_ITEM i
                    JOIN #TMP_SCADA s 
                      ON i.batch = s.batch 
                      AND ISNULL(i.tarjeta,'') = ISNULL(s.tarjeta,'') 
                      AND ISNULL(i.otcod,'') = ISNULL(s.otcod,'') 
                      AND ISNULL(i.procod,'') = ISNULL(s.procod,'')
                    WHERE i.opid = @opid;
                END

                -- 1b. Cerrar cabecera y sesión
                UPDATE dbo.RCN_CONT_OPERACION
                SET activo = 0, estado = 'F', operacion_fin = @now
                WHERE opid = @opid;

                UPDATE dbo.RCN_CONT_OPERACION_SESION
                SET activo = 0, participa_hasta = @now
                WHERE opid = @opid AND activo = 1;
            END

            -- 2. Abrir nueva operación con Metadata del SCADA (TOP 1 porque todos pertenecen al mismo lote lógico)
            INSERT INTO dbo.RCN_CONT_OPERACION (
                telcod, operacion_inicio, activo, estado, last_seen_ok_at,
                periodo_sp, fecusucre_sp, ctcod_sp, ctnom_sp, semana_sp, anio_sp, fecha_sp, turno_sp
            )
            SELECT TOP 1
                @telcod, @now, 1, 'A', @now,
                periodo, fecusucre, ctcod, ctnom, semana, anio, ISNULL(fecha, CAST(@now AS DATE)), ISNULL(NULLIF(turno,''), '1')
            FROM #TMP_SCADA
            WHERE tejfin = 0 OR tejfin IS NULL;

            SET @opid = SCOPE_IDENTITY();

            -- 3. Insertar detalle (Solo los items VIVOS que el SCADA me mandó esta vez, no los ya terminados)
            INSERT INTO dbo.RCN_CONT_OPERACION_ITEM (
                opid, batch, tarjeta, otcod, procod, pronom, tejtitulo, opecod, openom, 
                sp_inicio_flag, sp_final_flag, sp_tejfin_flag
            )
            SELECT 
                @opid, batch, tarjeta, otcod, procod, pronom, tejtitulo, opecod, openom,
                inicio, final, tejfin
            FROM #TMP_SCADA
            WHERE tejfin = 0 OR tejfin IS NULL;

            -- 4. Reconocer sesión activa (si existe)
            IF @sesact_id IS NOT NULL
            BEGIN
                INSERT INTO dbo.RCN_CONT_OPERACION_SESION (opid, sescod, participa_desde, activo)
                VALUES (@opid, @sesact_id, @now, 1);
            END
        END

        -- CASO C: MISMO CONJUNTO SIGUE CORRIENDO (Idempotencia)
        ELSE
        BEGIN
            -- 1. Actualizar Timestamp para mantener viva la ventana de gracia
            UPDATE dbo.RCN_CONT_OPERACION
            SET last_seen_ok_at = @now
            WHERE opid = @opid;

            -- 2. Actualizar las banderas de los ítems existentes (para reflejar ej. los tejfin parciales)
            IF @scada_total > 0
            BEGIN
                UPDATE i
                SET sp_tejfin_flag = s.tejfin, sp_inicio_flag = s.inicio, sp_final_flag = s.final
                FROM dbo.RCN_CONT_OPERACION_ITEM i
                JOIN #TMP_SCADA s 
                  ON i.batch = s.batch 
                  AND ISNULL(i.tarjeta,'') = ISNULL(s.tarjeta,'') 
                  AND ISNULL(i.otcod,'') = ISNULL(s.otcod,'') 
                  AND ISNULL(i.procod,'') = ISNULL(s.procod,'')
                WHERE i.opid = @opid;
            END

            -- 3. Re-evaluar vínculos de sesión
            DECLARE @current_link_sescod BIGINT = NULL;
            
            SELECT TOP 1 @current_link_sescod = sescod
            FROM dbo.RCN_CONT_OPERACION_SESION
            WHERE opid = @opid AND activo = 1;

            IF @sesact_id IS NOT NULL
            BEGIN
                -- Hay operario activo en el telar
                IF @current_link_sescod IS NULL OR @current_link_sescod <> @sesact_id
                BEGIN
                    -- Sesión cambió: Cerrar link activo anterior y abrir nuevo
                    UPDATE dbo.RCN_CONT_OPERACION_SESION
                    SET activo = 0, participa_hasta = @now
                    WHERE opid = @opid AND activo = 1;

                    INSERT INTO dbo.RCN_CONT_OPERACION_SESION (opid, sescod, participa_desde, activo)
                    VALUES (@opid, @sesact_id, @now, 1);
                END
            END
            ELSE
            BEGIN
                -- No hay operario activo (Sesión huérfana temporal)
                IF @current_link_sescod IS NOT NULL
                BEGIN
                    -- Cerrar el vínculo activo
                    UPDATE dbo.RCN_CONT_OPERACION_SESION
                    SET activo = 0, participa_hasta = @now
                    WHERE opid = @opid AND activo = 1;
                END
            END
        END

        COMMIT TRAN;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRAN;
        THROW;
    END CATCH;

    DROP TABLE IF EXISTS #TMP_SCADA;
END;
GO
