"use client";

import {useEffect} from "react";

const RELOAD_FLAG = "dysmaths-pwa-reloaded";

export const PWA_INSTALLABLE_EVENT = "dysmaths:pwa-installable";
export const PWA_INSTALLED_EVENT = "dysmaths:pwa-installed";

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{outcome: "accepted" | "dismissed"; platform: string}>;
}

declare global {
  interface Window {
    __dysmathsDeferredInstallPrompt?: BeforeInstallPromptEvent | null;
  }
}

export function PwaRegistration() {
  useEffect(() => {
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as Navigator & {standalone?: boolean}).standalone === true;

    const handleBeforeInstallPrompt = (event: Event) => {
      const promptEvent = event as BeforeInstallPromptEvent;
      promptEvent.preventDefault();
      window.__dysmathsDeferredInstallPrompt = promptEvent;
      window.dispatchEvent(new CustomEvent(PWA_INSTALLABLE_EVENT, {detail: {available: true}}));
    };

    const handleInstalled = () => {
      window.__dysmathsDeferredInstallPrompt = null;
      window.dispatchEvent(new CustomEvent(PWA_INSTALLABLE_EVENT, {detail: {available: false}}));
      window.dispatchEvent(new CustomEvent(PWA_INSTALLED_EVENT));
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt as EventListener);
    window.addEventListener("appinstalled", handleInstalled);

    if (window.__dysmathsDeferredInstallPrompt) {
      window.dispatchEvent(new CustomEvent(PWA_INSTALLABLE_EVENT, {detail: {available: true}}));
    } else if (isStandalone) {
      window.dispatchEvent(new CustomEvent(PWA_INSTALLABLE_EVENT, {detail: {available: false}}));
      window.dispatchEvent(new CustomEvent(PWA_INSTALLED_EVENT));
    }

    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") {
      return () => {
        window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt as EventListener);
        window.removeEventListener("appinstalled", handleInstalled);
      };
    }

    let refreshing = false;

    const reloadOnce = () => {
      if (refreshing) {
        return;
      }

      if (window.sessionStorage.getItem(RELOAD_FLAG) === "1") {
        window.sessionStorage.removeItem(RELOAD_FLAG);
        return;
      }

      refreshing = true;
      window.sessionStorage.setItem(RELOAD_FLAG, "1");
      window.location.reload();
    };

    const activateWaitingWorker = (registration: ServiceWorkerRegistration) => {
      if (registration.waiting) {
        registration.waiting.postMessage({type: "SKIP_WAITING"});
      }
    };

    let removeControllerListener: (() => void) | undefined;
    let removeOnlineListener: (() => void) | undefined;
    let removeVisibilityListener: (() => void) | undefined;

    const registerServiceWorker = async () => {
      const registration = await navigator.serviceWorker.register("/sw.js", {scope: "/"});

      activateWaitingWorker(registration);

      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        if (!worker) {
          return;
        }

        worker.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) {
            activateWaitingWorker(registration);
          }
        });
      });

      navigator.serviceWorker.addEventListener("controllerchange", reloadOnce);
      removeControllerListener = () => navigator.serviceWorker.removeEventListener("controllerchange", reloadOnce);

      const updateNow = () => {
        registration.update().catch(() => undefined);
      };

      window.addEventListener("online", updateNow);
      removeOnlineListener = () => window.removeEventListener("online", updateNow);

      const handleVisibilityChange = () => {
        if (document.visibilityState === "visible") {
          updateNow();
        }
      };

      document.addEventListener("visibilitychange", handleVisibilityChange);
      removeVisibilityListener = () => document.removeEventListener("visibilitychange", handleVisibilityChange);
    };

    registerServiceWorker().catch(() => undefined);

    return () => {
      removeControllerListener?.();
      removeOnlineListener?.();
      removeVisibilityListener?.();
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt as EventListener);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  return null;
}
