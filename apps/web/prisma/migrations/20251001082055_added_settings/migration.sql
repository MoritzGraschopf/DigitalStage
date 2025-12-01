-- CreateTable
CREATE TABLE "UserSettings" (
    "userId" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'de-AT',
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Vienna',
    "autoplayHls" BOOLEAN NOT NULL DEFAULT true,
    "notifyChatToasts" BOOLEAN NOT NULL DEFAULT true,
    "notifyConfCreated" BOOLEAN NOT NULL DEFAULT true,
    "wsReconnect" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserSettings_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "UserSettings" ADD CONSTRAINT "UserSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
