import { describe, expect, it } from "vitest";

import { avatarFileProblem, linkLabel, MAX_AVATAR_BYTES, profileSchema } from "./profile";

describe("profileSchema", () => {
  it("trims and accepts normal text", () => {
    const r = profileSchema.parse({ display_name: "  Ana B ", bio: "hi\nthere" });
    expect(r).toEqual({ display_name: "Ana B", bio: "hi\nthere" });
  });

  it("validates and trims custom status", () => {
    const base = { display_name: "", bio: "" };
    expect(profileSchema.parse({ ...base, custom_status: "  Building  " }).custom_status).toBe(
      "Building",
    );
    expect(profileSchema.safeParse({ ...base, custom_status: "" }).success).toBe(true);
    for (const custom_status of ["x".repeat(129), "two\nlines", "bell\u0007"]) {
      expect(profileSchema.safeParse({ ...base, custom_status }).success).toBe(false);
    }
  });

  it("allows empty (clears the field)", () => {
    expect(profileSchema.safeParse({ display_name: "", bio: "" }).success).toBe(true);
  });

  it("rejects too long and control characters", () => {
    expect(profileSchema.safeParse({ display_name: "a".repeat(33), bio: "" }).success).toBe(false);
    expect(profileSchema.safeParse({ display_name: "", bio: "b".repeat(191) }).success).toBe(false);
    expect(profileSchema.safeParse({ display_name: "two\nlines", bio: "" }).success).toBe(false);
    expect(profileSchema.safeParse({ display_name: "", bio: "bell\u0007" }).success).toBe(false);
  });
});

describe("avatarFileProblem", () => {
  it("accepts allowed images under the cap", () => {
    expect(avatarFileProblem({ type: "image/png", size: 1000 })).toBeNull();
  });
  it("rejects other types, empty and too big", () => {
    expect(avatarFileProblem({ type: "image/svg+xml", size: 10 })).not.toBeNull();
    expect(avatarFileProblem({ type: "image/jpeg", size: 0 })).not.toBeNull();
    expect(avatarFileProblem({ type: "image/jpeg", size: MAX_AVATAR_BYTES + 1 })).not.toBeNull();
  });
});

describe("pronouns and accent color", () => {
  const base = { display_name: "", bio: "" };
  it("accepts and normalizes", () => {
    const r = profileSchema.parse({ ...base, pronouns: " they/them ", accent_color: " #A1B2C3 " });
    expect(r.pronouns).toBe("they/them");
    expect(r.accent_color).toBe("#a1b2c3");
    expect(profileSchema.safeParse({ ...base, accent_color: "" }).success).toBe(true);
  });
  it("rejects bad values", () => {
    for (const accent_color of ["red", "#12345", "#1234567", "123456", "#12345g"]) {
      expect(profileSchema.safeParse({ ...base, accent_color }).success).toBe(false);
    }
    for (const pronouns of ["p".repeat(41), "a\nb"]) {
      expect(profileSchema.safeParse({ ...base, pronouns }).success).toBe(false);
    }
  });
});

describe("name color, emoji and links", () => {
  const base = { display_name: "", bio: "" };
  it("accepts good values", () => {
    const r = profileSchema.parse({
      ...base,
      name_color: "#FF8800",
      status_emoji: " 🎮 ",
      links: [{ url: " https://github.com/ana " }],
    });
    expect(r.name_color).toBe("#ff8800");
    expect(r.status_emoji).toBe("🎮");
    expect(r.links).toEqual([{ url: "https://github.com/ana" }]);
  });
  it("rejects bad links and too many", () => {
    for (const url of ["http://a.com", "javascript:alert(1)", "a.com", "https://u:p@a.com"]) {
      expect(profileSchema.safeParse({ ...base, links: [{ url }] }).success).toBe(false);
    }
    const six = Array.from({ length: 6 }, () => ({ url: "https://a.com" }));
    expect(profileSchema.safeParse({ ...base, links: six }).success).toBe(false);
  });
  it("labels links by domain", () => {
    expect(linkLabel("https://www.github.com/ana")).toBe("github.com");
  });
});

describe("link length after normalization", () => {
  it("rejects links that grow past the limit once encoded", () => {
    const url = `https://example.com/${"é".repeat(40)}`;
    expect(url.length).toBeLessThanOrEqual(200);
    expect(profileSchema.safeParse({ display_name: "", bio: "", links: [{ url }] }).success).toBe(
      false,
    );
  });
});
