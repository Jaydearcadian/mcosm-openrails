import { useCallback, useEffect, useState } from "react";

const GUIDE_VERSION = "v1";

function storageKey(kind: "tour" | "navigator", scope: string) {
  return `openrails.cockpit.${kind}.${GUIDE_VERSION}:${scope}`;
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

export function useFirstRunGuide(scope: string) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    const completed = readBoolean(storageKey("tour", scope), false);
    setStep(0);
    setOpen(!completed);
  }, [scope]);

  const dismiss = useCallback(() => {
    window.localStorage.setItem(storageKey("tour", scope), "true");
    setOpen(false);
  }, [scope]);

  const restart = useCallback((nextStep = 0) => {
    setStep(nextStep);
    setOpen(true);
  }, []);

  return { open, step, setStep, dismiss, restart };
}

export function useNavigatorPreference(scope: string) {
  const [open, setOpen] = useState(true);

  useEffect(() => {
    setOpen(readBoolean(storageKey("navigator", scope), true));
  }, [scope]);

  const update = useCallback((next: boolean) => {
    window.localStorage.setItem(storageKey("navigator", scope), String(next));
    setOpen(next);
  }, [scope]);

  return { open, setOpen: update };
}
