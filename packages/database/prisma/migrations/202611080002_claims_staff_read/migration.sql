-- Instruction et arbitrage des litiges : le personnel plateforme lit les sous-commandes et leurs
-- lignes (lecture seule ; aucune donnée de contact au-delà de celle transmise au vendeur).
CREATE POLICY staff_read ON "SellerOrder" FOR SELECT USING (app_platform_role() IS NOT NULL);
CREATE POLICY staff_read ON "OrderItem" FOR SELECT USING (app_platform_role() IS NOT NULL);
