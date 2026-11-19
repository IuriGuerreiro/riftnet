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
import { Button, ErrorText, Input, Modal, Textarea } from "./ui";

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
    defaultValues: { display_name: me?.displayName ?? "", bio: me?.bio ?? "" },
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
    <Modal open title="Your profile" onClose={onClose}>
      <section className="flex items-center gap-4">
        {preview ? (
          <img src={preview.url} alt="preview" className="size-24 rounded-full object-cover" />
        ) : (
          <Avatar userId={myId} size="lg" />
        )}
        <div className="flex flex-col items-start gap-2">
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
              <Button
                size="sm"
                disabled={upload.isPending}
                onClick={() => upload.mutate(preview.file, { onSuccess: () => setPreview(null) })}
              >
                {upload.isPending ? "Uploading…" : "Save avatar"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPreview(null)}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="secondary" onClick={() => fileInput.current?.click()}>
                Change avatar
              </Button>
              {me?.avatarHash && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="hover:text-danger"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate()}
                >
                  Remove
                </Button>
              )}
            </>
          )}
        </div>
      </section>
      <ErrorText error={fileError ?? upload.error ?? remove.error} />

      <form onSubmit={onSave} className="space-y-4">
        <Input
          label="Display name"
          placeholder={me?.username ? `@${me.username}` : "display name"}
          {...form.register("display_name")}
          error={form.formState.errors.display_name?.message}
        />
        <Textarea
          label="Bio"
          rows={3}
          {...form.register("bio")}
          error={form.formState.errors.bio?.message}
          hint={`${bio.length}/${MAX_BIO}`}
        />
        <ErrorText error={update.error} />
        {update.isSuccess && !form.formState.isDirty && (
          <p className="text-xs text-success">Saved</p>
        )}
        <Button type="submit" block disabled={update.isPending}>
          Save profile
        </Button>
      </form>
    </Modal>
  );
}
