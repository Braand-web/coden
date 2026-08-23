import { OpenRouterService } from '../services/openrouter-service.ts';
import { AI_ALLOWED_MODELS } from '../config/ai-models.ts';

export async function syncOpenRouterAllowedModels(service: OpenRouterService, supabase: any) {
  console.log('[SYNC] Starting OpenRouter catalog sync for whitelisted models...');
  
  try {
    const catalog = await service.getCatalog() as { data: any[] };
    const remoteModels = catalog.data || [];
    
    for (const modelId of AI_ALLOWED_MODELS) {
      const remoteModel = remoteModels.find((m: any) => m.id === modelId);
      
      const updateData: any = {
        openrouter_model_id: modelId,
        is_allowed: true,
        is_available: !!remoteModel,
        updated_at: new Date().toISOString()
      };

      if (remoteModel) {
        updateData.display_name = remoteModel.name;
        updateData.max_context_tokens = remoteModel.context_length;
        updateData.supports_streaming = true;
      } else {
        console.warn(`[SYNC] ALERT: Whitelisted model ${modelId} is missing from OpenRouter catalog!`);
      }

      // Update Supabase ai_model_catalog
      const { error } = await supabase
        .from('ai_model_catalog')
        .upsert(updateData, { onConflict: 'openrouter_model_id' });

      if (error) {
        console.error(`[SYNC] Error upserting model ${modelId}:`, error);
      }
    }

    console.log('[SYNC] Completed catalog sync.');
  } catch (error) {
    console.error('[SYNC] Failed to sync models:', error);
  }
}
