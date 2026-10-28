import { describe, expect, it } from "vitest";
import {
  emulatorSearchText,
  formatGrams,
  isEmulatorSerial,
  isValidAvdName,
  suggestAvdName,
} from "./emulator";

describe("emulator helpers", () => {
  it("recognizes emulator serials", () => {
    expect(isEmulatorSerial("emulator-5554")).toBe(true);
    expect(isEmulatorSerial("192.168.10.22:5555")).toBe(false);
  });

  it("suggests names the backend accepts", () => {
    expect(suggestAvdName("CRKC-3588A", 31)).toBe("Leniu_CRKC-3588A_API31");
    expect(suggestAvdName("秤 3588", 31)).toBe("Leniu_3588_API31");
    expect(suggestAvdName("", 30)).toBe("Leniu_Device_API30");
    expect(isValidAvdName(suggestAvdName("x".repeat(100), 31))).toBe(true);
    expect(isValidAvdName("出入库")).toBe(false);
    expect(isValidAvdName(".hidden")).toBe(false);
  });

  it("builds search text from names, source and model", () => {
    const text = emulatorSearchText(
      {
        name: "Leniu_CRKC-3588A_API32",
        displayName: "出入库秤-王丽",
        api: 32,
        abi: "arm64-v8a",
        width: 1920,
        height: 1080,
        profile: {
          sourceSn: "be49d58da931daef",
          sourceLabel: "出入库秤-王丽-3588",
          identity: {
            brand: "",
            manufacturer: "ShiMeta",
            model: "CRKC-3588A",
            device: "",
            name: "",
            platform: "",
            displayId: "",
          },
          serialPorts: [],
          scalePort: null,
          scaleProtocol: "xyd2",
        },
      },
      "emulator-5554",
    );
    expect(text).toContain("出入库");
    expect(text).toContain("crkc-3588a");
    expect(text).toContain("emulator-5554");
    expect(text).not.toContain("undefined");
  });

  it("formats weights", () => {
    expect(formatGrams(0)).toBe("0 g");
    expect(formatGrams(1234)).toBe("1.234 kg");
    expect(formatGrams(-500)).toBe("-500 g");
  });
});
