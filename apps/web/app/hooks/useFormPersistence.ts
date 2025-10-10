/**
 * Hook for persisting form data to sessionStorage
 * Prevents data loss when navigating away from forms
 */

import { useEffect, useCallback } from 'react';

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
        sessionStorage.setItem(formKey, JSON.stringify(data));
      } catch (error) {
        console.error('Error saving form to sessionStorage:', error);
      }
    },
    [formKey, enabled]
  );

  // Load form data from sessionStorage
  const loadForm = useCallback((): T | null => {
    if (!enabled) return null;
    try {
      const saved = sessionStorage.getItem(formKey);
      if (saved) {
        return JSON.parse(saved) as T;
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
