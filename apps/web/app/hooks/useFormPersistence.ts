/**
 * Hook for persisting form data to sessionStorage
 * Prevents data loss when navigating away from forms.
 *
 * Secrets are never persisted: any field whose name looks like a password,
 * passcode, PIN, token or secret is dropped before writing, and dropped again
 * on read so drafts saved by older builds can't be restored.
 */

import { useEffect, useCallback } from 'react';

const SECRET_FIELD_RE = /pass(word|code)?|pin$|secret|token|otp|cvc|cvv/i;

/** Returns a shallow copy of `data` without secret-looking fields. */
export function stripSecretFields<T extends object>(data: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (!SECRET_FIELD_RE.test(k)) out[k] = v;
  }
  return out as Partial<T>;
}

export function useFormPersistence<T extends object>(
  formKey: string,
  formData: T,
  options: {
    enabled?: boolean;
    clearOnUnmount?: boolean;
  } = {}
) {
  const { enabled = true, clearOnUnmount = false } = options;

  // Save form data to sessionStorage
  const saveForm = useCallback(
    (data: T) => {
      if (!enabled) return;
      try {
        sessionStorage.setItem(formKey, JSON.stringify(stripSecretFields(data)));
      } catch (error) {
        console.error('Error saving form to sessionStorage:', error);
      }
    },
    [formKey, enabled]
  );

  // Load form data from sessionStorage
  const loadForm = useCallback((): Partial<T> | null => {
    if (!enabled) return null;
    try {
      const saved = sessionStorage.getItem(formKey);
      if (saved) {
        const parsed = JSON.parse(saved) as T;
        const clean = stripSecretFields(parsed);
        // Scrub drafts written before secrets were filtered.
        if (Object.keys(clean).length !== Object.keys(parsed).length) {
          sessionStorage.setItem(formKey, JSON.stringify(clean));
        }
        return clean;
      }
    } catch (error) {
      console.error('Error loading form from sessionStorage:', error);
    }
    return null;
  }, [formKey, enabled]);

  // Clear form data from sessionStorage
  const clearForm = useCallback(() => {
    try {
      sessionStorage.removeItem(formKey);
    } catch (error) {
      console.error('Error clearing form from sessionStorage:', error);
    }
  }, [formKey]);

  // Auto-save on form data change
  useEffect(() => {
    if (enabled && formData) {
      saveForm(formData);
    }
  }, [formData, enabled, saveForm]);

  // Clear on unmount if specified
  useEffect(() => {
    return () => {
      if (clearOnUnmount) {
        clearForm();
      }
    };
  }, [clearOnUnmount, clearForm]);

  return {
    saveForm,
    loadForm,
    clearForm,
  };
}
