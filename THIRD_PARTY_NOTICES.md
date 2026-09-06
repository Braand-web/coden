# Third-party notices

Coden's runtime skill policies are original, condensed adaptations. No upstream script is executed during a user run. Source revisions are pinned and tracked in `src/services/coden-skill-provenance.ts`.

The following repositories informed the adapted policies:

- obra/superpowers — MIT — commit `b36e0829c6d0140e93cfef2ca599b1b07d4a7797`
- mattpocock/skills — MIT — commit `3cca18b368ae95cdbdebbff572ccafa662551015`
- addyosmani/agent-skills — MIT — commit `48cb1168aeaaa70dfc2bbf709eddfa2a8ed8129a`
- pbakaus/impeccable — Apache-2.0 — commit `831cabee8b4bc1a2b66e5ae22003e9a19b57d464`
- garrytan/gstack — MIT — commit `c24121663732644c56280474a1720475dbe53127`
- anthropics/skills — Apache-2.0 for the selected `frontend-design` skill — commit `41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f`
- microsoft/skills — MIT — commit `02e0b2f852b39ea00c43283f999b83fc12079273`
- mblode/agent-skills — MIT — commit `0a639b1ef3b75aa6cc945e778fb1486def1d41bf`
- richkuo/rk-skills — MIT — commit `2e24981458cb83c544d93a6538bb694da0ec87ba`

Audited but not loaded into the user-run runtime:

- vercel-labs/agent-skills — commit `063bee94c3f4df8453406c830b0a7df0f2860278`; no root license was present in the audited revision, so its instruction content is not copied or adapted.
- shuyhere/repo-to-skill — MIT — commit `f4fe8c564b07dd6e50fa7ec089da8946ef1c29da`; retained as an administration concept only, never as an automatic runtime downloader.

Database and migration policy is Coden-native and is not attributed to an upstream skill.
