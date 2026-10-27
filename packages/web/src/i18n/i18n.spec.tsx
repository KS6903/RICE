import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { currentLanguage, findLanguage, LANGUAGES, t, textKey } from ".";
import { tx } from "./tx";

describe("t", () => {
  it("shows the English key, with its values, when nothing else is loaded", () => {
    expect(currentLanguage().code).toBe("en");
    expect(t("Rain likely after {{time}}", { time: "3 PM" })).toBe("Rain likely after 3 PM");
  });

  it("counts in English from en.json", () => {
    expect(t("{{count}} users", { count: 1 })).toBe("1 user");
    expect(t("{{count}} users", { count: 4 })).toBe("4 users");
    expect(t("You can restore them within 30 days.", { count: 1 })).toBe(
      "You can restore it within 30 days.",
    );
  });

  it("marks data that is English without changing it", () => {
    expect(textKey("Manager")).toBe("Manager");
  });
});

describe("tx", () => {
  it("puts an element where its placeholder is", () => {
    const { container } = render(
      <p>{tx("Your {{plan}} plan expires in {{count}} days.", { plan: <b>Pro</b>, count: 2 })}</p>,
    );
    expect(container.innerHTML).toBe("<p>Your <b>Pro</b> plan expires in 2 days.</p>");
  });
});

describe("the language list", () => {
  it("has English, and each language once", () => {
    expect(findLanguage("en")?.name).toBe("English");
    const codes = LANGUAGES.map((l) => l.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("has Tagalog, Bisaya, Ilocano and Hiligaynon by the names people use", () => {
    expect(["tl", "ceb", "ilo", "hil"].map((code) => findLanguage(code)?.name)).toEqual([
      "Tagalog",
      "Bisaya",
      "Ilokano",
      "Hiligaynon",
    ]);
  });
});
