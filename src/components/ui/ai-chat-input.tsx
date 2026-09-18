import * as React from "react";
import { useRef, useState, useEffect, useCallback } from "react";
import { cn } from "../../lib/utils";
import { MODEL_REGISTRY, PROVIDER_META, isPlanAtLeast, type CanonicalUserPlan } from "../../config/ai-models";
import { providerIconSvg } from "../../model-provider-icons";
import { AGENT_EFFORT_LABELS, AGENT_EFFORT_LEVELS, DEFAULT_AGENT_EFFORT, type AgentEffort } from "../../services/agent-effort";

// ----------------------------------------------------------------------
// Transition Physics
// ----------------------------------------------------------------------
const SPRING_TRANSITION = "max-width 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275), height 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)";
const SMOOTH_HEIGHT_TRANSITION = "max-width 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275), height 0.15s ease-out";

// ----------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------
interface Attachment {
  id: string;
  file: File;
  url: string;
  name: string;
  width?: number;
  height?: number;
}

/*
 * The models this selector offers are Coden's own.
 *
 * The reference listed "GPT 5.5", "Opus 4.8" and three more that do not exist
 * in this product. `normalizeModelSelectionId` on the server accepts only ids
 * present in MODEL_REGISTRY and silently returns 'auto' for anything else, so
 * a selector built on those names would have looked like it worked and changed
 * nothing at all — the worst of both outcomes.
 *
 * 'auto' leads, and is the default: it is the one entry that routes rather
 * than pins, and the product's own rule is that the agent decides unless the
 * user overrides it.
 */
export const AUTO_MODEL = "auto";

type ModelOption = { id: string; label: string; icon: string; minPlan: CanonicalUserPlan };

const MODEL_OPTIONS: ModelOption[] = [
  { id: AUTO_MODEL, label: "Auto", icon: "auto", minPlan: "free" },
  ...Array.from(
    new Map(
      MODEL_REGISTRY.map((model: any) => [
        model.id,
        {
          id: model.id as string,
          label: model.label as string,
          icon: PROVIDER_META[model.provider as keyof typeof PROVIDER_META]?.icon || "auto",
          minPlan: model.minPlan as CanonicalUserPlan,
        },
      ]),
    ).values(),
  ),
];

const MODEL_LABELS = new Map(MODEL_OPTIONS.map(option => [option.id, option.label]));
const MODEL_ICONS = new Map(MODEL_OPTIONS.map(option => [option.id, option.icon]));
const MODEL_MIN_PLANS = new Map(MODEL_OPTIONS.map(option => [option.id, option.minPlan]));

/** The level's display name; the raw value is what crosses the wire. */
function effortLabel(value: string): string {
  return AGENT_EFFORT_LABELS[value as AgentEffort] || value;
}

const PLAN_LABELS: Record<CanonicalUserPlan, string> = {
  free: "Free",
  pro: "Pro",
  business: "Business",
  enterprise: "Enterprise",
};

/*
 * Which models this plan may actually run.
 *
 * The menu listed the whole catalogue and the plan was never consulted, so on
 * a free workspace nine of the fourteen entries were traps: the request
 * reached `modelRouter.selectModel`, threw `ModelNotAllowedForPlanError`, and
 * came back as a bare GENERATION_FAILED. Production logged exactly that twice
 * in fourteen seconds on `anthropic/claude-opus-5`.
 *
 * Locked models stay visible — the required plan is the reason to upgrade, and
 * hiding it sells nothing — but they cannot be selected, and a selection that
 * is already stored for a model this plan cannot run resolves back to Auto
 * rather than failing every turn until the user works out why.
 *
 * `plan` left undefined means "not known here" and locks nothing, which is the
 * landing page: it has no session to ask.
 */
function isModelLockedForPlan(modelId: string, plan?: string): boolean {
  if (!plan) return false;
  const minPlan = MODEL_MIN_PLANS.get(modelId);
  return minPlan ? !isPlanAtLeast(plan, minPlan) : false;
}

// ----------------------------------------------------------------------
// Sub-components
// ----------------------------------------------------------------------
function MorphingText({ text }: { text: string }) {
  const [width, setWidth] = useState<number | "auto">("auto");
  const spanRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (spanRef.current) {
      setWidth(spanRef.current.offsetWidth);
    }
  }, [text]);

  return (
    <span
      className="relative inline-flex items-center justify-center overflow-hidden transition-all duration-300 ease-[cubic-bezier(0.175,0.885,0.32,1.275)]"
      style={{ width }}
    >
      <span ref={spanRef} className="invisible whitespace-nowrap px-1">
        {text}
      </span>
      <span
        key={text}
        className="absolute inset-0 flex items-center justify-center whitespace-nowrap animate-in fade-in zoom-in-95 duration-300"
      >
        {text}
      </span>
    </span>
  );
}

/*
 * Provider marks, drawn from this repository.
 *
 * The reference fetched five SVGs from cdn.21st.dev on every render of the
 * dropdown. Those are third-party brand marks on a third-party host: an
 * outbound request per icon, a dependency on someone else's uptime for a
 * control inside a paid product, and no offline story. `providerIconSvg`
 * already exists here and the builder's own selector already uses it.
 */
