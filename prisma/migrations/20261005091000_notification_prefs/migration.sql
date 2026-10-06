-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'ARTIST_NEW_EVENT';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "mutedNotifications" "NotificationType"[] DEFAULT ARRAY[]::"NotificationType"[];

