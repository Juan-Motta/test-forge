import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { GroupMeta } from "./GroupMeta";

describe("GroupMeta", () => {
  it("keeps saving tags after a save that throws, and shows what the server holds", async () => {
    const onTags = vi.fn().mockRejectedValueOnce(new Error("network down")).mockResolvedValue(undefined);
    const user = userEvent.setup();
    const { rerender } = render(<GroupMeta description="" tags={["a", "b"]} onDescription={vi.fn()} onTags={onTags} />);

    await user.click(screen.getByRole("button", { name: "Remove the tag a" }));
    expect(await screen.findByText("network down")).toBeInTheDocument();
    // The failed removal is undone: the list is what the server still holds.
    expect(within(screen.getByRole("list", { name: "Group tags" })).getByText("a")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove the tag b" }));
    await waitFor(() => expect(onTags).toHaveBeenLastCalledWith(["a"]));
    rerender(<GroupMeta description="" tags={["a"]} onDescription={vi.fn()} onTags={onTags} />);
    expect(within(screen.getByRole("list", { name: "Group tags" })).queryByText("b")).not.toBeInTheDocument();
  });

  it("can save the description again after a save that throws", async () => {
    const onDescription = vi.fn().mockRejectedValueOnce(new Error("network down")).mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<GroupMeta description="" tags={[]} onDescription={onDescription} onTags={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Edit the description" }));
    await user.type(screen.getByRole("textbox", { name: "Edit the description" }), "First");
    await user.keyboard("{Control>}{Enter}{/Control}");
    expect(await screen.findByText("network down")).toBeInTheDocument();
    await user.keyboard("{Control>}{Enter}{/Control}");
    await waitFor(() => expect(onDescription).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Edit the description" })).not.toBeInTheDocument());
  });
});
