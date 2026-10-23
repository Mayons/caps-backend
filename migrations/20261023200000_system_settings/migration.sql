-- CreateTable
CREATE TABLE "SystemSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "adminOnlyLogin" BOOLEAN NOT NULL DEFAULT false,
    "registrationClosed" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SystemSettings_pkey" PRIMARY KEY ("id")
);


-- Garantiza una única fila de configuración y la crea con los valores por defecto.
ALTER TABLE "SystemSettings" ADD CONSTRAINT "SystemSettings_singleton" CHECK ("id" = 1);
INSERT INTO "SystemSettings" ("id", "updatedAt") VALUES (1, CURRENT_TIMESTAMP);
