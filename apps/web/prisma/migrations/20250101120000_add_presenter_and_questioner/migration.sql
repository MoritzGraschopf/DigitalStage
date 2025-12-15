-- AlterEnum
BEGIN;
CREATE TYPE "Role_new" AS ENUM ('ORGANIZER', 'PARTICIPANT', 'VIEWER', 'QUESTIONER');
ALTER TABLE "UserConference" ALTER COLUMN "role" TYPE "Role_new" USING ("role"::text::"Role_new");
ALTER TYPE "Role" RENAME TO "Role_old";
ALTER TYPE "Role_new" RENAME TO "Role";
DROP TYPE "Role_old";
COMMIT;

-- AlterTable
ALTER TABLE "UserConference" ADD COLUMN "isPresenter" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "UserConference_conferenceId_isPresenter_idx" ON "UserConference"("conferenceId", "isPresenter");


