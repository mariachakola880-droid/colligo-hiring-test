/*
  Warnings:

  - Added the required column `access_token` to the `tickets` table without a default value. This is not possible if the table is not empty.
  - A unique constraint covering the columns `[access_token]` on the table `tickets` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "access_token" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "tickets_access_token_key" ON "tickets"("access_token");
