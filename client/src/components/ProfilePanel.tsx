import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";

import {
  type ProfileUpdate,
  useRemoveAvatar,
  useRemoveBanner,
  useUpdateProfile,
  useUploadAvatar,
  useUploadBanner,
} from "../api/profile";
import { ProfileCardBody } from "../features/profile/ProfileCard";
import { ColorField, EmojiPicker, LinksEditor } from "../features/profile/ProfileFields";
import {
  AVATAR_TYPES,
  avatarFileProblem,
  isHttpsUrl,
  MAX_BIO,
  MAX_PRONOUNS,
  type ProfileForm,
  profileSchema,
} from "../schemas/profile";
import { useProfile } from "../stores/profiles";
import { Avatar } from "./Avatar";
import { PresenceSettings } from "./PresenceSettings";
import { Button, ErrorText, Input, Modal, Textarea } from "./ui";

const DEFAULT_ACCENT = "#7c6cf2";

function useImagePick() {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{ file: File; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview.url);
    },
    [preview],
  );

  const fileInput = (
    <input
      ref={input}
      type="file"
      accept={AVATAR_TYPES.join(",")}
      className="hidden"
      onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (!file) return;
        const problem = avatarFileProblem(file);
        setError(problem);
        if (!problem) setPreview({ file, url: URL.createObjectURL(file) });
      }}
    />
  );
  return {
    preview,
    error,
    fileInput,
    browse: () => input.current?.click(),
    clear: () => setPreview(null),
  };
}

function validColor(raw: string | undefined): string | null {
  const v = raw?.trim().toLowerCase() ?? "";
  return /^#[0-9a-f]{6}$/.test(v) ? v : null;
}

function orNull(s: string | undefined): string | null {
  const t = s?.trim();
  return t === undefined || t === "" ? null : t;
}

