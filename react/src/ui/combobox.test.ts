import { describe, expect, it } from "vitest";
import { comboboxInputValue } from "./combobox.tsx";

interface City {
  id: string;
  name: string;
}

const recife: City = { id: "rec", name: "Recife" };
const label = (city: City) => city.name;

describe("comboboxInputValue", () => {
  // Show the label while the list is open and every keystroke is overwritten by the old
  // selection — the field types backwards.
  it("shows what the user is typing while the list is open", () => {
    expect(comboboxInputValue(true, "rec", recife, label)).toBe("rec");
  });

  // Show the query while the list is closed and the field goes blank the moment focus
  // leaves, even though a value is set.
  it("shows the selected item once the list closes", () => {
    expect(comboboxInputValue(false, "rec", recife, label)).toBe("Recife");
  });

  it("is empty with nothing selected", () => {
    expect(comboboxInputValue(false, "rec", null, label)).toBe("");
  });

  it("still shows an open query when nothing is selected yet", () => {
    expect(comboboxInputValue(true, "rec", null, label)).toBe("rec");
  });
});
