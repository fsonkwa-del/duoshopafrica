import { type Locale, messages } from "@duoshop/i18n";

// Codes d'erreur API -> message localisé ; tout code inconnu retombe sur un message générique.
export function staffError(locale: Locale, code: string | undefined): string {
  const errors = messages[locale].admin.errors;
  return code && code in errors
    ? errors[code as keyof typeof errors]
    : errors.unknown;
}