export function ProfilePanel({
  myId,
  onClose,
  onAudio,
}: {
  myId: string;
  onClose: () => void;
  onAudio: () => void;
}) {
  const me = useProfile(myId);
  const update = useUpdateProfile();
  const uploadAvatar = useUploadAvatar();
  const removeAvatar = useRemoveAvatar();
  const uploadBanner = useUploadBanner();
  const removeBanner = useRemoveBanner();
  const avatar = useImagePick();
  const banner = useImagePick();

  const form = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      display_name: me?.displayName ?? "",
      bio: me?.bio ?? "",
      custom_status: me?.customStatus ?? "",
      pronouns: me?.pronouns ?? "",
      accent_color: me?.accentColor ?? "",
      name_color: me?.nameColor ?? "",
      status_emoji: me?.statusEmoji ?? "",
      links: (me?.links ?? []).map((url) => ({ url })),
    },
  });
  const draft = useWatch({ control: form.control });

  const onSave = form.handleSubmit((values) => {
    const dirty = form.formState.dirtyFields;
    const { links, ...rest } = values;
    const changed: ProfileUpdate = Object.fromEntries(
      Object.entries(rest).filter(([k]) => dirty[k as keyof ProfileForm]),
    );
    if (dirty.links) changed.links = (links ?? []).map((l) => l.url).filter(Boolean);
    if (Object.keys(changed).length === 0) return;
    update.mutate(changed, { onSuccess: () => form.reset(values) });
  });

  const previewProfile = me && {
    ...me,
    displayName: orNull(draft.display_name),
    bio: orNull(draft.bio),
    customStatus: orNull(draft.custom_status),
    pronouns: orNull(draft.pronouns),
    accentColor: validColor(draft.accent_color),
    nameColor: validColor(draft.name_color),
    statusEmoji: orNull(draft.status_emoji),
    links: (draft.links ?? []).map((l) => l.url?.trim() ?? "").filter(isHttpsUrl),
  };

  return (
    <Modal open title="Edit profile" onClose={onClose}>
      <PresenceSettings />
      <Button variant="secondary" size="sm" onClick={onAudio}>
        Voice &amp; Audio
      </Button>

      {previewProfile && (
        <section aria-label="Profile preview">
          <ProfileCardBody profile={previewProfile} bannerPreview={banner.preview?.url} />
        </section>
      )}

      <section className="flex items-center gap-4">
        {avatar.preview ? (
          <img
            src={avatar.preview.url}
            alt="Avatar preview"
            className="size-16 rounded-full object-cover"
          />
        ) : (
          <span className="[&>*]:size-16! [&>*]:text-2xl">
            <Avatar userId={myId} size="lg" />
          </span>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {avatar.fileInput}
          {avatar.preview ? (
            <>
              <Button
                size="sm"
                disabled={uploadAvatar.isPending}
                onClick={() =>
                  avatar.preview &&
                  uploadAvatar.mutate(avatar.preview.file, { onSuccess: avatar.clear })
                }
              >
                {uploadAvatar.isPending ? "Uploading…" : "Save avatar"}
              </Button>
              <Button size="sm" variant="ghost" onClick={avatar.clear}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="secondary" onClick={avatar.browse}>
                Change avatar
              </Button>
              {me?.avatarHash && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="hover:text-danger"
                  disabled={removeAvatar.isPending}
                  onClick={() => removeAvatar.mutate()}
                >
                  Remove
                </Button>
              )}
            </>
          )}
        </div>
      </section>
      <ErrorText error={avatar.error ?? uploadAvatar.error ?? removeAvatar.error} />

      <section className="flex flex-wrap items-center gap-2">
        {banner.fileInput}
        {banner.preview ? (
          <>
            <Button
              size="sm"
              disabled={uploadBanner.isPending}
              onClick={() =>
                banner.preview &&
                uploadBanner.mutate(banner.preview.file, { onSuccess: banner.clear })
              }
            >
              {uploadBanner.isPending ? "Uploading…" : "Save banner"}
            </Button>
            <Button size="sm" variant="ghost" onClick={banner.clear}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="secondary" onClick={banner.browse}>
              {me?.bannerHash ? "Change banner" : "Add banner"}
            </Button>
            {me?.bannerHash && (
              <Button
                size="sm"
                variant="ghost"
                className="hover:text-danger"
                disabled={removeBanner.isPending}
                onClick={() => removeBanner.mutate()}
              >
                Remove
              </Button>
            )}
          </>
        )}
        <span className="text-xs text-fg-subtle">Wide image, cropped to 5:2</span>
      </section>
      <ErrorText error={banner.error ?? uploadBanner.error ?? removeBanner.error} />

      <form onSubmit={onSave} className="space-y-4">
        <Input
          label="Display name"
          placeholder={me?.username ? `@${me.username}` : "Display name"}
          {...form.register("display_name")}
          error={form.formState.errors.display_name?.message}
        />
        <Input
          label="Pronouns"
          placeholder="e.g. they/them"
          maxLength={MAX_PRONOUNS}
          {...form.register("pronouns")}
          error={form.formState.errors.pronouns?.message}
        />
        <Input
          label="Custom status"
          placeholder="What are you up to?"
          {...form.register("custom_status")}
          error={form.formState.errors.custom_status?.message}
        />
        <Textarea
          label="Bio"
          rows={3}
          {...form.register("bio")}
          error={form.formState.errors.bio?.message}
          hint={`${draft.bio?.length ?? 0}/${MAX_BIO}`}
        />
        <EmojiPicker form={form} />
        <ColorField form={form} name="name_color" label="Name color" fallback="#ecedf1" />
        <ColorField
          form={form}
          name="accent_color"
          label="Accent color"
          fallback={DEFAULT_ACCENT}
        />
        <LinksEditor control={form.control} form={form} />
        <ErrorText error={update.error} />
        {update.isSuccess && !form.formState.isDirty && (
          <p className="text-xs text-success">Profile saved</p>
        )}
        <Button type="submit" block disabled={update.isPending}>
          Save profile
        </Button>
      </form>
    </Modal>
  );
}
