"use client";
import { useActionState } from "react";
import { revealOwnerAction } from "./actions";

// Contact privé du propriétaire (lot 2) : affiché sur motif, chaque affichage est journalisé ;
// le numéro n'apparaît jamais dans une URL ni dans l'historique du navigateur.
export function RevealOwner({
  storeId,
  labels,
}: {
  storeId: string;
  labels: { title: string; reason: string; reveal: string; error: string };
}) {
  const [state, action, pending] = useActionState(revealOwnerAction, null);
  return (
    <details>
      <summary>{labels.title}</summary>
      {state?.ok ? (
        <p>
          <strong>{state.ownerName}</strong> · {state.ownerPhone}
        </p>
      ) : (
        <form action={action} className="stack">
          <input type="hidden" name="storeId" value={storeId} />
          <label>
            {labels.reason}
            <input name="reason" minLength={10} maxLength={500} required />
          </label>
          {state && !state.ok && <p role="alert">{labels.error}</p>}
          <button type="submit" className="link-button" disabled={pending}>
            {labels.reveal}
          </button>
        </form>
      )}
    </details>
  );
}
