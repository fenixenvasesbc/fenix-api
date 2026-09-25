-- ADR-004 Submodulo 5: pausar/reanudar el plazo.
ALTER TABLE "DesignRequest" ADD COLUMN "pausedAt" TIMESTAMP(3);
ALTER TABLE "DesignRequest" ADD COLUMN "pausedByUserId" TEXT;
ALTER TABLE "DesignRequest" ADD COLUMN "pausedTotalMs" BIGINT NOT NULL DEFAULT 0;
