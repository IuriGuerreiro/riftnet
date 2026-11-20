import { useId, useState } from "react";

import { Button } from "./Button";
import { Input } from "./Input";
import { Modal } from "./Modal";

export function PromptDialog({
  open,
  title,
  label,
  initial = "",
  placeholder,
  submitLabel,
  onSubmit,
  onClose,
}: {
  open: boolean;
  title: string;
  label: string;
  initial?: string;
  placeholder?: string;
  submitLabel: string;
  onSubmit: (value: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  const formId = useId();
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={!value.trim()}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={(e) => {
          e.preventDefault();
          if (!value.trim()) return;
          onSubmit(value.trim());
          onClose();
        }}
      >
        <Input
          autoFocus
          label={label}
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
        />
      </form>
    </Modal>
  );
}
