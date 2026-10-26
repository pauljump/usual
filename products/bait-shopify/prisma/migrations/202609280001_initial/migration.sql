-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" DATETIME,
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" DATETIME
);

-- CreateTable
CREATE TABLE "BaitShop" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "consentAt" DATETIME,
    "consentVersion" TEXT,
    "secret" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastRecordedAt" DATETIME,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "records" INTEGER NOT NULL DEFAULT 0,
    "bytes" BIGINT NOT NULL DEFAULT 0,
    "deepRequests" INTEGER NOT NULL DEFAULT 0,
    "deepest" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "BaitBudget" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "day" TEXT NOT NULL,
    "requests" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "BaitEvent" (
    "shop" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "at" DATETIME NOT NULL,
    "journey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "depth" INTEGER NOT NULL,
    "records" INTEGER NOT NULL,
    "bytes" INTEGER NOT NULL,
    "client" TEXT NOT NULL,
    "version" TEXT NOT NULL,

    PRIMARY KEY ("shop", "slot")
);

-- CreateIndex
CREATE INDEX "BaitBudget_day_idx" ON "BaitBudget"("day");

-- CreateIndex
CREATE INDEX "BaitEvent_shop_at_idx" ON "BaitEvent"("shop", "at");

-- CreateIndex
CREATE INDEX "BaitEvent_at_idx" ON "BaitEvent"("at");

