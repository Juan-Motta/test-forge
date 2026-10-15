import type { Locale } from "../config";
import { en } from "./en";
import { es } from "./es";

export type MessageKey = keyof typeof en;

/** A dictionary: every English key, no others (a missing or extra key is a type error). */
export type Messages = { readonly [K in MessageKey]: string };

/** Keys of plural messages, without the `.one` / `.other` suffix. */
export type PluralKey = { [K in MessageKey]: K extends `${infer Base}.other` ? Base : never }[MessageKey];

export const MESSAGES: Record<Locale, Messages> = { en, es };
