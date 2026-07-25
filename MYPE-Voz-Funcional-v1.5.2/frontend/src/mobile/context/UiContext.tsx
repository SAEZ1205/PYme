import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ACTIVE_OPERATOR_STORAGE_KEY,
  setActiveOperatorName,
} from "../../services/operator.service";

const PEOPLE_KEY = "mype-voz-operators";

interface UiContextValue {
  activePerson: string;
  people: string[];
  changePerson: (name: string) => void;
  addPerson: (name: string) => void;
}

const UiContext = createContext<UiContextValue | null>(null);

function readPeople(): string[] {
  try {
    const saved = JSON.parse(window.localStorage.getItem(PEOPLE_KEY) ?? "[]") as unknown;
    if (Array.isArray(saved)) {
      const valid = saved.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
      if (valid.length) return valid;
    }
  } catch {
    // Se usa el valor inicial.
  }
  return ["Yo"];
}

export function UiProvider({ children }: { children: ReactNode }) {
  const [people, setPeople] = useState<string[]>(readPeople);
  const [activePerson, setActivePerson] = useState(() => {
    const saved = window.localStorage.getItem(ACTIVE_OPERATOR_STORAGE_KEY);
    return saved?.trim() || readPeople()[0] || "Yo";
  });

  useEffect(() => {
    setActiveOperatorName(activePerson);
  }, [activePerson]);

  const value = useMemo<UiContextValue>(() => ({
    activePerson,
    people,
    changePerson(name) {
      setActivePerson(name);
      setActiveOperatorName(name);
    },
    addPerson(name) {
      const clean = name.trim();
      if (!clean) return;
      setPeople((current) => {
        const next = current.some((item) => item.toLowerCase() === clean.toLowerCase())
          ? current
          : [...current, clean];
        window.localStorage.setItem(PEOPLE_KEY, JSON.stringify(next));
        return next;
      });
      setActivePerson(clean);
      setActiveOperatorName(clean);
    },
  }), [activePerson, people]);

  return <UiContext.Provider value={value}>{children}</UiContext.Provider>;
}

export function useUi() {
  const value = useContext(UiContext) as UiContextValue | null;
  if (!value) throw new Error("useUi debe usarse dentro de UiProvider.");
  return value;
}
