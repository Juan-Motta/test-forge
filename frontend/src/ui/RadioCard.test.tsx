import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { RadioCard, RadioCardGroup } from "./RadioCard";

function Harness() {
  const [value, setValue] = useState("s2s");
  return (
    <RadioCardGroup label="Evaluator voice pipeline">
      <RadioCard
        name="pipe"
        value="s2s"
        checked={value === "s2s"}
        onChange={setValue}
        title="Speech-to-speech"
        description="One realtime model listens and talks."
      />
      <RadioCard
        name="pipe"
        value="cascade"
        checked={value === "cascade"}
        onChange={setValue}
        title="STT → LLM → TTS"
        description="Pick each piece."
      />
    </RadioCardGroup>
  );
}

describe("RadioCard", () => {
  it("is a native radio named by its title and described by its description", () => {
    render(<Harness />);

    expect(screen.getByRole("radiogroup", { name: "Evaluator voice pipeline" })).toBeInTheDocument();
    const radio = screen.getByRole("radio", { name: "Speech-to-speech" });
    expect(radio).toBeChecked();
    expect(radio).toHaveAccessibleDescription("One realtime model listens and talks.");
  });

  it("selects when the card is clicked", async () => {
    render(<Harness />);

    await userEvent.click(screen.getByText("Pick each piece."));

    expect(screen.getByRole("radio", { name: "STT → LLM → TTS" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Speech-to-speech" })).not.toBeChecked();
  });
});