function ModelIcon({ model, className }: { model: string; className?: string }) {
  const icon = MODEL_ICONS.get(model) || "auto";
  return (
    <span
      className={cn("inline-flex items-center justify-center [&>svg]:size-full", className)}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: providerIconSvg(icon) }}
    />
  );
}

function ArrowUpIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M7 12V2M7 2L2.5 6.5M7 2L11.5 6.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="5" y="1" width="4" height="7" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2.75 6.5V7a4.25 4.25 0 0 0 8.5 0v-.5M7 11.25V13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" fill="currentColor" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M7 2.5V11.5M2.5 7H11.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M2.5 2.5L11.5 11.5M11.5 2.5L2.5 11.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function DynamicBarsIcon({ level }: { level: string }) {
  // Four levels, four bars: Ultra has to look like a step beyond High, not
  // share its icon. Lit by rank so an unknown value degrades to one bar
  // rather than to none.
  const rank = Math.max(0, (AGENT_EFFORT_LEVELS as readonly string[]).indexOf(level));
  const lit = (index: number) => (rank >= index ? 1 : 0.3);

  return (
    <svg width="16" height="14" viewBox="0 0 16 14" fill="none" aria-hidden="true">
      <rect x="0.5" y="9" width="2.5" height="3.5" rx="1" fill="currentColor" className="transition-opacity duration-300" opacity={1} />
      <rect x="4" y="6.5" width="2.5" height="6" rx="1" fill="currentColor" className="transition-opacity duration-300" opacity={lit(1)} />
      <rect x="7.5" y="4" width="2.5" height="8.5" rx="1" fill="currentColor" className="transition-opacity duration-300" opacity={lit(2)} />
      <rect x="11" y="1.5" width="2.5" height="11" rx="1" fill="currentColor" className="transition-opacity duration-300" opacity={lit(3)} />
    </svg>
  );
}

// ----------------------------------------------------------------------
// Attachment Thumbnail
// ----------------------------------------------------------------------
function AttachmentThumb({
  attachment,
  index,
  onRemove,
  onOpen,
  registerRef,
}: {
  attachment: Attachment;
  index: number;
  onRemove: (id: string) => void;
  onOpen: (attachment: Attachment, rect: DOMRect) => void;
  registerRef: (id: string, el: HTMLButtonElement | null) => void;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  return (
    <button
      ref={(el) => {
        btnRef.current = el;
        registerRef(attachment.id, el);
      }}
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={(e) => {
        e.stopPropagation();
        if (btnRef.current) {
          onOpen(attachment, btnRef.current.getBoundingClientRect());
        }
      }}
      style={{ animationDelay: `${index * 35}ms`, animationFillMode: "backwards" }}
      className={cn(
        "group relative size-12 shrink-0 overflow-hidden rounded-xl border border-border bg-muted outline-none",
        "transition-transform duration-200 ease-[cubic-bezier(0.175,0.885,0.32,1.275)] hover:scale-[1.04] active:scale-[0.96]",
        "animate-in fade-in slide-in-from-top-3 zoom-in-90 duration-400"
      )}
      aria-label={`Ouvrir l'aperçu de ${attachment.name}`}
    >
      <img src={attachment.url} alt={attachment.name} className="size-full object-cover" draggable={false} />
      <span className={cn("absolute inset-0 flex items-start justify-end bg-var(--foreground)/0 transition-colors duration-200", isHovered && "bg-var(--foreground)/25")}>
        <span
          role="button" tabIndex={-1}
          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onClick={(e) => { e.stopPropagation(); onRemove(attachment.id); }}
          className={cn(
            "m-1 flex size-4 items-center justify-center rounded-full bg-background/90 text-foreground/70 shadow-sm transition-all duration-200 ease-[cubic-bezier(0.175,0.885,0.32,1.275)] hover:bg-background hover:text-foreground hover:scale-110",
            isHovered ? "opacity-100 scale-100" : "opacity-0 scale-50 pointer-events-none"
          )}
          aria-label={`Retirer ${attachment.name}`}
        >
          <CloseIcon />
        </span>
      </span>
    </button>
  );
}

// ----------------------------------------------------------------------
// Shared-Element Gallery Modal
// ----------------------------------------------------------------------
function AttachmentGalleryModal({
  attachment,
  originRect,
  onClose,
}: {
  attachment: Attachment;
  originRect: DOMRect;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<"opening" | "open" | "closing">("opening");
  const [targetRect, setTargetRect] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
    radius: number;
  } | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const maxW = Math.min(window.innerWidth * 0.86, 560);
    const maxH = Math.min(window.innerHeight * 0.78, 720);

    const naturalW = attachment.width || 800;
    const naturalH = attachment.height || 600;
    const scale = Math.min(maxW / naturalW, maxH / naturalH, 1.6);

    const width = naturalW * scale;
    const height = naturalH * scale;

    setTargetRect({
      top: (window.innerHeight - height) / 2,
      left: (window.innerWidth - width) / 2,
      width,
      height,
      radius: 20,
    });

    const raf = requestAnimationFrame(() => setPhase("open"));
    return () => cancelAnimationFrame(raf);
  }, [attachment]);

  const handleClose = useCallback(() => setPhase("closing"), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") handleClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [handleClose]);

  const isOpen = phase === "open";
  const isClosing = phase === "closing";

  const geometry = isOpen && targetRect
      ? targetRect
      : { top: originRect.top, left: originRect.left, width: originRect.width, height: originRect.height, radius: 12 };

  const animEasing = isClosing ? "ease-out" : "cubic-bezier(0.175, 0.885, 0.32, 1.275)";
  const animDur = isClosing ? "0.3s" : "0.45s";
  const flipTransition = `top ${animDur} ${animEasing}, left ${animDur} ${animEasing}, width ${animDur} ${animEasing}, height ${animDur} ${animEasing}, border-radius ${animDur} ${animEasing}`;

  return (
    <div className="fixed inset-0 z-[100]" onClick={handleClose} role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-background/70 backdrop-blur-md transition-opacity duration-400" style={{ opacity: isOpen ? 1 : 0 }} />
      <div
        style={{
          position: "fixed",
          top: geometry.top, left: geometry.left, width: geometry.width, height: geometry.height,
          borderRadius: geometry.radius, transition: flipTransition, overflow: "hidden",
          boxShadow: isOpen ? "0 24px 60px -12px color-mix(in srgb, var(--foreground) 35%, transparent)" : "0 0px 0px 0px color-mix(in srgb, var(--foreground) 0%, transparent)",
        }}
        className="bg-muted"
        onTransitionEnd={() => { if (phase === "closing") onClose(); }}
        onClick={(e) => e.stopPropagation()}
      >
        <img ref={imgRef} src={attachment.url} alt={attachment.name} className="size-full object-cover" draggable={false} />
      </div>

      <button
        type="button" onClick={handleClose}
        style={{ opacity: isOpen ? 1 : 0, transform: isOpen ? "scale(1)" : "scale(0.7)" }}
        className={cn(
          "fixed right-4 top-4 flex size-9 items-center justify-center rounded-full bg-card/90 text-foreground/70 shadow-md backdrop-blur-sm",
          "transition-all duration-300 ease-[cubic-bezier(0.175,0.885,0.32,1.275)] hover:bg-card hover:text-foreground",
          !isOpen && "pointer-events-none"
        )}
        aria-label="Fermer l'aperçu"
      >
        <span className="scale-150"><CloseIcon /></span>
      </button>
    </div>
  );
}

