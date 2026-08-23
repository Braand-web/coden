# Coden

Coden is an AI-assisted full-stack web application builder. Provider calls,
system prompts, privileged tools, and private credentials remain server-side.

## Run Locally

**Prerequisites:** Node.js

1. Install dependencies:
   `npm install`
2. Copy `.env.example` to `.env.local` and configure the server-only
   `OPENROUTER_API_KEY`. Coden routes its approved model catalog exclusively
   through OpenRouter and never exposes provider credentials through `VITE_*`.
3. Configure the matching Supabase frontend and backend variables.
4. Run the app:
   `npm run dev`

## Validation

Before publishing changes:

```sh
npm run lint
npm run test
npm run seo:check
npm run build
```

## Production

Railway must receive the server-only OpenRouter, Supabase service-role and
Cloudflare deployment credentials. Only the Supabase URL and publishable key
may use the `VITE_` prefix. The canonical public URL is `https://coden.fun`.

Apply the versioned files in `supabase/migrations/` to the selected Coden
Supabase project before enabling authenticated production traffic. Payment
variables remain optional until billing is activated.
