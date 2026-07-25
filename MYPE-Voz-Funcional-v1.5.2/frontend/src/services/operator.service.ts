export const ACTIVE_OPERATOR_STORAGE_KEY = "mype-voz-active-operator";

export function getActiveOperatorName(): string | null {
  const value = window.localStorage.getItem(ACTIVE_OPERATOR_STORAGE_KEY);
  return value?.trim() || null;
}

export function setActiveOperatorName(name: string): void {
  window.localStorage.setItem(ACTIVE_OPERATOR_STORAGE_KEY, name.trim());
}
