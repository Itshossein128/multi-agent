import {
  APPEARANCE_STORAGE_KEY,
  parseAppearance,
  readAppearance,
  toggleAppearance,
  writeAppearance,
  type Appearance,
} from "@/lib/appearance";

describe("appearance preference", () => {
  it("uses the browser storage key and only light or dark", () => {
    expect(APPEARANCE_STORAGE_KEY).toBe("agent-studio.appearance.v1");
    expect(parseAppearance("light")).toBe("light");
    expect(parseAppearance("dark")).toBe("dark");
  });

  it("rejects every value other than the exact strings light and dark", () => {
    expect(parseAppearance(null)).toBe("dark");
    expect(parseAppearance("")).toBe("dark");
    expect(parseAppearance("Light")).toBe("dark");
    expect(parseAppearance("auto")).toBe("dark");
    expect(parseAppearance("system")).toBe("dark");
    expect(parseAppearance("blue")).toBe("dark");
  });

  it("toggles between the two appearances", () => {
    expect(toggleAppearance("dark")).toBe("light");
    expect(toggleAppearance("light")).toBe("dark");
  });

  it("reads dark when the key is missing and does not rewrite a corrupt value", () => {
    const setItem = jest.fn();
    expect(readAppearance({ getItem: () => null, setItem } as Pick<Storage, "getItem"> & { setItem: jest.Mock })).toBe("dark");
    expect(setItem).not.toHaveBeenCalled();

    const corrupt = {
      getItem: () => "blue",
      setItem: jest.fn(),
    };
    expect(readAppearance(corrupt)).toBe("dark");
    expect(corrupt.setItem).not.toHaveBeenCalled();
    expect(corrupt.getItem()).toBe("blue");
  });

  it("reads the stored light or dark value", () => {
    expect(readAppearance({ getItem: (key: string) => (key === APPEARANCE_STORAGE_KEY ? "light" : null) })).toBe("light");
    expect(readAppearance({ getItem: () => "dark" })).toBe("dark");
  });

  it("resolves a thrown storage read to dark", () => {
    expect(readAppearance({ getItem: () => { throw new Error("denied"); } })).toBe("dark");
  });

  it("writes only light or dark and swallows storage exceptions", () => {
    const setItem = jest.fn();
    writeAppearance({ setItem }, "light");
    writeAppearance({ setItem }, "dark");
    expect(setItem).toHaveBeenNthCalledWith(1, APPEARANCE_STORAGE_KEY, "light");
    expect(setItem).toHaveBeenNthCalledWith(2, APPEARANCE_STORAGE_KEY, "dark");

    writeAppearance({ setItem }, "blue" as Appearance);
    expect(setItem).toHaveBeenCalledTimes(2);

    expect(() => writeAppearance({ setItem: () => { throw new Error("denied"); } }, "light")).not.toThrow();
  });
});
