import { useCallback, useEffect, useState } from "react";

const GUIDE_VERSION = "v3";
const NAVIGATOR_VERSION = "v2";

export type GuideKind = "orientation" | "workspace";

function storageKey(kind: GuideKind | "navigator", scope: string) {
  const version = kind === "navigator" ? NAVIGATOR_VERSION : GUIDE_VERSION;
  return `openrails.cockpit.${kind}.${version}:${scope}`;
}

function readBoolean(key: string, fallback: boolean) {
  if (typeof window === "undefined") return fallback;
  const value = window.localStorage.getItem(key);
  if (value === null) return fallback;
  return value === "true";
}

export function guidanceScope(address?: string, workspaceId?: string) {
  return `${address?.toLowerCase() ?? "guest"}:${workspaceId ?? "direct"}`;
}

export function useFirstRunGuide(scope: string, kind: GuideKind = "orientation") {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    const completed = readBoolean(storageKey(kind, scope), false);
    setStep(0);
    setOpen(!completed);
  }, [kind, scope]);

  const dismiss = useCallback(() => {
    window.localStorage.setItem(storageKey(kind, scope), "true");
    setOpen(false);
  }, [kind, scope]);

  const restart = useCallback((nextStep = 0) => {
    setStep(nextStep);
    setOpen(true);
  }, []);

  return { open, step, setStep, dismiss, restart };
}

export function useNavigatorPreference(scope: string) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(readBoolean(storageKey("navigator", scope), false));
  }, [scope]);

  const update = useCallback((next: boolean) => {
    window.localStorage.setItem(storageKey("navigator", scope), String(next));
    setOpen(next);
  }, [scope]);

  return { open, setOpen: update };
}
