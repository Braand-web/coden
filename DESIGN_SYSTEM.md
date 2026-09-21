# Coden public design system

The public experience uses the Builder and Dashboard as visual references without changing either surface.

## Foundations

- Primary typeface: Geist.
- Technical and numeric labels: JetBrains Mono.
- Content shell: 1180 px maximum width.
- Spacing scale: 4, 8, 12, 16, 24, 32, 40, 48, 64, 80 and 96 px.
- Radius scale: 8, 12, 16 and 24 px, plus fully rounded controls.
- Primary accent: `#3A83F7` through `--accent`.
- Motion curve: `cubic-bezier(.32, .72, 0, 1)`.
- Motion durations: 120 ms for physical feedback, 180 ms for controls and 280 ms for panels.

## Public layout

- One shared fixed Header and one shared Footer across all public pages.
- The Header is transparent at the top and becomes a blurred surface after the page leaves its top sentinel.
- The Landing follows one action: describe an application and continue into the authenticated Builder.
- Cards use complete borders, restrained surfaces and no decorative border on only one side.
- Product colour effects stay behind content and never reduce text contrast.

## Interaction

- Every interactive control includes hover, active and keyboard focus states.
- Section reveals use `IntersectionObserver`, opacity, transform and blur only.
- `prefers-reduced-motion` removes nonessential movement.
- Empty, loading and error states use the same geometry as the finished component.

## Content

- French is the canonical language for public pages.
- Claims must map to a product capability or a verifiable source.
- No invented customer, testimonial, metric, certification or connected integration.
- Pricing comes from `src/config/billing-v2.ts`; pages must not define a second commercial source of truth.
- The copyright line remains `@codenYYYY` and the Footer contains no duplicate brand block.

