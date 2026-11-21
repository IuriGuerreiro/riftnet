import { Plus, X } from "lucide-react";
import { type Control, useFieldArray, type UseFormReturn, useWatch } from "react-hook-form";

import { Button, cn, IconButton, Input } from "../../components/ui";
import { MAX_LINKS, type ProfileForm } from "../../schemas/profile";

const STATUS_EMOJIS = [
  "😀",
  "😎",
  "🥳",
  "😴",
  "🤒",
  "🤔",
  "😤",
  "🫠",
  "💻",
  "🎮",
  "🎧",
  "📚",
  "🎨",
  "🏋️",
  "☕",
  "🍕",
  "✈️",
  "🏠",
  "🔥",
  "✨",
  "❤️",
  "👀",
  "🚧",
  "🌙",
];

type ColorName = "accent_color" | "name_color";

export function ColorField({
  form,
  name,
  label,
  fallback,
}: {
  form: UseFormReturn<ProfileForm>;
  name: ColorName;
  label: string;
  fallback: string;
}) {
  const raw = useWatch({ control: form.control, name }) ?? "";
  const value = raw.trim().toLowerCase();
  const valid = /^#[0-9a-f]{6}$/.test(value);
  const set = (v: string) => form.setValue(name, v, { shouldDirty: true, shouldValidate: true });

  return (
    <div className="flex items-end gap-2">
      <input
        type="color"
        aria-label={`Pick ${label.toLowerCase()}`}
        value={valid ? value : fallback}
        onChange={(e) => set(e.target.value)}
        className="mb-0.5 size-10 shrink-0 cursor-pointer rounded-control border border-line bg-transparent"
      />
      <div className="flex-1">
        <Input
          label={label}
          placeholder="#rrggbb"
          {...form.register(name)}
          error={form.formState.errors[name]?.message}
        />
      </div>
      {raw && (
        <Button size="sm" variant="ghost" className="mb-1" onClick={() => set("")}>
          Clear
        </Button>
      )}
    </div>
  );
}

export function EmojiPicker({ form }: { form: UseFormReturn<ProfileForm> }) {
  const current = useWatch({ control: form.control, name: "status_emoji" }) ?? "";
  const set = (v: string) =>
    form.setValue("status_emoji", v, { shouldDirty: true, shouldValidate: true });

  return (
    <fieldset>
      <legend className="mb-1.5 text-xs font-semibold uppercase text-fg-muted">Status emoji</legend>
      <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Status emoji">
        <button
          type="button"
          role="radio"
          aria-checked={!current}
          onClick={() => set("")}
          className={cn(
            "flex size-8 items-center justify-center rounded-control text-xs text-fg-subtle hover:bg-surface-3",
            !current && "bg-surface-3 ring-2 ring-brand",
          )}
        >
          None
        </button>
        {STATUS_EMOJIS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            role="radio"
            aria-checked={current === emoji}
            aria-label={emoji}
            onClick={() => set(emoji)}
            className={cn(
              "flex size-8 items-center justify-center rounded-control text-lg hover:bg-surface-3",
              current === emoji && "bg-surface-3 ring-2 ring-brand",
            )}
          >
            {emoji}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function LinksEditor({
  control,
  form,
}: {
  control: Control<ProfileForm>;
  form: UseFormReturn<ProfileForm>;
}) {
  const { fields, append, remove } = useFieldArray({ control, name: "links" });
  const errors = form.formState.errors.links;

  return (
    <fieldset className="space-y-2">
      <legend className="mb-1.5 text-xs font-semibold uppercase text-fg-muted">Links</legend>
      {fields.map((field, i) => (
        <div key={field.id} className="flex items-start gap-2">
          <div className="flex-1">
            <Input
              aria-label={`Link ${i + 1}`}
              placeholder="https://"
              {...form.register(`links.${i}.url`)}
              error={errors?.[i]?.url?.message}
            />
          </div>
          <IconButton
            label={`Remove link ${i + 1}`}
            size="sm"
            icon={<X size={16} />}
            className="mt-1.5"
            onClick={() => remove(i)}
          />
        </div>
      ))}
      {fields.length < MAX_LINKS && (
        <Button size="sm" variant="secondary" onClick={() => append({ url: "" })}>
          <Plus size={14} /> Add link
        </Button>
      )}
      {errors?.root?.message && <p className="text-xs text-danger">{errors.root.message}</p>}
    </fieldset>
  );
}
