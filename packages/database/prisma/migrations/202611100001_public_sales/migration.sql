-- Nombre d'unités vendues d'un produit public (cartes « N vendus » de la vitrine).
-- Agrégat seulement, à partir des mouvements de stock SALE (ventes payées) ; aucune donnée
-- de commande ni d'acheteur exposée ; 0 pour un produit non public.
CREATE FUNCTION product_units_sold(p_product uuid) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN product_is_public(p_product) THEN
    coalesce((SELECT -sum(m."delta") FROM "StockMovement" m
               JOIN "ProductVariant" v ON v."id" = m."variantId"
              WHERE v."productId" = p_product AND m."reason" = 'SALE'), 0)
  ELSE 0 END
$$;
REVOKE ALL ON FUNCTION product_units_sold(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION product_units_sold(uuid) TO duoshop_app;
