import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./Button";
import { Dialog } from "./Dialog";

function Harness({ onClose = () => {} }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Delete connection</Button>
      <Dialog
        open={open}
        title="Delete connection?"
        description="Runs that use it will fail until you pick another."
        onClose={() => {
          onClose();
          setOpen(false);
        }}
        actions={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger">Delete</Button>
          </>
        }
      />
    </>
  );
}

describe("Dialog", () => {
  it("is labelled by its title and described by its description", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Delete connection" }));

    const dialog = screen.getByRole("dialog", { name: "Delete connection?" });
    expect(dialog).toHaveAccessibleDescription("Runs that use it will fail until you pick another.");
  });

  it("moves focus inside and keeps Tab cycling within the dialog", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Delete connection" }));

    const cancel = screen.getByRole("button", { name: "Cancel" });
    const remove = screen.getByRole("button", { name: "Delete" });
    expect(cancel).toHaveFocus();

    await user.tab();
    expect(remove).toHaveFocus();
    await user.tab();
    expect(cancel).toHaveFocus();
    await user.tab({ shift: true });
    expect(remove).toHaveFocus();
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const trigger = screen.getByRole("button", { name: "Delete connection" });
    await user.click(trigger);

    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("renders free-form content (like a form) when no actions are given", async () => {
    render(
      <Dialog open title="Add connection" onClose={() => {}}>
        <form aria-label="Connection">
          <label htmlFor="n">Name</label>
          <input id="n" />
        </form>
      </Dialog>,
    );

    const dialog = screen.getByRole("dialog", { name: "Add connection" });
    expect(within(dialog).getByRole("form", { name: "Connection" })).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveFocus();
  });

  it("renders confirmation actions after the body, all reachable from the keyboard", async () => {
    render(
      <Dialog
        open
        title="Delete connection?"
        onClose={() => {}}
        actions={
          <>
            <Button variant="secondary">Cancel</Button>
            <Button>Delete</Button>
          </>
        }
      >
        <p>Runs that use it will fail.</p>
        <a href="#details">Details</a>
      </Dialog>,
    );

    const dialog = screen.getByRole("dialog", { name: "Delete connection?" });
    const body = within(dialog).getByText("Runs that use it will fail.");
    const cancel = within(dialog).getByRole("button", { name: "Cancel" });
    const remove = within(dialog).getByRole("button", { name: "Delete" });
    expect(body.compareDocumentPosition(cancel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(cancel.compareDocumentPosition(remove) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    expect(within(dialog).getByRole("link", { name: "Details" })).toHaveFocus();
    await userEvent.tab();
    expect(cancel).toHaveFocus();
    await userEvent.tab();
    expect(remove).toHaveFocus();
  });
});
