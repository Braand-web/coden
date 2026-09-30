/**
 * A greeting, a thanks, a compliment: never an order.
 *
 * Every message is classified by a small, fast model that reads the conversation with it. Given a long history full of
 * a build and a short message, that model can read « parfait » as « go ahead », and a greeting after a plan as
 * a confirmation of it — and Coden starts coding on « bonjour ». The decision is easy to make without a model:
 * a greeting is conversation whatever came before, and a thanks or a compliment is conversation unless the last
 * thing Coden said was a question or an offer that it answers.
 *
 * « oui », « ok », « vas-y » stay with the model: they answer what Coden proposed, and what it proposed is the context.
 * `CODEN_ROUTER_GUARD=0` gives this up.
 */
export function routerGuardEnabled(env: Record<string, string | undefined> = typeof process !== 'undefined' ? process.env : {}): boolean {
  return env.CODEN_ROUTER_GUARD !== '0';
}

const squash = (value: string) => value
  .toLowerCase()
  .normalize('NFKD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/[!?.,;:…]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const GREETINGS = new Set(['bonjour', 'bonsoir', 'salut', 'coucou', 'hello', 'hi', 'hey', 'yo', 'good morning', 'good afternoon', 'good evening', 'bonjour coden', 'salut coden', 'hello coden', 'hey coden']);
const ACKNOWLEDGEMENTS = /^(?:merci(?: beaucoup| bien)?|thanks?|thank you|super|parfait|top|nickel|genial|excellent|bravo|cool|nice|great|perfect|impeccable|formidable|magnifique|bien joue|well done|wow)(?: coden)?$/;

/** What Coden said last asks something, or offers something: a short reply then answers it. */
export function lastTurnAsksOrOffers(history: Array<{ role: string; content: string }> | undefined): boolean {
  const last = [...(history || [])].reverse().find(turn => turn.role === 'assistant' && String(turn.content || '').trim());
  if (!last) return false;
  const text = String(last.content).trim();
  const tail = text.slice(-400);
  return /\?\s*$/.test(tail) || /\b(?:je lance|on y va|je te propose|je peux (?:le )?(?:faire|lancer|ajouter)|veux[- ]tu|voulez[- ]vous|souhaites[- ]tu|souhaitez[- ]vous|dois[- ]je|shall i|want me to|should i|would you like|do you want|let me know if)\b/i.test(tail.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, ''));
}

export function classifySocialMessage(prompt: string, history?: Array<{ role: string; content: string }>): 'greeting' | 'acknowledgement' | null {
  const text = squash(String(prompt || ''));
  if (!text || text.length > 40) return null;
  if (GREETINGS.has(text)) return 'greeting';
  if (ACKNOWLEDGEMENTS.test(text) && !lastTurnAsksOrOffers(history)) return 'acknowledgement';
  return null;
}
