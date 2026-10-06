-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "favoriteGenres" TEXT[] DEFAULT ARRAY[]::TEXT[];
