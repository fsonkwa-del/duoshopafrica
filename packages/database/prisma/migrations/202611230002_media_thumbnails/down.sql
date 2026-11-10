-- Retour arrière : les grilles reprennent l'image complète (les objets vignettes restent dans
-- le stockage, sans effet).
ALTER TABLE "ProductMedia" DROP COLUMN "thumbKey";
