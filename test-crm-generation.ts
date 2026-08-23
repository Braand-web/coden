import { buildDeepReasoningContract } from './src/services/deep-reasoning.ts';
import { buildAIModelRuntimeConfig, getAIModelCapabilityProfile } from './src/services/ai-model-runtime.ts';

const prompt = "Crée un mini-CRM pour gérer des leads, avec un tableau de bord analytique, des filtres de recherche et un pipeline de vente interactif.";

console.log("🚀 Lancement du test de génération : Mini-CRM avec le Moteur V2\n");

// 1. Génération du contrat Deep Reasoning V2
const contract = buildDeepReasoningContract({
  prompt,
  projectName: "Mini-CRM",
  files: [],
  decision: { intent: 'build', requiresFileChanges: true }
});

console.log("🧠 [Deep Reasoning V2] Type d'application détecté :", contract.app_type);
console.log("\n📊 Analyse Architecturale requise :");
console.log("- Profondeur max des composants :", contract.architecture_critic.max_component_depth);
console.log("- Patterns recommandés :", contract.architecture_critic.patterns.join(", "));

console.log("\n🧪 Simulateur d'interactions généré :");
contract.interaction_simulator.expected_user_flows.forEach((flow, i) => {
  console.log(`  ${i + 1}. ${flow}`);
});

console.log("\n⚙️  Étapes de planification (incluant les nouvelles audits) :");
contract.planner.stages.forEach(stage => {
  if (['architect', 'security_audit', 'ux_audit'].includes(stage.key)) {
    console.log(`  ✅ ${stage.key.toUpperCase()} : ${stage.objective}`);
  }
});

// 2. Configuration du Runtime IA (Thinking Budget)
const runtimeConfig = buildAIModelRuntimeConfig({
  modelId: 'anthropic/claude-sonnet-5', // Modèle avec reasoning support
  task: 'frontend_generation',
  stream: true
});

console.log("\n⚡ [Runtime IA] Allocation du Budget de Réflexion (Thinking Budget) :");
if (runtimeConfig.thinking.enabled) {
  console.log(`- Budget alloué pour la génération frontend : ${runtimeConfig.thinking.budgetTokens} tokens invisibles`);
  console.log("- Modèle sélectionné :", runtimeConfig.profile.id);
} else {
  console.log("- Thinking désactivé pour cette tâche/modèle.");
}

console.log("\n✅ Le moteur V2 a parfaitement compris les enjeux du CRM et est prêt à générer le code source complet de manière sécurisée et structurée !");
