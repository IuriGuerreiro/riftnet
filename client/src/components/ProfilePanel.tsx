import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";

import { useRemoveAvatar, useUpdateProfile, useUploadAvatar } from "../api/profile";
import {
  AVATAR_TYPES,
  avatarFileProblem,
  MAX_BIO,
  type ProfileForm,
  profileSchema,
} from "../schemas/profile";
import { useProfile } from "../stores/profiles";
import { Avatar } from "./Avatar";
import { PresenceSettings } from "./PresenceSettings";
import { Button, ErrorText, Input } from "./ui";

export function ProfilePanel({ myId, onClose }: { myId: string; onClose: () => void }) {
  const me = useProfile(myId);
  const update = useUpdateProfile();
  const upload = useUploadAvatar();
  const remove = useRemoveAvatar();
  const fileInput = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{ file: File; url: string } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const form = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      display_name: me?.displayName ?? "",
      bio: me?.bio ?? "",
      custom_status: me?.customStatus ?? "",
    },
  });
  const bio = useWatch({ control: form.control, name: "bio" });

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview.url);
    },
    [preview],
  );

  function pick(file: File | undefined) {
    if (!file) return;
    const problem = avatarFileProblem(file);
    setFileError(problem);
    if (problem) return;
    setPreview({ file, url: URL.createObjectURL(file) });
  }

  const onSave = form.handleSubmit((values) =>
    update.mutate(values, { onSuccess: () => form.reset(values) }),
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm space-y-4 rounded-xl bg-zinc-900 p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Your profile</h2>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-100"
            aria-label="Close"
          >
            ✕
          </button>
        </header>

        <PresenceSettings />
        <section className="flex items-center gap-4">
          {preview ? (
            <img src={preview.url} alt="preview" className="size-24 rounded-full object-cover" />
          ) : (
            <Avatar userId={myId} size="lg" />
          )}
          <div className="flex flex-col gap-2 text-sm">
            <input
              ref={fileInput}
              type="file"
              accept={AVATAR_TYPES.join(",")}
              className="hidden"
              onChange={(e) => {
                pick(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            {preview ? (
              <>
                <button
                  className="rounded bg-brand px-3 py-1 font-semibold text-zinc-950 disabled:opacity-50"
                  disabled={upload.isPending}
                  onClick={() => upload.mutate(preview.file, { onSuccess: () => setPreview(null) })}
                >
                  {upload.isPending ? "Uploading…" : "Save avatar"}
                </button>
                <button
                  className="text-zinc-400 hover:text-zinc-100"
                  onClick={() => setPreview(null)}
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button
                  className="rounded bg-zinc-800 px-3 py-1 hover:bg-zinc-700"
                  onClick={() => fileInput.current?.click()}
                >
                  Change avatar
                </button>
                {me?.avatarHash && (
                  <button
                    className="text-zinc-400 hover:text-red-400 disabled:opacity-50"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate()}
                  >
                    Remove
                  </button>
                )}
              </>
            )}
          </div>
        </section>
        <ErrorText error={fileError ?? upload.error ?? remove.error} />

        <form onSubmit={onSave} className="space-y-3">
          <label className="block space-y-1 text-xs text-zinc-400">
            Display name
            <Input
              placeholder={me?.username ? `@${me.username}` : "display name"}
              {...form.register("display_name")}
              error={form.formState.errors.display_name?.message}
            />
          </label>
          <label className="block space-y-1 text-xs text-zinc-400">
            Custom status
            <Input
              placeholder="What are you up to?"
              {...form.register("custom_status")}
              error={form.formState.errors.custom_status?.message}
            />
          </label>
          <label className="block space-y-1 text-xs text-zinc-400">
            Bio
            <textarea
              rows={3}
              {...form.register("bio")}
              className="w-full resize-none rounded-lg bg-zinc-800 px-3 py-2 text-sm text-zinc-100 outline-none ring-brand focus:ring-2"
            />
            <span className="flex justify-between">
              <span className="text-red-400">{form.formState.errors.bio?.message}</span>
              <span>
                {bio.length}/{MAX_BIO}
              </span>
            </span>
          </label>
          <ErrorText error={update.error} />
          {update.isSuccess && !form.formState.isDirty && (
            <p className="text-xs text-green-400">Saved</p>
          )}
          <Button type="submit" disabled={update.isPending}>
            Save profile
          </Button>
        </form>
      </div>
    </div>
  );
}
