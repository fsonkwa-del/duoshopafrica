"use client";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { requestPhotoUpload } from "./actions";

const MAX_BYTES = 5 * 1024 * 1024;
const TYPES = ["image/jpeg", "image/png", "image/webp"];

// Seul composant client du catalogue : l'envoi direct vers le stockage exige un PUT navigateur.
export function PhotoUpload({
  storeId,
  productId,
  labels,
}: {
  storeId: string;
  productId: string;
  labels: {
    file: string;
    altFr: string;
    altEn: string;
    send: string;
    sending: string;
    sent: string;
    tooLarge: string;
    failed: string;
  };
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">(
    "idle",
  );
  const [message, setMessage] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get("photo");
    if (!(file instanceof File) || !TYPES.includes(file.type)) {
      setState("error");
      setMessage(labels.failed);
      return;
    }
    if (file.size > MAX_BYTES) {
      setState("error");
      setMessage(labels.tooLarge);
      return;
    }
    setState("sending");
    const grant = await requestPhotoUpload({
      storeId,
      productId,
      contentType: file.type,
      bytes: file.size,
      altFr: String(data.get("altFr") ?? ""),
      altEn: String(data.get("altEn") ?? ""),
    });
    if (!grant.ok) {
      setState("error");
      setMessage(labels.failed);
      return;
    }
    // Content-Length est fixé par le navigateur (taille réelle) : il doit égaler la taille signée.
    const { "content-length": _ignored, ...headers } = grant.headers;
    const upload = await fetch(grant.url, {
      method: "PUT",
      headers,
      body: file,
    }).catch(() => null);
    if (!upload?.ok) {
      setState("error");
      setMessage(labels.failed);
      return;
    }
    form.reset();
    setState("sent");
    setMessage(labels.sent);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="stack">
      <label>
        {labels.file}
        <input name="photo" type="file" accept={TYPES.join(",")} required />
      </label>
      <label>
        {labels.altFr}
        <input name="altFr" required minLength={3} maxLength={200} />
      </label>
      <label>
        {labels.altEn}
        <input name="altEn" required minLength={3} maxLength={200} />
      </label>
      <button
        type="submit"
        className="secondary"
        disabled={state === "sending"}
      >
        {state === "sending" ? labels.sending : labels.send}
      </button>
      <p role="status" aria-live="polite">
        {state === "sent" || state === "error" ? message : ""}
      </p>
    </form>
  );
}
