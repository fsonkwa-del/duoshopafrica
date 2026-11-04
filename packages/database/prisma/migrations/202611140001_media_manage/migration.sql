-- Le vendeur peut retirer une photo de son produit (choix de la photo principale : UPDATE "position"
-- déjà accordé). Suppression limitée au tenant courant par la politique tenant_scope ; l'API
-- refuse une photo encore en traitement (PENDING) pour ne pas croiser le worker.
GRANT DELETE ON "ProductMedia" TO duoshop_app;
