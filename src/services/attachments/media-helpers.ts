/**
 * The small model calls attachments need: describing an image, reading a
 * scanned PDF, transcribing a soundtrack.
 *
 * Each picks, from the models Coden is allowed to call, one whose live
 * catalogue entry reads that modality (Gemini Flash first: it reads images,
 * PDFs and audio, quickly and cheaply). When none does, the helper returns an
 * empty string and the attachment says what could not be read.
 */
import type { ChatContentPart, ChatMessage } from '../openrouter-service.ts';
import type { ExtractionDeps } from './extract.ts';

type Chat = (modelId: string, messages: ChatMessage[], retryAttempts?: number, timeoutMs?: number) => Promise<{ text: string; cost_usd?: number }>;
type Catalog = { peek(id: string): { architecture?: { input_modalities?: string[] } } | undefined; ensure(): Promise<void> };

const PREFERRED = ['google/gemini-3.8-flash', 'google/gemini-3.8-flash:batch'];

export function pickModelFor(modality: 'image' | 'audio' | 'file' | 'video', allowed: readonly string[], catalog: Catalog): string | null {
  const ordered = [...PREFERRED.filter(id => allowed.includes(id)), ...allowed.filter(id => !PREFERRED.includes(id) && !id.endsWith(':batch'))];
  return ordered.find(id => (catalog.peek(id)?.architecture?.input_modalities || []).includes(modality)) || null;
}

const base64 = (data: Uint8Array) => Buffer.from(data).toString('base64');

export function createMediaHelpers(chat: Chat, allowed: readonly string[], catalog: Catalog): Required<Pick<ExtractionDeps, 'describeImage' | 'ocrPdf' | 'transcribe'>> {
  const ask = async (modality: 'image' | 'audio' | 'file', parts: ChatContentPart[], timeoutMs: number) => {
    await catalog.ensure().catch(() => undefined);
    const model = pickModelFor(modality, allowed, catalog);
    if (!model) return '';
    const result = await chat(model, [{ role: 'user', content: parts }], 2, timeoutMs);
    if (result.cost_usd) console.info('[coden:attachment_model_call]', { modality, model, cost_usd: result.cost_usd });
    return String(result.text || '').trim();
  };
  return {
    describeImage: (image, name) => ask('image', [
      { type: 'text', text: `Décris cette image (« ${name} ») pour un développeur qui va créer une interface à partir d’elle. En français, 150 mots au plus, sans préambule. Dis d’abord ce que c’est (capture d’écran, maquette, logo, charte graphique, photo, schéma), puis : la mise en page et ses sections dans l’ordre, les textes lisibles importants, les couleurs (codes hexadécimaux estimés), la typographie et le style général.` },
      { type: 'image_url', image_url: { url: `data:${image.mime};base64,${base64(image.data)}`, detail: 'high' } },
    ], 45_000),
    ocrPdf: (pdf, name) => ask('file', [
      { type: 'text', text: `Ce PDF (« ${name} ») est scanné. Transcris fidèlement tout son texte, page par page, en gardant les titres, les listes et les tableaux (en Markdown). N’ajoute rien, ne résume pas.` },
      { type: 'file', file: { filename: name, file_data: `data:application/pdf;base64,${base64(pdf)}` } },
    ], 120_000),
    transcribe: (audio, name) => ask('audio', [
      { type: 'text', text: `Transcris fidèlement la bande son de la vidéo « ${name} », dans sa langue d’origine. Indique les changements de locuteur par un tiret. S’il n’y a que de la musique ou aucun propos, réponds « (aucun propos, musique ou silence) ».` },
      { type: 'input_audio', input_audio: { data: base64(audio), format: 'mp3' } },
    ], 120_000),
  };
}
