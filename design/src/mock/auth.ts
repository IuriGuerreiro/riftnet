const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const TAKEN = new Set(["admin", "adept", "nova", "pixel", "ghost", "iuri"]);

export const MOCK_HINTS = [
  ["Login error", "password: wrong"],
  ["Email in use", "email: taken@…"],
  ["Username taken", "admin, nova, pixel"],
] as const;

export async function mockLogin(email: string, password: string) {
  await wait(900);
  if (password === "wrong") throw new Error("That email and password don't match.");
  return { email };
}

export async function mockRegister(email: string) {
  await wait(1100);
  if (email.startsWith("taken@")) throw new Error("An account with this email already exists.");
  return { email };
}

export async function mockCheckUsername(name: string) {
  await wait(450);
  return !TAKEN.has(name);
}

export function suggestUsernames(name: string): string[] {
  const base = name.replaceAll(/[^a-z0-9_.]/g, "").slice(0, 24) || "adept";
  return [`${base}_`, `${base}.gg`, `${base}${(base.length * 37) % 100}`].filter(
    (s) => !TAKEN.has(s),
  );
}
