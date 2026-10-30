-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "categoryId" UUID;

-- CreateTable
CREATE TABLE "Category" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "parentId" UUID,
    "nameFr" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 100,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Category_slug_key" ON "Category"("slug");

-- CreateIndex
CREATE INDEX "Category_parentId_position_idx" ON "Category"("parentId", "position");

-- CreateIndex
CREATE INDEX "Product_categoryId_status_idx" ON "Product"("categoryId", "status");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------- Écrit à la main : invariants, deux niveaux, RLS, taxonomie initiale ----------
ALTER TABLE "Category" ADD CONSTRAINT "Category_values_valid" CHECK (
  "slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length("slug") <= 60
  AND char_length("nameFr") BETWEEN 2 AND 60 AND char_length("nameEn") BETWEEN 2 AND 60
  AND ("parentId" IS NULL OR "parentId" <> "id"));

-- Deux niveaux au plus : le parent d'une catégorie doit être une racine.
CREATE FUNCTION category_depth_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW."parentId" IS NOT NULL AND EXISTS (
       SELECT 1 FROM "Category" WHERE "id" = NEW."parentId" AND "parentId" IS NOT NULL) THEN
    RAISE EXCEPTION 'categories have two levels at most' USING ERRCODE = '23514';
  END IF;
  IF NEW."parentId" IS NOT NULL AND EXISTS (
       SELECT 1 FROM "Category" WHERE "parentId" = NEW."id") THEN
    RAISE EXCEPTION 'a category with children cannot become a child' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER category_depth BEFORE INSERT OR UPDATE OF "parentId" ON "Category"
  FOR EACH ROW EXECUTE FUNCTION category_depth_guard();

ALTER TABLE "Category" ENABLE ROW LEVEL SECURITY;
CREATE POLICY public_read ON "Category" FOR SELECT USING (true);
CREATE POLICY admin_insert ON "Category" FOR INSERT WITH CHECK (app_platform_role() = 'ADMIN');
CREATE POLICY admin_update ON "Category" FOR UPDATE
  USING (app_platform_role() = 'ADMIN') WITH CHECK (app_platform_role() = 'ADMIN');
GRANT SELECT, INSERT ON "Category" TO duoshop_app;
GRANT UPDATE ("nameFr", "nameEn", "position", "active", "parentId") ON "Category" TO duoshop_app;
GRANT UPDATE ("categoryId") ON "Product" TO duoshop_app;

-- Taxonomie de départ (modifiable par l'administration).
WITH roots ("slug", "nameFr", "nameEn", "position") AS (VALUES
  ('mode', 'Mode et pagnes', 'Fashion and fabrics', 10),
  ('alimentation', 'Alimentation', 'Food', 20),
  ('beaute', 'Beauté et bien-être', 'Beauty and wellness', 30),
  ('maison', 'Maison et cuisine', 'Home and kitchen', 40),
  ('artisanat', 'Artisanat', 'Handicrafts', 50),
  ('electronique', 'Téléphones et électronique', 'Phones and electronics', 60)
)
INSERT INTO "Category" ("id", "slug", "nameFr", "nameEn", "position")
SELECT gen_random_uuid(), "slug", "nameFr", "nameEn", "position" FROM roots;
WITH children ("parent", "slug", "nameFr", "nameEn", "position") AS (VALUES
  ('mode', 'tissus-pagnes', 'Tissus et pagnes', 'Fabrics and wax prints', 10),
  ('mode', 'vetements', 'Vêtements', 'Clothing', 20),
  ('mode', 'chaussures', 'Chaussures', 'Shoes', 30),
  ('mode', 'sacs-accessoires', 'Sacs et accessoires', 'Bags and accessories', 40),
  ('alimentation', 'epices-condiments', 'Épices et condiments', 'Spices and condiments', 10),
  ('alimentation', 'huiles-produits-locaux', 'Huiles et produits locaux', 'Oils and local produce', 20),
  ('alimentation', 'boissons', 'Boissons', 'Drinks', 30),
  ('beaute', 'soins-corps-cheveux', 'Soins du corps et des cheveux', 'Body and hair care', 10),
  ('beaute', 'parfums', 'Parfums', 'Fragrances', 20),
  ('maison', 'cuisine', 'Cuisine et ustensiles', 'Kitchen and utensils', 10),
  ('maison', 'decoration', 'Décoration', 'Decoration', 20),
  ('artisanat', 'vannerie', 'Vannerie et raphia', 'Basketry and raffia', 10),
  ('artisanat', 'sculpture', 'Sculpture et bois', 'Sculpture and wood', 20),
  ('electronique', 'telephones', 'Téléphones', 'Phones', 10),
  ('electronique', 'accessoires-telephone', 'Accessoires téléphone', 'Phone accessories', 20)
)
INSERT INTO "Category" ("id", "slug", "parentId", "nameFr", "nameEn", "position")
SELECT gen_random_uuid(), c."slug", p."id", c."nameFr", c."nameEn", c."position"
  FROM children c JOIN "Category" p ON p."slug" = c."parent";
