/*
  Warnings:

  - You are about to drop the column `participationPassword` on the `conference` table. All the data in the column will be lost.
  - You are about to drop the column `startDate` on the `conference` table. All the data in the column will be lost.
  - You are about to drop the column `userId` on the `conference` table. All the data in the column will be lost.
  - You are about to drop the column `name` on the `User` table. All the data in the column will be lost.
  - You are about to drop the `Invitation` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `organizerId` to the `conference` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "Conference" DROP CONSTRAINT "Conference_userId_fkey";

-- DropForeignKey
ALTER TABLE "Invitation" DROP CONSTRAINT "Invitation_conferenceId_fkey";

-- AlterTable
ALTER TABLE "Conference" DROP COLUMN "participationPassword",
DROP COLUMN "startDate",
DROP COLUMN "userId",
ADD COLUMN     "organizerId" INTEGER NOT NULL,
ADD COLUMN     "startAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" DROP COLUMN "name",
ADD COLUMN     "firstName" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "lastName" TEXT NOT NULL DEFAULT '';

-- DropTable
DROP TABLE "Invitation";

-- CreateIndex
CREATE INDEX "Conference_organizerId_idx" ON "Conference"("organizerId");

-- CreateIndex
CREATE INDEX "Conference_status_idx" ON "Conference"("status");

-- CreateIndex
CREATE INDEX "UserConference_conferenceId_idx" ON "UserConference"("conferenceId");

-- AddForeignKey
ALTER TABLE "Conference" ADD CONSTRAINT "Conference_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
