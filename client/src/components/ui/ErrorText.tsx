export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-sm text-danger">
      {error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "Something went wrong"}
    </p>
  );
}
