/** Provider/database errors stay on the server, never in customer responses. */
export function publicCheckoutFailure(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (/Unknown public paid plan|Unsupported .+ credit tier|Invalid top-up product|This top-up is only available/i.test(message)) {
    return { status: 400, diagnosticCode: 'CHECKOUT_OFFER_UNAVAILABLE', message: 'Cette offre n’est pas disponible pour votre compte. Choisissez une offre valide.' };
  }
  if (/checkout request has already been used/i.test(message)) {
    return { status: 409, diagnosticCode: 'CHECKOUT_REQUEST_CONFLICT', message: 'Cette demande de paiement a expiré ou a déjà été utilisée. Relancez le paiement.' };
  }
  return { status: 503, diagnosticCode: 'CHECKOUT_TEMPORARILY_UNAVAILABLE', message: 'Le paiement est momentanément indisponible. Réessayez dans un instant.' };
}

export function publicWebhookFailure(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  // Invalid signatures and payloads are permanent failures; persistence and
  // provider availability failures must remain retryable for paid customers.
  const invalid = error instanceof SyntaxError || /signature validation failed|webhook payload is invalid|Paid amount does not match|Paid currency does not match/i.test(message);
  return { status: invalid ? 400 : 503, diagnosticCode: invalid ? 'WEBHOOK_INVALID' : 'WEBHOOK_RETRY_REQUIRED' };
}