// ----------------------------------------------------------------------
// Main Component
// ----------------------------------------------------------------------

export interface PromptInputProps {
  onSubmit?: (
    value: string,
    meta: { model: string; effort: string; attachments: File[] }
  ) => void;
  placeholder?: string;
  className?: string;
  models?: string[];
  efforts?: string[];
  defaultValue?: string;
  value?: string;
  onChange?: (value: string) => void;
  /**
   * The model and the effort, controllable exactly like `value`.
   *
   * They used to be internal state seeded from `models[0]`, which made the
   * choice a property of the mounted component rather than of the session:
   * anything that remounted the composer — and the Builder remounts it — put
   * the selector back on Auto without telling anyone. A host that owns the
   * session passes `model`/`effort` and listens to the change callbacks; a
   * host that does not can still seed the first render with `defaultModel`
   * and `defaultEffort` and let the component hold the rest.
   */
  model?: string;
  defaultModel?: string;
  onModelChange?: (model: string) => void;
  /**
   * The workspace plan, so the menu can only offer what it can actually run.
   *
   * Omitted means the surface does not know — nothing is locked, which is the
   * landing page's case. Every surface that has a session should pass it.
   */
  plan?: string;
  effort?: string;
  defaultEffort?: string;
  onEffortChange?: (effort: string) => void;
  maxAttachments?: number;
  /** Collapsed and expanded widths. The surfaces size this differently. */
  collapsedWidth?: number;
  expandedWidth?: number;
  /** Start open, for a surface whose composer is the point of the page. */
  defaultExpanded?: boolean;
  disabled?: boolean;
  /**
   * A run is in flight. The Builder's action button has to become a stop
   * during generation, which is a different state from the recording stop:
   * the user still has a prompt, and pressing it cancels the agent rather
   * than the microphone. Given its own prop so the two cannot be confused.
   */
  isBusy?: boolean;
  onStop?: () => void;
}

