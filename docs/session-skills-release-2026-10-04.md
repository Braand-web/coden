# On-demand Coden methods

This release adds an optional `load_skill` tool to the main coding session. The model chooses a curated method; no extra model call or specialist is started automatically. Existing budgets and permissions remain unchanged. Three methods can be active, and six distinct methods can be loaded per run. Instructions are refreshed from the original system prompt without accumulating copies, including after transcript compaction and between repair rounds.

The existing frontend-design method is reused. Four concise Coden-specific methods cover frontend implementation, UX review, code review and visual consistency. They are original adaptations, not wholesale copies of supplied files. The UX source supplied by the user credits Madina Gbotoe (https://madinagbotoe.com/, CC BY 4.0). Missing external scripts, databases, license files and unavailable tools are not represented as installed resources.

This is the first implementation lot, not completion of the full integration plan. Persisting loaded-method state across separate sessions, worker-specific loading, expanded browser journeys and real-model evaluation remain to be validated separately. No production database migration or billing/authentication change is included. Unit tests do not demonstrate real-model task success or latency improvements.
