/**
 * Type-level tests, checked by `pnpm typecheck` (tsc includes every `.tsx`; vitest does not run
 * `.test-d.tsx`). An unused `@ts-expect-error` is itself a type error, so each case fails the
 * typecheck as soon as the contract it guards is loosened.
 */
import type { ComponentProps } from "react";
import { expectTypeOf } from "vitest";
import { IconButton } from "./IconButton";
import { MenuIcon } from "./icons";

type Props = ComponentProps<typeof IconButton>;

expectTypeOf<Props["label"]>().toEqualTypeOf<string>();

// @ts-expect-error -- an icon-only button without a label has no accessible name
export const withoutLabel = <IconButton icon={<MenuIcon />} />;

// @ts-expect-error -- children would be read as part of the name; the icon goes in `icon`
export const withChildren = <IconButton label="Menu" icon={<MenuIcon />}>Menu</IconButton>;

export const valid = <IconButton label="Open menu" icon={<MenuIcon />} onClick={() => {}} />;