export const PromptInput = React.forwardRef<HTMLDivElement, PromptInputProps>(
  (
    {
      onSubmit,
      placeholder = "Posez votre question",
      className,
      models = MODEL_OPTIONS.map(option => option.id),
      efforts = [...AGENT_EFFORT_LEVELS],
      defaultValue = "",
      value: controlledValue,
      onChange,
      model: controlledModel,
      defaultModel,
      onModelChange,
      plan,
      effort: controlledEffort,
      defaultEffort,
      onEffortChange,
      maxAttachments = 6,
      collapsedWidth = 320,
      expandedWidth = 480,
      defaultExpanded = false,
      disabled = false,
      isBusy = false,
      onStop,
    },
    ref
  ) => {
    const [expanded, setExpanded] = useState(defaultExpanded);
    const [isSmoothResize, setIsSmoothResize] = useState(false);
    const [localValue, setLocalValue] = useState(defaultValue);
    /*
     * A seed that is offered, not imposed: a stored model the current surface
     * does not list (a retired id, a model above the plan) falls back to the
     * first option rather than displaying a choice the menu cannot honour.
     */
    const [localModel, setLocalModel] = useState(
      () => (defaultModel && models.includes(defaultModel) ? defaultModel : models[0]),
    );
    const [localEffort, setLocalEffort] = useState(
      () => (defaultEffort && efforts.includes(defaultEffort) ? defaultEffort : DEFAULT_AGENT_EFFORT),
    );
    const [isModelSelectOpen, setIsModelSelectOpen] = useState(false);

    const [attachments, setAttachments] = useState<Attachment[]>([]);
    const [activeAttachment, setActiveAttachment] = useState<{ attachment: Attachment; rect: DOMRect } | null>(null);

    // Audio/Voice recording states
    const [isRecording, setIsRecording] = useState(false);
    const [audioData, setAudioData] = useState<number[]>(new Array(5).fill(0));
    const valueRef = useRef(controlledValue !== undefined ? controlledValue : localValue);

    // Refs for Web Audio & Speech Recognition cleanup
    const streamRef = useRef<MediaStream | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const rafRef = useRef<number | null>(null);
    const recognitionRef = useRef<any>(null);

    const [hoverStyle, setHoverStyle] = useState({ opacity: 0, transform: "translateY(0px) scale(0.95)", transition: "none" });
    const [containerHeight, setContainerHeight] = useState(116);
    const [textareaHeight, setTextareaHeight] = useState(68);
    const [isScrolling, setIsScrolling] = useState(false);

    const isControlled = controlledValue !== undefined;
    const value = isControlled ? controlledValue : localValue;
    const hasValue = value.trim() !== "" || attachments.length > 0;
    const hasAttachments = attachments.length > 0;

    /*
     * The same controlled/uncontrolled resolution the value uses.
     *
     * A host that owns the session sends the model and the effort down and is
     * told about every change; a host that does not keeps them here. Either
     * way the rendered choice is always one of the options on offer, so the
     * label and the menu cannot disagree.
     */
    const isModelControlled = controlledModel !== undefined;
    const rawModel = isModelControlled ? controlledModel : localModel;
    // A model this plan cannot run resolves back to the first option rather
    // than being displayed and sent. Otherwise a stored selection made before
    // a downgrade — or picked from a menu that used to offer everything —
    // fails every single turn with no way for the user to see why.
    const offeredModel = models.includes(rawModel) ? rawModel : models[0];
    const selectedModel = isModelLockedForPlan(offeredModel, plan) ? models[0] : offeredModel;
    const isEffortControlled = controlledEffort !== undefined;
    const rawEffort = isEffortControlled ? controlledEffort : localEffort;
    const effortIndex = Math.max(0, efforts.indexOf(efforts.includes(rawEffort) ? rawEffort : DEFAULT_AGENT_EFFORT));

    const handleModelChange = useCallback((next: string) => {
      if (isModelLockedForPlan(next, plan)) return;
      if (!isModelControlled) setLocalModel(next);
      onModelChange?.(next);
    }, [isModelControlled, onModelChange, plan]);

    const handleEffortChange = useCallback((next: string) => {
      if (!isEffortControlled) setLocalEffort(next);
      onEffortChange?.(next);
    }, [isEffortControlled, onEffortChange]);

    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const internalContainerRef = useRef<HTMLDivElement>(null);
    const topFadeRef = useRef<HTMLDivElement>(null);
    const bottomFadeRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const thumbRefs = useRef<Map<string, HTMLButtonElement | null>>(new Map());

    // Sync value ref for audio callback closure
    useEffect(() => {
      valueRef.current = value;
    }, [value]);

    const updateFades = () => {
      const el = textareaRef.current;
      if (!el) return;
      const { scrollTop, scrollHeight, clientHeight } = el;
      if (topFadeRef.current) {
        topFadeRef.current.style.opacity = Math.min(scrollTop / 20, 1).toString();
      }
      if (bottomFadeRef.current) {
        const bottomScroll = scrollHeight - clientHeight - scrollTop;
        bottomFadeRef.current.style.opacity = Math.min(Math.max(bottomScroll - 16, 0) / 10, 1).toString();
      }
    };

    const handleValueChange = useCallback((val: string) => {
      setIsSmoothResize(true);
      if (!isControlled) setLocalValue(val);
      onChange?.(val);
    }, [isControlled, onChange]);

    const expand = () => {
      setIsSmoothResize(false);
      setExpanded(true);
    };

    // --- Voice Recording Logic ---
    const stopRecording = useCallback(() => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
        recognitionRef.current = null;
      }
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
      setIsRecording(false);
      setAudioData(new Array(5).fill(0));
    }, []);

    const startRecording = useCallback(async () => {
      setIsSmoothResize(false);
      setExpanded(true);

      let stream: MediaStream | null = null;
      try {
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        }
      } catch {
        /* Denied or unavailable — handled below. */
      }

      /*
       * No microphone, no dictation.
       *
       * The reference fell back to typing a fixed English sentence into the
       * box — "Can you build a high fidelity Framer Motion layout…" — which is
       * demo scaffolding. In production that is a stranger's words appearing
       * in a paying customer's prompt after they were told the mic failed.
       * Refusing is the honest outcome; the button simply does nothing it
       * cannot do.
       */
      if (!stream) {
        stopRecording();
        return;
      }

      setIsRecording(true);
      streamRef.current = stream;

      // Setup Web Audio API for visualizer
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioContextRef.current = audioCtx;

      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const updateVisualizer = () => {
        analyser.getByteFrequencyData(dataArray);
        const bands = new Array(5).fill(0);
        const step = Math.floor(dataArray.length / 5);
        for (let i = 0; i < 5; i++) {
          let sum = 0;
          for (let j = 0; j < step; j++) {
            sum += dataArray[i * step + j];
          }
          bands[i] = sum / step / 255; // normalize to 0-1
        }
        setAudioData(bands);
        rafRef.current = requestAnimationFrame(updateVisualizer);
      };
      updateVisualizer();

      // Setup Speech Recognition
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = document.documentElement.lang || "fr-FR";

        let baseline = valueRef.current;

        recognition.onresult = (event: any) => {
          let interimTranscript = "";
          let finalTranscript = "";

          for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
              finalTranscript += event.results[i][0].transcript;
            } else {
              interimTranscript += event.results[i][0].transcript;
            }
          }

          if (finalTranscript) {
            baseline += (baseline ? " " : "") + finalTranscript;
          }

          handleValueChange((baseline + (interimTranscript ? " " + interimTranscript : "")).trim());
        };

        recognition.onerror = () => stopRecording();
        recognition.onend = () => stopRecording();

        recognitionRef.current = recognition;
        recognition.start();
      }
    }, [handleValueChange, stopRecording]);

    // Keep textarea auto-scrolled to bottom while recording
    useEffect(() => {
      if (isRecording && textareaRef.current) {
        textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
      }
    }, [value, isRecording]);

    // Ensure cleanup of mic/streams on unmount
    useEffect(() => {
      return () => {
        stopRecording();
        attachments.forEach((a) => URL.revokeObjectURL(a.url));
      };
    }, [stopRecording, attachments]);


    useEffect(() => {
      if ((value.trim() !== "" || hasAttachments) && !expanded) {
        setIsSmoothResize(false);
        setExpanded(true);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value, expanded, hasAttachments]);

    useEffect(() => {
      if (expanded && !isRecording && !defaultExpanded) {
        const timer = setTimeout(() => {
          if (textareaRef.current) {
            textareaRef.current.focus();
            const length = textareaRef.current.value.length;
            textareaRef.current.setSelectionRange(length, length);
          }
        }, 50);
        return () => clearTimeout(timer);
      }
    }, [expanded, isRecording, defaultExpanded]);

    // ONLY updates height on value/text change. Adding attachments leaves this completely isolated.
    useEffect(() => {
      if (!textareaRef.current) return;
      const el = textareaRef.current;

      const currentHeight = el.style.height;
      el.style.transition = 'none';
      el.style.height = "0px";
      const scrollHeight = el.scrollHeight;
      el.style.height = currentHeight;
      void el.offsetHeight;
      el.style.transition = '';

      const newHeight = Math.max(68, Math.min(scrollHeight, 160));
      el.style.height = `${newHeight}px`;

      setTextareaHeight(newHeight);
      setIsScrolling(scrollHeight > 160);

      setTimeout(updateFades, 0);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value, expanded]);

    useEffect(() => {
      setContainerHeight(Math.max(116, textareaHeight + 48));
      setTimeout(updateFades, 0);
    }, [textareaHeight]);

    useEffect(() => {
      if (!isModelSelectOpen) return;
      const handleOutsideClick = (e: MouseEvent) => {
        if (internalContainerRef.current && !internalContainerRef.current.contains(e.target as Node)) {
          setIsModelSelectOpen(false);
        }
      };
      document.addEventListener("mousedown", handleOutsideClick);
      return () => document.removeEventListener("mousedown", handleOutsideClick);
    }, [isModelSelectOpen]);

    const handleBlur = (e: React.FocusEvent<HTMLDivElement>) => {
      if (internalContainerRef.current && internalContainerRef.current.contains(e.relatedTarget as Node)) return;
      if (value.trim() === "" && !hasAttachments && !isRecording && !defaultExpanded) {
        setIsSmoothResize(false);
        setExpanded(false);
        setIsModelSelectOpen(false);
      }
    };

    const handleSubmit = () => {
      if (value.trim() === "" && !hasAttachments) return;
      if (disabled) return;
      setIsSmoothResize(false);
      onSubmit?.(value, { model: selectedModel, effort: efforts[effortIndex], attachments: attachments.map((a) => a.file) });
      handleValueChange("");
      attachments.forEach((a) => URL.revokeObjectURL(a.url));
      setAttachments([]);
      setExpanded(defaultExpanded);
      setIsModelSelectOpen(false);
    };

    const cycleEffort = (e: React.MouseEvent) => {
      e.stopPropagation();
      handleEffortChange(efforts[(effortIndex + 1) % efforts.length]);
    };

    const openFileChooser = (e: React.MouseEvent) => {
      e.stopPropagation();
      fileInputRef.current?.click();
    };

    const handleFilesChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []).filter((f) => f.type.startsWith("image/"));
      e.target.value = "";

      if (files.length === 0) return;
      const room = Math.max(0, maxAttachments - attachments.length);
      const accepted = files.slice(0, room);

      if (!expanded) { setIsSmoothResize(false); setExpanded(true); }
      else { setIsSmoothResize(true); }

      for (const file of accepted) {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => addAttachment(file, url, img.naturalWidth, img.naturalHeight);
        img.onerror = () => addAttachment(file, url, 800, 600);
        img.src = url;
      }
    };

    const addAttachment = (file: File, url: string, width: number, height: number) => {
      const id = `${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`;
      setAttachments((prev) => [...prev, { id, file, url, name: file.name, width, height }]);
    };

    const removeAttachment = (id: string) => {
      setIsSmoothResize(true);
      setAttachments((prev) => {
        const target = prev.find((a) => a.id === id);
        if (target) URL.revokeObjectURL(target.url);
        return prev.filter((a) => a.id !== id);
      });
      thumbRefs.current.delete(id);
    };

    // Calculate action button states. A run in flight outranks everything:
    // the one thing a user needs from this button then is a way to stop.
    const showStop = isRecording || isBusy;
    const showArrow = hasValue && !showStop;
    const showMic = !hasValue && !showStop;

    const onActionButtonClick = (e: React.MouseEvent) => {
      e.preventDefault();
      if (isRecording) {
        stopRecording();
      } else if (isBusy) {
        onStop?.();
      } else if (hasValue) {
        handleSubmit();
      } else {
        void startRecording();
      }
    };

    return (
      <>
        {/* Outer Wrapper for positioning and max-width scaling.
            `coden-prompt-input` is the scope hook, not decoration: Tailwind's
            preflight is deliberately not loaded on the product surfaces (it
            would reset thousands of lines of hand-written Builder CSS), so the
            few resets this component genuinely assumes — a button with no
            chrome, a control that inherits its font — are scoped to this
            subtree in coden-composer.css instead. */}
        <div
          ref={(node) => {
            if (typeof ref === "function") ref(node);
            else if (ref) ref.current = node;
            // @ts-ignore
            internalContainerRef.current = node;
          }}
          onBlur={handleBlur}
          className={cn("coden-prompt-input relative flex flex-col w-full", className)}
          style={{
            maxWidth: expanded ? expandedWidth : collapsedWidth,
            transition: isSmoothResize ? "max-width 0.15s ease-out" : "max-width 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleFilesChosen}
            className="hidden"
            tabIndex={-1}
            aria-hidden="true"
          />

          {/* Independent Attachment Tab (Slides up from behind the prompt input) */}
          <div
            aria-hidden={!hasAttachments}
            style={{
              height: hasAttachments && expanded ? 68 : 0,
              transition: isSmoothResize
                ? "height 0.15s ease-out"
                : "height 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
            }}
            className="w-full relative z-0 overflow-hidden"
          >
            <div
              style={{
                position: "absolute",
                bottom: -8,
                left: 20,
                right: 20,
                height: 68,
                transform: hasAttachments && expanded ? "translateY(0)" : "translateY(100%)",
                opacity: hasAttachments && expanded ? 1 : 0,
                transition: isSmoothResize
                  ? "transform 0.15s ease-out, opacity 0.15s ease-out"
                  : "transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.3s ease-out",
              }}
              className="border border-border border-b-0 bg-muted rounded-t-2xl px-2 pt-2 pb-1 flex items-start gap-2 overflow-x-auto prompt-scrollbar"
            >
              {attachments.map((attachment, index) => (
                <AttachmentThumb
                  key={attachment.id}
                  attachment={attachment}
                  index={index}
                  onRemove={removeAttachment}
                  onOpen={(a, rect) => setActiveAttachment({ attachment: a, rect })}
                  registerRef={(id, el) => thumbRefs.current.set(id, el)}
                />
              ))}
            </div>
          </div>

          {/* Main Input Card */}
          <div
            onMouseDown={(e) => {
              const isTextarea = e.target === textareaRef.current;
              if (expanded && !isTextarea && !isRecording) {
                e.preventDefault();
                textareaRef.current?.focus();
              }
            }}
            style={{
              borderRadius: 24,
              height: expanded ? containerHeight : 48,
              transition: isSmoothResize ? SMOOTH_HEIGHT_TRANSITION : SPRING_TRANSITION,
              overflow: expanded ? "visible" : "hidden",
            }}
            className={cn(
              "relative w-full border border-border bg-card shadow-sm focus-within:border-ring/40 focus-within:ring-1 focus-within:ring-ring/20 hover:border-border/80 z-10",
              expanded ? "cursor-text" : "cursor-default"
            )}
          >
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => handleValueChange(e.target.value)}
              onScroll={updateFades}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  handleSubmit();
                }
                if (e.key === "Escape" && value.trim() === "" && !hasAttachments && !defaultExpanded) {
                  setIsSmoothResize(false);
                  setExpanded(false);
                  setIsModelSelectOpen(false);
                }
              }}
              placeholder={placeholder}
              aria-label="Prompt"
              disabled={isRecording || disabled}
              style={{
                transition: isSmoothResize
                  ? "height 0.15s ease-out"
                  : "opacity 0.3s ease-out, transform 0.3s ease-out, height 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)"
              }}
              className={cn(
                "prompt-scrollbar absolute top-0 inset-x-0 z-[1] w-full resize-none bg-transparent pl-4 pr-12 py-3.5 text-sm leading-[22px] text-foreground outline-none placeholder:font-medium placeholder:text-muted-foreground/80 cursor-text",
                expanded ? "opacity-100 scale-100 translate-y-0" : "opacity-0 scale-95 -translate-y-1 pointer-events-none",
                isScrolling ? "overflow-y-auto" : "overflow-y-hidden",
                isRecording && "pointer-events-none"
              )}
            />

            <div
              ref={topFadeRef}
              className="coden-prompt-fade absolute left-4 right-12 top-0 z-[2] h-8 pointer-events-none"
            />
            <div
              ref={bottomFadeRef}
              className="coden-prompt-fade absolute left-4 right-12 z-[2] h-8 pointer-events-none"
              style={{
                opacity: 0,
                top: `${textareaHeight - 32}px`,
                transition: isSmoothResize ? "top 0.15s ease-out" : "top 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)"
              }}
            />

            <button
              type="button"
              onClick={expand}
              style={{ transition: isSmoothResize ? "none" : "all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)" }}
              className={cn(
                "absolute inset-x-0 top-0 z-[1] cursor-text pl-4 pr-12 py-[15px] text-left text-sm font-medium leading-[17px] text-muted-foreground/80 outline-none",
                !expanded ? "opacity-100 scale-100 translate-y-0" : "opacity-0 scale-105 translate-y-1 pointer-events-none"
              )}
              aria-label="Ouvrir le champ de saisie"
            >
              {placeholder}
            </button>

            {/* Bottom Actions Wrapper - Hides when recording to make space for visualizer */}
            <div
              className={cn(
                "absolute bottom-2 left-3 right-12 z-[10] flex items-center gap-0 transition-all duration-300 ease-[cubic-bezier(0.175,0.885,0.32,1.275)]",
                expanded && !isRecording ? "opacity-100 blur-0 translate-y-0 pointer-events-auto" : "opacity-0 blur-sm translate-y-2 pointer-events-none"
              )}
            >
              <div className="relative">
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsModelSelectOpen((prev) => !prev);
                  }}
                  className={cn(
                    "group flex items-center gap-1 rounded-full px-2 py-1 text-foreground/50 transition-all duration-200 outline-none hover:bg-accent/60 hover:text-foreground cursor-default",
                    isModelSelectOpen ? "bg-accent/60 text-foreground" : ""
                  )}
                  aria-label={`Choisir le modèle. Actuel : ${MODEL_LABELS.get(selectedModel) || selectedModel}`}
                >
                  <ModelIcon model={selectedModel} className="size-3.5 opacity-70 group-hover:opacity-100 transition-opacity" />
                  <span className="text-xs font-semibold select-none transition-colors">
                    <MorphingText text={MODEL_LABELS.get(selectedModel) || selectedModel} />
                  </span>
                </button>

                <div
                  style={{ transformOrigin: "bottom left" }}
                  onMouseLeave={() => {
                    setHoverStyle((prev) => ({
                      ...prev, opacity: 0, transform: prev.transform.replace("scale(1)", "scale(0.95)"), transition: "opacity 0.2s ease-in, transform 0.2s ease-out",
                    }));
                  }}
                  className={cn(
                    "absolute bottom-full left-0 mb-2.5 z-50 w-44 max-h-72 overflow-y-auto prompt-scrollbar rounded-2xl border border-border bg-card/95 p-1 shadow-xl backdrop-blur-md flex flex-col gap-0.5 transition-all duration-400 cursor-default",
                    isModelSelectOpen
                      ? "opacity-100 scale-100 translate-y-0 pointer-events-auto ease-[cubic-bezier(0.34,1.56,0.64,1)]"
                      : "opacity-0 scale-95 translate-y-3 pointer-events-none ease-[cubic-bezier(0.175,0.885,0.32,1.275)]"
                  )}
                >
                  <div className="relative flex flex-col gap-0.5">
                    <div style={hoverStyle} className="absolute left-0 right-0 top-0 h-8 -z-10 rounded-xl bg-accent pointer-events-none" />
                    {models.map((model, idx) => {
                      const locked = isModelLockedForPlan(model, plan);
                      const requiredPlan = MODEL_MIN_PLANS.get(model);
                      return (
                      <button
                        key={model}
                        type="button"
                        disabled={locked}
                        aria-disabled={locked}
                        title={locked && requiredPlan ? `Requiert le plan ${PLAN_LABELS[requiredPlan]}` : undefined}
                        onMouseDown={(e) => e.preventDefault()}
                        onMouseEnter={() => {
                          if (locked) return;
                          setHoverStyle((prev) => ({
                            opacity: 1, transform: `translateY(${idx * 34}px) scale(1)`,
                            transition: prev.opacity === 0 ? "opacity 0.15s ease-out" : "transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.15s ease",
                          }));
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (locked) return;
                          handleModelChange(model);
                          setIsModelSelectOpen(false);
                        }}
                        className={cn(
                          "group relative flex h-8 w-full items-center justify-between rounded-xl px-2.5 py-1.5 text-left text-xs font-medium outline-none cursor-default",
                          locked ? "text-foreground/35 cursor-not-allowed" : "text-foreground/80 active:scale-[0.98]",
                        )}
                      >
                        <span className="flex items-center gap-2">
                          <ModelIcon model={model} className={cn("size-3.5 transition-opacity", locked ? "opacity-40" : "opacity-85 group-hover:opacity-100")} />
                          {MODEL_LABELS.get(model) || model}
                        </span>
                        {locked && requiredPlan ? (
                          <span className="shrink-0 rounded-md border border-border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-foreground/45">
                            {PLAN_LABELS[requiredPlan]}
                          </span>
                        ) : null}
                      </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <button
                type="button" onMouseDown={(e) => e.preventDefault()} onClick={cycleEffort}
                className="group flex items-center gap-1 rounded-full px-2 py-1 text-foreground/50 transition-all duration-200 hover:bg-accent/60 hover:text-foreground outline-none cursor-default"
                aria-label={`Niveau de raisonnement : ${effortLabel(efforts[effortIndex])}`}
              >
                <DynamicBarsIcon level={efforts[effortIndex]} />
                <span className="text-xs font-semibold select-none transition-colors"><MorphingText text={effortLabel(efforts[effortIndex])} /></span>
              </button>

              <button
                type="button" onMouseDown={(e) => e.preventDefault()} onClick={openFileChooser} disabled={attachments.length >= maxAttachments}
                /* The landing's "start from a screenshot" link clicks this by
                   attribute, the same way it clicked the button this replaced. */
                data-prompt-action="upload"
                className="ml-auto flex size-7 items-center justify-center rounded-full text-foreground/50 transition-all duration-200 hover:bg-accent/60 hover:text-foreground outline-none cursor-default disabled:opacity-40 disabled:pointer-events-none"
                aria-label="Joindre des images"
              >
                <PlusIcon />
              </button>
            </div>

            {/* Audio Wave Visualizer Overlay positioned precisely to the left of the mic button */}
            <div
              className={cn(
                "absolute right-12 bottom-2 z-[10] flex h-8 items-center justify-end gap-[3px] transition-all duration-400 ease-[cubic-bezier(0.175,0.885,0.32,1.275)]",
                isRecording ? "w-16 opacity-100 translate-x-0" : "w-0 opacity-0 translate-x-4 pointer-events-none"
              )}
            >
              {audioData.map((val, i) => (
                <div
                  key={i}
                  className="w-1 rounded-full bg-primary transition-[height] duration-75 ease-out"
                  style={{ height: `${Math.max(4, val * 24)}px` }}
                />
              ))}
            </div>

            <button
              type="button"
              onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onClick={onActionButtonClick}
              disabled={disabled}
              aria-label={showArrow ? "Envoyer" : isRecording ? "Arrêter la dictée" : isBusy ? "Arrêter la génération" : "Dicter"}
              style={{ borderRadius: 9999 }}
              className="absolute right-2 bottom-2 z-[10] flex h-8 w-8 items-center justify-center bg-primary text-primary-foreground transition-all duration-300 hover:opacity-90 outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-default disabled:opacity-50"
            >
              <span className="relative flex h-full w-full items-center justify-center">
                <span className={cn("absolute inset-0 flex items-center justify-center transition-all duration-300 ease-[cubic-bezier(0.175,0.885,0.32,1.275)]", showArrow ? "opacity-100 scale-100 rotate-0 blur-none" : "opacity-0 scale-50 rotate-45 blur-[1px] pointer-events-none")}>
                  <ArrowUpIcon />
                </span>
                <span className={cn("absolute inset-0 flex items-center justify-center transition-all duration-300 ease-[cubic-bezier(0.175,0.885,0.32,1.275)]", showMic ? "opacity-100 scale-100 rotate-0 blur-none" : "opacity-0 scale-50 -rotate-45 blur-[1px] pointer-events-none")}>
                  <MicIcon />
                </span>
                <span className={cn("absolute inset-0 flex items-center justify-center transition-all duration-300 ease-[cubic-bezier(0.175,0.885,0.32,1.275)]", showStop ? "opacity-100 scale-100 rotate-0 blur-none" : "opacity-0 scale-50 rotate-45 blur-[1px] pointer-events-none")}>
                  <StopIcon />
                </span>
              </span>
            </button>
          </div>
        </div>

        {activeAttachment && (
          <AttachmentGalleryModal
            attachment={activeAttachment.attachment} originRect={activeAttachment.rect} onClose={() => setActiveAttachment(null)}
          />
        )}
      </>
    );
  }
);

PromptInput.displayName = "PromptInput";
