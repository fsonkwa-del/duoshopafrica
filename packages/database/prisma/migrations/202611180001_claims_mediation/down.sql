-- Retour arrière du renommage : l'alias disparaît, la fonction reprend son nom d'origine.
DROP FUNCTION arbitrate_claim(uuid, boolean, text);
ALTER FUNCTION mediate_claim(uuid, boolean, text) RENAME TO arbitrate_claim;
